import type { ObjectId } from './project.js';

export type Interpolation = 'step' | 'linear' | 'smooth';
export type TrackChannel = 'position' | 'quaternion' | 'scale' | 'fov';
export type TrackTarget = { kind: 'object'; objectId: ObjectId } | { kind: 'camera' };
export type Keyframe = { time: number; value: number[] };
export type Track = {
  target: TrackTarget;
  channel: TrackChannel;
  interpolation: Interpolation;
  keyframes: Keyframe[];
};
export type Timeline = { duration: number; fps: number; tracks: Track[] };

/**
 * Value width per channel. The only length table in this file; `animation/compile.ts` reports the
 * same numbers through `channelBinding` and does not re-validate what is written here.
 */
const VALUE_SIZE: Record<TrackChannel, number> = {
  position: 3,
  quaternion: 4,
  scale: 3,
  fov: 1,
};

/**
 * Lookup key for one `(target, channel)` pair. Opaque: callers may compare it but must not parse it,
 * so its spelling may change.
 */
export function trackKey(target: TrackTarget, channel: TrackChannel): string {
  return target.kind === 'camera' ? `camera:${channel}` : `object:${target.objectId}:${channel}`;
}

/** The only lookup primitive: a linear scan, because a `Timeline` stays a plain round-trippable record. */
export function findTrack(
  timeline: Timeline,
  target: TrackTarget,
  channel: TrackChannel,
): Track | undefined {
  const key = trackKey(target, channel);
  for (const track of timeline.tracks) {
    if (trackKey(track.target, track.channel) === key) return track;
  }
  return undefined;
}

/** Returns the track for the pair, appending an empty one with `interpolation ?? 'linear'` when absent. */
export function ensureTrack(
  timeline: Timeline,
  target: TrackTarget,
  channel: TrackChannel,
  interpolation?: Interpolation,
): Track {
  const existing = findTrack(timeline, target, channel);
  if (existing !== undefined) return existing;
  const track: Track = {
    target,
    channel,
    interpolation: interpolation ?? 'linear',
    keyframes: [],
  };
  timeline.tracks.push(track);
  return track;
}

/**
 * Inserts a keyframe in ascending time order, or replaces the value of the keyframe already sitting
 * at `time`. The caller's value array is copied, never aliased.
 */
export function addKeyframe(
  timeline: Timeline,
  target: TrackTarget,
  channel: TrackChannel,
  time: number,
  value: readonly number[],
): { ok: true; keyframe: Keyframe } | { ok: false; error: 'bad-value-length'; detail: string } {
  const valueSize = VALUE_SIZE[channel];
  if (value.length !== valueSize) {
    return {
      ok: false,
      error: 'bad-value-length',
      detail: `channel ${channel} takes ${valueSize} numbers, received ${value.length}`,
    };
  }
  if (!Number.isFinite(time) || time < 0) {
    throw new RangeError(`keyframe time must be finite and non-negative, received ${time}`);
  }
  const numbers = [...value];
  for (const number of numbers) {
    if (!Number.isFinite(number)) {
      throw new TypeError(`keyframe value must be finite, received ${number}`);
    }
  }
  const track = ensureTrack(timeline, target, channel);
  const existing = track.keyframes.find((keyframe) => keyframe.time === time);
  if (existing !== undefined) {
    existing.value = numbers;
    return { ok: true, keyframe: existing };
  }
  const inserted: Keyframe = { time, value: numbers };
  let insertAt = track.keyframes.length;
  while (insertAt > 0) {
    const previous = track.keyframes[insertAt - 1];
    if (previous === undefined || previous.time <= time) break;
    insertAt -= 1;
  }
  track.keyframes.splice(insertAt, 0, inserted);
  return { ok: true, keyframe: inserted };
}

/**
 * Moving a keyframe onto an occupied time drops the keyframe that sat there (the moved one wins).
 * `false` means the track or the index does not exist and nothing changed.
 */
export function moveKeyframe(
  timeline: Timeline,
  target: TrackTarget,
  channel: TrackChannel,
  index: number,
  time: number,
): boolean {
  if (!Number.isFinite(time) || time < 0) {
    throw new RangeError(`keyframe time must be finite and non-negative, received ${time}`);
  }
  const track = findTrack(timeline, target, channel);
  if (track === undefined) return false;
  const keyframe = track.keyframes[index];
  if (keyframe === undefined) return false;
  keyframe.time = time;
  for (let i = track.keyframes.length - 1; i >= 0; i -= 1) {
    const other = track.keyframes[i];
    if (other !== undefined && other !== keyframe && other.time === time) {
      track.keyframes.splice(i, 1);
    }
  }
  // Array.prototype.sort is stable, so keyframes sharing a time keep their relative order.
  track.keyframes.sort((left, right) => left.time - right.time);
  return true;
}

/** Removing the last keyframe of a track removes the track itself. */
export function removeKeyframe(
  timeline: Timeline,
  target: TrackTarget,
  channel: TrackChannel,
  index: number,
): boolean {
  const track = findTrack(timeline, target, channel);
  if (track === undefined) return false;
  if (index < 0 || index >= track.keyframes.length) return false;
  track.keyframes.splice(index, 1);
  if (track.keyframes.length === 0) {
    const trackIndex = timeline.tracks.indexOf(track);
    if (trackIndex >= 0) timeline.tracks.splice(trackIndex, 1);
  }
  return true;
}

export function setInterpolation(
  timeline: Timeline,
  target: TrackTarget,
  channel: TrackChannel,
  interpolation: Interpolation,
): boolean {
  const track = findTrack(timeline, target, channel);
  if (track === undefined) return false;
  track.interpolation = interpolation;
  return true;
}

/** Stable-sorts every track's keyframes by ascending time, in `timeline.tracks` order. */
export function sortKeyframes(timeline: Timeline): void {
  for (const track of timeline.tracks) {
    track.keyframes.sort((left, right) => left.time - right.time);
  }
}

/**
 * Deletion hook for `Project.remove`. Tracks are spliced out of the existing array so holders of
 * `timeline.tracks` keep a live reference; camera tracks are untouched.
 */
export function removeTracksFor(timeline: Timeline, objectId: ObjectId): void {
  for (let i = timeline.tracks.length - 1; i >= 0; i -= 1) {
    const track = timeline.tracks[i];
    if (track === undefined) continue;
    if (track.target.kind === 'object' && track.target.objectId === objectId) {
      timeline.tracks.splice(i, 1);
    }
  }
}
