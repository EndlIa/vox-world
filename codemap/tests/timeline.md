# tests/timeline.test.ts

Ring: 1 · Layer: tests (node, no GPU) · Depends on: `../src/document/timeline.js`,
`../src/document/project.js`, `../src/animation/compile.js`, `../src/animation/playback.js`,
`three`, `vitest`

## Responsibility
Pins the timeline as editable authoring data and the two things built from it: keyframe order and
value-length validation, and the compiled `AnimationClip` with frame-exact sampling through the mixer.
It does not test the timeline widget, scrubbing, or MP4 export.

## Public interface
`describe` / `it` names are this file's observable surface:
- `track identity` — `keys a distinct string per target kind, object id, and channel`, `creates a
  missing track with the default interpolation and returns the existing one again`, `finds a track and
  returns undefined when the target has none`
- `keyframes` — `keeps keyframes strictly ascending by time after an out-of-order insert`, `replaces
  the value of a keyframe already sitting at that time`, `rejects a value whose length does not match
  the channel with bad-value-length`, `moves and removes keyframes by index and reports whether
  anything changed`, `drops the whole track when its last keyframe is removed`, `changes interpolation
  only for a track that exists`, `sorts keyframes in place and drops every object track of a removed
  object while keeping the camera track`
- `clip compilation` — `maps step, linear, and smooth to the matching Three.js interpolation modes`,
  `binds each channel to its property path and value size`, `names object tracks obj-<n>.<path> and the
  camera track camera.fov`, `skips objects that own no tracks and takes the duration from the timeline`
- `playback sampling` — `reproduces each keyframe value exactly at its keyframe time`, `keeps the
  current time when the clip is rebuilt after an edit`

## Internal logic
1. Fixtures are plain `Timeline` literals plus one `Project` with two objects and the output camera;
   object ids come from `project.allocateId()`, never from hand-written strings.
2. Keyframe order is asserted on the whole `keyframes` array, and index-based mutators are checked with
   the array before and after, so "returned false" means "changed nothing".
3. Every keyframe time in the sampling fixture lies on a frame boundary at `timeline.fps`, so
   `setTime` reproducing the stored value is exact rather than a tolerance test. Sampling reads the
   bound `Object3D` transform and the camera's `fov`, never the authoring arrays.

## Invariants
- `trackKey` is injective over `(target kind, object id, channel)`; the string is opaque and never
  parsed. `ensureTrack` never creates a second `Track` for one `(target, channel)` pair.
- Each track's `keyframes` is strictly ascending by `time` with at most one keyframe per time after
  `addKeyframe`, `moveKeyframe`, and `sortKeyframes`; a move onto an occupied time discards the
  keyframe already there.
- `Keyframe.value.length` matches the channel — 3 for `position` and `scale`, 4 for `quaternion`, 1 for
  `fov` — and `addKeyframe` never aliases the caller's value array.
- `moveKeyframe`, `removeKeyframe`, and `setInterpolation` return `false` for an out-of-range index or
  a missing track and change nothing; removing a track's last keyframe removes the track, and
  `removeTracksFor` leaves camera tracks intact.
- Compilation yields one `KeyframeTrack` per track, `step`/`linear`/`smooth` mapping to
  `InterpolateDiscrete`/`InterpolateLinear`/`InterpolateSmooth`, with `clip.duration` equal to
  `timeline.duration`; track names are `PropertyBinding` names, the target's binding name joined with
  `channelBinding(channel).path`, so an object track is `obj-3.position` and the camera track is
  `camera.fov`.
- `playback.setTime(t)` at each keyframe time reproduces that keyframe's value component-wise in the
  bound object and leaves the camera's projection matrix current, and `rebuild` keeps `time`,
  `playing`, and `loop`.

## Errors
- `addKeyframe` returns `{ ok: false; error: 'bad-value-length'; detail }` for a wrong `value.length`
  and changes nothing; it never pads or truncates the value.
- The same call throws `RangeError` for a non-finite or negative `time` and `TypeError` for a
  non-finite `value` entry — programmer errors the UI prevents, not user states.
- Index-based mutators report ordinary misses with `false`, and `removeTracksFor` with an object that
  has no tracks is a no-op, because a stale selection after an edit is a normal user state.

## Dependencies
`../src/document/timeline.js` for every symbol under test (types and mutators alike),
`../src/document/project.js` for `Project`, `../src/animation/compile.js` for `buildClip` and
`channelBinding`, `../src/animation/playback.js` for `Playback`, `three` for `Object3D`,
`PerspectiveCamera`, and `AnimationClip`, and `vitest`.

## Tests
This file *is* the test, run by `npm test` in the node environment — the mixer needs no GPU. It is the
only unit coverage for `src/document/timeline.ts`, `src/animation/compile.ts`, and
`src/animation/playback.ts`.
