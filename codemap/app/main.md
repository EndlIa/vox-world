# src/app/main.ts

Ring: 4 · Layer: app · Depends on: every module of rings 0-4 (see Dependencies)

## Responsibility
The composition root: the only file allowed to import every module. It creates the project and every long-lived object, wires the import → voxelize
→ edit → animate → export flow, and runs the render loop; it owns no algorithm, only calls into inner rings.

## Public interface
```ts
type AppContext = {
  project: Project; mirror: SceneMirror; picker: Picker; session: EditorSession; playback: Playback;
  controls: ViewportControls; pointer: PointerTool; capture: Capture; overlay: Overlay;
};
function main(): void;
```

## Internal logic
1. **Entry and project.** `index.html` pins `<canvas id="viewport">`, `<div id="panels">`, `<div id="timeline">`, and `<div id="hud">` and loads
   `/src/app/main.ts` as a module. `main()` resolves those four elements once, builds everything below, schedules the render loop, and returns;
   the long-lived objects live in one `AppContext`, everything else stays `main`-local. It creates `new Project()` and one demo voxel object
   through `project.createVoxelObject(...)`, so the viewport is not empty before the first import.
2. **Viewport.** `viewportCamera = new THREE.PerspectiveCamera(...)` is app-owned viewport state (D17) and has camera layers 1 and 2 enabled, so the overlay,
   the aspect guide, and the gizmo (layer 1) and the imported raw meshes (layer 2, D24) are drawn by the viewport while the raycaster tests layers 0 and 2
   and the export camera — and the `Capture` that renders through it — tests layer 0 alone; `new THREE.WebGLRenderer({ canvas: viewport,
   antialias: true })`; `new SceneMirror(project, { background, ambientIntensity })`, whose `mirror.camera` is the output camera; `new
   ViewportControls(viewport, viewportCamera)`; `new Overlay(mirror.scene)`; `new OutputPreview({ aspect, visible: true })`, its `guide` in
   `mirror.scene`; `new Capture({ width, height })` at the initial export size, which every export resizes to the resolution the panel asked for;
   then `mirror.frameAll(viewportCamera)`.
3. **Editor objects.** `new EditorSession(project)`, `new Picker(mirror)`, and `new PointerTool({ dom: viewport, project, session, picker, overlay,
   `getCamera: () => (cameraLocked ? mirror.camera : viewportCamera)`, `getGizmoBusy: () => controls.gizmoBusy()`, callbacks })`; the camera closure
   is what keeps a pick on the camera that drew the frame, since the lock retargets rendering, and the gizmo closure is the one claim the tool defers
   to, so a left press on empty space still reaches picking while the gizmo is attached — `controls` is constructed in step 2 and the arrow defers the
   lookup to call time. The callbacks refresh the UI, mark objects dirty, and write the status line.
4. **Animation.** `new Playback({ camera: mirror.camera })` — the output camera whose `fov` a track animates — then `playback.bind(new Map(...))`
   mapping every `ObjectId` to `mirror.objectOf(id)`; `Playback` names the bound objects itself.
5. **UI.** `new Panels(panelsRoot, panelContext)`, `new TimelinePanel(timelineRoot, timelineContext)`, and `new Hud(hudRoot)`, over the actions of
   step 6; `pickImportFile` is implemented here as `void pickGlbFile().then(file => { if (file) void importFile(file); })`, so the dialog stays in
   `app/`.
6. **Flow wiring**, the only place the modules meet:
   - Import — `importFile(file)` is the body of `pickImportFile` and of the drop callback: `file.arrayBuffer()` → `await importGlb(data)`; failure →
     `panels.reportError(`${error}: ${detail}`)`; success → `adoptImportedScene(project, scene)` creates the import's **one** object, and
     `attachSourceMeshes(scene, objectId)` builds one `new THREE.Mesh(node.geometry, node.sourceMesh.material)` per imported node — every node, the
     outline shells included — keeps each in the app-local `sourceMeshes` array for teardown, and hands it to
     `mirror.attachSourceObject(objectId, mesh, node.matrixWorld)` — with the node's own baked world matrix (D25), not with an assumed identity local
     transform, because that matrix is where the model's placement lives now that one object stands for the whole file, and because the object's own
     transform is about to be replaced by the payload's placement. Then mark that id dirty, `bindingsDirty`, `mirror.sync()`, `commitDirty()`, and
     **immediately** `await runVoxelizeJob(buildVoxelizeSource(scene), importTarget(), objectId)` (D26): the import itself voxelizes the whole imported
     scene, so no click separates the import from voxels. `importTarget()` is `{ kind: 'uniform', voxelSize: defaults().uniformVoxelSize }`, the uniform
     default the panel seeds itself with. The intermediate `sync()`/`commitDirty()` gives the frames that run during chunked voxelization a node and the raw
     meshes on layer 2; the job's own `frameAll` then measures the finished voxels. An outline shell is a source mesh like every other node — the model is
     displayed as authored — but its geometry never reaches `buildVoxelizeSource`, so no payload carries its inverted hull; the object holds all of them at
     once, which is why a file of nothing but outlines still gets one object and no voxels at all.
   - Voxelize — one body, `runVoxelizeJob(source, target, objectId)`, shared by the import path and by `applyRevoxelize`: abort the in-flight job
     (`jobController?.abort()`, then cleared, so an import with nothing to voxelize still supersedes it) and return when `source` is `undefined`
     (an outline-only import), otherwise own a fresh `AbortController` and run
     `voxelize({ sources: [source], target, budget: DEFAULT_CELL_BUDGET, onProgress, signal })`; failure → `reportError` with the literal and detail;
     success → `applyVoxelizeResult(project, result, { attachTo: new Map([[source.sourceId, objectId]]) })`, mark dirty, `commitDirty()`,
     then `mirror.frameAll(viewportCamera)`; `clearProgress()` on both paths. The `attachTo` key is the source's own id — the id every output carries — so
     the payload lands on the object the import created instead of beside it. Framing belongs here, after the payload: an object that was an `'empty'`
     placeholder until this call renders as voxels now, and its source meshes hide behind them unless the override is on. `frameAll` syncs before measuring, so the
     payload meshes rebuilt for the id just marked dirty are exactly what it fits. The abort is mandatory and comes first: a setting committed twice in a
     row, or an import that lands on top of a running job, must leave only the newest payloads, and a superseded `voxelize` call reports itself as
     `'cancelled'`. `applyRevoxelize({ target })` is the panel's entry point — it returns without acting when `lastImport` is `undefined` (nothing to
     re-voxelize) and otherwise re-sources the retained import whole with `buildVoxelizeSource(lastImport.scene)` into `lastImport.objectId`;
     there is no per-object scope any more.
   - Edit: `createGroup` → `createGroup(project, 'Group')`; `deleteActive` → `deleteObject(project, session.activeObjectId)` then
     `session.setActiveObject(null)`.
   - Ops: `setActiveMaskColor(color)` → `setObjectMaskColor(project, session.activeObjectId, color)`; `setActiveVisible(visible)` →
     `setObjectVisible(project, session.activeObjectId, visible)`; `renameActive(name)` → `renameObject(project, session.activeObjectId, name)`, which
     trims and refuses an empty name; `reparentActive(parentId)` →
     `reparentObject(project, session.activeObjectId, parentId)`; `setLeafLabel(label)` →
     `setLeafLabel(project, objectId, leafId, label === '' ? undefined : label)` from a leaf selection. Every one of them returns without acting when
     nothing is active. A failed `OpResult` goes to `reportError(`${error}: ${detail}`)`; success marks dirty and refreshes — the mark is what makes
     the next `mirror.sync()` pick the change up, since the panel is re-read only through `commitDirty`.
   - Raw meshes: `setSourceVisible(enabled)` is the panel's one entry point for the override (D24). It writes `mirror.setSourceVisible(enabled)` and
     nothing else: the mirror owns the flag, applies it to its layer-2 meshes at once and again on the next `sync()`, and the panel reads it back through
     `sceneVisible: () => mirror.sourceVisible` — which is also why `main` implements `PanelContext.sceneVisible`, so the checkbox cannot drift from the
     mirror. No mark-dirty and no refresh are needed, and an export is unaffected either way because it renders layer 0 alone.
   - Defaults: `defaults()` seeds the panel from the retained import's `voxelizeBounds` — root size = largest extent, uniform voxel size = `root / 96`, octree target
     cell size = `root / 64`, `maxDepth = 10` — and returns the constants 10 m / 10⁄96 m / 10⁄64 m / 10 before any import. `/96` is what keeps a first
     import of real content at a workable cell count instead of a million cells. Those are the bounds of the nodes that are voxelized, not of every
     displayed node: a stylized export's outline shells are drawn around the model and a little larger, so seeding the root from them would inflate the
     octree root and the default voxel size for content they do not cover (README D27). A scene of nothing but outlines has no outline-free bounds, so it
     falls back to `scene.bounds`, which is what framing uses either way because every node is displayed.
   - Animate: `onEdited` → `playback.rebuild(project)`; `onScrub(t)` → `playback.pause()` then `playback.setTime(t)`.
   - Camera lock — `setCameraLock(enabled)`, the one entry point the panel has for it: it sets `cameraLocked`, hands navigation over with
     `controls.setOrbitTarget(enabled ? mirror.camera : viewportCamera)`, and hides the guide with `outputPreview.followOutputCamera(enabled)`.
     The flag is set before retargeting, so the retarget's own `change` event cannot author anything on the way out of the lock.
     `controls.onOrbitChange(...)` then copies the output camera's `position` and `quaternion` into `project.camera.transform` while
     `cameraLocked && !playback.playing`, which is what makes a timeline `add` on the camera record the pose the user actually aimed. The
     `playing` guard is mandatory: a running clip owns the mirror's camera, and writing its samples back would drift the authored pose frame by
     frame. `controls.dispose()` drops the registration, so no separate teardown call exists.
   - FOV — `setCameraFov(fov)`, the panel's one entry point for the output camera's projection: it ignores non-finite input, clamps to `[1, 179]`,
     writes `project.camera.fov`, and copies the clamped value onto `mirror.camera` with `updateProjectionMatrix()`, because assigning `fov` alone
     leaves the projection stale. The locked viewport and the next export therefore both show the authored value, and a camera `fov` keyframe records
     it instead of the value the mirror camera was constructed with.
   - Export: `exportMp4(options)` sizes the capture to the requested resolution with `capture.resize(options.width, options.height)` and points the
     aspect guide at that aspect, then runs `new ExportJob({ mirror }).run({ project, scene: mirror.scene, capture, playback, output: { width:
     options.width, height: options.height, fps: options.fps, from: options.from, to: options.to, mode: options.mode } }, onProgress, signal)` →
     `saveMp4(blob, 'vox-world.mp4')`; failure → `reportError`. Resolution, frame rate, range, and mask mode are the panel's choices; `main` owns
     only the capture that must render at them.
   - Drop: `wireDropTarget(viewport, file => { void importFile(file); })`.
7. **Render loop**, one `requestAnimationFrame` callback: `dt = Math.min((now - last) / 1000, 0.1)`; `playback.advance(dt)` for preview (a paused
   action does not advance, so the transport flag never has to be mirrored here); `mirror.sync()` for dirty objects; `controls.update()` and
   `outputPreview.update(viewportCamera)`; then `const renderCamera = cameraLocked ? mirror.camera : viewportCamera` and
   `renderer.render(mirror.scene, renderCamera)` — drawing through the output camera is what makes the lock visible. While the lock is on the
   loop also holds that camera's aspect equal to the canvas': an export sets the aspect for its own frames, and a resize would otherwise leave
   the locked view stretched. The output camera stays on layer 0, so the locked view shows exactly what an export shows — no overlay, no gizmo,
   no guide. Finally `timelinePanel.setTime(playback.time)` and a fresh `HudState` into the HUD.
8. The loop never reads or writes voxel data: no `UniformGrid` or `Octree` method is called and nothing is rasterized. An object is dirty only
   because an edit or an import changed its data, so `sync()` cannot overwrite a transform the mixer wrote for playback.
9. `HudState` is assembled here from `project.get(session.activeObjectId)`, `session.resolutionOf(id)`, `session.selection`, `Math.round(playback.time *
   project.timeline.fps)`, `project.timeline.fps`, and `leaf`: `octree.leafBox(leafId)` plus `getLeaf(leafId)` for a leaf selection, else null.
10. **Ownership.** `main` constructs and disposes every long-lived object and passes each dependency in; no module below it builds another module's
    dependencies (`Panels` never creates a `Project`, `PointerTool` receives its `Picker` and `Overlay`). The imported raw meshes are the same kind of
    app-owned object: they live in a `main`-local array, and teardown detaches them from the scene graph the mirror just released without disposing the
    geometry or materials they share with the imported scene. Disposal cancels the frame and the in-flight job, detaches the drop target, and disposes
    everything in `AppContext` plus the renderer, controls, capture, and overlay; the orbit-change registration lives in the controls, so disposing them
    unregisters it.

## Invariants
- `main()` creates the renderer, the mirror, and every listed object once, and schedules exactly one render loop.
- Project mutations get `mirror.markDirty` plus `panels.refresh()`, timeline edits go through `onEdited` → `playback.rebuild`, one job at a time.
- Every path that can make new geometry measurable re-fits the **viewport** camera: the import path ends in `runVoxelizeJob`, whose success path fits after
  `applyVoxelizeResult` and `commitDirty()`, because a payload can only be measured once it is attached, and the settings path (`applyRevoxelize`) fits the
  same way through the same body. No other path moves the camera, and the output camera is never framed.
- Importing is never a state the user has to finish: a successful import always ends in a voxelization of the whole imported scene at `importTarget()`
  (README D26), so the imported object holds a payload and no click, settings change, or confirmation is needed to see voxels. There is no per-object or
  per-scope voxelize path left, and `applyRevoxelize` is the only other caller of the shared body. One import is one object, one
  payload, and one row in the object list; an outline shell contributes no cells but is still displayed as one of that object's source meshes
  (README D27), and an import of nothing but outlines has no source at all: the object stays `'empty'` and the job returns after the abort, which is the
  one import that ends without a payload.
- The two bounds an import reports are used for exactly one thing each: `voxelizeBounds` seeds `defaults()` (and with it `importTarget()` and every panel
  field derived from it), `bounds` is what framing fits, and neither is ever mixed up. A shell that sticks out past the model therefore cannot move the
  voxel size, while framing still fits what the user can see.
- One voxelization job runs at a time: `jobController` is aborted before a new job takes ownership, so a superseded import or setting can never attach its
  payloads after the newer one. A job that was aborted reports `'cancelled'`; a job that fails leaves the project untouched (D12) — `applyVoxelizeResult` is
  only reached on `ok: true`.
- The render loop never reads or writes voxel data, and playback writes only mirror `Object3D` transforms and the camera `fov`.
- Authored camera pose (`project.camera.transform`) is written in exactly one place: the orbit-change callback, only while the lock is on and
  `playback.playing` is false; `project.camera.fov` is written only by `setCameraFov`. Nothing else reads a mirror transform back into the document
  while the mixer is running.
- `viewportCamera` (app-owned) drives rendering, navigation, picking, and fitting while the lock is off; with the lock on, navigation, rendering,
  and picking move to `mirror.camera` (output) — the stated exception to D17 — and the viewport camera is left exactly where it was until the lock
  is released. Picking follows the render camera through `getCamera()` and fitting always uses the viewport camera, and the output camera never gains
  layer 1 or layer 2, so neither a decoration nor a raw mesh can reach an export or a locked view.
- Every imported node gets exactly one raw mesh on layer 2, attached by `attachSourceMeshes` right after `adoptImportedScene` to the import's single object
  and handed that node's own baked `node.matrixWorld` (D25); the meshes share the imported geometry and materials, the app keeps
  them in `sourceMeshes`, the mirror never disposes them, and teardown detaches them. The matrix is what keeps every raw mesh on its imported pose — before
  the payload the object is at the identity, after it at the payload's translation, and `applySources` re-derives each mesh's local matrix from it: the app
  never re-parents a mesh, never computes a placement, and never writes a mesh matrix itself. Whether they are shown is the mirror's flag and the panel's
  checkbox (`setSourceVisible` + `sceneVisible`) — `main` keeps no copy of it and never toggles `visible` on a mesh itself.
- `HudState.leaf` is built here from `session.selection` and the octree; the HUD itself never queries anything.
- The pointer tool receives both live lookups it needs as closures — `getCamera()` for the render camera, `getGizmoBusy()` → `controls.gizmoBusy()` for
  the gizmo's claim — so neither is cached across frames. A left press therefore reaches `Picker.pick` whenever the gizmo is not dragging and no handle
  is hovered, which is what keeps leaf and cell selection reachable while the gizmo is attached to the active object.

## Errors
`importGlb`, `voxelize`, `applyVoxelizeResult`, and `ExportJob.run` failures reach the user through `panels.reportError` with the `Result`'s `error`
literal and `detail` as returned; a failed import or voxelization leaves the project untouched (D12); inner-ring programmer errors propagate. A
settings-driven voxelization with no import retains nothing to voxelize, so `applyRevoxelize` returns silently rather than reporting an error — the
panel has already done its part by forwarding a target — and a retained import whose every node is an outline has no source, which `runVoxelizeJob`
treats the same way: it aborts the superseded job, clears the progress line, and returns. An aborted job's own `'cancelled'` result is reported like any
other failure, because `jobController` is the only thing that knows the job was superseded. The
camera lock has no failure path and reports nothing: it is reversible UI state, and its only write is a pose copy.

## Dependencies
- `../document/project.js`, `../editor/{session,ops,pointer}.js` — `Project`, `EditorSession`, `EditResolution`, `applyVoxelizeResult`,
  `createGroup`, `deleteObject`, `renameObject`, `setObjectMaskColor`, `setObjectVisible`, `reparentObject`, `setLeafLabel`, `PointerTool`.
- `../voxels/voxelize/voxelize.js` — `voxelize`, `VoxelizeTarget`, `VoxelizeSource`; `../three-runtime/import.js` — `importGlb`, `adoptImportedScene`,
  `buildVoxelizeSource`.
- `../three-runtime/{scene,picking,controls,capture,overlay}.js` — `SceneMirror`, `Picker`, `ViewportControls`, `OutputPreview`, `Capture`,
  `Overlay`; `../animation/playback.js` and `../export/job.js` — `Playback`, `ExportJob`.
- `../ui/{panels,timeline,hud,dom}.js` — `Panels`, `TimelinePanel`, `Hud`, `el`; `./files.js` — `pickGlbFile`, `wireDropTarget`, `saveMp4`;
  `three` — `WebGLRenderer`, `PerspectiveCamera`. Nothing may import this file: the dependency direction stops here.

## Tests
None of its own: it is the smoke target of the slice, verified by `npm run dev` plus a walk through Scenario A and Scenario B (README section 9).
Importing is now the first assertion of every walk (README D26): dropping `island.glb` must show voxels with no further interaction — `imported <scene name> (N
node(s))` immediately followed by `voxelized N cell(s)` in the status line, the one imported object listed as `uniform` with a resolution, and no
`Voxelize` button or `Whole scene` checkbox anywhere in the panel — and committing
a new voxel size, cell size, root size, or max depth, or switching `Representation`, must re-voxelize the retained import at what the fields show. The
panel's field values must come from the outline-free bounds: importing `public/forest.glb` (79 nodes, 22 of them `*_Line _0` shells
holding 6410 of its 17628 triangles) reports `voxelized 28893 cell(s) from 11218 triangle(s)` — exactly the 57 non-outline nodes, in one payload — lists one
imported row named after the glTF scene (`Sketchfab_Scene · uniform · 0.147 m`) beside the boot demo cube, and seeds voxel size `0.147 m` and root size
`14.1552 m`, i.e. `root / 96` of that model's own extent; the 22 shells are drawn as that object's raw meshes and their cells are nowhere in the payload.
The same file is the measurement of the one-payload rule: the same 11218 triangles used to voxelize into 57 payloads holding 32854 cells, and the 3961 cells
of the difference are the ones two or more meshes claimed (the stones inside the soil box, the barbecue and the fire inside each other) — two objects whose
boxes overlapped drew exactly coincident cubes in different colours, and the first part now keeps such a cell. The repo's demo GLBs have
identity node transforms, so the placement half (D25) needs real content: a Sketchfab export whose root chain and mesh nodes carry a rotation and
non-uniform scales must land with the object translation-only and every raw mesh exactly where the import put it — through the object's identity transform
before the payload and the payload's `-origin` offset after it — with every voxel grid axis-aligned in world space, and `Show raw meshes` must bring the raw
meshes back exactly on top of their voxels — before the fix those meshes landed rotated, sheared, and mis-scaled relative to them.
Scenario A exercises the camera lock end to end: import `island.glb` — one object, the whole file — tick `Camera lock (output)`, steer the output camera
with middle/right drag, and `add` camera keyframes at two playhead times — the two keyframes must differ, the export must move the camera along them,
and pressing play must leave the authored pose untouched while the clip runs. The two object properties the panel exposes go through their ops on the
same walk: renaming the active object must change the object list and the HUD, unticking `Visible` must hide its node in the viewport, and a blank
name must come back as a reported failure with the object unchanged. The raw-mesh half of the walk: a click must select the imported object with no
selection or overlay, hovering must name it in the status line, the voxelization the import already ran must have replaced the raw meshes with voxels,
`Show raw meshes` must bring them back over them and take them away again, and an export taken while they are shown must contain voxels only — the
output camera and `Capture` never test layer 2.

## Open questions
- Brief section 4 has animation "mark mirrored objects dirty"; rebuilding from project truth while the mixer's transforms are animated would clobber
  them, so dirty marking stays on the edit and import paths.
- The `FOV (deg)` field authors `mirror.camera.fov` directly, so a `fov` track that is running overwrites the typed value on the next mixer
  sample while the document keeps it — the same ownership split the pose copy guards with `playback.playing`, but the projection has no such guard.
