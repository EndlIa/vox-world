# src/animation/playback.ts

Ring: 1 · Layer: animation · Depends on: ./compile.js, ../document/project.js, three

## Responsibility
A thin `THREE.AnimationMixer` wrapper: it owns play, pause, stop, loop, interactive advance, and the frame-exact `setTime` the export loop drives, plus binding project object ids to their mirrored `Object3D`s. It owns no animation data — the authored keyframes live in `document/timeline.ts` and the clip is derived by `./compile.js` — and it never writes into the project (D4).

## Public interface
```ts
class Playback {
  constructor(opts: { camera: THREE.PerspectiveCamera });
  bind(objects: Map<ObjectId, THREE.Object3D>): void;   // targets the mixer animates
  rebuild(project: Project): void;                      // recompiles the clip, keeps the current time
  setTime(time: number): void;                          // frame-exact, used by export
  play(): void; pause(): void; stop(): void;
  setLoop(loop: boolean): void;
  advance(deltaSeconds: number): void;
  get time(): number;
  get playing(): boolean;                               // the mixer is advancing the clip
  get duration(): number;
  dispose(): void;
}
```

## Internal logic
1. Fields: the output `camera`, `mixer: THREE.AnimationMixer | null`, `clip: THREE.AnimationClip | null`, `action: THREE.AnimationAction | null`, the bound object map, and the `loop`/`running` flags. Everything is runtime state; nothing here is saved with the project, and `running` is exposed as the read-only `playing` accessor.
2. `bind(objects)` stores the map and resolves the mixer root as the topmost ancestor of the first bound `Object3D`, which is `mirror.scene` — the mirror places every mirrored node under one scene root, so `PropertyBinding.findNode` reaches every named descendant from there. The root is never the bound object node itself: `PropertyBinding` resolves names relative to the root, and a node used as the root cannot find its own children's siblings. It then writes `object.name = objectId` for each entry and `camera.name = 'camera'`, because track names bind through `Object3D.name` — this naming is the binding contract of D22, and the output camera is a child of the scene root named `camera`. The assignment is idempotent — `SceneMirror` already names each per-object node with its `ObjectId` (plus `userData.objectId`) — and it never clobbers a display name, since display names live in `SceneObject.name`. Instance-bucket `InstancedMesh`es stay unnamed in the mirror, so no track can ever resolve to an instance mesh. `SceneMirror` adds the output camera to the scene root itself, so it is already a child of the mixer root when `bind` runs; that is what lets a `camera.*` track resolve.
3. Rebinding replaces the previous mixer: the old root is released with `uncacheRoot`, so no stale binding survives a re-`bind`.
4. `rebuild(project)` keeps the playhead: it samples `const t = this.time`, compiles `clip = buildClip(project)`, and, when a mixer exists, discards the old action and creates a new one with the same settings — `setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1)`, `clampWhenFinished = !loop`, `setEffectiveWeight(1)`, `play()`, and `paused = !running`. The action is always active; deactivating it would also drop the bindings `setTime` needs. Finally it restores `setTime(t)`. With nothing bound yet the clip is retained and the action is created on the next `bind`.
5. `setTime(t)` clamps `t` to `[0, duration]`, then calls `mixer.setTime(t)`: the mixer zeroes its clock and applies exactly one update of `t`, so the sampled transforms depend only on `t` and the clip — repeating `setTime(t)` reproduces identical frames, and at a keyframe time the authored value is reproduced exactly. It finishes by refreshing the camera's projection matrix itself (`camera.updateProjectionMatrix()`), which is the only way a `.fov` track's change becomes visible to the renderer, since the mixer writes `camera.fov` without touching the matrix. `export/job.ts` therefore gets all three guarantees — clamped range, purity in `t`, and an up-to-date projection matrix — from this one call and never has to repeat them.
6. `play()` sets `running` and clears `action.paused`; `pause()` sets `running = false` and `action.paused = true`, which keeps the action active so scrubbing still samples; `stop()` is `pause()` plus `setTime(0)`. `running` is read back only through `get playing()`, which is therefore false before the first `play()` and after every `pause()` or `stop()`.
7. `advance(deltaSeconds)` calls `mixer.update(deltaSeconds)` for interactive preview only. It accumulates, so it is not reproducible and the export loop never uses it.
8. `setLoop(loop)` stores the flag and re-applies the loop mode and `clampWhenFinished` to the current action.
9. `get time()` returns the action's own playhead (`action ? action.time : 0`), which `LoopRepeat` wraps into `[0, duration)` and `LoopOnce` clamps at the end. `get playing()` reports the transport state, not the mixer's: it says whether `play()` is in effect, and only an explicit `pause()`/`stop()` clears it, so a clip that reached its end while playing still reports `true`. `get duration()` returns `clip ? clip.duration : 0`, i.e. the compiled `timeline.duration`.
10. `dispose()` stops all actions, uncaches the mixer root, and drops the clip, action, mixer, and object map. Mirror `Object3D`s, the camera, and the project are left untouched — they outlive playback.

## Invariants
- The mixer writes only into the bound mirror `Object3D`s (`position`, `quaternion`, `scale`) and into `camera.fov`. It never writes into `project.objects`, so playback cannot dirty voxel data and cannot feed an edit loop (D1, D4). While it is running, nothing reads a transform back out of an `Object3D` as authoring input: the app copies the output camera's pose into `project.camera.transform` only while `playing` is false, so a sampled frame can never drift the authored pose.
- `setTime(t)` clamps `t` to `[0, duration]`, is a pure function of `t` and the clip — same `t` in, same transforms out, with no dependence on call history — and refreshes the camera's projection matrix itself whenever a `.fov` track changed `camera.fov`. `export/job.ts` relies on exactly these three guarantees and must not re-clamp, re-sample, or call `updateProjectionMatrix()` (D2).
- `rebuild` preserves `time`, `running`, and `loop`, so editing a keyframe or the timeline duration never jumps the playhead.
- `playing` reports the transport, not the mixer: it is true from `play()` until the next `pause()` or `stop()`, and false before the first `play()`. It never depends on whether the playhead reached the end, and it is only ever observed, never used to sample a frame — `setTime` stays valid while playing.
- `bind` names bound objects by `ObjectId` and the camera `'camera'`; `compile.ts` names tracks `obj-<n>.<path>` and `camera.<path>` against exactly those literals. The mixer root is always `mirror.scene`, never a bound node.
- The mixer root is the shared scene root, so no track can bind outside it: instance-bucket `InstancedMesh`es carry only `userData` and stay unnamed in the mirror, and no other node in the subtree is named after an `ObjectId` (the mirror's per-object nodes already carry `node.name = <ObjectId>` and `userData.objectId`, which makes `bind`'s assignment idempotent).
- The camera's projection matrix is current after `setTime`, `advance`, and `stop`.
- `time` and `playing` are never stored in `Timeline` and are not export inputs: the export job supplies its own `t` per frame. `playing` is the app's read-only guard — it is consulted before authored camera data is written, and it gates nothing inside playback.
- Before anything is bound, `rebuild` still compiles and stores the clip; `setTime`, `play`, and `advance` are harmless, and `time` stays `0`.
- `clip` and `action` are always consistent: the action is created from the current clip, and the previous one is discarded first.

## Errors
- No `Result` type and no user-facing failure: playback is driven by UI and export code that already owns error reporting.
- A non-finite `time` or `deltaSeconds` throws `RangeError` — a programmer error, since `Timeline` times and the export loop are finite by construction.
- `dispose()` is idempotent and safe before any `bind`; destroying the mixer while mirrored objects are still bound is prevented by leaving those objects in place.

## Dependencies
- `./compile.js` — `buildClip`, the only source of the clip; interpolation and channel paths are its business, not this file's.
- `../document/project.js` — `Project` for `rebuild` and `ObjectId` for the binding map.
- `three` — `AnimationMixer`, `AnimationAction`, `AnimationClip` types, `LoopRepeat`/`LoopOnce`, and `PerspectiveCamera`; allowed in ring 1 (D1, D2).

## Tests
- `tests/timeline.test.ts` — `AnimationMixer.setTime` reproduces keyframe values exactly at keyframe times, which is this file's `setTime` contract; the same file pins the clip that `rebuild` installs. The `playing` accessor has no test of its own: only the app's authoring guard reads it, and that guard's effect is observable only in a running browser.

## Open questions
- Whether `advance` should delegate to `setTime((time + delta) % duration)` so interactive preview is also exactly reproducible, at the cost of not using `LoopRepeat`'s native wrap.
