# src/animation/compile.ts

Ring: 1 · Layer: animation · Depends on: ../document/project.js, ../document/timeline.js, three

## Responsibility
Translates the authoring timeline into one `THREE.AnimationClip`: channel to keyframe-track class, interpolation mode to Three.js interpolant, channel to `PropertyBinding` path. It is a pure translation — it creates no mixer, holds no state, and never evaluates a time; Three.js is the interpolation engine (D2).

## Public interface
```ts
function channelBinding(channel: TrackChannel): { path: string; valueSize: number };
function buildClip(project: Project, only?: readonly ObjectId[]): THREE.AnimationClip;
```

## Internal logic
1. `channelBinding` is an exhaustive switch: `position → { path: '.position', valueSize: 3 }`, `quaternion → { path: '.quaternion', valueSize: 4 }`, `scale → { path: '.scale', valueSize: 3 }`, `fov → { path: '.fov', valueSize: 1 }`, with a `never` default so adding a channel breaks the build. The `valueSize` values must equal the keyframe lengths `timeline.ts` validates.
2. `buildClip` walks `project.timeline.tracks` in array order and skips: tracks with zero keyframes (`KeyframeTrack` requires non-empty arrays), and object tracks whose `objectId` is absent from `project.objects` (a stale track survives a removal only if `removeTracksFor` was skipped).
3. When `only` is given, only object tracks whose `objectId` is in the list are compiled; camera tracks are omitted, because a partial clip is by definition a subset of the scene.
4. Track name = target binding name + `binding.path`. Object targets use the raw `ObjectId`, giving `obj-3.position`; the camera target uses the literal `'camera'`, giving `camera.fov`. `PropertyBinding` resolves that name through `Object3D.name` inside the mixer root, and `Playback.bind` assigns the same two literals — this is the whole cross-file contract between the two files.
5. `times = new Float32Array(keyframes.map(k => k.time))` and `values = new Float32Array(times.length * valueSize)`, filled keyframe by keyframe in stored order. Quaternion values are authored and written as `[x, y, z, w]`, which is what `QuaternionKeyframeTrack` interpolates (shortest-path slerp). A value whose length differs from `valueSize` is impossible through `timeline.ts`; the fill checks anyway and throws `RangeError` rather than writing out of bounds.
6. Interpolation: `step → THREE.InterpolateDiscrete`, `linear → THREE.InterpolateLinear`, `smooth → THREE.InterpolateSmooth`, applied to the created track. `InterpolateBezier` is not used: the authoring model has no tangent fields (D2).
7. Track class per channel: `VectorKeyframeTrack` for `position` and `scale`, `QuaternionKeyframeTrack` for `quaternion`, `NumberKeyframeTrack` for `fov`.
8. `new THREE.AnimationClip('timeline', project.timeline.duration, tracks)` and return it. The clip name is a fixed literal — object identity comes from the binding names, never from the clip or track name. The duration comes from `timeline.duration`, not from the last keyframe time, so a track shorter than the timeline does not shorten the export.

## Invariants
- Pure: `buildClip` mutates nothing in the project or the timeline, and copies every keyframe value out of the authored arrays into fresh typed arrays, so a later edit cannot retroactively change a clip already handed out.
- `clip.duration === project.timeline.duration` for every clip built without `only`.
- Track names are unique per `(target, channel)` because the timeline holds at most one track per pair; each name is a `PropertyBinding` path relative to the target object.
- `values.length === times.length * valueSize` for every track, and `times` is strictly increasing (pinned by `timeline.ts`).
- Interpolation mapping is total, exact, and per-track: a single clip may mix step, linear, and smooth tracks.
- An object with no tracks contributes nothing; a project with no tracks yields a clip with an empty track list and the timeline's duration.
- Exactly one place in ring 1 maps a channel to a binding path: `channelBinding`. No other module re-derives `'.position'` or a value size.

## Errors
- No `Result` type: the inputs are validated where they are authored, so the only runtime failures are invariants. An unknown `TrackChannel` throws `TypeError` from the `never` guard; a keyframe whose `value.length` contradicts `channelBinding` throws `RangeError`.
- Missing objects and empty tracks are skipped silently by design — they are normal states after an edit, not failures.

## Dependencies
- `../document/project.js` — `Project` and `ObjectId` (the `objects` map is the existence check for step 2).
- `../document/timeline.js` — `Track`, `TrackChannel`, `Interpolation`, `TrackTarget` types; the timeline data itself is read through `project.timeline`, so no mutator is imported.
- `three` — `AnimationClip`, `VectorKeyframeTrack`, `QuaternionKeyframeTrack`, `NumberKeyframeTrack`, and the interpolation constants; allowed in ring 1 (D1, D2).

## Tests
- `tests/timeline.test.ts` — clip compilation maps `step`/`linear`/`smooth` onto the three interpolants, picks the right track class and `'.position'`/`'.quaternion'`/`'.scale'`/`'.fov'` paths, sets `duration` from the timeline, and omits objects without keyframes.

## Open questions
- `only` has no caller in the demo slice: `Playback.rebuild` compiles the whole timeline and the export job renders the whole scene. Either a preview flow needs it or it should be dropped (the brief requires every option to have a real caller).
