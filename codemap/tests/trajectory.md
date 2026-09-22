# tests/trajectory.test.ts

Ring: 3 · Layer: tests (node, no GPU) · Depends on: `../src/document/project.js`,
`../src/document/timeline.js`, `../src/animation/trajectory.js`, `vitest`

## Responsibility
Pins the camera trajectory sampler's own decision — the times it asks for — and the fact that the curve between them
is the track's rather than a straight line: the even walk over the clip with both ends included, the sampler
following `step` and `linear`, one marker point per authored keyframe in time order, and the empty answer for a
camera without a position track (README D47). It reads only the returned `Vector3` lists; the scratch mixer, the binding name, the
default segment count, and the release of the throwaway nodes are not asserted here.

## Public interface
`describe` / `it` names are this file's observable surface:
- `camera trajectory` — `samples the authored curve evenly over the clip, both ends included`, `follows the track
  interpolation rather than assuming a straight line`, `reports one marker point per keyframe, in time order`,
  `draws nothing at all without a camera position track`

## Internal logic
1. `CAMERA` is the fixture's `{ kind: 'camera' }`, the same target literal the widget and the sampler name the camera
   by.
2. `projectWithCameraKeys(keys)` is the only fixture: a fresh `Project`, `timeline.durationMs = 1000`, and one
   `addKeyframe(project.timeline, CAMERA, 'position', timeMs, value)` per entry, so a case states keyframe times and
   values as literals and the ordering comes from the model.
3. Cases call `sampleCameraTrajectory(project, segments)` with an explicit count (2 and 4), so the expectations are
   three and five points and the default `CAMERA_PATH_SEGMENTS` never enters an assertion;
   `cameraKeyframePositions` takes no count.
4. Every case builds its own project, so no case can run against another's timeline. `three` is not imported: a point
   is read through `Vector3.toArray()`.

## Invariants
- A 0→10 linear camera track sampled with 2 segments returns exactly three points, `[0, 0, 0]`, `[5, 0, 0]`,
  `[10, 0, 0]`: the walk is even, it includes both ends, and its length is segments + 1.
- The sampler follows the track's interpolation: under `step` the same four-segment walk holds the earlier keyframe
  (`[0, 0, 0]` then `[4, 8, 0]`), and switching that track to `linear` puts the same sample between the two
  (`[2, 4, 0]`). No easing or keyframe arithmetic is visible from outside.
- `cameraKeyframePositions` reports one point per keyframe in time order — keys added at 1000 then 0 come back as
  `[1, 2, 3]` then `[4, 5, 6]` — so it follows the track's ordering, not insertion order.
- A camera with no position track yields `[]` from both functions, with no exception: the empty list is the state the
  drawing turns into nothing.

## Errors
None asserted, and the file has no error path to assert: neither function throws for a missing track, and the fixture
cannot author a malformed keyframe.

## Dependencies
`../src/document/project.js` for `Project`; `../src/document/timeline.js` for `addKeyframe`, `setInterpolation`, and
the `TrackTarget` type; `../src/animation/trajectory.js` for `sampleCameraTrajectory` and
`cameraKeyframePositions`; `vitest` for `describe`, `it`, `expect`. No DOM and no GPU: the suite runs in the node
environment.

## Tests
This file *is* the test, run by `npm test` in the node environment — the scratch mixer needs no GPU. It is the only
coverage of `animation/trajectory.ts`. Not covered here: the default `CAMERA_PATH_SEGMENTS` value and the floor on a
sub-one `segments`; `smooth` sampling (its mapping is pinned in `tests/timeline.test.ts`); the `camera.position`
binding name and the scratch root's shape; and the `uncacheRoot` that releases the throwaway mixer.
