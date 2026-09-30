# src/animation/trajectory.ts

Ring: 1 · Layer: animation · Depends on: ../document/camera.js, ../document/project.js, three

## Responsibility
Turns the active take into the two plain point lists the viewport drawing needs: the sampled polyline of where the
camera travels, and one point per authored key, which is where the rings go. The sampling is not a second
interpolation — it walks each segment through `document/camera.ts`'s own evaluator, `resolveSegmentAt`, the same
evaluation a render uses, cuts included — and the only thing decided here is the set of times to ask for: an even walk
over each segment, both of its ends included. It stores nothing, holds no mixer and no clip, and writes nothing into
the project; every call builds fresh points. It exists for the camera path drawing.
(`animation/playback.ts` is the long-lived mixer, and it is not this file's business either: the shot is the mirror's.)

## Public interface
```ts
const CAMERA_PATH_SEGMENTS = 128;
function sampleCameraTrajectory(project: Project, segments = CAMERA_PATH_SEGMENTS): Vector3[];
function cameraKeyframePositions(project: Project): Vector3[];
```

## Internal logic
1. `CAMERA_PATH_SEGMENTS` is 128: enough that a curved move reads as a curve at demo scale, and few enough that the
   polyline is rebuilt cheaply on every redraw.
2. `sampleCameraTrajectory` reads `activeTake(project.camera)`. No take at all, or a take whose segment chain is
   empty, returns `[]`: a camera with nothing to draw is the empty list, which is the state the drawing turns into
   nothing, not a failure.
3. Times are per segment, because that is where a cut lives: `steps = Math.max(1, Math.floor(segments))` is split as
   `perSegment = Math.max(1, Math.round(steps / take.segments.length))`, and each segment is sampled at
   `startMs + (endMs - startMs) * step / perSegment` for `step` 0 to `perSegment` inclusive. An even walk of that
   shot, both of its ends included; the clip's own end is included because the last segment's `endMs` is the clip's
   length after `retimeCamera`.
4. Sampling is per segment rather than over the clip, which is what keeps a cut honest:
   `resolveSegmentAt(segment, time, take.id)` answers one segment's own state, so the run of the earlier shot reaches
   its own last state and the run of the later one starts at its own first — a jump where the states differ, drawn
   where the cut is, with no interpolated flight between them and no sample across the seam.
5. Each pushed point is the `Vector3` the resolve allocated for it, so nothing here aliases a key's own vector and a
   caller may mutate what it is handed.
6. `cameraKeyframePositions` is the marker list, and it is deliberately separate from the sampled one: a ring belongs
   to an authored key, not to a sample of the curve between two of them. It maps every segment's `keys` — in take
   order, which is time order because the segments tile the clip and each segment's keys ascend — to a clone of each
   key's `position`, so a segment boundary adds no marker of its own: only the keys appear.
7. There is no mixer, node, or clip to build, uncache, or release: the evaluator is pure and this file keeps nothing.

## Invariants
- Interpolation is entirely the camera model's: no easing, no curve math, and no keyframe arithmetic happens here.
  Inside a segment, position and orientation are interpolated and the ends are held, exactly as `resolveSegmentAt`
  does it for a render — so the drawn path is the travel the camera really makes.
- The polyline is per segment: the number of points is `take.segments.length * (perSegment + 1)` with
  `perSegment = Math.max(1, Math.round(Math.max(1, Math.floor(segments)) / take.segments.length))`, and each run's
  first and last point are that segment's own states at its own start and end.
- A cut is drawn where it is: consecutive runs meet at the same time holding each side's own state, so a `cut` shows
  as the jump it is and a `continuous` seam shows as no visible break at all.
- Every returned point is a fresh `Vector3`: mutating one reaches neither the project nor a later sample, and no
  authored vector is aliased — the evaluations allocate their own state, and the markers are clones.
- A camera with no take, or with an empty segment chain, yields `[]` from both functions, and neither of them throws.
- Nothing is retained and nothing is serialized: no mixer, node, clip, or point survives a call.

## Errors
No `Result` and no failure path: both functions are total. A camera with nothing to resolve is the empty list, which
is the state the drawing turns into nothing. `segments` is floored and floored at one, so a caller asking for less
than one sample still gets a drawable line rather than an exception — and a take of many segments gets at least one
step in each of them, so a cut can never be sampled away.

## Dependencies
- `../document/camera.js` — `activeTake` for the take and `resolveSegmentAt` for the per-segment evaluation;
  `resolveCameraAt` is imported alongside them but nothing here calls it. The camera data itself is read through
  `project.camera`, so no mutator is imported.
- `../document/project.js` — `Project`.
- `three` — `Vector3`; allowed in ring 1.

## Tests
- `tests/trajectory.test.ts` — even sampling with both ends included, a cut reached as a jump (each segment sampled on
  its own, so the samples either side of the seam are the two shots' own states), one marker point per authored key in
  time order, and a single-key take drawing one repeated point, which the panel calls no path. The evaluation the
  sampler leans on is `document/camera.ts`'s, pinned by `tests/camera.test.ts`.

## Open questions
- `segments` has no caller beyond its default: `app/main.ts` always takes `CAMERA_PATH_SEGMENTS`. Either the path's
  density becomes a setting or the parameter should be dropped — the same question `compile.ts`'s `only` carries.
- `resolveCameraAt` is imported here and never called; it is the clip-level resolve the sampler used to go through.
  Dropping the import is the whole of the fix.
