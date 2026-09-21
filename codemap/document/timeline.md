# src/document/timeline.ts

Ring: 1 · Layer: document · Depends on: ./project.js (type-only, `ObjectId`)

## Responsibility
Holds the authoring truth of animation: tracks, channels, keyframes, and interpolation mode as plain serializable data, plus the pure mutators that edit them. It is not a sampler and not an evaluator — the clip and the mixer are derived from this data on change (D2), and this file never evaluates a time.

## Public interface
```ts
type Interpolation = 'step' | 'linear' | 'smooth';
type TrackChannel = 'position' | 'quaternion' | 'scale' | 'fov';
type TrackTarget = { kind: 'object'; objectId: ObjectId } | { kind: 'camera' };
type Keyframe = { time: number; value: number[] };   // length 3, except quaternion 4 and fov 1
type Track = { target: TrackTarget; channel: TrackChannel; interpolation: Interpolation; keyframes: Keyframe[] };
type Timeline = { duration: number; fps: number; tracks: Track[] };

function trackKey(target: TrackTarget, channel: TrackChannel): string;
function findTrack(timeline: Timeline, target: TrackTarget, channel: TrackChannel): Track | undefined;
function ensureTrack(timeline: Timeline, target: TrackTarget, channel: TrackChannel,
  interpolation?: Interpolation): Track;
function addKeyframe(timeline: Timeline, target: TrackTarget, channel: TrackChannel, time: number,
  value: readonly number[]): { ok: true; keyframe: Keyframe } | { ok: false; error: 'bad-value-length' };
function moveKeyframe(timeline: Timeline, target: TrackTarget, channel: TrackChannel, index: number,
  time: number): boolean;
function removeKeyframe(timeline: Timeline, target: TrackTarget, channel: TrackChannel, index: number): boolean;
function setInterpolation(timeline: Timeline, target: TrackTarget, channel: TrackChannel,
  interpolation: Interpolation): boolean;
function sortKeyframes(timeline: Timeline): void;
function removeTracksFor(timeline: Timeline, objectId: ObjectId): void;
```

## Internal logic
1. A module-private `VALUE_SIZE: Record<TrackChannel, number>` maps `position → 3`, `quaternion → 4`, `scale → 3`, `fov → 1`. It is the only length table here; `compile.ts` reports the same numbers through `channelBinding` and does not re-validate.
2. `trackKey` renders `camera:<channel>` or `object:<objectId>:<channel>`. The string is a lookup key only: callers may compare it but must not parse it, so its exact spelling can change.
3. `findTrack` scans `timeline.tracks` comparing `trackKey`, and is the only lookup primitive. No side index is kept, because `Timeline` must stay a plain record that serialization can round-trip (D9) and the track count is small.
4. `ensureTrack` returns the existing track or appends `{ target, channel, interpolation: interpolation ?? 'linear', keyframes: [] }` and returns it. A track may therefore be empty until its first keyframe.
5. `addKeyframe` rejects `value.length !== VALUE_SIZE[channel]` with `'bad-value-length'`, copies the numbers into a fresh `number[]` (the caller's array is never aliased), then inserts by `time`: an existing keyframe at the same time has its `value` replaced in place, otherwise the new keyframe is spliced into sorted position. Ordering is maintained incrementally, so no sort is needed on the hot path.
6. `moveKeyframe` returns `false` for a missing track or an index outside the keyframe array; otherwise it writes the new `time`, drops any other keyframe already sitting at that exact time (the moved one wins), restores the sorted order with a stable sort of that track, and returns `true`. This keeps one keyframe per time, which the compiled `KeyframeTrack` requires.
7. `removeKeyframe` splices the entry; removing the last keyframe removes the whole track, so a track with zero keyframes exists only between `ensureTrack` and its first insertion.
8. `setInterpolation` returns `false` for a missing track, otherwise assigns and returns `true`.
9. `sortKeyframes` stable-sorts every track's keyframes by ascending `time`, in `timeline.tracks` order.
10. `removeTracksFor` filters in place (splice on the existing `tracks` array) so that holders of `timeline.tracks` keep a live reference; camera tracks are untouched. This is the deletion hook `Project.remove` calls.

## Invariants
- Every mutator mutates the passed `Timeline` in place and returns; no mutator allocates a new `Timeline`, so `project.timeline` identity is stable.
- Each track's `keyframes` is strictly ascending in `time` after `addKeyframe`, `moveKeyframe`, and `sortKeyframes`, with at most one keyframe per time.
- `keyframe.value.length` always matches the channel size: 3 for `position` and `scale`, 4 for `quaternion`, 1 for `fov`.
- At most one track exists per `(target, channel)` pair, and `findTrack` returns it.
- `duration` and `fps` are owned by the UI/export settings and are never written by a track mutator.
- `Timeline` is plain data: numbers and arrays only, no `Vector3`, no `Object3D`, no `three` import; `ObjectId` enters as a type only.
- `addKeyframe` never aliases the caller's value array, so later mutation of the input cannot corrupt a keyframe.

## Errors
- `addKeyframe` returns `{ ok: false, error: 'bad-value-length' }` for a wrong `value.length`; state is unchanged.
- `addKeyframe` throws `RangeError` for a non-finite or negative `time`, and `TypeError` for a non-finite entry in `value` — both are programmer errors, as the timeline UI clamps scrubs.
- `moveKeyframe`, `removeKeyframe`, and `setInterpolation` report ordinary misses with `false` rather than throwing, because a stale selection after an edit is a normal user state.
- `removeTracksFor` cannot fail: an object with no tracks is a no-op.

## Dependencies
- `./project.js` — `ObjectId` type only, erased at compile time; `project.ts` imports this module for values, so the runtime edge is one-way.
- No `three`, no `voxels/*`, no outer-ring import.

## Tests
- `tests/timeline.test.ts` — keyframe insertion keeps order, equal-time insertion replaces, `'bad-value-length'` on a mismatched channel length, `removeKeyframe` dropping the last keyframe removes the track, and `removeTracksFor` leaving camera tracks intact.
- `tests/timeline.test.ts` also pins the downstream contract that a compiled clip reproduces keyframe values exactly, which is the reason the ordering above is mandatory.

## Open questions
- Whether `addKeyframe` beyond `timeline.duration` should be rejected or should stretch `duration`. It is currently accepted: keyframes are the authoring truth and `duration` is edited independently.
