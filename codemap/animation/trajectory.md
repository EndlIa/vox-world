# src/animation/trajectory.ts

Ring: 1 · Layer: animation · Depends on: ./compile.js, ../document/timeline.js, ../document/project.js, three

## Responsibility
Turns the authored camera position track into the two plain point lists the viewport drawing needs: the sampled
polyline of where the camera travels, and one point per authored keyframe, which is where the rings go. The sampling
is not a second interpolation — it runs the compiled track through a scratch `AnimationMixer`, so the curve between
keyframes is three's own, discrete, linear, or the smooth spline exactly as the track was built (README D2) — and the
only thing decided here is the set of times to ask for: an even walk over the clip's length. It stores nothing, holds
no mixer, and writes nothing into the project; every call builds fresh points and releases the mixer it built
(`animation/playback.ts` is the long-lived one, this is a throwaway). It exists for the camera path drawing (README D47).

## Public interface
```ts
const CAMERA_PATH_SEGMENTS = 128;
function sampleCameraTrajectory(project: Project, segments = CAMERA_PATH_SEGMENTS): Vector3[];
function cameraKeyframePositions(project: Project): Vector3[];
```

## Internal logic
1. `CAMERA_PATH_SEGMENTS` is 128: enough that a curved move reads as a curve at demo scale, and few enough that the
   polyline is rebuilt cheaply on every redraw.
2. `sampleCameraTrajectory` compiles the timeline with `buildClip(project)` and looks for the track named `camera` +
   `channelBinding('position').path`, i.e. `camera.position`. That lookup is written against the two literals of the
   binding contract `compile.ts` and `playback.ts` share: the camera target's binding name is `'camera'` and the
   channel path is `channelBinding`'s (README D22).
3. No such track returns `[]`. A camera with no authored position keyframes has no path to draw, which is a normal
   state rather than a failure.
4. Sampling runs the one track, not the whole clip: a fresh `AnimationClip` carries the compiled clip's name and
   duration and only the camera position track. A scratch `Object3D` named `camera` is added to an unnamed scratch
   root, and the mixer is created over that root. The root stays unnamed so only the child can be bound, and because
   no object track enters the sampling clip the mixer never has to resolve a node named after an `ObjectId` at all.
5. The action is set to `LoopOnce, 1` with `clampWhenFinished = true` and played. A repeating action folds the sample
   taken at the clip's length back onto the first keyframe, and the drawn path has to reach the last one; the clamp is
   what puts that final sample on the last keyframe instead.
6. Times: `steps = Math.max(1, Math.floor(segments))`, then a sample at each `clip.duration * step / steps` for
   `step` 0 to `steps` inclusive — both ends of the clip included. Each iteration calls `mixer.setTime(time)` and
   pushes `node.position.clone()`, so what is returned is copies.
7. `mixer.uncacheRoot(root)` releases the scratch binding walk before the points are returned; the scratch nodes and
   sampler clip go with it.
8. `cameraKeyframePositions` is the marker list, and it is deliberately separate from the sampled one: a ring belongs
   to an authored keyframe, not to a sample of the curve between two of them. It reads
   `findTrack(project.timeline, CAMERA, 'position')` and maps every `Keyframe.value` to a `Vector3` in the track's own
   order — which `document/timeline.ts` keeps strictly ascending by time — and returns `[]` for a camera without that
   track.
9. `CAMERA` is the module-private `{ kind: 'camera' }` by which the timeline names the camera target.

## Invariants
- Interpolation is entirely three's: no easing, no curve math, and no keyframe arithmetic happens here. `step` holds
  the earlier keyframe, `linear` lands between two, and `smooth` follows the spline, because that is what the compiled
  track interpolates (README D2).
- `points.length === Math.max(1, Math.floor(segments)) + 1`; the first point is the clip's start and the last is the
  clip's length, so a path always spans the whole clip rather than ending at the last keyframe.
- Every returned point is a fresh `Vector3`: mutating one reaches neither the project, the clip, nor a later sample,
  and no authored array is aliased.
- The camera position track is the only thing that can bind: the sampling clip holds exactly that track, its target is
  the scratch child named `camera`, and the root above it is unnamed, so `PropertyBinding` finds nothing else and no
  object track can enter the walk.
- A camera without a position track yields `[]` from both functions, and neither of them throws.
- Nothing is retained and nothing is serialized: no mixer, node, clip, or point survives a call.

## Errors
No `Result` and no failure path: both functions are total. A missing track is the empty list, which is the state the
drawing turns into nothing. `segments` is floored and floored at one, so a caller asking for less than one segment
still gets a drawable two-point line rather than an exception.

## Dependencies
- `./compile.js` — `buildClip` for the clip and `channelBinding` for the `'.position'` path of the D22 name.
- `../document/timeline.js` — `findTrack` and the `TrackTarget` type for the marker list.
- `../document/project.js` — `Project`.
- `three` — `AnimationClip`, `AnimationMixer`, `LoopOnce`, `Object3D`, `Vector3`; allowed in ring 1 (D1, D2).

## Tests
- `tests/trajectory.test.ts` — even sampling with both ends included, the sampler following the track's interpolation
  instead of assuming a straight line, one marker point per keyframe in time order, and nothing at all without a
  track. The clip the sampler leans on, and the interpolation modes it maps, are pinned by `tests/timeline.test.ts`.

## Open questions
- `segments` has no caller beyond its default: `app/main.ts` always takes `CAMERA_PATH_SEGMENTS`. Either the path's
  density becomes a setting or the parameter should be dropped — the same question `compile.ts`'s `only` carries.
