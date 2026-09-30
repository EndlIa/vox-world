# src/document/timeline.ts

Ring: 1 · Layer: document · Depends on: ./project.js (type-only, `ObjectId`)

## Responsibility
Holds the authoring truth of animation: tracks, channels, keyframes, and interpolation mode as plain serializable data, plus the pure mutators that edit them. It is not a sampler and not an evaluator — the clip and the mixer are derived from this data on change, and this file never evaluates a time. Its clock is milliseconds, kept at whatever precision the author gave (`Keyframe.timeMs`, `Timeline.durationMs`); the clip's seconds are `animation/compile.ts`'s one conversion.

## Public interface
```ts
type Interpolation = 'step' | 'linear' | 'smooth';
type TrackChannel = 'position' | 'quaternion' | 'scale';
type TrackTarget = { kind: 'object'; objectId: ObjectId };
type Keyframe = { id: string; timeMs: number; value: number[] };   // length 3, except quaternion 4
type Track = { target: TrackTarget; channel: TrackChannel; interpolation: Interpolation; keyframes: Keyframe[] };
type Timeline = { durationMs: number; fps: number; tracks: Track[] };

function trackKey(target: TrackTarget, channel: TrackChannel): string;
function findTrack(timeline: Timeline, target: TrackTarget, channel: TrackChannel): Track | undefined;
function ensureTrack(timeline: Timeline, target: TrackTarget, channel: TrackChannel,
  interpolation?: Interpolation): Track;
function addKeyframe(timeline: Timeline, target: TrackTarget, channel: TrackChannel, timeMs: number,
  value: readonly number[]): { ok: true; keyframe: Keyframe } | { ok: false; error: 'bad-value-length'; detail: string };
function overwriteKeyframesAt(timeline: Timeline, target: TrackTarget, timeMs: number,
  values: Partial<Record<TrackChannel, readonly number[]>>): TrackChannel[];
function animatedChannels(timeline: Timeline, target: TrackTarget): TrackChannel[];
function maxKeyframeTime(timeline: Timeline): number;
function moveKeyframe(timeline: Timeline, target: TrackTarget, channel: TrackChannel, id: string,
  timeMs: number): boolean;
function removeKeyframe(timeline: Timeline, target: TrackTarget, channel: TrackChannel, id: string): boolean;
function setDuration(timeline: Timeline, durationMs: number): void;
function setInterpolation(timeline: Timeline, target: TrackTarget, channel: TrackChannel,
  interpolation: Interpolation): boolean;
function sortKeyframes(timeline: Timeline): void;
function removeTracksFor(timeline: Timeline, objectId: ObjectId): void;
function adoptKeyframeIds(timeline: Timeline): void;
function channelValueSize(channel: TrackChannel): number;   // the per-channel value length, read by ./serialize.js
```

## Internal logic
1. A module-private `VALUE_SIZE: Record<TrackChannel, number>` maps `position → 3`, `quaternion → 4`, `scale → 3`. It is the only length table here; `compile.ts` reports the same numbers through `channelBinding` and does not re-validate, and `serialize.ts` reads the widths through `channelValueSize` instead of declaring a second copy of them.
2. A module-private `clampTime(timeMs, durationMs)` is the funnel every authored keyframe time passes through: it clamps into `[0, durationMs]` and throws `RangeError` on a non-finite time, and it never rounds: a fractional millisecond is an ordinary authored time. `addKeyframe`, `moveKeyframe`, and `setDuration` all call it, which is what makes a keyframe outside the duration unrepresentable — the author's time is clamped rather than rejected. That is also the answer to this file's former open question about a time past the end: it is neither accepted as authored nor taken to stretch the clip, it lands on the end, and `setDuration` is the only thing that moves the end.
3. `trackKey` renders `object:<objectId>:<channel>`. The string is a lookup key only: callers may compare it but must not parse it, so its exact spelling can change. The camera was once a second target kind here and is no longer one: `document/camera.ts` owns the shot, so no track can name it.
4. `findTrack` scans `timeline.tracks` comparing `trackKey`, and is the only lookup primitive. No side index is kept, because `Timeline` must stay a plain record that serialization can round-trip and the track count is small.
5. `ensureTrack` returns the existing track or appends `{ target, channel, interpolation: interpolation ?? 'linear', keyframes: [] }` and returns it. A track is therefore empty until its first keyframe and may be empty again later, since removing the last keyframe leaves the track in place.
6. A module counter (`nextKeyframeId`) mints `keyframe-<n>`, unique for the session. The id is the identity a keyframe is addressed by — `moveKeyframe` and `removeKeyframe` take one, and the timeline widget's rows carry it — so reordering or retiming the list cannot make a press land on a neighbour. An id is minted only for a new keyframe: replacing a value keeps the id of the keyframe that was already there.
7. `addKeyframe` rejects `value.length !== VALUE_SIZE[channel]` with `'bad-value-length'`, copies the numbers into a fresh `number[]` (the caller's array is never aliased), clamps the time through `clampTime`, then inserts by `timeMs`: an existing keyframe at the same millisecond has its `value` replaced in place — its `id` survives — otherwise a new keyframe with a fresh id is spliced into sorted position. Ordering is maintained incrementally, so no sort is needed on the hot path.

8. `overwriteKeyframesAt` is the write behind a gesture that lands on a keyframe the author seeked to: for each channel named in `values` it looks up that channel's track and the keyframe sitting at `timeMs`, and replaces that keyframe's `value` with a fresh copy of the numbers, keeping its id and its time. "Sitting at" means within `SAME_TIME_EPSILON`, because the clip's clock is seconds and this one is milliseconds — a seek to a keyframe's own time can come back a hair off it. Nothing is created or removed: a channel with no keyframe at that instant, and a target with no track at all, are both left alone, which is what keeps an edit made away from a keyframe the author's to key with `add`. It writes no time either, so `clampTime` is not involved — `timeMs` is a lookup, and a clamped one would match the wrong keyframe. The returned channel list is how a caller tells whether anything changed.
9. `animatedChannels` reports the channels of one target that a compiled clip actually writes, in channel order: the ones whose track holds at least one keyframe. An empty track is not among them, because `compile.ts` contributes no track for it — which is what lets a caller tell "the clip will write this channel" from "the clip has nothing to say about it". It answers with a fresh array and mutates nothing.

10. `moveKeyframe` finds the keyframe by `id` in the target track, writes the clamped time, and re-sorts that track with a stable sort. It returns `false`, changing nothing, for a missing track, an unknown id (a row that went stale), or a millisecond another keyframe already holds: a move onto an occupied time is refused rather than dropping the keyframe that sat there, which keeps one keyframe per millisecond — what the compiled `KeyframeTrack` requires — without a silent loss. Moving a keyframe onto the time it already has returns `true` and changes nothing.
11. `removeKeyframe` finds the entry by id and splices it. The track stays even when it is left empty: a channel that has been keyed once keeps its interpolation and its `(target, channel)` slot, and a keyframe added to it afterwards joins that same track. An empty track contributes no track to a compiled clip (`compile.ts` skips a track with zero keyframes), so an emptied track is a normal state rather than half of a deletion.
12. `maxKeyframeTime` walks every track and returns the latest `timeMs` anywhere in the timeline, or `0` with no keyframes. The timeline widget reads it as the floor of its duration field, which is what keeps the duration from cutting the clip short.
13. `setDuration` writes the clip length — floored at `0`, and `RangeError` on a non-finite value — and then drags the clip onto it: every keyframe time is clamped into the new range, and when a clamp lands two keyframes on one millisecond the later one is kept (the array is ordered, so the later keyframe is the larger authored time). Shortening the clip therefore never leaves a keyframe outside it, and never keeps the older of two keyframes that collapsed onto the end. Nothing here rounds: a fractional length and a fractional keyframe time are ordinary authored values, which is the same rule `clampTime` keeps. It is the clip's only length write, and the project layer wraps it (`Project.setDuration`) so the camera's coverage is retimed in the same act — a clip shortened on its own would leave a take answering for a length the clip no longer has.
14. `setInterpolation` returns `false` for a missing track, otherwise assigns and returns `true`.
15. `sortKeyframes` stable-sorts every track's keyframes by ascending `timeMs`, in `timeline.tracks` order.
16. `removeTracksFor` filters in place (splice on the existing `tracks` array) so that holders of `timeline.tracks` keep a live reference; every track of another object is left alone. Every track it can see belongs to an object now that the camera is no track at all, so the object id is the whole of the comparison. This is the deletion hook `Project.remove` calls.
17. `adoptKeyframeIds(timeline)` is the restore hook: it walks every keyframe id, reads the `keyframe-<n>` suffix the minter itself writes, and raises the module counter to `max(current, highest suffix + 1)`. An id of another shape is skipped rather than parsed, because an id is opaque to every caller but this module and a foreign one must not be able to set the counter. `channelValueSize` returns `VALUE_SIZE[channel]`: the widths a reader validates a file against, and the same table the mutators check.

## Invariants
- Every mutator mutates the passed `Timeline` in place and returns; none allocates a new `Timeline`, so `project.timeline` identity is stable. `setDuration` is the one mutator that replaces a track's `keyframes` array — collapsing keeps a fresh list — so a holder of that array must re-read the track afterwards; the others splice or sort the array they were given.
- Every time a mutator writes is a finite time inside `[0, timeline.durationMs]`, at the precision it was authored with: the clamp runs on the way in (`addKeyframe`, `moveKeyframe`) and again over every track on `setDuration`, and no other mutator writes a time.
- Each track's `keyframes` is strictly ascending in `timeMs` after `addKeyframe`, `moveKeyframe`, and `sortKeyframes`, with at most one keyframe per millisecond.
- `keyframe.id` is unique for the session and stable for that keyframe's life: a replace at an occupied millisecond keeps it, and no path mints a second id for the same keyframe.
- `adoptKeyframeIds` only raises the counter: afterwards the next minted id is above every `keyframe-<n>` the timeline already holds, and the adopted ids themselves are untouched.
- `keyframe.value.length` always matches the channel size: 3 for `position` and `scale`, 4 for `quaternion`.
- At most one track exists per `(target, channel)` pair, and `findTrack` returns it — including while it holds no keyframe. Every target is an object: the camera is not on this timeline and no channel addresses it.
- `fps` is owned by the UI/export settings and is never written by a mutator here; `durationMs` is written only by `setDuration`, which also clamps every keyframe onto the new length, and `Project.setDuration` is the one caller that keeps the camera's coverage in step with it.
- `Timeline` is plain data: numbers, strings, and arrays only, no `Vector3`, no `Object3D`, no `three` import; `ObjectId` enters as a type only.
- `addKeyframe` never aliases the caller's value array, so later mutation of the input cannot corrupt a keyframe.
- `overwriteKeyframesAt` changes values and nothing else: it never creates, removes, or retimes a keyframe, never touches a channel it was not given, keeps every id and time it found, and returns exactly the channels it wrote — so a caller can treat an empty result as "this instant holds no keyframe of this target".

## Errors
- `addKeyframe` returns `{ ok: false, error: 'bad-value-length' }` for a wrong `value.length`; state is unchanged.
- `addKeyframe` and `moveKeyframe` throw `RangeError` for a non-finite time and `setDuration` for a non-finite duration, and `addKeyframe` throws `TypeError` for a non-finite entry in `value` — all programmer errors, as the widget validates what it reads from its own fields. A negative time is not an error: it clamps to `0`.
- `moveKeyframe`, `removeKeyframe`, and `setInterpolation` report ordinary misses with `false` rather than throwing, because a stale row or a move refused onto an occupied millisecond is a normal user state.
- `overwriteKeyframesAt` throws `TypeError` for a value whose length is not its channel's width and `RangeError` for a non-finite time. Both are programmer errors — the values come from the document's own vectors — and both are raised before any write, so a refused call leaves the timeline as it was. Its ordinary miss is an empty result, not a throw: a time no keyframe holds is a normal state, not a failure.
- `removeTracksFor` cannot fail: an object with no tracks is a no-op.

## Dependencies
- `./project.js` — `ObjectId` type only, erased at compile time; `project.ts` imports this module for values, so the runtime edge is one-way.
- No `three`, no `voxels/*`, no outer-ring import.

## Tests
- `tests/timeline.test.ts` — insertion keeps ascending order, equal-millisecond insertion replaces the value while keeping the id, `'bad-value-length'` on a mismatched channel length, added and moved times clamped onto the clip, `moveKeyframe` and `removeKeyframe` by id with their `false` cases (unknown id, and a move onto an occupied millisecond), `removeKeyframe` leaving an emptied track in place with its interpolation and no track in the compiled clip, `overwriteKeyframesAt` rewriting only the channels that already hold a keyframe at that instant (ids and times kept, a channel without one left alone and no track created for it), writing nothing for a time no keyframe holds — one a whole second off included — while still matching a time that came back from the clip's seconds and back, `animatedChannels` reporting only the keyed channels of the target it was asked about (an emptied track is not animated, another object's track is not reported), `setDuration` clamping onto the new length and keeping the later of two collapsed keyframes, `maxKeyframeTime`, `removeTracksFor` leaving another object's tracks intact, and `adoptKeyframeIds` flooring the minter above the ids a loaded timeline already holds.
- `tests/timeline.test.ts` also pins the downstream contract that a compiled clip reproduces keyframe values exactly with `timeMs / 1000` frame times, which is why the ordering and the clamp above are mandatory.
