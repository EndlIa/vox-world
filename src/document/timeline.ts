import type { ObjectId } from './project.js';

export type Interpolation = 'step' | 'linear' | 'smooth';
export type TrackChannel = 'position' | 'quaternion' | 'scale' | 'fov';
export type TrackTarget = { kind: 'object'; objectId: ObjectId } | { kind: 'camera' };
export type Keyframe = { id: string; timeMs: number; value: number[] };
export type Track = {
  target: TrackTarget;
  channel: TrackChannel;
  interpolation: Interpolation;
  keyframes: Keyframe[];
};
export type Timeline = { durationMs: number; fps: number; tracks: Track[] };

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
 * Keyframe identity. Rows in the timeline widget address a keyframe by its id rather than by its place in
 * the array, so editing one keyframe's time cannot make another row act on the wrong keyframe.
 */
let nextKeyframeId = 1;

/**
 * Clamps a time onto the clip: whole milliseconds inside `[0, durationMs]`. Every entry point funnels through
 * this, which is what makes a keyframe outside the duration unrepresentable (README D45) — the author's time is
 * rounded rather than rejected. A non-finite time is a programmer error and throws.
 */
function clampTime(timeMs: number, durationMs: number): number {
  if (!Number.isFinite(timeMs)) {
    throw new RangeError(`keyframe time must be finite, received ${timeMs}`);
  }
  return Math.min(Math.max(Math.round(timeMs), 0), Math.max(0, durationMs));
}

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
 * The latest keyframe time anywhere in the clip, or 0 with no keyframes. The timeline widget reads it as the
 * floor of the duration field, which is what keeps the duration from cutting the clip short (README D45).
 */
export function maxKeyframeTime(timeline: Timeline): number {
  let latest = 0;
  for (const track of timeline.tracks) {
    for (const keyframe of track.keyframes) {
      if (keyframe.timeMs > latest) latest = keyframe.timeMs;
    }
  }
  return latest;
}

/**
 * Inserts a keyframe, or replaces the value of the one already sitting at that time — the id survives a replace,
 * so a row that was selected or being retimed stays on the same keyframe. The caller's value array is copied,
 * never aliased, and the time is clamped onto the clip.
 */
export function addKeyframe(
  timeline: Timeline,
  target: TrackTarget,
  channel: TrackChannel,
  timeMs: number,
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
  const time = clampTime(timeMs, timeline.durationMs);
  const numbers = [...value];
  for (const number of numbers) {
    if (!Number.isFinite(number)) {
      throw new TypeError(`keyframe value must be finite, received ${number}`);
    }
  }
  const track = ensureTrack(timeline, target, channel);
  const existing = track.keyframes.find((keyframe) => keyframe.timeMs === time);
  if (existing !== undefined) {
    existing.value = numbers;
    return { ok: true, keyframe: existing };
  }
  const inserted: Keyframe = { id: `keyframe-${nextKeyframeId++}`, timeMs: time, value: numbers };
  let insertAt = track.keyframes.length;
  while (insertAt > 0) {
    const previous = track.keyframes[insertAt - 1];
    if (previous === undefined || previous.timeMs <= time) break;
    insertAt -= 1;
  }
  track.keyframes.splice(insertAt, 0, inserted);
  return { ok: true, keyframe: inserted };
}

/**
 * Moves one keyframe, named by id, onto a clamped time. A move onto a time another keyframe already holds is
 * refused: `false` means nothing changed, which the widget reports by restoring the field's previous text. The
 * same reasons make `false` of an unknown id — a stale row after the timeline changed under it.
 */
export function moveKeyframe(
  timeline: Timeline,
  target: TrackTarget,
  channel: TrackChannel,
  id: string,
  timeMs: number,
): boolean {
  const time = clampTime(timeMs, timeline.durationMs);
  const track = findTrack(timeline, target, channel);
  if (track === undefined) return false;
  const keyframe = track.keyframes.find((entry) => entry.id === id);
  if (keyframe === undefined) return false;
  if (track.keyframes.some((entry) => entry !== keyframe && entry.timeMs === time)) return false;
  keyframe.timeMs = time;
  // Array.prototype.sort is stable, so keyframes sharing a time keep their relative order.
  track.keyframes.sort((left, right) => left.timeMs - right.timeMs);
  return true;
}

/**
 * Removes one keyframe, named by id. The track stays even when it is left empty: a channel that has been keyed
 * once keeps its interpolation and its slot in the clip, and re-adding a keyframe to it does not disturb the
 * widget (README D45). The empty track contributes nothing to a compiled clip.
 */
export function removeKeyframe(
  timeline: Timeline,
  target: TrackTarget,
  channel: TrackChannel,
  id: string,
): boolean {
  const track = findTrack(timeline, target, channel);
  if (track === undefined) return false;
  const index = track.keyframes.findIndex((entry) => entry.id === id);
  if (index < 0) return false;
  track.keyframes.splice(index, 1);
  return true;
}

/**
 * Writes the clip length and drags the clip onto it: every keyframe time is clamped into the new range, and a
 * clamp that lands two keyframes on the same millisecond keeps the later one (the array is already ordered, so
 * "later" is the larger authored time). A shorter duration therefore never leaves a keyframe outside the clip.
 */
export function setDuration(timeline: Timeline, durationMs: number): void {
  if (!Number.isFinite(durationMs)) {
    throw new RangeError(`timeline duration must be finite, received ${durationMs}`);
  }
  const duration = Math.max(0, Math.round(durationMs));
  timeline.durationMs = duration;
  for (const track of timeline.tracks) {
    for (const keyframe of track.keyframes) keyframe.timeMs = clampTime(keyframe.timeMs, duration);
    const kept: Keyframe[] = [];
    for (const keyframe of track.keyframes) {
      const last = kept[kept.length - 1];
      if (last !== undefined && last.timeMs === keyframe.timeMs) kept[kept.length - 1] = keyframe;
      else kept.push(keyframe);
    }
    track.keyframes = kept;
  }
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
    track.keyframes.sort((left, right) => left.timeMs - right.timeMs);
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
