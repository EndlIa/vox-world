# src/animation/compile.ts

Ring: 1 · Layer: animation · Depends on: ../document/project.js, ../document/timeline.js, three

## Responsibility
Translates the authoring timeline into one `THREE.AnimationClip`: channel to keyframe-track class, interpolation mode to Three.js interpolant, channel to `PropertyBinding` path. It is a pure translation — it creates no mixer, holds no state, and never evaluates a time; Three.js is the interpolation engine. It is also the one place an authored keyframe time becomes a clip time: the document holds milliseconds, fractional included, and the clip is seconds, so this division by 1000 is where the two units meet.

## Public interface
```ts
function channelBinding(channel: TrackChannel): { path: string; valueSize: number };
function buildClip(project: Project, only?: readonly ObjectId[]): THREE.AnimationClip;
```

## Internal logic
1. `channelBinding` is an exhaustive switch: `position → { path: '.position', valueSize: 3 }`, `quaternion → { path: '.quaternion', valueSize: 4 }`, `scale → { path: '.scale', valueSize: 3 }`, with a `never` default so adding a channel breaks the build. The `valueSize` values must equal the keyframe lengths `timeline.ts` validates.
2. `buildClip` walks `project.timeline.tracks` in array order and skips: tracks with zero keyframes (`KeyframeTrack` requires non-empty arrays), and object tracks whose `objectId` is absent from `project.objects` (a stale track survives a removal only if `removeTracksFor` was skipped). An empty track is a normal state rather than half of a deletion — `document/timeline.ts` keeps a track when its last keyframe is removed — and this skip is what makes such a track contribute nothing to the clip.
3. When `only` is given, only tracks whose `objectId` is in the list are compiled, because a partial clip is by definition a subset of the scene. There is no camera to omit: the camera is not a target this file can meet.
4. Track name = target binding name + `binding.path`. Every target is an object, so the name is the raw `ObjectId` plus the channel's path — `obj-3.position`, `obj-7.scale`. `PropertyBinding` resolves that name through `Object3D.name` inside the mixer root, and `Playback.bind` assigns the same names — the object ids, one per mirrored node — which is the whole cross-file contract between the two files. The camera is deliberately absent from that contract: `document/camera.ts` resolves the shot, and `SceneMirror.applyShot` writes it into the output camera, so no track is ever named after one.
5. `times = new Float32Array(keyframes.map(k => k.timeMs / 1000))` and `values = new Float32Array(times.length * valueSize)`, filled keyframe by keyframe in stored order. The division is deliberate and is the whole of the unit boundary: the authoring timeline counts milliseconds (`timeMs`, `durationMs`), fractional included, the clip counts seconds, and playback, scrubbing, the export job, and the HUD all keep working in seconds because of it. Quaternion values are authored and written as `[x, y, z, w]`, which is what `QuaternionKeyframeTrack` interpolates (shortest-path slerp). A value whose length differs from `valueSize` is impossible through `timeline.ts`; the fill checks anyway and throws `RangeError` — naming the keyframe's `timeMs`, in milliseconds — rather than writing out of bounds.
6. Interpolation: `step → THREE.InterpolateDiscrete`, `linear → THREE.InterpolateLinear`, `smooth → THREE.InterpolateSmooth`, applied to the created track. `InterpolateBezier` is not used: the authoring model has no tangent fields.
7. Track class per channel: `VectorKeyframeTrack` for `position` and `scale`, `QuaternionKeyframeTrack` for `quaternion`. `NumberKeyframeTrack` is no longer imported: it existed for the camera's `fov` channel, and the camera is no longer a track.
8. `new THREE.AnimationClip('timeline', project.timeline.durationMs / 1000, tracks)` and return it. The clip name is a fixed literal — object identity comes from the binding names, never from the clip or track name. The duration comes from `timeline.durationMs`, converted to the clip's seconds, and not from the last keyframe time, so a track shorter than the timeline does not shorten the export.

## Invariants
- Pure: `buildClip` mutates nothing in the project or the timeline, and copies every keyframe value out of the authored arrays into fresh typed arrays, so a later edit cannot retroactively change a clip already handed out.
- `clip.duration === project.timeline.durationMs / 1000` for every clip built without `only`.
- Track names are unique per `(target, channel)` because the timeline holds at most one track per pair; each name is a `PropertyBinding` path relative to the target object.
- `values.length === times.length * valueSize` for every track, and `times` is strictly increasing (pinned by `timeline.ts`), because the authored times are already strictly ascending.
- Every clip time is its authoring time over 1000, and this is the only place an authored time becomes a clip time. The widget seeks and displays in milliseconds and the app converts at those two calls (`onScrub` in, the loop's `setTime` out), so no other module turns an authoring time into a sampled one.
- Interpolation mapping is total, exact, and per-track: a single clip may mix step, linear, and smooth tracks.
- An object with no tracks contributes nothing; a project with no tracks yields a clip with an empty track list whose duration is still the timeline's, in seconds.
- The camera contributes nothing and can contribute nothing: no channel maps to a `.fov` path, no target names it, and the shot is resolved from `document/camera.ts` — so the mixer never interpolates a camera, and a clip is objects alone.
- Exactly one place in ring 1 maps a channel to a binding path: `channelBinding`. No other module re-derives `'.position'` or a value size.

## Errors
- No `Result` type: the inputs are validated where they are authored, so the only runtime failures are invariants. An unknown `TrackChannel` throws `TypeError` from the `never` guard; a keyframe whose `value.length` contradicts `channelBinding` throws `RangeError`.
- Missing objects and empty tracks are skipped silently by design — they are normal states after an edit, not failures.

## Dependencies
- `../document/project.js` — `Project` and `ObjectId` (the `objects` map is the existence check for step 2).
- `../document/timeline.js` — `Track`, `TrackChannel`, `Interpolation`, `TrackTarget` types; the timeline data itself is read through `project.timeline`, so no mutator is imported.
- `three` — `AnimationClip`, `VectorKeyframeTrack`, `QuaternionKeyframeTrack`, and the interpolation constants; allowed in ring 1.

## Tests
- `tests/timeline.test.ts` — clip compilation maps `step`/`linear`/`smooth` onto the three interpolants, picks the right track class and `'.position'`/`'.quaternion'`/`'.scale'` paths, sets `duration` from `timeline.durationMs / 1000`, reads keyframe times back as `timeMs / 1000`, omits objects without keyframes and tracks left empty, and asserts that no track is named `camera.fov` — the camera is not the clip's.

## Open questions
- `only` has no caller in the demo slice: `Playback.rebuild` compiles the whole timeline and the export job renders the whole scene. Either a preview flow needs it or it should be dropped — every option must have a real caller.
