# tests/timeline.test.ts

Ring: 1 · Layer: tests (node, no GPU) · Depends on: `../src/document/timeline.js`,
`../src/document/project.js`, `../src/animation/compile.js`, `../src/animation/playback.js`,
`three`, `vitest`

## Responsibility
Pins the timeline as editable authoring data counted in whole milliseconds — keyframe identity, ordering, and
value-length validation, and the one clamp every authoring entry point shares (README D45) — plus the two
things built from it: the compiled `AnimationClip` and frame-exact sampling through the mixer. It does not
test the timeline widget, scrubbing, or MP4 export.

## Public interface
`describe` / `it` names are this file's observable surface:
- `track identity` — `keys a distinct string per target kind, object id, and channel`, `creates a
  missing track with the default interpolation and returns the existing one again`, `finds a track and
  returns undefined when the target has none`
- `keyframes` — `keeps keyframes strictly ascending by time after an out-of-order insert`, `replaces
  the value of a keyframe already sitting at that time`, `rejects a value whose length does not match
  the channel with bad-value-length`, `moves a keyframe by id and reports whether anything changed`,
  `refuses to move a keyframe onto a millisecond another one holds, leaving both untouched`, `removes a
  keyframe by id and reports whether anything changed`, `keeps an emptied track in place, with its
  interpolation and its slot in the clip`, `changes interpolation only for a track that exists`, `sorts
  keyframes in place and drops every object track of a removed object while keeping the camera track`
- `clamped authoring times` — `clamps an added time onto whole milliseconds inside the clip`, `keeps
  the id and replaces the value when an add rounds onto the occupied millisecond`, `clamps a shortened
  duration and keeps the later of two keyframes that collapse`, `reports the latest keyframe time across
  tracks, and 0 with no keyframes`
- `clip compilation` — `maps step, linear, and smooth to the matching Three.js interpolation modes`,
  `binds each channel to its property path and value size`, `names object tracks obj-<n>.<path> and the
  camera track camera.fov`, `skips objects that own no tracks and takes the duration from the timeline`
- `playback sampling` — `reproduces each keyframe value exactly at its keyframe time`, `keeps the
  current time when the clip is rebuilt after an edit`

## Internal logic
1. Fixtures author in milliseconds: `oneProject()` builds a `Project` with two objects and sets `fps` 10 and
   `durationMs` 2000, and object ids come from `Project` (`createObject`, `allocateId`), never from
   hand-written strings. The one hand-written `Timeline` literal, in the sort/removal test, takes its object
   ids from `allocateId()` too and writes keyframes as `{ id, timeMs, value }`.
2. `times(track)` reports `timeMs`, `ids(track)` reports `id` — so a move or a replace can be traced to the
   same keyframe — and `values(track)` flattens the value arrays, so "changed nothing" is observable on the
   authoring record itself.
3. Every assertion that faces the authoring data is in milliseconds; every assertion that faces a compiled
   clip or a `Playback` is in seconds (`buildClip(...).duration`, `tracks[0].times[1]`, `playback.setTime`,
   `playback.duration`, `playback.time`). `compile.ts` is the single crossing point, `timeMs / 1000` and
   `durationMs / 1000`, so the two units never meet in one expectation. That split is the point of the
   current design, not an accident of the fixtures.
4. `mirrorFor(project, objectId)` builds a `SceneMirror`-shaped root with one node per project object and the
   camera as a child, binds a `Playback`, and rebuilds it. Sampling therefore reads the bound `Object3D`
   transform and the camera's `fov`, never the authoring arrays, and the file also asserts the project's own
   transform and `project.camera.fov` are left untouched.
5. Every keyframe time in the sampling fixture lies on a frame boundary at `timeline.fps` (10), so `setTime`
   reproducing the stored value is exact rather than a tolerance test.

## Invariants
- `trackKey` is injective over `(target kind, object id, channel)`; the string is opaque and never parsed.
  `ensureTrack` never creates a second `Track` for one `(target, channel)` pair, returns the existing track
  and its interpolation unchanged, and defaults a new track to `linear` unless another interpolation is
  passed at creation.
- Each track's `keyframes` is strictly ascending by `timeMs` with at most one keyframe per millisecond after
  `addKeyframe`, `moveKeyframe`, and `sortKeyframes`. A move onto a millisecond another keyframe holds
  returns `false` and changes nothing — both keyframes and both ids survive — while a move onto the time it
  already has is a `true` that changes nothing. The candidate time is clamped before the collision is judged,
  so `500.4` onto an occupied `500` is refused as well.
- Out-of-range times are never rejected: `addKeyframe` and `moveKeyframe` round to whole milliseconds and
  clamp into `[0, durationMs]`, so `2500` and `-750` land on `2000` and `0`, and `500.6` and `500.4` land on
  `501` and `500`.
- `addKeyframe` at a time that is already occupied replaces the value and keeps the keyframe's id, and it
  always copies the caller's value array rather than aliasing it — a later mutation of the caller's array is
  invisible in the track.
- `Keyframe.value.length` matches the channel — 3 for `position` and `scale`, 4 for `quaternion`, 1 for
  `fov` — and a mismatch leaves both the tracks and the keyframes exactly as they were.
- `moveKeyframe`, `removeKeyframe`, and `setInterpolation` return `false` for an unknown id or a missing
  track and change nothing. Removing a track's last keyframe leaves the track in place, with its
  interpolation and its slot in `timeline.tracks`, so a keyframe added later joins that same track and
  `buildClip` contributes no compiled track for the empty one. `removeTracksFor` drops every object track
  while leaving camera tracks intact, and is a no-op for an unknown id.
- `setDuration` writes the length and drags the clip onto it: every keyframe time is clamped into the new
  range, and a collapse that lands two keyframes on one millisecond keeps the later authored one, id and
  value together.
- `maxKeyframeTime` is the latest keyframe time across every track, and `0` with no keyframes; an emptied
  track holds no time, so another track's latest becomes the answer.
- `sortKeyframes` and `removeTracksFor` mutate `timeline.tracks` in place, so a holder of the array keeps a
  live reference.
- Compilation yields one `KeyframeTrack` per non-empty track, `step`/`linear`/`smooth` mapping to
  `InterpolateDiscrete`/`InterpolateLinear`/`InterpolateSmooth`, with `clip.duration` equal to
  `timeline.durationMs / 1000`; track names are `PropertyBinding` names, the target's binding name joined
  with `channelBinding(channel).path`, so an object track is `obj-3.position` and the camera track is
  `camera.fov`. An object with no tracks is skipped, and an empty `Project` compiles to zero tracks and
  duration 0.
- `playback.setTime(t)` at each keyframe time reproduces that keyframe's value component-wise in the bound
  object, `fov` and projection matrix included for the camera, and `rebuild` keeps `time`, `playing`, and
  `loop` — an advanced, looping playback wraps instead of restarting, and `stop` returns it to zero.

## Errors
- `addKeyframe` returns `{ ok: false; error: 'bad-value-length'; detail }` for a wrong `value.length` and
  changes nothing; it never pads or truncates the value, and it creates neither the track nor the keyframe.
- A non-finite time is a programmer error: `addKeyframe` with `Infinity` and `moveKeyframe` with `NaN` throw
  `RangeError`, and a non-finite `value` entry throws `TypeError`. A finite time outside the clip is *not* an
  error — it is clamped — which is why no out-of-range `RangeError` is pinned here.
- Ordinary misses report `false` rather than throwing: an unknown keyframe id, a missing track, and
  `removeTracksFor` for an object with no tracks are no-ops, because a stale row after an edit is a normal
  user state.

## Dependencies
`../src/document/timeline.js` for `addKeyframe`, `ensureTrack`, `findTrack`, `maxKeyframeTime`,
`moveKeyframe`, `removeKeyframe`, `removeTracksFor`, `setDuration`, `setInterpolation`, `sortKeyframes`,
`trackKey`, and the `Timeline`, `Track`, `TrackChannel`, and `TrackTarget` types;
`../src/document/project.js` for `Project` and `ObjectId`; `../src/animation/compile.js` for `buildClip` and
`channelBinding`; `../src/animation/playback.js` for `Playback`; `three` for `Object3D`,
`PerspectiveCamera`, `NumberKeyframeTrack`, `QuaternionKeyframeTrack`, `VectorKeyframeTrack`, and the three
`Interpolate*` modes; `vitest` for `describe`, `it`, `expect`.

## Tests
This file *is* the test, run by `npm test` in the node environment — the mixer needs no GPU. It is the only
unit coverage for `src/document/timeline.ts`, `src/animation/compile.ts`, and
`src/animation/playback.ts`. Not covered here: the timeline widget's rows and transport, scrubbing, and MP4
export; the `only` object filter of `buildClip`; a non-finite `setDuration`; ties in `sortKeyframes`; and
`fps`, which only shapes the fixtures.
