/**
 * The authored camera: named takes, each a chain of segments that tiles the clip, each segment holding its own pose
 * keys, its own projection, and its own lens.
 *
 * It owns camera data and nothing else: plain records and `three` value types, no mirror, no DOM, no evaluation state.
 * `resolveCameraAt` is the one evaluator, and it is a pure function of the takes and a time — the same time always
 * resolves to the same state, whatever ran before it — which is what lets playback, the carrier, the path drawing and
 * an export all read one camera without sharing a mutable pose.
 *
 * The shape exists for three properties a single camera with property tracks cannot hold at once:
 *
 * - **A take is a whole shooting plan.** Copies are cheap and switching is `activeTakeId`, so "copy the take, adjust
 *   it, then decide" is a switch rather than an undo chain. Exactly one take is active, and the others are kept
 *   exactly as they were.
 * - **A segment is a continuous shot.** Inside one segment the camera interpolates; across a boundary it does not,
 *   whatever `enter` says. That is what makes a cut exact: the two states at the cut instant are the *previous*
 *   segment's end state and the *next* segment's start state, and the later one wins, with no interpolated flight
 *   between them and no second keyframe smuggled in a millisecond early.
 * - **The projection belongs to the segment.** Perspective and orthographic are segment properties, so a projection
 *   change can only happen at a cut — never as an interpolation between two kinds, which would mean nothing.
 *
 * Times are the authoring unit, milliseconds at whatever precision the author gave, exactly like `timeline.ts`.
 */

import { Quaternion, Vector3 } from 'three';

/** The two projections a segment can render with. */
export type ProjectionKind = 'perspective' | 'orthographic';

/**
 * How a segment takes over from the one before it. `start` opens the take; `continuous` asserts that the states on
 * both sides of the boundary are the same pose and the same lens, so no viewer can see where the seam is; `cut` jumps
 * and is exactly the case where the two sides differ.
 */
export type SegmentEntry = 'start' | 'continuous' | 'cut';

/**
 * One authored camera state. `lens` is the scalar his own exchange format carries: a vertical field of view in degrees
 * when the segment is perspective, a visible world height when it is orthographic. Which one it is is decided by the
 * segment, never by the key, so a segment's keys always mean the same thing as each other.
 */
export type CameraKey = {
  id: string;
  timeMs: number;
  position: Vector3;
  quaternion: Quaternion;
  lens: number;
};

/**
 * One continuous shot. `startMs`/`endMs` are its range on the clip, half-open on the right so the segments of a take
 * tile the clip without a gap or an overlap; the last segment owns the clip's own end. `keys` is never empty and
 * always ascending — a segment has to be able to answer for every time inside its range — and its ends are held
 * outside the first and last key.
 */
export type CameraSegment = {
  id: string;
  name: string;
  startMs: number;
  endMs: number;
  enter: SegmentEntry;
  projection: ProjectionKind;
  /** Clip planes, constant for the life of the segment. Animating them is deliberately not offered. */
  near: number;
  far: number;
  keys: CameraKey[];
};

/** One named shooting plan, covering the whole clip. */
export type CameraTake = { id: string; name: string; segments: CameraSegment[] };

/** The camera of a project: every take it has, and which one is being edited and rendered. */
export type Camera = { takes: CameraTake[]; activeTakeId: string };

/** What a take says the camera is at one time: everything a renderer or a carrier needs, and no identity of its own. */
export type ResolvedCamera = {
  takeId: string;
  segmentId: string;
  position: Vector3;
  quaternion: Quaternion;
  projection: ProjectionKind;
  lens: number;
  near: number;
  far: number;
};

/** The default vertical field of view, in degrees, of a camera that has not been given one. */
export const DEFAULT_FOV = 50;
export const DEFAULT_NEAR = 0.1;
export const DEFAULT_FAR = 2000;

/** Id shapes this module mints, so `adoptCameraIds` can tell a loaded id from a foreign one. */
const TAKE_ID_PATTERN = /^take-(\d+)$/;
const SEGMENT_ID_PATTERN = /^segment-(\d+)$/;
const CAMERA_KEY_ID_PATTERN = /^camkey-(\d+)$/;

let nextTakeId = 1;
let nextSegmentId = 1;
let nextCameraKeyId = 1;

/**
 * Restore hook: raises the minting counters above every id the camera already holds, so an id loaded from a file can
 * never be minted a second time. Ids of another shape are skipped rather than parsed — they are opaque to every caller
 * but this module, and a foreign file must not be able to steer the counter.
 */
export function adoptCameraIds(camera: Camera): void {
  for (const take of camera.takes) {
    const takeMatch = TAKE_ID_PATTERN.exec(take.id);
    if (takeMatch !== null) nextTakeId = Math.max(nextTakeId, Number(takeMatch[1]) + 1);
    for (const segment of take.segments) {
      const segmentMatch = SEGMENT_ID_PATTERN.exec(segment.id);
      if (segmentMatch !== null) nextSegmentId = Math.max(nextSegmentId, Number(segmentMatch[1]) + 1);
      for (const key of segment.keys) {
        const keyMatch = CAMERA_KEY_ID_PATTERN.exec(key.id);
        if (keyMatch !== null) nextCameraKeyId = Math.max(nextCameraKeyId, Number(keyMatch[1]) + 1);
      }
    }
  }
}

/** One key, copied: the value types are cloned so no two takes can share a mutable pose. */
export function copyKey(key: CameraKey): CameraKey {
  return {
    id: key.id,
    timeMs: key.timeMs,
    position: key.position.clone(),
    quaternion: key.quaternion.clone(),
    lens: key.lens,
  };
}

export function copyTake(take: CameraTake): CameraTake {
  return { id: take.id, name: take.name, segments: take.segments.map((segment) => ({ ...segment, keys: segment.keys.map(copyKey) })) };
}

/** The camera as plain data: one copied take per take, keys included, so a snapshot can be written to and kept. */
export function copyCamera(camera: Camera): Camera {
  return { takes: camera.takes.map(copyTake), activeTakeId: camera.activeTakeId };
}

function assertFinite(value: number, what: string): void {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${what} must be finite, received ${value}`);
  }
}

/**
 * A camera with one take and one segment covering `[0, durationMs]`, opening on the pose and lens it is given. This is
 * the shape a project starts from: a single continuous shot, which is what an author who never touches the camera
 * should get.
 */
export function createCamera(init: {
  durationMs: number;
  position: Vector3;
  quaternion: Quaternion;
  fov?: number;
  near?: number;
  far?: number;
}): Camera {
  const lens = init.fov ?? DEFAULT_FOV;
  const start = init.position.clone();
  const quaternion = init.quaternion.clone();
  const take: CameraTake = {
    id: `take-${nextTakeId++}`,
    name: 'Take 1',
    segments: [
      {
        id: `segment-${nextSegmentId++}`,
        name: 'Shot 1',
        startMs: 0,
        endMs: Math.max(0, init.durationMs),
        enter: 'start',
        projection: 'perspective',
        near: init.near ?? DEFAULT_NEAR,
        far: init.far ?? DEFAULT_FAR,
        keys: [{ id: `camkey-${nextCameraKeyId++}`, timeMs: 0, position: start, quaternion, lens }],
      },
    ],
  };
  return { takes: [take], activeTakeId: take.id };
}

/** The take being edited and rendered, or undefined for a camera with no takes at all. */
export function activeTake(camera: Camera): CameraTake | undefined {
  return camera.takes.find((take) => take.id === camera.activeTakeId) ?? camera.takes[0];
}

export function takeById(camera: Camera, takeId: string): CameraTake | undefined {
  return camera.takes.find((take) => take.id === takeId);
}

/**
 * The segment that owns `timeMs`: the last one that starts at or before it. A time outside the take's range belongs to
 * the nearest end segment, so an author scrubbing past a shortened clip still sees a camera rather than nothing, and
 * the clip's own end belongs to the last segment because a half-open range would otherwise have no owner for it.
 */
export function segmentAt(take: CameraTake, timeMs: number): CameraSegment | undefined {
  let owner: CameraSegment | undefined;
  for (const segment of take.segments) {
    if (segment.startMs > timeMs) break;
    owner = segment;
  }
  return owner ?? take.segments[0];
}

/** Linear between the two keys around `timeMs`, and held outside the first and the last. */
function resolveKey(keys: readonly CameraKey[], timeMs: number, target: { position: Vector3; quaternion: Quaternion; lens: number }): void {
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (first === undefined || last === undefined) return;
  if (timeMs <= first.timeMs) {
    target.position.copy(first.position);
    target.quaternion.copy(first.quaternion);
    target.lens = first.lens;
    return;
  }
  if (timeMs >= last.timeMs) {
    target.position.copy(last.position);
    target.quaternion.copy(last.quaternion);
    target.lens = last.lens;
    return;
  }
  let before = first;
  let after = last;
  for (let index = 1; index < keys.length; index += 1) {
    const candidate = keys[index];
    if (candidate === undefined) continue;
    if (candidate.timeMs >= timeMs) {
      before = keys[index - 1] ?? candidate;
      after = candidate;
      break;
    }
  }
  const span = after.timeMs - before.timeMs;
  const alpha = span <= 0 ? 0 : (timeMs - before.timeMs) / span;
  target.position.lerpVectors(before.position, after.position, alpha);
  // Shortest-arc slerp, which is what an authored orientation means and what his own segments interpolate with.
  target.quaternion.copy(before.quaternion).slerp(after.quaternion, alpha);
  target.lens = before.lens + (after.lens - before.lens) * alpha;
}

/**
 * One segment's own state at a time, ignoring every other segment: the primitive a cut needs, because the state a
 * segment holds at its own end is not the state the clip holds there — the later segment owns that instant.
 */
export function resolveSegmentAt(segment: CameraSegment, timeMs: number, takeId: string): ResolvedCamera {
  const state = { position: new Vector3(), quaternion: new Quaternion(), lens: segment.keys[0]?.lens ?? DEFAULT_FOV };
  resolveKey(segment.keys, timeMs, state);
  return {
    takeId,
    segmentId: segment.id,
    position: state.position,
    quaternion: state.quaternion,
    projection: segment.projection,
    lens: state.lens,
    near: segment.near,
    far: segment.far,
  };
}

/**
 * The camera the active take holds at `timeMs`, or undefined when the camera has no take to answer with. Pure: every
 * call allocates its own result, so two readers of the same time can never fight over one pose.
 */
export function resolveCameraAt(camera: Camera, timeMs: number): ResolvedCamera | undefined {
  assertFinite(timeMs, 'timeMs');
  const take = activeTake(camera);
  if (take === undefined) return undefined;
  const segment = segmentAt(take, timeMs);
  if (segment === undefined) return undefined;
  return resolveSegmentAt(segment, timeMs, take.id);
}

export type CameraEditResult = { ok: true } | { ok: false; error: string; detail: string };

const OK: CameraEditResult = { ok: true };

/** How close two boundary states have to be for a `continuous` seam to mean anything. */
const SAME_STATE_EPSILON = 1e-9;

function refuse(error: string, detail: string): CameraEditResult {
  return { ok: false, error, detail };
}

/** Which take is active. An unknown id is refused, because a camera whose active take is missing has no state at all. */
export function setActiveTake(camera: Camera, takeId: string): boolean {
  if (takeById(camera, takeId) === undefined) return false;
  camera.activeTakeId = takeId;
  return true;
}

/**
 * Adds a take. With a source it is a copy — the same segments and keys, copied rather than aliased, with fresh ids —
 * which is what makes "copy this take and change something" one command; without one it is a single segment opening
 * on a default shot, so a take is never empty.
 */
export function addTake(camera: Camera, init: { name?: string; source?: CameraTake; durationMs: number }): CameraTake {
  const take: CameraTake =
    init.source === undefined
      ? {
          id: `take-${nextTakeId++}`,
          name: init.name ?? `Take ${camera.takes.length + 1}`,
          segments: [
            {
              id: `segment-${nextSegmentId++}`,
              name: 'Shot 1',
              startMs: 0,
              endMs: Math.max(0, init.durationMs),
              enter: 'start',
              projection: 'perspective',
              near: DEFAULT_NEAR,
              far: DEFAULT_FAR,
              keys: [
                { id: `camkey-${nextCameraKeyId++}`, timeMs: 0, position: new Vector3(), quaternion: new Quaternion(), lens: DEFAULT_FOV },
              ],
            },
          ],
        }
      : {
          id: `take-${nextTakeId++}`,
          name: init.name ?? `${init.source.name} copy`,
          // A copy is a deep copy with ids of its own, so editing the new take cannot reach into the old one.
          segments: init.source.segments.map((segment) => ({
            ...segment,
            id: `segment-${nextSegmentId++}`,
            keys: segment.keys.map((key) => ({ ...copyKey(key), id: `camkey-${nextCameraKeyId++}` })),
          })),
        };
  camera.takes.push(take);
  return take;
}

/** Removes a take. The last one cannot be removed: a project with a camera always has somewhere to author it. */
export function removeTake(camera: Camera, takeId: string): boolean {
  if (camera.takes.length <= 1) return false;
  const index = camera.takes.findIndex((take) => take.id === takeId);
  if (index < 0) return false;
  camera.takes.splice(index, 1);
  if (camera.activeTakeId === takeId) camera.activeTakeId = camera.takes[0]?.id ?? '';
  return true;
}

/**
 * Sets how a segment takes over from the one before it, and refuses `continuous` whose two sides are not the same
 * state: the label means "no viewer can see the seam", so allowing it over a real jump would make it a lie. `cut` and
 * `start` are always taken as given.
 */
export function setSegmentEntry(camera: Camera, takeId: string, segmentId: string, entry: SegmentEntry): CameraEditResult {
  const take = takeById(camera, takeId);
  const segment = segmentOf(camera, takeId, segmentId);
  if (take === undefined || segment === undefined) return refuse('unknown-segment', `no segment ${segmentId} in ${takeId}`);
  if (entry === 'continuous') {
    const previous = take.segments[take.segments.indexOf(segment) - 1];
    if (previous === undefined) return refuse('no-previous', `${segment.name} opens the take, so it cannot continue one`);
    const before = { position: new Vector3(), quaternion: new Quaternion(), lens: 0 };
    const after = { position: new Vector3(), quaternion: new Quaternion(), lens: 0 };
    resolveKey(previous.keys, previous.endMs, before);
    resolveKey(segment.keys, segment.startMs, after);
    if (!before.position.equals(after.position) || Math.abs(before.lens - after.lens) > SAME_STATE_EPSILON) {
      return refuse('not-continuous', `${previous.name} ends at a different pose or lens than ${segment.name} starts with`);
    }
    if (before.quaternion.angleTo(after.quaternion) > SAME_STATE_EPSILON) {
      return refuse('not-continuous', `${previous.name} ends at a different orientation than ${segment.name} starts with`);
    }
  }
  segment.enter = entry;
  return OK;
}

export function renameTake(camera: Camera, takeId: string, name: string): boolean {
  const take = takeById(camera, takeId);
  if (take === undefined || name.length === 0) return false;
  take.name = name;
  return true;
}

/**
 * Splits the segment that owns `timeMs` in two, the second of them entering with `cut`. Both sides get a key at the
 * cut instant holding the state the segment had there, which is the whole point of the shape: the boundary keeps the
 * previous segment's end state *and* the next segment's start state, and the author can now move the later one to
 * open somewhere else — a cut — while an untouched split stays seamless.
 *
 * A time outside the segment, or on its first key, is refused: a split has to leave both sides with a range and a key.
 */
export function splitSegment(camera: Camera, takeId: string, timeMs: number, durationMs: number): CameraEditResult {
  assertFinite(timeMs, 'timeMs');
  const take = takeById(camera, takeId);
  if (take === undefined) return refuse('unknown-take', `no take ${takeId}`);
  // By range rather than by resolution's own nearest-end rule: a split outside a segment has nothing to split.
  const segment = take.segments.find((candidate) => timeMs >= candidate.startMs && timeMs <= candidate.endMs);
  if (segment === undefined) return refuse('outside-segment', `${timeMs} is outside every segment of ${take.name}`);
  if (timeMs <= segment.startMs || timeMs >= segment.endMs) {
    return refuse('bad-split', `a split at ${timeMs} would leave an empty ${segment.name}`);
  }
  const state = { position: new Vector3(), quaternion: new Quaternion(), lens: segment.keys[0]?.lens ?? DEFAULT_FOV };
  resolveKey(segment.keys, timeMs, state);
  const boundary: CameraKey = {
    id: `camkey-${nextCameraKeyId++}`,
    timeMs,
    position: state.position.clone(),
    quaternion: state.quaternion.clone(),
    lens: state.lens,
  };
  const later: CameraSegment = {
    id: `segment-${nextSegmentId++}`,
    name: `${segment.name} b`,
    startMs: timeMs,
    endMs: segment.endMs,
    enter: 'cut',
    projection: segment.projection,
    near: segment.near,
    far: segment.far,
    keys: [
      { ...boundary, id: `camkey-${nextCameraKeyId++}`, position: boundary.position.clone(), quaternion: boundary.quaternion.clone() },
    ],
  };
  segment.name = `${segment.name} a`;
  segment.endMs = timeMs;
  segment.keys = [...segment.keys.filter((key) => key.timeMs < timeMs), boundary];
  take.segments.splice(take.segments.indexOf(segment) + 1, 0, later);
  // A take must still cover the clip: a split at the very end would otherwise leave the clip's end unowned.
  retimeCamera(camera, durationMs);
  return OK;
}

/**
 * Removes a segment. The hole is closed by the following segment, which takes over the removed range and the removed
 * segment's `enter`; with no following segment the previous one grows into it, and a take never ends up empty or
 * with a gap.
 */
export function removeSegment(camera: Camera, takeId: string, segmentId: string): boolean {
  const take = takeById(camera, takeId);
  if (take === undefined || take.segments.length <= 1) return false;
  const index = take.segments.findIndex((segment) => segment.id === segmentId);
  if (index < 0) return false;
  const removed = take.segments[index];
  if (removed === undefined) return false;
  const next = take.segments[index + 1];
  const previous = take.segments[index - 1];
  if (next !== undefined) {
    next.startMs = removed.startMs;
    next.enter = removed.enter;
  } else if (previous !== undefined) {
    previous.endMs = removed.endMs;
  }
  take.segments.splice(index, 1);
  return true;
}

/**
 * Sets a segment's projection. The lens scalar is reinterpreted rather than converted — a field of view in degrees is
 * not a world height, and inventing a conversion would need a distance the camera does not store — so the number stays
 * and the author sets it after the switch.
 */
export function setSegmentProjection(
  camera: Camera,
  takeId: string,
  segmentId: string,
  projection: ProjectionKind,
): CameraEditResult {
  const segment = segmentOf(camera, takeId, segmentId);
  if (segment === undefined) return refuse('unknown-segment', `no segment ${segmentId} in ${takeId}`);
  segment.projection = projection;
  return OK;
}

/** Clip planes, per segment: refused rather than reported, because a camera with `near >= far` renders nothing. */
export function setSegmentLensParams(
  camera: Camera,
  takeId: string,
  segmentId: string,
  params: { near: number; far: number },
): CameraEditResult {
  const segment = segmentOf(camera, takeId, segmentId);
  if (segment === undefined) return refuse('unknown-segment', `no segment ${segmentId} in ${takeId}`);
  if (!Number.isFinite(params.near) || !Number.isFinite(params.far)) {
    return refuse('bad-lens', `near ${params.near} and far ${params.far} must be finite`);
  }
  if (params.near <= 0 || params.far <= params.near) {
    return refuse('bad-lens', `near ${params.near} and far ${params.far} are not a usable range`);
  }
  segment.near = params.near;
  segment.far = params.far;
  return OK;
}

/**
 * Moves a segment's range. A boundary between two shots belongs to both of them, so moving one moves the neighbour's
 * end with it: that is what keeps the take tiling the clip however the author drags a cut. A range that would leave a
 * neighbour with nothing — or no range at all — is refused, because the resolution order, not the data, would then
 * decide which shot is on screen.
 */
export function setSegmentRange(
  camera: Camera,
  takeId: string,
  segmentId: string,
  range: { startMs: number; endMs: number },
): CameraEditResult {
  assertFinite(range.startMs, 'startMs');
  assertFinite(range.endMs, 'endMs');
  const take = takeById(camera, takeId);
  const segment = segmentOf(camera, takeId, segmentId);
  if (take === undefined || segment === undefined) return refuse('unknown-segment', `no segment ${segmentId} in ${takeId}`);
  if (range.endMs <= range.startMs) {
    return refuse('bad-range', `${range.startMs}..${range.endMs} is not a range`);
  }
  const index = take.segments.indexOf(segment);
  const previous = take.segments[index - 1];
  const next = take.segments[index + 1];
  if (previous !== undefined && range.startMs <= previous.startMs) {
    return refuse('overlap', `${previous.name} would be left with no range`);
  }
  if (next !== undefined && range.endMs >= next.endMs) {
    return refuse('overlap', `${next.name} would be left with no range`);
  }
  segment.startMs = range.startMs;
  segment.endMs = range.endMs;
  // The two boundaries are shared, so the neighbours follow rather than overlap.
  if (previous !== undefined) previous.endMs = range.startMs;
  if (next !== undefined) next.startMs = range.endMs;
  return OK;
}

function segmentOf(camera: Camera, takeId: string, segmentId: string): CameraSegment | undefined {
  const take = takeById(camera, takeId);
  if (take === undefined) return undefined;
  return take.segments.find((segment) => segment.id === segmentId);
}

/**
 * Writes the pose the author is aiming into a segment at a time — the one write behind a carrier drag, a typed pose,
 * and `Camera -> View`. A key already at that time keeps its id and takes the new state, so a row being edited stays
 * on the same key; the time is clamped into the segment's own range, because a key outside it could never be read.
 */
export function upsertKey(
  camera: Camera,
  takeId: string,
  segmentId: string,
  init: { timeMs: number; position: Vector3; quaternion: Quaternion; lens: number },
): { ok: true; key: CameraKey } | { ok: false; error: string; detail: string } {
  assertFinite(init.timeMs, 'timeMs');
  assertFinite(init.lens, 'lens');
  const segment = segmentOf(camera, takeId, segmentId);
  if (segment === undefined) {
    return { ok: false, error: 'unknown-segment', detail: `no segment ${segmentId} in ${takeId}` };
  }
  const time = Math.min(Math.max(init.timeMs, segment.startMs), segment.endMs);
  const existing = segment.keys.find((key) => key.timeMs === time);
  if (existing !== undefined) {
    existing.position.copy(init.position);
    existing.quaternion.copy(init.quaternion).normalize();
    existing.lens = init.lens;
    return { ok: true, key: existing };
  }
  const inserted: CameraKey = {
    id: `camkey-${nextCameraKeyId++}`,
    timeMs: time,
    position: init.position.clone(),
    quaternion: init.quaternion.clone().normalize(),
    lens: init.lens,
  };
  let insertAt = segment.keys.length;
  while (insertAt > 0 && (segment.keys[insertAt - 1]?.timeMs ?? 0) > time) insertAt -= 1;
  segment.keys.splice(insertAt, 0, inserted);
  return { ok: true, key: inserted };
}

/** Moves one key by id. Refused when that would collide with another key or leave the segment's range. */
export function moveKey(camera: Camera, takeId: string, segmentId: string, keyId: string, timeMs: number): boolean {
  const segment = segmentOf(camera, takeId, segmentId);
  if (segment === undefined) return false;
  const key = segment.keys.find((candidate) => candidate.id === keyId);
  if (key === undefined) return false;
  const time = Math.min(Math.max(timeMs, segment.startMs), segment.endMs);
  if (segment.keys.some((candidate) => candidate.id !== keyId && candidate.timeMs === time)) return false;
  key.timeMs = time;
  segment.keys.sort((left, right) => left.timeMs - right.timeMs);
  return true;
}

/** Removes one key. The last key of a segment cannot go: a segment has to resolve for the whole of its range. */
export function removeKey(camera: Camera, takeId: string, segmentId: string, keyId: string): boolean {
  const segment = segmentOf(camera, takeId, segmentId);
  if (segment === undefined || segment.keys.length <= 1) return false;
  const index = segment.keys.findIndex((key) => key.id === keyId);
  if (index < 0) return false;
  segment.keys.splice(index, 1);
  return true;
}

/**
 * The clip changed length: the take has to keep covering it, so the first segment starts at the clip's start and the
 * last one ends at its end. Only the two ends move — an inner boundary is the author's, and stretching a take's middle
 * shots because the clip got longer would silently re-time every cut.
 */
export function retimeCamera(camera: Camera, durationMs: number): void {
  assertFinite(durationMs, 'durationMs');
  const duration = Math.max(0, durationMs);
  for (const take of camera.takes) {
    const first = take.segments[0];
    const last = take.segments[take.segments.length - 1];
    if (first === undefined || last === undefined) continue;
    first.startMs = 0;
    last.endMs = Math.max(duration, last.startMs);
  }
}
