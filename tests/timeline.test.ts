import {
  InterpolateDiscrete,
  InterpolateLinear,
  InterpolateSmooth,
  Object3D,
  PerspectiveCamera,
  QuaternionKeyframeTrack,
  NumberKeyframeTrack,
  VectorKeyframeTrack,
} from 'three';
import { describe, expect, it } from 'vitest';
import { buildClip, channelBinding } from '../src/animation/compile.js';
import { Playback } from '../src/animation/playback.js';
import { Project, type ObjectId } from '../src/document/project.js';
import {
  addKeyframe,
  ensureTrack,
  findTrack,
  maxKeyframeTime,
  moveKeyframe,
  removeKeyframe,
  removeTracksFor,
  setDuration,
  setInterpolation,
  sortKeyframes,
  trackKey,
  type Timeline,
  type Track,
  type TrackChannel,
  type TrackTarget,
} from '../src/document/timeline.js';

const CHANNELS: readonly TrackChannel[] = ['position', 'quaternion', 'scale', 'fov'];

/** Keyframe times in array order, in the authoring unit (whole milliseconds). */
function times(track: Track | undefined): number[] {
  return (track?.keyframes ?? []).map((keyframe) => keyframe.timeMs);
}

/** Keyframe ids in array order, so a move or a replace can be traced to the same keyframe. */
function ids(track: Track | undefined): string[] {
  return (track?.keyframes ?? []).map((keyframe) => keyframe.id);
}

/** Keyframe values in array order, flattened, so "changed nothing" is observable. */
function values(track: Track | undefined): number[][] {
  return (track?.keyframes ?? []).map((keyframe) => [...keyframe.value]);
}

function oneProject() {
  const project = new Project();
  const car = project.createObject({ name: 'car', representation: 'empty' });
  const wheel = project.createObject({ name: 'wheel', parentId: car.id, representation: 'empty' });
  project.timeline.fps = 10;
  project.timeline.durationMs = 2000;
  return { project, car, wheel };
}

function objectTarget(objectId: ObjectId): TrackTarget {
  return { kind: 'object', objectId };
}

const CAMERA: TrackTarget = { kind: 'camera' };

/**
 * A mirror shaped like `SceneMirror`: one scene root, one node per project object, and the output
 * camera as a child of that root. `Playback.bind` names the nodes after their ids (D22).
 */
function mirrorFor(project: Project, objectId: ObjectId) {
  const root = new Object3D();
  root.name = 'scene';
  const nodes = new Map<ObjectId, Object3D>();
  for (const id of project.objects.keys()) {
    const object = new Object3D();
    root.add(object);
    nodes.set(id, object);
  }
  const camera = new PerspectiveCamera(50, 1, 0.1, 2000);
  root.add(camera);
  const playback = new Playback({ camera });
  playback.bind(nodes);
  playback.rebuild(project);
  const node = nodes.get(objectId);
  if (node === undefined) throw new Error(`no mirror node for ${objectId}`);
  return { playback, node, camera };
}

describe('track identity', () => {
  it('keys a distinct string per target kind, object id, and channel', () => {
    const { project, car, wheel } = oneProject();
    const targets: TrackTarget[] = [
      CAMERA,
      objectTarget(car.id),
      objectTarget(wheel.id),
      objectTarget('obj-999'),
    ];
    const keys = new Set<string>();
    let count = 0;
    for (const target of targets) {
      for (const channel of CHANNELS) {
        keys.add(trackKey(target, channel));
        count += 1;
      }
    }
    expect(keys.size).toBe(count);
    expect(trackKey(CAMERA, 'position')).not.toBe(trackKey(objectTarget(car.id), 'position'));
    expect(trackKey(objectTarget(car.id), 'position')).not.toBe(
      trackKey(objectTarget(car.id), 'quaternion'),
    );
    expect(project.objects.size).toBe(2);
  });

  it('creates a missing track with the default interpolation and returns the existing one again', () => {
    const { project, car } = oneProject();
    const track = ensureTrack(project.timeline, objectTarget(car.id), 'position');
    expect(track.interpolation).toBe('linear');
    expect(track.keyframes).toEqual([]);
    expect(project.timeline.tracks).toHaveLength(1);

    const again = ensureTrack(project.timeline, objectTarget(car.id), 'position', 'step');
    expect(again).toBe(track);
    expect(project.timeline.tracks).toHaveLength(1);
    expect(again.interpolation).toBe('linear');

    const explicit = ensureTrack(project.timeline, objectTarget(car.id), 'scale', 'smooth');
    expect(explicit.interpolation).toBe('smooth');
    expect(project.timeline.tracks).toHaveLength(2);
  });

  it('finds a track and returns undefined when the target has none', () => {
    const { project, car, wheel } = oneProject();
    const track = ensureTrack(project.timeline, CAMERA, 'fov');
    expect(findTrack(project.timeline, CAMERA, 'fov')).toBe(track);
    expect(findTrack(project.timeline, CAMERA, 'position')).toBeUndefined();
    expect(findTrack(project.timeline, objectTarget(car.id), 'fov')).toBeUndefined();
    expect(findTrack(project.timeline, objectTarget(wheel.id), 'fov')).toBeUndefined();
  });
});

describe('keyframes', () => {
  it('keeps keyframes strictly ascending by time after an out-of-order insert', () => {
    const { project, car } = oneProject();
    const target = objectTarget(car.id);
    const timeline = project.timeline;
    addKeyframe(timeline, target, 'position', 1000, [1, 0, 0]);
    addKeyframe(timeline, target, 'position', 500, [0.5, 0, 0]);
    addKeyframe(timeline, target, 'position', 2000, [2, 0, 0]);
    addKeyframe(timeline, target, 'position', 0, [0, 0, 0]);
    const track = findTrack(timeline, target, 'position');
    expect(times(track)).toEqual([0, 500, 1000, 2000]);
    expect(values(track)).toEqual([
      [0, 0, 0],
      [0.5, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ]);
  });

  it('replaces the value of a keyframe already sitting at that time', () => {
    const { project, car } = oneProject();
    const target = objectTarget(car.id);
    const authored = [1, 2, 3];
    const first = addKeyframe(project.timeline, target, 'position', 1000, authored);
    const second = addKeyframe(project.timeline, target, 'position', 1000, [4, 5, 6]);
    const track = findTrack(project.timeline, target, 'position');
    expect(times(track)).toEqual([1000]);
    expect(values(track)).toEqual([[4, 5, 6]]);
    if (!first.ok || !second.ok) throw new Error('both inserts must succeed');
    expect(second.keyframe).toBe(first.keyframe);
    expect(first.keyframe.value).not.toBe(authored);
    authored[0] = 99;
    expect(first.keyframe.value).toEqual([4, 5, 6]);
  });

  it('rejects a value whose length does not match the channel with bad-value-length', () => {
    const { project, car } = oneProject();
    const target = objectTarget(car.id);
    const timeline = project.timeline;
    addKeyframe(timeline, target, 'position', 0, [0, 0, 0]);
    const before = values(findTrack(timeline, target, 'position'));

    const short = addKeyframe(timeline, target, 'quaternion', 500, [0, 0, 0]);
    expect(short.ok).toBe(false);
    if (!short.ok) {
      expect(short.error).toBe('bad-value-length');
      expect(short.detail.length).toBeGreaterThan(0);
    }

    const long = addKeyframe(timeline, target, 'fov', 500, [1, 2, 3]);
    expect(long.ok).toBe(false);
    expect(findTrack(timeline, target, 'quaternion')).toBeUndefined();
    expect(findTrack(timeline, target, 'fov')).toBeUndefined();
    expect(values(findTrack(timeline, target, 'position'))).toEqual(before);

    // A time outside the clip is clamped rather than rejected; only a non-finite one is a programmer error.
    expect(() => addKeyframe(timeline, target, 'position', Infinity, [0, 0, 0])).toThrow(RangeError);
    expect(() => addKeyframe(timeline, target, 'position', 500, [0, Number.NaN, 0])).toThrow(
      TypeError,
    );
    expect(() =>
      moveKeyframe(timeline, target, 'position', 'keyframe-999', Number.NaN),
    ).toThrow(RangeError);
    expect(values(findTrack(timeline, target, 'position'))).toEqual(before);
  });

  it('moves a keyframe by id and reports whether anything changed', () => {
    const { project, car } = oneProject();
    const target = objectTarget(car.id);
    const timeline = project.timeline;
    const moved = addKeyframe(timeline, target, 'position', 1500, [1.5, 0, 0]);
    addKeyframe(timeline, target, 'position', 0, [0, 0, 0]);
    addKeyframe(timeline, target, 'position', 500, [0.5, 0, 0]);
    if (!moved.ok) throw new Error('insert must succeed');
    const track = findTrack(timeline, target, 'position');

    expect(moveKeyframe(timeline, target, 'position', moved.keyframe.id, 250)).toBe(true);
    expect(times(track)).toEqual([0, 250, 500]);
    expect(values(track)).toEqual([
      [0, 0, 0],
      [1.5, 0, 0],
      [0.5, 0, 0],
    ]);

    const snapshot = values(track);
    expect(moveKeyframe(timeline, target, 'position', 'keyframe-999', 1000)).toBe(false);
    expect(moveKeyframe(timeline, CAMERA, 'fov', moved.keyframe.id, 1000)).toBe(false);
    expect(values(track)).toEqual(snapshot);

    // Moving a keyframe onto the time it already has changes nothing but still counts as a move.
    expect(moveKeyframe(timeline, target, 'position', moved.keyframe.id, 250)).toBe(true);
    expect(times(track)).toEqual([0, 250, 500]);

    // A moved time is clamped onto the clip the same way an added one is.
    expect(moveKeyframe(timeline, target, 'position', moved.keyframe.id, 2500)).toBe(true);
    expect(times(track)).toEqual([0, 500, 2000]);
  });

  it('refuses to move a keyframe onto a millisecond another one holds, leaving both untouched', () => {
    const { project, car } = oneProject();
    const target = objectTarget(car.id);
    const timeline = project.timeline;
    const moved = addKeyframe(timeline, target, 'position', 1500, [1.5, 0, 0]);
    const start = addKeyframe(timeline, target, 'position', 0, [0, 0, 0]);
    const occupied = addKeyframe(timeline, target, 'position', 500, [0.5, 0, 0]);
    if (!moved.ok || !start.ok || !occupied.ok) throw new Error('every insert must succeed');
    const track = findTrack(timeline, target, 'position');

    expect(moveKeyframe(timeline, target, 'position', moved.keyframe.id, 500)).toBe(false);
    // The candidate time is clamped before the collision is judged, so this lands on the same millisecond.
    expect(moveKeyframe(timeline, target, 'position', moved.keyframe.id, 500.4)).toBe(false);
    expect(times(track)).toEqual([0, 500, 1500]);
    expect(values(track)).toEqual([
      [0, 0, 0],
      [0.5, 0, 0],
      [1.5, 0, 0],
    ]);
    expect(ids(track)).toEqual([start.keyframe.id, occupied.keyframe.id, moved.keyframe.id]);
  });

  it('removes a keyframe by id and reports whether anything changed', () => {
    const { project, car } = oneProject();
    const target = objectTarget(car.id);
    const timeline = project.timeline;
    const first = addKeyframe(timeline, target, 'position', 0, [0, 0, 0]);
    addKeyframe(timeline, target, 'position', 500, [0.5, 0, 0]);
    addKeyframe(timeline, target, 'position', 1500, [1.5, 0, 0]);
    if (!first.ok) throw new Error('insert must succeed');
    const track = findTrack(timeline, target, 'position');

    expect(removeKeyframe(timeline, target, 'position', 'keyframe-999')).toBe(false);
    expect(removeKeyframe(timeline, CAMERA, 'fov', first.keyframe.id)).toBe(false);
    expect(times(track)).toEqual([0, 500, 1500]);

    expect(removeKeyframe(timeline, target, 'position', first.keyframe.id)).toBe(true);
    expect(times(track)).toEqual([500, 1500]);
    expect(values(track)).toEqual([
      [0.5, 0, 0],
      [1.5, 0, 0],
    ]);
  });

  it('keeps an emptied track in place, with its interpolation and its slot in the clip', () => {
    const { project, car } = oneProject();
    const target = objectTarget(car.id);
    const timeline = project.timeline;
    const track = ensureTrack(timeline, target, 'scale', 'smooth');
    const added = addKeyframe(timeline, target, 'scale', 0, [1, 1, 1]);
    if (!added.ok) throw new Error('insert must succeed');

    expect(removeKeyframe(timeline, target, 'scale', added.keyframe.id)).toBe(true);
    expect(findTrack(timeline, target, 'scale')).toBe(track);
    expect(track.interpolation).toBe('smooth');
    expect(times(track)).toEqual([]);
    expect(timeline.tracks).toHaveLength(1);
    // An empty track is a normal state: it contributes no track to a compiled clip.
    expect(buildClip(project).tracks).toHaveLength(0);

    // A keyframe added afterwards joins that same track instead of a fresh one.
    const again = addKeyframe(timeline, target, 'scale', 500, [2, 2, 2]);
    if (!again.ok) throw new Error('insert must succeed');
    expect(findTrack(timeline, target, 'scale')).toBe(track);
    expect(timeline.tracks).toHaveLength(1);
    expect(times(track)).toEqual([500]);
    expect(buildClip(project).tracks.map((compiled) => compiled.name)).toEqual([`${car.id}.scale`]);
  });

  it('changes interpolation only for a track that exists', () => {
    const { project, car, wheel } = oneProject();
    const target = objectTarget(car.id);
    ensureTrack(project.timeline, target, 'position');
    expect(setInterpolation(project.timeline, target, 'position', 'smooth')).toBe(true);
    expect(findTrack(project.timeline, target, 'position')?.interpolation).toBe('smooth');
    expect(setInterpolation(project.timeline, objectTarget(wheel.id), 'scale', 'step')).toBe(false);
    expect(project.timeline.tracks).toHaveLength(1);
  });

  it('sorts keyframes in place and drops every object track of a removed object while keeping the camera track', () => {
    const ids = new Project();
    const firstId = ids.allocateId();
    const secondId = ids.allocateId();
    const timeline: Timeline = {
      durationMs: 3000,
      fps: 24,
      tracks: [
        {
          target: { kind: 'object', objectId: firstId },
          channel: 'position',
          interpolation: 'linear',
          keyframes: [
            { id: 'first-late', timeMs: 2000, value: [2, 0, 0] },
            { id: 'first-start', timeMs: 0, value: [0, 0, 0] },
            { id: 'first-middle', timeMs: 1000, value: [1, 0, 0] },
          ],
        },
        {
          target: { kind: 'object', objectId: secondId },
          channel: 'scale',
          interpolation: 'step',
          keyframes: [
            { id: 'second-late', timeMs: 1500, value: [2, 2, 2] },
            { id: 'second-start', timeMs: 500, value: [1, 1, 1] },
          ],
        },
      ],
    };
    const firstKeyframes = timeline.tracks[0]?.keyframes;
    const secondKeyframes = timeline.tracks[1]?.keyframes;
    sortKeyframes(timeline);
    expect(timeline.tracks[0]?.keyframes).toBe(firstKeyframes);
    expect(timeline.tracks[1]?.keyframes).toBe(secondKeyframes);
    expect(times(timeline.tracks[0])).toEqual([0, 1000, 2000]);
    expect(times(timeline.tracks[1])).toEqual([500, 1500]);

    const { project, car } = oneProject();
    const carTarget = objectTarget(car.id);
    addKeyframe(project.timeline, carTarget, 'quaternion', 0, [0, 0, 0, 1]);
    addKeyframe(project.timeline, CAMERA, 'fov', 0, [50]);
    const tracks = project.timeline.tracks;
    project.remove(car.id);
    expect(project.timeline.tracks).toBe(tracks);
    expect(findTrack(project.timeline, carTarget, 'quaternion')).toBeUndefined();
    expect(findTrack(project.timeline, CAMERA, 'fov')?.keyframes).toHaveLength(1);

    removeTracksFor(project.timeline, 'obj-999');
    expect(project.timeline.tracks).toHaveLength(1);
  });

});

describe('clamped authoring times', () => {
  it('clamps an added time onto whole milliseconds inside the clip', () => {
    const { project, car } = oneProject();
    const target = objectTarget(car.id);
    const timeline = project.timeline;
    addKeyframe(timeline, target, 'position', 2500, [2.5, 0, 0]); // past the end
    addKeyframe(timeline, target, 'position', -750, [-0.75, 0, 0]); // before the start
    addKeyframe(timeline, target, 'position', 500.6, [0.6, 0, 0]); // rounds up
    addKeyframe(timeline, target, 'position', 500.4, [0.4, 0, 0]); // rounds down
    const track = findTrack(timeline, target, 'position');
    expect(times(track)).toEqual([0, 500, 501, 2000]);
    expect(values(track)).toEqual([
      [-0.75, 0, 0],
      [0.4, 0, 0],
      [0.6, 0, 0],
      [2.5, 0, 0],
    ]);
  });

  it('keeps the id and replaces the value when an add rounds onto the occupied millisecond', () => {
    const { project, car } = oneProject();
    const target = objectTarget(car.id);
    const timeline = project.timeline;
    const first = addKeyframe(timeline, target, 'position', 500, [0.5, 0, 0]);
    const second = addKeyframe(timeline, target, 'position', 500.4, [9, 9, 9]);
    if (!first.ok || !second.ok) throw new Error('both inserts must succeed');
    const track = findTrack(timeline, target, 'position');
    expect(times(track)).toEqual([500]);
    expect(values(track)).toEqual([[9, 9, 9]]);
    expect(ids(track)).toEqual([first.keyframe.id]);
    expect(second.keyframe).toBe(first.keyframe);
  });

  it('clamps a shortened duration and keeps the later of two keyframes that collapse', () => {
    const { project, car } = oneProject();
    const target = objectTarget(car.id);
    const timeline = project.timeline;
    addKeyframe(timeline, target, 'position', 500, [0.5, 0, 0]);
    const last = addKeyframe(timeline, target, 'position', 1800, [1.8, 0, 0]);
    if (!last.ok) throw new Error('insert must succeed');
    const track = findTrack(timeline, target, 'position');

    setDuration(timeline, 1200);
    expect(timeline.durationMs).toBe(1200);
    expect(times(track)).toEqual([500, 1200]); // only the keyframe past the new end moves

    setDuration(timeline, 400);
    expect(timeline.durationMs).toBe(400);
    expect(times(track)).toEqual([400]);
    expect(ids(track)).toEqual([last.keyframe.id]); // the later authored time wins the collision
    expect(values(track)).toEqual([[1.8, 0, 0]]);
  });

  it('reports the latest keyframe time across tracks, and 0 with no keyframes', () => {
    const { project, car, wheel } = oneProject();
    const timeline = project.timeline;
    expect(maxKeyframeTime(timeline)).toBe(0);

    addKeyframe(timeline, CAMERA, 'fov', 1250, [70]);
    addKeyframe(timeline, CAMERA, 'fov', 0, [50]);
    addKeyframe(timeline, objectTarget(car.id), 'position', 800, [1, 0, 0]);
    expect(maxKeyframeTime(timeline)).toBe(1250);

    const latest = addKeyframe(timeline, objectTarget(wheel.id), 'scale', 1900, [2, 2, 2]);
    if (!latest.ok) throw new Error('insert must succeed');
    expect(maxKeyframeTime(timeline)).toBe(1900);

    // An emptied track holds no time, so the latest keyframe of another track becomes the answer.
    removeKeyframe(timeline, objectTarget(wheel.id), 'scale', latest.keyframe.id);
    expect(maxKeyframeTime(timeline)).toBe(1250);
  });
});

describe('clip compilation', () => {
  it('maps step, linear, and smooth to the matching Three.js interpolation modes', () => {
    const { project, car, wheel } = oneProject();
    const carTarget = objectTarget(car.id);
    const wheelTarget = objectTarget(wheel.id);
    addKeyframe(project.timeline, carTarget, 'position', 0, [0, 0, 0]);
    addKeyframe(project.timeline, carTarget, 'position', 1000, [1, 1, 1]);
    addKeyframe(project.timeline, wheelTarget, 'scale', 0, [1, 1, 1]);
    addKeyframe(project.timeline, CAMERA, 'fov', 0, [50]);
    addKeyframe(project.timeline, CAMERA, 'fov', 1000, [70]);
    setInterpolation(project.timeline, carTarget, 'position', 'step');
    setInterpolation(project.timeline, wheelTarget, 'scale', 'smooth');
    setInterpolation(project.timeline, CAMERA, 'fov', 'linear');

    const clip = buildClip(project);
    const byName = new Map(clip.tracks.map((track) => [track.name, track]));
    expect(byName.get(`${car.id}.position`)?.getInterpolation()).toBe(InterpolateDiscrete);
    expect(byName.get(`${wheel.id}.scale`)?.getInterpolation()).toBe(InterpolateSmooth);
    expect(byName.get('camera.fov')?.getInterpolation()).toBe(InterpolateLinear);
    expect(byName.get(`${car.id}.position`)).toBeInstanceOf(VectorKeyframeTrack);
    expect(byName.get(`${wheel.id}.scale`)).toBeInstanceOf(VectorKeyframeTrack);
    expect(byName.get('camera.fov')).toBeInstanceOf(NumberKeyframeTrack);
  });

  it('binds each channel to its property path and value size', () => {
    expect(channelBinding('position')).toEqual({ path: '.position', valueSize: 3 });
    expect(channelBinding('quaternion')).toEqual({ path: '.quaternion', valueSize: 4 });
    expect(channelBinding('scale')).toEqual({ path: '.scale', valueSize: 3 });
    expect(channelBinding('fov')).toEqual({ path: '.fov', valueSize: 1 });

    const { project, car } = oneProject();
    const target = objectTarget(car.id);
    addKeyframe(project.timeline, target, 'quaternion', 0, [0, 0, 0, 1]);
    addKeyframe(project.timeline, target, 'quaternion', 500, [0, 0, 0, 1]);
    const clip = buildClip(project);
    const track = clip.tracks[0];
    expect(track).toBeInstanceOf(QuaternionKeyframeTrack);
    expect(track?.name).toBe(`${car.id}.quaternion`);
    expect(track?.times.length).toBe(2);
    expect(track?.values.length).toBe(2 * 4);
  });

  it('names object tracks obj-<n>.<path> and the camera track camera.fov', () => {
    const { project, car, wheel } = oneProject();
    addKeyframe(project.timeline, objectTarget(car.id), 'position', 0, [0, 0, 0]);
    addKeyframe(project.timeline, objectTarget(wheel.id), 'quaternion', 0, [0, 0, 0, 1]);
    addKeyframe(project.timeline, CAMERA, 'fov', 0, [50]);
    const names = buildClip(project).tracks.map((track) => track.name);
    expect(names).toEqual([`${car.id}.position`, `${wheel.id}.quaternion`, 'camera.fov']);
    expect(car.id).toMatch(/^obj-\d+$/);
  });

  it('skips objects that own no tracks and takes the duration from the timeline', () => {
    const { project, car, wheel } = oneProject();
    addKeyframe(project.timeline, objectTarget(car.id), 'position', 0, [0, 0, 0]);
    addKeyframe(project.timeline, objectTarget(car.id), 'position', 1000, [1, 1, 1]);
    expect(project.objects.has(wheel.id)).toBe(true);
    expect(buildClip(project).tracks).toHaveLength(1);

    project.timeline.durationMs = 5000;
    const stretched = buildClip(project);
    expect(stretched.duration).toBe(5);
    // The clip is seconds while the timeline is milliseconds, so 1000 ms reads back as one.
    expect(stretched.tracks[0]?.times[1]).toBe(1);

    const empty = new Project();
    expect(buildClip(empty).tracks).toHaveLength(0);
    expect(buildClip(empty).duration).toBe(0);
  });
});

describe('playback sampling', () => {
  it('reproduces each keyframe value exactly at its keyframe time', () => {
    const { project, car } = oneProject();
    const target = objectTarget(car.id);
    addKeyframe(project.timeline, target, 'position', 0, [1.5, -2.25, 0]);
    addKeyframe(project.timeline, target, 'position', 500, [4, 5.5, -6]);
    addKeyframe(project.timeline, target, 'position', 1500, [0.25, 0, 8]);
    addKeyframe(project.timeline, target, 'quaternion', 0, [0, 0, 0, 1]);
    addKeyframe(project.timeline, target, 'quaternion', 1000, [0.5, 0.5, 0.5, 0.5]);
    addKeyframe(project.timeline, CAMERA, 'fov', 0, [40]);
    addKeyframe(project.timeline, CAMERA, 'fov', 1000, [70]);

    const { playback, node, camera } = mirrorFor(project, car.id);
    expect(playback.duration).toBe(2);

    // Authoring is milliseconds and the compiled clip is seconds, so these are the keyframe times over 1000.
    const expectations: readonly (readonly [number, readonly number[]])[] = [
      [0, [1.5, -2.25, 0]],
      [0.5, [4, 5.5, -6]],
      [1.5, [0.25, 0, 8]],
    ];
    for (const [time, position] of expectations) {
      playback.setTime(time);
      expect(node.position.toArray()).toEqual([...position]);
    }

    playback.setTime(0);
    expect(node.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    playback.setTime(1);
    expect(node.quaternion.toArray()).toEqual([0.5, 0.5, 0.5, 0.5]);

    playback.setTime(1);
    expect(camera.fov).toBe(70);
    const expectedProjection = new PerspectiveCamera(70, 1, 0.1, 2000);
    expect(camera.projectionMatrix.elements).toEqual(expectedProjection.projectionMatrix.elements);

    // The mixer animates the mirror only: the project's own transform is untouched.
    expect(project.get(car.id)?.transform.position.toArray()).toEqual([0, 0, 0]);
    expect(project.camera.fov).toBe(50);
  });

  it('keeps the current time when the clip is rebuilt after an edit', () => {
    const { project, car } = oneProject();
    const target = objectTarget(car.id);
    addKeyframe(project.timeline, target, 'position', 0, [0, 0, 0]);
    addKeyframe(project.timeline, target, 'position', 500, [0.5, 0, 0]);
    const { playback, node } = mirrorFor(project, car.id);

    playback.setTime(0.5);
    expect(playback.time).toBe(0.5);

    addKeyframe(project.timeline, target, 'position', 1500, [1.5, 0, 0]);
    project.timeline.durationMs = 3000;
    playback.rebuild(project);
    expect(playback.time).toBe(0.5);
    expect(playback.duration).toBe(3);

    playback.setTime(1.5);
    expect(node.position.toArray()).toEqual([1.5, 0, 0]);

    // Transport state survives the rebuild: the action is still playing and still looping.
    playback.play();
    playback.setLoop(true);
    playback.rebuild(project);
    expect(playback.time).toBe(1.5);
    playback.advance(1.5);
    expect(playback.time).toBe(0); // 1.5 + 1.5 = 3 seconds wrapped by the 3 second loop

    playback.stop();
    expect(playback.time).toBe(0);
    expect(node.position.toArray()).toEqual([0, 0, 0]);
  });
});
