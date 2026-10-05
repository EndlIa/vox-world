/**
 * The authored camera: takes, segments, keys, and the one pure evaluator. Pure records and arithmetic, so the suite is
 * node-side and needs no renderer — the boundaries it pins are the ones a viewer would otherwise have to notice: what
 * a take holds between keys, which segment owns an instant, and that a cut is exact.
 */

import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import type { Camera } from '../src/document/camera.js';
import {
  activeTake,
  addTake,
  adoptCameraIds,
  createCamera,
  moveKey,
  removeKey,
  removeSegment,
  removeTake,
  renameTake,
  resolveCameraAt,
  retimeCamera,
  segmentAt,
  setActiveTake,
  setSegmentEntry,
  setSegmentLensParams,
  setSegmentProjection,
  setSegmentRange,
  splitSegment,
  takeById,
  upsertKey,
} from '../src/document/camera.js';

const DURATION = 2000;

function cameraAt(x: number, y: number, z: number, fov = 50) {
  return createCamera({ durationMs: DURATION, position: new Vector3(x, y, z), quaternion: new Quaternion(), fov });
}

/** The one take and the one segment a fresh camera holds. */
function only(camera: Camera) {
  const take = activeTake(camera);
  if (take === undefined) throw new Error('fixture: the camera has no take');
  const segment = take.segments[0];
  if (segment === undefined) throw new Error('fixture: the take has no segment');
  return { take, segment };
}

describe('the camera a project starts with', () => {
  it('is one active take holding one segment that covers the clip', () => {
    const camera = cameraAt(-5, 6, 4);
    const { take, segment } = only(camera);

    expect(camera.activeTakeId).toBe(take.id);
    expect(camera.takes).toHaveLength(1);
    expect(segment.startMs).toBe(0);
    expect(segment.endMs).toBe(DURATION);
    expect(segment.enter).toBe('start');
    expect(segment.projection).toBe('perspective');
    expect(segment.keys).toHaveLength(1);

    const resolved = resolveCameraAt(camera, 0);
    expect(resolved?.position.toArray()).toEqual([-5, 6, 4]);
    expect(resolved?.lens).toBe(50);
    expect(resolved?.segmentId).toBe(segment.id);
  });

  it('answers for every time in the clip, holding the nearest key outside the authored span', () => {
    const camera = cameraAt(0, 0, 0);
    const { take, segment } = only(camera);
    upsertKey(camera, take.id, segment.id, { timeMs: 500, position: new Vector3(1, 0, 0), quaternion: new Quaternion(), lens: 30 });
    upsertKey(camera, take.id, segment.id, { timeMs: 1000, position: new Vector3(2, 0, 0), quaternion: new Quaternion(), lens: 60 });

    expect(resolveCameraAt(camera, 0)?.position.toArray()).toEqual([0, 0, 0]);
    expect(resolveCameraAt(camera, 500)?.position.toArray()).toEqual([1, 0, 0]);
    expect(resolveCameraAt(camera, 1500)?.position.toArray()).toEqual([2, 0, 0]);
    expect(resolveCameraAt(camera, DURATION)?.position.toArray()).toEqual([2, 0, 0]);
  });

  it('interpolates position and lens linearly and orientation along the shortest arc', () => {
    const camera = cameraAt(0, 0, 0, 20);
    const { take, segment } = only(camera);
    const quarterTurn = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);
    upsertKey(camera, take.id, segment.id, { timeMs: 1000, position: new Vector3(4, 0, 0), quaternion: quarterTurn, lens: 60 });

    const middle = resolveCameraAt(camera, 250);
    expect(middle?.position.x).toBeCloseTo(1, 12);
    expect(middle?.lens).toBeCloseTo(30, 12);
    // A quarter turn at the quarter of the span is an eighth of a turn, which is what slerp gives and a component-wise
    // lerp of the four numbers would not.
    expect(middle?.quaternion.angleTo(new Quaternion())).toBeCloseTo(Math.PI / 8, 6);
  });

  it('resolves purely: two reads of one time are equal and independent', () => {
    const camera = cameraAt(1, 2, 3);
    const first = resolveCameraAt(camera, 500);
    const second = resolveCameraAt(camera, 500);
    expect(first?.position.toArray()).toEqual(second?.position.toArray());
    first?.position.set(9, 9, 9);
    expect(resolveCameraAt(camera, 500)?.position.toArray()).toEqual([1, 2, 3]);
  });
});

describe('segments', () => {
  it('gives an instant to the last segment that starts at or before it, and the clip end to the last one', () => {
    const camera = cameraAt(0, 0, 0);
    const { take, segment } = only(camera);
    splitSegment(camera, take.id, 1000, DURATION);
    const [first, second] = take.segments;
    if (first === undefined || second === undefined) throw new Error('fixture: the split did not produce two segments');

    expect(segmentAt(take, 0)?.id).toBe(first.id);
    expect(segmentAt(take, 999.5)?.id).toBe(first.id);
    expect(segmentAt(take, 1000)?.id).toBe(second.id);
    expect(segmentAt(take, DURATION)?.id).toBe(second.id);
    expect(segment.id).toBe(first.id);
  });

  it('splits into two ranges that tile the take, each keyed at the cut with the state it had there', () => {
    const camera = cameraAt(0, 0, 0);
    const { take, segment } = only(camera);
    upsertKey(camera, take.id, segment.id, { timeMs: 2000, position: new Vector3(8, 0, 0), quaternion: new Quaternion(), lens: 50 });

    const result = splitSegment(camera, take.id, 1000, DURATION);
    expect(result.ok).toBe(true);
    const [first, second] = take.segments;
    if (first === undefined || second === undefined) throw new Error('fixture: the split did not produce two segments');

    expect(first.endMs).toBe(1000);
    expect(second.startMs).toBe(1000);
    expect(second.endMs).toBe(DURATION);
    expect(second.enter).toBe('cut');
    expect(first.keys[first.keys.length - 1]?.timeMs).toBe(1000);
    expect(second.keys[0]?.timeMs).toBe(1000);
    // Both sides of the seam hold the same state until the author moves one, and the cut instant is the later
    // segment's: a fresh split only looks seamless because nothing has diverged yet.
    expect(first.keys[first.keys.length - 1]?.position.toArray()).toEqual(second.keys[0]?.position.toArray());
    expect(resolveCameraAt(camera, 999.99)?.segmentId).toBe(first.id);
    expect(resolveCameraAt(camera, 1000)?.segmentId).toBe(second.id);
    expect(resolveCameraAt(camera, 1000)?.position.toArray()).toEqual([4, 0, 0]);
  });

  it('lets the two sides of a cut diverge, and never blends across the boundary', () => {
    const camera = cameraAt(0, 0, 0);
    const { take, segment } = only(camera);
    splitSegment(camera, take.id, 1000, DURATION);
    const second = take.segments[1];
    if (second === undefined) throw new Error('fixture: no second segment');

    upsertKey(camera, take.id, second.id, { timeMs: 1000, position: new Vector3(0, 5, 0), quaternion: new Quaternion(), lens: 90 });

    expect(resolveCameraAt(camera, 999.9)?.position.toArray()).toEqual([0, 0, 0]);
    expect(resolveCameraAt(camera, 1000)?.position.toArray()).toEqual([0, 5, 0]);
    // Half a millisecond later it is the later segment's own state, not a step along a flight between the two.
    expect(resolveCameraAt(camera, 1000.5)?.position.toArray()).toEqual([0, 5, 0]);
    expect(resolveCameraAt(camera, 1000)?.lens).toBe(90);
  });

  it('refuses a split that would leave an empty segment', () => {
    const camera = cameraAt(0, 0, 0);
    const { take, segment } = only(camera);
    expect(splitSegment(camera, take.id, 0, DURATION)).toMatchObject({ ok: false, error: 'bad-split' });
    expect(splitSegment(camera, take.id, DURATION, DURATION)).toMatchObject({ ok: false, error: 'bad-split' });
    expect(splitSegment(camera, take.id, -1, DURATION)).toMatchObject({ ok: false, error: 'outside-segment' });
    expect(segment.endMs).toBe(DURATION);
  });

  it('closes the hole a removed segment leaves, and refuses to remove the only one', () => {
    const camera = cameraAt(0, 0, 0);
    const { take, segment } = only(camera);
    splitSegment(camera, take.id, 800, DURATION);
    splitSegment(camera, take.id, 1400, DURATION);
    const [first, middle, last] = take.segments;
    if (first === undefined || middle === undefined || last === undefined) throw new Error('fixture: three segments');

    expect(removeSegment(camera, take.id, middle.id)).toBe(true);
    expect(take.segments).toHaveLength(2);
    expect(take.segments[1]?.startMs).toBe(800);
    expect(take.segments[1]?.enter).toBe('cut');

    // The last one leaves its range to the previous segment rather than a hole.
    expect(removeSegment(camera, take.id, last.id)).toBe(true);
    expect(take.segments).toHaveLength(1);
    expect(take.segments[0]?.endMs).toBe(DURATION);

    expect(removeSegment(camera, take.id, segment.id)).toBe(false);
  });

  it('moves a shared boundary for both neighbours, and refuses a range that would empty one', () => {
    const camera = cameraAt(0, 0, 0);
    const { take } = only(camera);
    splitSegment(camera, take.id, 1000, DURATION);
    const [first, second] = take.segments;
    if (first === undefined || second === undefined) throw new Error('fixture: two segments');

    // A cut is a boundary the two shots share, so extending the first one pushes the second one along.
    expect(setSegmentRange(camera, take.id, first.id, { startMs: 0, endMs: 1200 }).ok).toBe(true);
    expect(first.endMs).toBe(1200);
    expect(second.startMs).toBe(1200);

    expect(setSegmentRange(camera, take.id, second.id, { startMs: 900, endMs: DURATION }).ok).toBe(true);
    expect(second.startMs).toBe(900);
    expect(first.endMs).toBe(900);

    // What is refused is a range that would leave its neighbour nothing, or nothing at all.
    expect(setSegmentRange(camera, take.id, first.id, { startMs: 0, endMs: DURATION })).toMatchObject({ ok: false, error: 'overlap' });
    expect(setSegmentRange(camera, take.id, first.id, { startMs: 500, endMs: 500 })).toMatchObject({ ok: false, error: 'bad-range' });
    expect(first.endMs).toBe(900);
  });

  it('keeps the lens scalar across a projection switch and refuses unusable clip planes', () => {
    const camera = cameraAt(0, 0, 0);
    const { take, segment } = only(camera);
    const lens = segment.keys[0]?.lens;
    expect(setSegmentProjection(camera, take.id, segment.id, 'orthographic').ok).toBe(true);
    expect(segment.projection).toBe('orthographic');
    expect(segment.keys[0]?.lens).toBe(lens);

    expect(setSegmentLensParams(camera, take.id, segment.id, { near: 0, far: 10 })).toMatchObject({ ok: false, error: 'bad-lens' });
    expect(setSegmentLensParams(camera, take.id, segment.id, { near: 10, far: 10 })).toMatchObject({ ok: false, error: 'bad-lens' });
    expect(setSegmentLensParams(camera, take.id, segment.id, { near: 1, far: 500 }).ok).toBe(true);
    expect(segment.near).toBe(1);
    expect(segment.far).toBe(500);
  });

  it('accepts a continuous entry only when the two sides really are the same state', () => {
    const camera = cameraAt(0, 0, 0);
    const { take, segment } = only(camera);
    upsertKey(camera, take.id, segment.id, { timeMs: 1000, position: new Vector3(3, 0, 0), quaternion: new Quaternion(), lens: 50 });
    splitSegment(camera, take.id, 1000, DURATION);
    const second = take.segments[1];
    if (second === undefined) throw new Error('fixture: no second segment');

    expect(setSegmentEntry(camera, take.id, second.id, 'continuous').ok).toBe(true);
    upsertKey(camera, take.id, second.id, { timeMs: 1000, position: new Vector3(4, 0, 0), quaternion: new Quaternion(), lens: 50 });
    expect(setSegmentEntry(camera, take.id, second.id, 'continuous')).toMatchObject({ ok: false, error: 'not-continuous' });
    expect(setSegmentEntry(camera, take.id, second.id, 'cut').ok).toBe(true);
    expect(setSegmentEntry(camera, take.id, take.segments[0]!.id, 'continuous')).toMatchObject({ ok: false, error: 'no-previous' });
  });
});

describe('takes', () => {
  it('copies a take deeply, with ids of its own, and can switch to it', () => {
    const camera = cameraAt(2, 0, 0);
    const { take, segment } = only(camera);
    upsertKey(camera, take.id, segment.id, { timeMs: 1000, position: new Vector3(5, 0, 0), quaternion: new Quaternion(), lens: 40 });

    const copy = addTake(camera, { source: take, durationMs: DURATION });
    expect(camera.takes).toHaveLength(2);
    expect(copy.id).not.toBe(take.id);
    expect(copy.name).toContain('copy');
    const copySegment = copy.segments[0];
    if (copySegment === undefined) throw new Error('fixture: the copy has no segment');
    expect(copySegment.id).not.toBe(segment.id);
    expect(copySegment.keys[0]?.id).not.toBe(segment.keys[0]?.id);

    // Editing the copy cannot reach the source: the keys are copies, not references.
    copySegment.keys[0]?.position.set(99, 99, 99);
    expect(resolveCameraAt(camera, 0)?.position.toArray()).toEqual([2, 0, 0]);
    expect(resolveCameraAt(camera, 1000)?.position.toArray()).toEqual([5, 0, 0]);

    expect(setActiveTake(camera, copy.id)).toBe(true);
    expect(resolveCameraAt(camera, 1000)?.position.toArray()).toEqual([5, 0, 0]);
    expect(resolveCameraAt(camera, 1000)?.takeId).toBe(copy.id);
    expect(setActiveTake(camera, 'take-999')).toBe(false);
    expect(renameTake(camera, copy.id, 'Wide')).toBe(true);
    expect(takeById(camera, copy.id)?.name).toBe('Wide');
  });

  it('resolves a named take by id, so a preview and an export can read different plans', () => {
    const camera = cameraAt(2, 0, 0);
    const { take, segment } = only(camera);
    upsertKey(camera, take.id, segment.id, { timeMs: 1000, position: new Vector3(5, 0, 0), quaternion: new Quaternion(), lens: 40 });

    const other = addTake(camera, { name: 'Wide', durationMs: DURATION });
    const otherSegment = other.segments[0];
    if (otherSegment === undefined) throw new Error('fixture: the added take has no segment');
    upsertKey(camera, other.id, otherSegment.id, { timeMs: 0, position: new Vector3(8, 0, 0), quaternion: new Quaternion(), lens: 70 });

    // The active take answers when no id is named; naming one reads that take whatever the active flag says, which is
    // what lets an export render a plan the editor is not previewing.
    expect(setActiveTake(camera, take.id)).toBe(true);
    expect(resolveCameraAt(camera, 0)?.position.toArray()).toEqual([2, 0, 0]);
    expect(resolveCameraAt(camera, 0, other.id)?.position.toArray()).toEqual([8, 0, 0]);
    expect(resolveCameraAt(camera, 0, other.id)?.takeId).toBe(other.id);
    // The other take's own single key holds for the whole clip, so a later time reads it rather than the active take.
    expect(resolveCameraAt(camera, 1000, other.id)?.position.toArray()).toEqual([8, 0, 0]);

    // A take that names nothing resolves to nothing rather than substituting the active take: an export pointed at a
    // deleted take must fail, not render the wrong plan. Omitting the id is what asks for the active take.
    expect(resolveCameraAt(camera, 0, 'take-999')).toBeUndefined();
    expect(resolveCameraAt(camera, 0)?.takeId).toBe(take.id);
  });

  it('keeps at least one take, and hands the active flag on when the active one goes', () => {
    const camera = cameraAt(0, 0, 0);
    const { take } = only(camera);
    const second = addTake(camera, { name: 'Second', durationMs: DURATION });
    setActiveTake(camera, second.id);

    expect(removeTake(camera, second.id)).toBe(true);
    expect(camera.takes).toHaveLength(1);
    expect(camera.activeTakeId).toBe(take.id);
    expect(removeTake(camera, take.id)).toBe(false);
  });

  it('never resolves without a take', () => {
    const camera = cameraAt(0, 0, 0);
    camera.takes = [];
    expect(resolveCameraAt(camera, 0)).toBeUndefined();
  });
});

describe('authoring writes', () => {
  it('clamps a key into its segment and replaces the value at an occupied time, keeping the id', () => {
    const camera = cameraAt(0, 0, 0);
    const { take, segment } = only(camera);

    const late = upsertKey(camera, take.id, segment.id, { timeMs: DURATION + 500, position: new Vector3(1, 0, 0), quaternion: new Quaternion(), lens: 50 });
    expect(late.ok).toBe(true);
    if (!late.ok) throw new Error('');
    expect(late.key.timeMs).toBe(DURATION);

    const replace = upsertKey(camera, take.id, segment.id, { timeMs: DURATION, position: new Vector3(2, 0, 0), quaternion: new Quaternion(), lens: 55 });
    if (!replace.ok) throw new Error('');
    expect(replace.key).toBe(late.key);
    expect(segment.keys).toHaveLength(2);

    expect(upsertKey(camera, take.id, 'segment-999', { timeMs: 0, position: new Vector3(), quaternion: new Quaternion(), lens: 50 })).toMatchObject({
      ok: false,
      error: 'unknown-segment',
    });
  });

  it('moves a key by id, refusing a collision, and refuses to remove the last one', () => {
    const camera = cameraAt(0, 0, 0);
    const { take, segment } = only(camera);
    const inserted = upsertKey(camera, take.id, segment.id, { timeMs: 1000, position: new Vector3(1, 0, 0), quaternion: new Quaternion(), lens: 50 });
    if (!inserted.ok) throw new Error('');

    expect(moveKey(camera, take.id, segment.id, inserted.key.id, 0)).toBe(false);
    expect(moveKey(camera, take.id, segment.id, inserted.key.id, 750)).toBe(true);
    expect(segment.keys.map((key) => key.timeMs)).toEqual([0, 750]);
    expect(moveKey(camera, take.id, segment.id, 'camkey-999', 500)).toBe(false);

    expect(removeKey(camera, take.id, segment.id, inserted.key.id)).toBe(true);
    expect(removeKey(camera, take.id, segment.id, segment.keys[0]!.id)).toBe(false);
    expect(segment.keys).toHaveLength(1);
  });

  it('moves only the two ends when the clip is retimed', () => {
    const camera = cameraAt(0, 0, 0);
    const { take } = only(camera);
    splitSegment(camera, take.id, 800, DURATION);
    splitSegment(camera, take.id, 1400, DURATION);
    const [first, middle, last] = take.segments;
    if (first === undefined || middle === undefined || last === undefined) throw new Error('fixture: three segments');

    retimeCamera(camera, 3000);
    expect(first.startMs).toBe(0);
    expect(middle.startMs).toBe(800);
    expect(middle.endMs).toBe(1400);
    expect(last.endMs).toBe(3000);
  });

  it('raises the id counters above the ids a loaded camera already holds', () => {
    const camera = cameraAt(0, 0, 0);
    const { take, segment } = only(camera);
    take.id = 'take-40';
    segment.id = 'segment-70';
    segment.keys[0]!.id = 'camkey-90';
    adoptCameraIds(camera);

    const second = addTake(camera, { durationMs: DURATION });
    expect(Number(second.id.split('-')[1])).toBeGreaterThan(40);
    const added = second.segments[0];
    if (added === undefined) throw new Error('fixture: no segment');
    expect(Number(added.id.split('-')[1])).toBeGreaterThan(70);
    expect(Number(added.keys[0]!.id.split('-')[1])).toBeGreaterThan(90);
  });
});
