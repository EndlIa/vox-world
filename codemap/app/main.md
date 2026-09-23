# src/app/main.ts

Ring: 4 · Layer: app · Depends on: every module of rings 0-4 (see Dependencies)

## Responsibility
The composition root: the only file allowed to import every module. It creates the project and every long-lived object, wires the import → voxelize
→ edit → animate → export flow, and runs the render loop; it owns no algorithm, only calls into inner rings. It also owns the one `VoxelizeDialog`:
the voxelization settings live there (README D26), and this file is what asks for them — once per import, after the model is on screen. `main`
never holds the settings; it seeds the dialog from the retained import's per-axis extent and acts on the count it resolves —
scaling the imported model onto the unit lattice first, so that count is the model's length in voxels (README D41).

## Public interface
```ts
type AppContext = {
  project: Project; mirror: SceneMirror; picker: Picker; session: EditorSession; playback: Playback;
  controls: ViewportControls; pointer: PointerTool; capture: Capture; overlay: Overlay; worldGrid: WorldGrid;
  cameraControl: CameraControl;
  cameraPath: CameraPath;
};
function main(): void;
```

## Internal logic
1. **Entry and project.** `index.html` pins `<canvas id="viewport">`, `<div id="panels">`, `<div id="timeline">`, and `<div id="hud">` and loads
   `/src/app/main.ts` as a module. `main()` resolves those four elements once, builds everything below, schedules the render loop, and returns;
   the long-lived objects live in one `AppContext`, everything else stays `main`-local. It creates `new Project()` and sets the clip it opens with —
   `project.timeline.durationMs = DEFAULT_DURATION_MS` (10 000, the authoring unit, i.e. ten seconds once the clip is compiled) and
   `project.timeline.fps = DEFAULT_FPS` — and one demo voxel object
   through `project.createVoxelObject(...)` — `buildDemoGrid()`, a `DEMO_CELLS`³ cube (4×4×4) of unit cells built by
   `UniformGrid.create()`, placed at `(-2, 0, -2)` — so the viewport is not empty before the first import. A cell coordinate is a world
   coordinate (README D41), so the demo content occupies the cells it names.
2. **Viewport.** `viewportCamera = new THREE.PerspectiveCamera(...)` is app-owned viewport state (D17) and has camera layers 1 and 2 enabled, so the overlay,
   the gizmo (layer 1) and the imported raw meshes (layer 2, D24) are drawn by the viewport while the raycaster tests layers 0 and 2
   and the export camera — and the `Capture` that renders through it — tests layer 0 alone; `new THREE.WebGLRenderer({ canvas: viewport,
   antialias: true, logarithmicDepthBuffer: true })`; `new SceneMirror(project, { background, ambientIntensity })`, whose `mirror.camera` is the output camera; `new
   `ViewportControls(viewport, viewportCamera)`; `new Overlay(mirror.scene)`; `new WorldGrid()`, whose `root` is added to `mirror.scene` —
   viewport decoration on layer 1 like the overlay, so it is never picked and never exported (D35, D49); `new CameraControl(mirror.scene)`, the
   runtime-only camera carrier the edit gizmo aims the output camera with (README D46) — a hidden node on the same layer 1, so it is never picked
   and no export frame contains it, and it reports the authored camera rather than owning any data — with `CAMERA_CONTROL_PIVOT`, `new Vector3(0, 0, 0)`,
   as the pivot the gizmo attaches it at; `new CameraPath(mirror.scene)`, the runtime-only drawing of the authored camera's trajectory (README D47) —
   hidden, unnamed, and on the same layer 1, so it is never picked and no export frame contains it, and it holds points the app hands it rather than
   any camera data; then
   `new Capture({ width, height })` at the initial export size, which every export resizes to the resolution the panel asked for;
   then `mirror.frameAll(viewportCamera)`.
3. **Editor objects.** `new EditorSession(project)`, `new Picker(mirror)`, and `new PointerTool({ dom: viewport, project, session, picker, overlay,
   `getCamera: () => (cameraLocked ? mirror.camera : viewportCamera)`, `getGizmoBusy: () => controls.gizmoBusy()`, callbacks })`; the camera closure
   is what keeps a pick on the camera that drew the frame, since the lock retargets rendering, and the gizmo closure is the one claim the tool defers
   to, so a left press on empty space still reaches picking while the gizmo is attached — `controls` is constructed in step 2 and the arrow defers the
   lookup to call time. The callbacks are the two closures that keep the UI and the mirror in step: `onSessionChange` re-reads the readouts,
   re-syncs the gizmo, and refreshes the mode bar, the panels, and the timeline, and marks the active object dirty; `onProjectChange(ids)`
   receives the ids of the objects an operation wrote — `projectChanged(ids)` adds each of them to `dirtyIds` and flags the playback bindings for a
   rebuild, then commits, so exactly those objects are marked dirty for the mirror and rebuilt (README D4) — which is what leaves neither half of a
   detach, whose two objects both changed, drawing stale geometry. Two app flags sit beside `cameraLocked`: `cameraControlSelected` (`false`), which
   is whether the gizmo drives the carrier instead of the active object, and `gizmoMode` (`'translate'`), the one gizmo mode the carrier and an object
   share (README D46). `cameraPathVisible` (`false`) sits beside them: whether the camera path is drawn, which `refreshCameraPath` clears whenever
   the camera track holds fewer than two keyframes (README D47). `followCamera` (`true`) sits beside that: whether a run of the clip takes the
   viewport with it, on by default the way the reference product has it, read when a run starts and never in flight (README D48). `playbackView` holds
   the viewport state a run started from — the camera's `position` and `quaternion`, the orbit `target`, whether the camera lock was already the
   user's (`locked`), and the playhead (`time`) it started at — or `undefined` when no run has captured one; it is what lets a pause hand the frame
   over and a run's end undo the whole thing (README D48).
4. **Animation.** `new Playback({ camera: mirror.camera })` — the output camera whose `fov` a track animates — then `playback.bind(new Map(...))`
   mapping every `ObjectId` to `mirror.objectOf(id)`; `Playback` names the bound objects itself.
5. **UI.** `new Panels(panelsRoot, panelContext)`, `new TimelinePanel(timelineRoot, timelineContext)`, `new Hud(hudRoot)`,
   `new ModeBar(modebarRoot, { session })` — the viewport's two-button mode switch, a view of the session like the panels — and
   `new VoxelizeDialog(panelsRoot, () => defaults())` — the settings modal is mounted into the same element as the panels and, like them, receives only
   callbacks and no state — over the actions of
   step 6, over `gridSettings`, the `WorldGrid` view the `Grid` group reads, over `timelineVisible`, the app's own timeline-bar flag, and over
   `cameraControl`, the view the `Camera` group's carrier controls read: `{ selected: cameraControlSelected, mode: gizmoMode, locked: cameraLocked,
   follow: followCamera, playing: playback.playing,
   pose, pathVisible: cameraPathVisible, pathAvailable: cameraKeyframePositions(project).length >= 2 }`, whose pose comes from
   `project.camera.transform` and `project.camera.fov` — not from the carrier node — because what the fields show is what a keyframe would record,
   and whose two path fields say whether the drawing is on and whether the track holds two keyframes for one to exist at all, while `follow` and
   `playing` are what the `Follow camera` box shows and what disables it for the length of a run (README D46, D47, D48);
   `pickImportFile` is implemented here as `void pickGlbFile().then(file => { if (file) void importFile(file); })`, so the file dialog stays in
   `app/`. That timeline flag is declared beside the other app flags and is `false`, so the bar opens collapsed; the context hands it over as
   `timelineVisible: () => timelineVisible`, and the matching action, `setTimelineVisible`, is its only writer. Right after the panel is built,
   `timelinePanel.setVisible(timelineVisible)` makes the flag and the markup agree from the first frame: `index.html` carries
   `<div id="timeline" hidden>` rather than leaving the attribute to the module, because a bar laid out by the first paint and hidden only when the
   bundle runs would flash (README D44). The app creates no status line and no message area: the panel overlay holds the rail and the windows only (D38). The dialog is
   created here because it belongs to `app/` in the same way the file dialog does: `ui` never imports `app/`, so the closure that seeds the dialog and
   the handling of its outcome live in this file.
6. **Flow wiring**, the only place the modules meet:
   - Import — `importFile(file)` is the body of `pickImportFile` and of the drop callback: `file.arrayBuffer()` → `await importGlb(data)`; failure →
     `reportFailure(result)`; success → `scaleImportedScene(result.scene, DEFAULT_VOXELS_ACROSS)` puts the model on the unit lattice as it arrives —
     one voxel is one world unit (README D41), so the count the prompt asks for is the model's length and the raw meshes and the payload are placed in
     the same unit — and the scaled scene is what is retained: `lastImport` is the `ImportedAssets` record `{ scene, objectId, meshes }`, whose
     `meshes` holds one raw mesh per imported node so a rescale can re-place them instead of building them again.
     `adoptImportedScene(project, scene)` creates the import's **one** object, and
     `attachSourceMeshes(scene, objectId, meshes)` builds one `new THREE.Mesh(node.geometry, node.sourceMesh.material)` per imported node — every node, the
     outline shells included — keeps each in that `meshes` array (and, the first time, in the app-local `sourceMeshes` array for teardown), and hands it to
     `mirror.attachSourceObject(objectId, mesh, node.matrixWorld)` — with **that node's** own baked world matrix (D25), which the mirror keeps per mesh (README D28), not with an assumed identity local
     transform, because that matrix is where the model's placement lives now that one object stands for the whole file, and because the object's own
     transform is about to be replaced by the payload's placement. A later call for the same scene reuses the mesh each node already has, so a rescale
     re-places the raw meshes instead of duplicating them. Then that id is marked dirty, `bindingsDirty` is set, `mirror.frameAll(viewportCamera)`
     fits the view to the model as it now stands on the lattice — `frameAll` syncs, so the node and its layer-2 meshes exist and are what it measures — and `commitDirty()`
     refreshes both panels. Nothing has a payload yet: the object is `'empty'` and the raw meshes
     are the whole of what the user sees; nothing announces the import's node count any more (D38). The flow ends by
     `await promptVoxelize(scene, adopted.objectId)` (D26), so the settings are asked for **after** the model is on screen and fitted. An outline
     shell is a source mesh like every other node — the whole file is displayed — but its geometry never reaches `buildVoxelizeSource`, so no
     payload carries its inverted hull; the object holds all of them at once, which is why a file of nothing but outlines still gets one object and no
     voxels at all.
   - Voxelize — the settings are asked for by `promptVoxelize(scene, objectId)`, the one prompt: it awaits
     `voxelizeDialog.open({ title: `Voxelize ${scene.name}` })` and acts on the outcome. On `{ kind: 'cancel' }` it writes
     and returns without reporting anything — the object stays `'empty'` with its source meshes
     displayed, so the user can inspect the raw model first — and on `{ kind: 'run', cellsAcross }` it re-scales the import to that
     count — `scaleImportedScene(scene, cellsAcross)`, the model's length in voxels, with the same raw meshes re-placed through
     `attachSourceMeshes(scaled, objectId, assets.meshes)` when the retained import is still the one the prompt was about, so the
     meshes stay glued to the content the job is about to voxelize (README D24, D41) — and runs the shared job on that scaled source,
     `buildVoxelizeSource(scaled)`.
     `main` derives no count of its own: the dialog's answer is the whole request (D26). One caller produces the prompt —
     `importFile` at the end of an import, with the scene it just adopted — and it binds the prompt to that scene's object, so the job always lands on
     the model the dialog was about.
   - One body, `runVoxelizeJob(source, objectId)`, is what a confirmed prompt runs: abort the in-flight job
     (`jobController?.abort()`, then cleared, so an import with nothing to voxelize still supersedes it) and return when `source` is `undefined`
     (an outline-only import), otherwise own a fresh `AbortController` and run
     `voxelize({ sources: [source], budget: DEFAULT_CELL_BUDGET, signal })` on it — one source, no target: the confirmed prompt has already scaled
     the model onto the unit lattice, so the job takes no voxel size at all (README D41). Failure → `reportFailure(result)`;
     success → `applyVoxelizeResult(project, result, { attachTo: new Map([[source.sourceId, objectId]]) })`, mark dirty, `commitDirty()`,
     then `mirror.frameAll(viewportCamera)`. The map is keyed by the source's own id, which every output carries, so
     the payload lands on the object the import created instead of beside it. Framing belongs here, after the payload: an object that was an `'empty'`
     placeholder until this call renders as voxels now, and its source meshes hide behind them unless the override is on. `frameAll` syncs before measuring, so the
     payload meshes rebuilt for the id just marked dirty are exactly what it fits. The abort is mandatory and comes first: a dialog confirmed twice, or an
     import that lands on top of a running job, must leave only the newest payloads, and a superseded `voxelize` call reports itself as
     `'cancelled'`. There is no second prompt: the dialog that follows a successful parse is the only way in, so a cancelled — or later
     regretted — voxelization is re-run by importing the file again, which adopts a fresh object beside the raw one the cancelled prompt left
     behind.
   - Edit and Scene: `createGroup` → `createGroup(project, 'Group')`; `deleteObject(id)` → `deleteObject(project, id)` from the row's trash, which
     also clears `session.activeObjectId` when that object was the active one. Deleting is per row, so the active object need not be the one deleted.
   - Ops: `setActiveMaskColor(color)` → `setObjectMaskColor(project, session.activeObjectId, color)`; `setActiveVisible(visible)` →
     `setObjectVisible(project, session.activeObjectId, visible)`; `setActiveAlignToGrid(alignToGrid)` →
     `setObjectAlignToGrid(project, session.activeObjectId, alignToGrid)`, which snaps the placement when it turns alignment on;
     `setActiveSubdivision(level)` → `setObjectSubdivision(project, session.activeObjectId, level)`, which replaces the payload
     with a block-replicated grid so the object keeps its placement and only its cells get smaller (README D43); the op throws
     `RangeError` for a level that is not a power of two, reports `'wrong-representation'` for an object with no grid,
     `'unsupported-subdivision'` for a level below the one the object holds, `'exceeds-grid'` when the refined cells would leave
     the key space, and `'budget-exceeded'` over `DEFAULT_CELL_BUDGET`, while the level the object already holds is an `ok` that
     writes no payload — a refused choice reports and leaves the project untouched;
     `renameActive(name)` → `renameObject(project, session.activeObjectId, name)`, which
     trims and refuses an empty name; `reparentActive(parentId)` →
     `reparentObject(project, session.activeObjectId, parentId)`. Every one of them returns without acting when
     nothing is active. The one action that is not a `project` call is `detachSelection()` → `pointer.detachSelection()`: the
     panel's `detach` button is a command on the region the `Select` tool already chose rather than a tool choice, so it goes
     through the pointer tool, which commits it exactly as a viewport press would and reports the two objects it wrote through
     `onProjectChange` — the app therefore marks them dirty on the edit path instead of in this wrapper (README D19, D23). The action defers the
     call to click time, which is what lets it name the `pointer` built later in the same function.
     A failed `OpResult` goes to `reportFailure(result)`; success marks dirty and refreshes
     the next `mirror.sync()` pick the change up, since the panel is re-read only through `commitDirty`.
   - Gizmo: `syncGizmo()` attaches the edit gizmo to `gizmoNodeNow()` — the carrier's node while the carrier is selected, otherwise the active
     object's mirrored node while the session is in `object` mode, and nothing in `edit` mode or with an empty selection — and detaches it
     otherwise (README D39, D46). The attach pivots at `CAMERA_CONTROL_PIVOT` for the carrier — its own origin, the camera position, because a
     camera has no content to center on — and at `mirror.contentCenterOf(objectId)`, the center of the object's own content, for an object, so the
     handles sit on what the user edits instead of at the node origin the document transform means (README D37). Both go through the same
     `gizmoMode`, which is the app's one flag for both. The drag has two halves: `onGizmoChange`, for the carrier, decomposes the reported matrix
     straight into `cameraControl.node` — the carrier *is* the node the gizmo derives from, so the drawing follows the pointer — and returns;
     for an object it feeds `mirror.previewTransform(objectId, project.alignWorldMatrix(objectId, matrix))`, so the mirrored
     node is put on the world matrix the gesture asks for with the very rule the commit stores — the preview and the document write must show and
     store the same pose, or the release would step the object back onto the grid (README D42). `onGizmoCommit`, for the carrier, calls
     `applyCameraMatrix(matrix)` and returns; for an object it writes that matrix to the document
     with `setTransformFromWorldMatrix(project, session.activeObjectId, matrix)` — the world matrix, converted to the
     object's local transform against its parent — followed by the usual mark-dirty plus `commitDirty()`. The document is
     therefore written exactly once per gesture, and the rebuild that write triggers discards the preview. `gizmoNodeNow()`
     is also what the render loop compares against the attached node, because that rebuild replaces it (see 7).
   - Camera carrier — the four `Camera` group commands over the carrier (README D46). `toggleCameraControl()` flips `cameraControlSelected` and
     re-syncs the gizmo, so selecting the carrier takes it from the active object and deselecting it gives the gizmo back from the session alone;
     `toggleGizmoMode()` flips `gizmoMode` and re-syncs, for whichever node the gizmo is on. `cameraToView()` is `Camera -> View`: it copies the
     viewport camera's position and quaternion into `project.camera.transform` and onto `mirror.camera`, selects the carrier, and re-syncs —
     aiming the carrier is what the user came for, so the select is part of the command. `viewToCamera()` is `View -> Camera`: it calls
     `controls.setViewFrom(project.camera.transform.position, project.camera.transform.quaternion)` and writes nothing at all, which is what
     makes it a safe way to look at what a render would frame. The first three end with `panels.refresh()`, because each changes what the `Camera`
     group shows; `viewToCamera` refreshes nothing, because it changes nothing the group displays.
   - Camera path — `refreshCameraPath()` is the one writer of the drawing and of `cameraPathVisible` (README D47): it clears the flag when the
     keyframe list holds fewer than two points, hands `sampleCameraTrajectory(project)` and `cameraKeyframePositions(project)` to
     `cameraPath.setTrajectory`/`setMarkers`, writes `setVisible(cameraPathVisible && !cameraLocked)` — the path is hidden with the carrier while the
     viewport already is the output camera — and refreshes the panel, which is what keeps the `Show camera path` box a view of both flags. It is
     called from the timeline's `onEdited` (a keyframe edit is what changes the trajectory), from `setCameraLock`, from its own toggle, and once at
     boot, and `setCameraPathVisible(visible)` only writes the flag and calls it. The path is a view of the authored camera track: nothing on this
     path writes a keyframe, a pose, or a transform, and the drawing owns no document data.
   - Authored-camera writes — the two write helpers end in the same two places: the document's `project.camera.transform` and the mirror's output
     camera, because `SceneMirror.sync` never touches that camera and the locked view and the export both render through it (README D17, D46).
     `applyCameraMatrix(matrix)` is what a carrier drag commits: it decomposes the world matrix into `project.camera.transform`, normalizes the
     quaternion, and copies position and quaternion onto `mirror.camera`. `setCameraPose(pose)` is the numeric grid's write: a component that is not
     finite returns before the document is touched, and a zero-length quaternion is refused rather than normalized into a rotation — that check reads the
     submitted numbers, so it too stops before writing anything, and a refused field therefore leaves the camera exactly as it was.
     A pose that passes both checks normalizes the quaternion, writes the position, routes the FOV through `setCameraFov` — which owns the clamp and
     the projection refresh — and copies the pose onto the mirror camera. Both call `panels.refresh()`, so the fields a refused write re-seeds are
     what the camera then holds.
   - Raw meshes: `setSourceVisible(enabled)` is the panel's one entry point for the override (D24). It writes `mirror.setSourceVisible(enabled)` and
     nothing else: the mirror owns the flag, applies it to its layer-2 meshes at once and again on the next `sync()`, and the panel reads it back through
     `sceneVisible: () => mirror.sourceVisible` — which is also why `main` implements `PanelContext.sceneVisible`, so the checkbox cannot drift from the
     mirror. No mark-dirty and no refresh are needed, and an export is unaffected either way because it renders layer 0 alone.
   - Grid display — the `Grid` group's three controls are the viewport's own settings, so the actions and `gridSettings` go through the
     `worldGrid` instance rather than through `app`: `Panels` refreshes inside its own constructor, and that first refresh runs before `app` is
     built, so a context built out of `app` would read a variable that is not there yet, while the instance has existed since step 2.
     `gridSettings: () => ({ mode: worldGrid.gridMode, axis: worldGrid.multiAxis, offset: worldGrid.multiOffset })` is the view the panel seeds
     its three fields from. `setGridMode(mode)` hands the display to `worldGrid.setMode` and then calls `panels.refresh()`, which re-seeds the
     `Display` select from that same view — the re-seed is what makes the field a view of the app's state rather than a forward-only control,
     because a value the grid did not take would come back as the field showing what the grid holds — and it is also the refresh that re-derives
     the disabled rule for the axis and the offset. `setGridAxis(axis)` calls `worldGrid.setMultiPlane(axis, worldGrid.multiOffset)` and
     `setGridOffset(offset)` calls `worldGrid.setMultiPlane(worldGrid.multiAxis, offset)`, so each action writes one component and keeps the
     other, and the two together are the whole of the moved plane's control. The offset action is the one that can arrive with
     nothing usable: the field is a number input with `step 1`, so it accepts a fraction such as `0.5`, and `Number.isInteger`
     refuses it — the action calls `panels.refresh()` and returns, so a non-integer never reaches the grid, which would refuse it
     with a `RangeError` (README D49). Nothing here
     re-aims a lattice any more: the per-object lattice and `refreshObjectGrid` left with D43's second layer, and its `objectGridKey` went with
     them, so a commit and a session change now touch no grid at all.
   - Defaults: `defaults()` seeds the dialog from the retained import's `voxelizeBounds`: `extent` is that box's size per
     axis, which the dialog reads its count against to print the model's dimensions (README D29, D41). With no import, or when
     the box it would measure is empty, every axis falls back to `DEFAULT_EXTENT` — the count the prompt already opens at,
     because one voxel is one world unit (README D41) — so the dialog is usable with no scene. The extent is handed over
     unrounded: only the readout the dialog prints rounds. The dialog reads it once per `open()` through the `() => defaults()` closure. Those are the bounds of the nodes that are voxelized, not of every
     displayed node: a stylized export's outline shells are drawn around the model and a little larger, so seeding the extent
     from them would stretch the printed dimensions for content they do not cover (README D27). A scene of
     nothing but outlines has no outline-free bounds, so it falls back to `scene.bounds`, which is what framing uses either way
     because every node is displayed.
   - Animate: `onEdited` → `playback.rebuild(project)` (the app's `refreshCameraPath` rides the same callback, README D47); `onTransport: togglePlayback`, so the widget's toggle reports the press and the app is what starts or pauses the run (README D48); `onScrub(timeMs)` → `playback.pause()` then `playback.setTime(timeMs / 1000)`, the one place the widget's milliseconds become the clip's seconds — the scrub bar, the exact-time field, and a keyframe row's `key` all seek through it (README D45).
   - Follow camera — the transport itself is the app's, not the widget's, because a run of the clip changes the viewport too (README D48). `startPlayback()` is the play press: it returns while a run is already going, captures `playbackView` from `viewportCamera.position`/`quaternion`, `controls.orbit.target`, `cameraLocked`, and `playback.time` (cloned, so nothing later writes through it), engages the lock with `setCameraLock(true)` when follow is on and the viewport is not already locked, calls `playback.play()`, and refreshes the panel. `pausePlayback(handOver)` is the pause: it returns while nothing runs, works out `handedOver = handOver && followCamera && playbackView?.locked === false` — only a lock the follow itself engaged is given back, so a lock the user asked for stays — pauses, and when handing over releases the lock first and then calls `controls.setViewFrom(mirror.camera.position, mirror.camera.quaternion)`, so the editor camera takes the pose the clip stopped at. That order is what keeps the handoff out of authored data: while the lock is on the orbit belongs to the output camera, so the move would otherwise be written into `project.camera.transform` (D17). `finishPlayback()` is the end of a non-looping run: it clears `playbackView`, pauses, and, when there was a run, sets the playhead back with `playback.setTime(restore.time)` — which is also what restores the view when the output camera is the one drawing, since its pose comes from the clip — then either `setCameraLock(true)` (the user's lock) or `setCameraLock(false)` plus `controls.setViewFrom(restore.position, restore.quaternion, restore.target)`. `togglePlayback()` is the only transport entry point: `pausePlayback(true)` while running, `startPlayback()` otherwise. `setFollowCamera(enabled)` writes the flag and refreshes the panel, because the option applies to the next run rather than to a run in flight.
   - Camera lock — `setCameraLock(enabled)`, the one entry point the panel has for it, and the one the transport's follow borrows (README D48): it sets `cameraLocked`, hands navigation over with
     and `controls.setOrbitTarget(enabled ? mirror.camera : viewportCamera)`.
     The flag is set before retargeting, so the retarget's own `change` event cannot author anything on the way out of the lock.
     `controls.onOrbitChange(...)` then copies the output camera's `position` and `quaternion` into `project.camera.transform` while
     `cameraLocked && !playback.playing`, which is what makes a timeline `add` on the camera record the pose the user actually aimed. The
     `playing` guard is mandatory: a running clip owns the mirror's camera, and writing its samples back would drift the authored pose frame by
     frame. `controls.dispose()` drops the registration, so no separate teardown call exists. The lock also calls `refreshCameraPath()`, because the
     carrier's controls and the path are gated on it — the path is hidden with the carrier while the viewport already is the output camera — and that
     call refreshes the panel: while the lock is on the viewport already *is* the output camera, so there is nothing left for the carrier
     to aim and the panel disables its controls (README D46, D47).
   - FOV — `setCameraFov(fov)`, the panel's one entry point for the output camera's projection: it ignores non-finite input, clamps to `[1, 179]`,
     writes `project.camera.fov`, and copies the clamped value onto `mirror.camera` with `updateProjectionMatrix()`, because assigning `fov` alone
     leaves the projection stale. The locked viewport and the next export therefore both show the authored value, and a camera `fov` keyframe records
     it instead of the value the mirror camera was constructed with.
   - Export: `exportMp4(options)` sizes the capture to the requested resolution with `capture.resize(options.width, options.height)` and points the
     capture at that aspect, then runs `new ExportJob({ mirror }).run({ project, scene: mirror.scene, capture, playback, output: { width:
     options.width, height: options.height, fps: options.fps, from: options.from, to: options.to, mode: options.mode } }, onProgress, signal)` →
     `saveMp4(blob, 'vox-world.mp4')`; failure → `reportFailure(result)`.
     only the capture that must render at them.
   - Drop: `wireDropTarget(viewport, file => { void importFile(file); })`.
   - Timeline bar — `setTimelineVisible(visible)`, the rail's `Animation` toggle, is a view-only write: it sets `timelineVisible` and calls
     `timelinePanel.setVisible(visible)`, so the app's flag stays the only state and the panel is told what to show rather than asked; the bar keeps
     its contents while hidden, because the render loop goes on writing the playhead into it. Beside the window-resize wiring — the `resize`
     listener whose body is `handleResize() → resizeViewport(renderer, viewport, viewportCamera)` — `barObserver` is a `ResizeObserver` on
     `timelineRoot` that calls the same `handleResize`: anything that moves the boundary between the canvas and the bar — the bar's visibility, a
     keyframe row, its message line — changes how much of the column the canvas has, and three's `setSize(w, h, false)` never touches the canvas'
     style, so without that refit the drawing buffer and the box would disagree and the view would be stretched (README D44).
7. **Render loop**, one `requestAnimationFrame` callback: `dt = Math.min((now - last) / 1000, 0.1)`; `playback.advance(dt)` for preview (a paused
   action does not advance, so the transport flag never has to be mirrored here); then the end check — `if (playback.playing && !playback.loop && playback.duration > 0 && playback.time >= playback.duration - 1e-6) finishPlayback()` — because a non-looping run is over at the last frame, and that is where the transport stops and the view goes back (README D48); `mirror.sync()` for dirty objects, then
   `syncGizmo()` whenever `gizmoNodeNow()` is no longer the node the gizmo is attached to — a rebuild replaced that node,
   and this is what puts the handles back on the object; `controls.update()` and
   then `const renderCamera = cameraLocked ? mirror.camera : viewportCamera` and
   `renderer.render(mirror.scene, renderCamera)` — drawing through the output camera is what makes the lock visible. While the lock is on the
   loop also holds that camera's aspect equal to the canvas': an export sets the aspect for its own frames, and a resize would otherwise leave
   the locked view stretched. The output camera stays on layer 0, so the locked view shows exactly what an export shows — no overlay, no gizmo,
   no viewport decoration. Just before the render the loop also drives the carrier (README D46): it reports the output camera as it stands right
   now — the authored pose, or the sampled one while a clip runs — through `setSelected(cameraControlSelected)` — which follows only the user's
   selection — and `setVisible((cameraControlSelected || observing) && !cameraLocked)`, where `const observing = playback.playing && !followCamera`: the
   carrier is drawn while it is selected, and — with the follow option off — for the length of a run as well, so a run that leaves the editor camera
   alone still shows the camera moving along the clip. That display selects nothing and is dropped when the run ends, and a camera cannot see itself,
   so the follow case hides the carrier exactly as the locked case does (README D46, D48), and `setPose(mirror.camera.position, mirror.camera.quaternion, mirror.camera.fov, canvasAspect(viewport))` — except while the carrier
   is selected and `controls.gizmoBusy()`, because a drag owns the pose until it commits and the per-frame update stands back for it. It then sets
   `const viewingDistance = max(renderCamera.position.distanceTo(cameraControl.node.position), controls.orbit.object.position.distanceTo(controls.orbit.target))`,
   which then goes to both drawings — `cameraControl.setScreenScale(viewingDistance)` and `cameraPath.setScreenScale(viewingDistance)` — and is
   followed by `cameraPath.faceCamera(renderCamera.quaternion)`, which turns the path's rings to the drawing camera (README D47):
   the size comes from how far the drawing camera is, floored at the distance navigation orbits from, because a viewport that sits *on* the carrier —
   which is exactly what `View -> Camera` produces — would otherwise scale the drawing and the gizmo down to a dot, and the orbit radius is the
   scene's own scale. The grid follows the same camera, one statement before that distance goes to the two drawings:
   `worldGrid.update(renderCamera)` puts the shown display's planes on the camera the frame is about to be drawn through — so a locked output
   camera gets the same reference as the editor camera, and the planes read nothing of it but its position — and it is decoration, so nothing
   about it reaches the render or the framing (README D49). That floor is the drawing's floor alone: `TransformControls` sizes its own handles by the distance to the drawing camera, so
   with the viewport on the carrier the handles still degenerate, and the flow that follows is to orbit away — a middle-drag moves the viewport off
   the carrier while the carrier stays where it was — after which the handles are grabbable again. Sizing them the way the object gizmo already does
   was chosen over special-casing the carrier. Finally `timelinePanel.setTime(playback.time * 1000)` — the clip's seconds into the widget's milliseconds, the mirror image of `onScrub`'s division (README D45) — and a fresh `HudState` into the HUD.
8. The loop never reads or writes voxel data: no `UniformGrid` method is called and nothing is rasterized. An object is dirty only
   because an edit or an import changed its data, so `sync()` cannot overwrite a transform the mixer wrote for playback.
9. `HudState` is assembled here from `project.get(session.activeObjectId)`, `session.resolutionOf(id)` (the `EditResolution`, which
   now carries the object's `subdivision` beside its `cells`), `session.selection`, `Math.round(playback.time *
   project.timeline.fps)`, and `project.timeline.fps`.
10. **Ownership.** `main` constructs and disposes every long-lived object and passes each dependency in; no module below it builds another module's
    dependencies (`Panels` never creates a `Project`, `PointerTool` receives its `Picker` and `Overlay`). The imported raw meshes are the same kind of
    app-owned object: they live in a `main`-local array, and teardown detaches them from the scene graph the mirror just released without disposing the
    geometry or materials they share with the imported scene. Disposal cancels the frame and the in-flight job, detaches the drop target, calls
    `voxelizeDialog.dispose()` — which settles a prompt still on screen as a cancel, so no `promptVoxelize` call is left waiting — disconnects the
    bar's resize observer, and disposes
    everything in `AppContext` plus the renderer, controls, capture, overlay, and the world grid; `app.cameraControl.dispose()` releases the carrier's
    geometries, materials, and node and `app.cameraPath.dispose()` the path's two geometries, two materials, and root (README D47), so no decoration is
    left in the scene the mirror releases; the orbit-change registration lives in the controls, so disposing them
    unregisters it.

## Invariants
- `main()` creates the renderer, the mirror, and every listed object once, and schedules exactly one render loop.
- Project mutations get `mirror.markDirty` plus `panels.refresh()`, every session change refreshes the mode bar, the panels, and the timeline, and
  timeline edits go through `onEdited` → `playback.rebuild`; one job at a time. A commit re-aims nothing: the grid follows the camera in the loop
  rather than the document, so the per-object lattice's refresh and its `objectGridKey` are gone (README D49).
- Every path that can make geometry measurable re-fits the **viewport** camera: the import path fits right after `commitDirty()`, on the raw meshes the
  user is about to answer the dialog about, and a confirmed prompt fits again through `runVoxelizeJob`, whose success path fits after
  `applyVoxelizeResult` and `commitDirty()`, because a payload can only be measured once it is attached. No other path moves the camera, and the output
  camera is never framed.
- Importing and voxelizing are two steps, and the second one is the user's (README D26): a successful import ends with the model adopted, displayed as
  raw meshes, fitted, and listed, and with the settings dialog open — never with a job. Only `{ kind: 'run', cellsAcross }` starts one, through the one job body
  `runVoxelizeJob`, so a cancelled dialog is a state the app supports rather than a failure: the object stays `'empty'` with its source meshes
  displayed, and nothing reports the cancel. A cancelled import is re-run by importing the file again
  only prompt, so a retained import is never re-asked about. There is no per-object or per-scope voxelize path, and a single prompt is on screen at a
  time because the dialog owns it. One import is one object, one
  payload, and one row in the object list; an outline shell contributes no cells but is still displayed as one of that object's source meshes
  (README D27), and an import of nothing but outlines has no source at all: the object stays `'empty'` and the job returns after the abort, which is the
  one confirmation that ends without a payload.
- The two bounds an import reports are used for exactly one thing each: `voxelizeBounds` gives `defaults()` its per-axis extent (and with it the
  whole dialog through the `() => defaults()` closure), `bounds` is what framing fits, and neither is ever mixed up. A shell that sticks out past the
  model therefore cannot stretch the dimensions the dialog prints while framing still fits what the user can see.
- One voxelization job runs at a time: `jobController` is aborted before a new job takes ownership, so a superseded confirmation can never attach its
  payloads after the newer one. A job that was aborted reports `'cancelled'`; a job that fails leaves the project untouched (D12) — `applyVoxelizeResult` is
  only reached on `ok: true`.
- The dialog is the only place the voxelization settings exist, and the dialog after an import is the only way in: `main` holds no target, voxel
  size, or count of its own, never reads one back out of the dialog's fields, and acts on the outcome verbatim — a confirm scales the import by
  `cellsAcross`, the model's length in voxels, which it neither rounds nor re-derives (README D41). The panel cannot open the prompt again, so
  `main` exposes no retained-import query to it.
- One voxel is one world unit (README D41), so an import is put on the lattice instead of being given a voxel size: as it arrives it is scaled to
  `DEFAULT_VOXELS_ACROSS` — which is what makes the count the prompt asks for the model's length in voxels — and a confirm scales the same scene
  again, to the count the user answered with. Both go through `scaleImportedScene`, whose factor is absolute against the file's `authoredExtent`, so
  the second call replaces the first rather than compounding, and the fitted view, the raw meshes, and the payload are all in that one unit.
- The render loop never reads or writes voxel data, and playback writes only mirror `Object3D` transforms and the camera `fov`.
- Authored camera pose (`project.camera.transform`) is written by exactly four paths and no others: the orbit-change callback, only while the lock is
  on and `playback.playing` is false; `applyCameraMatrix`, on a carrier drag's commit; `setCameraPose`, the numeric grid's whole-pose write; and
  `cameraToView`. `project.camera.fov` is written only by `setCameraFov`, which `setCameraPose` routes its FOV through. Nothing else reads a mirror
  transform back into the document while the mixer is running.
- A run of the clip is the app's transport and it is reversible: `togglePlayback` is the only entry point, `startPlayback` captures `playbackView` before
  anything moves, and the frame loop ends a non-looping run at its last frame through `finishPlayback` — so every run either pauses on the frame it
  stopped at or ends with the playhead and the view back at the values it started from (README D48).
- A playback end writes no authored data: the pause handoff runs with the lock already released and the restore of an end goes through
  `controls.setViewFrom`, which touches no document, while the orbit-change copy into `project.camera.transform` stays guarded by
  `cameraLocked && !playback.playing`, so neither a running clip nor a handoff can drift the authored camera pose (README D17, D48).
- Only a lock the follow engaged is released: `pausePlayback` hands the view over only when `playbackView.locked` was false and the follow option is on,
  and `finishPlayback` puts the lock back exactly as it was, so a lock the user asked for is never dropped by the transport — and a run that starts
  while the lock is already on restores only the playhead, since the output camera's own pose is what draws the view then (README D48).
- `followCamera` is read when a run starts and never in flight: `startPlayback` decides the lock from it and the frame loop's `observing` derives from
  it, so the panel disables its box while `playback.playing` rather than changing a run, and the option applies to the next run (README D48).
- `viewportCamera` (app-owned) drives rendering, navigation, picking, and fitting while the lock is off; with the lock on, navigation, rendering,
  and picking move to `mirror.camera` (output) — the stated exception to D17 — and the viewport camera is left exactly where it was until the lock
  is released. Picking follows the render camera through `getCamera()` and fitting always uses the viewport camera, and the output camera never gains
  layer 1 or layer 2, so neither a decoration nor a raw mesh can reach an export or a locked view.
- Every imported node gets exactly one raw mesh on layer 2, attached by `attachSourceMeshes` right after `adoptImportedScene` to the import's single object
  and handed that node's own baked `node.matrixWorld` (D25); the meshes share the imported geometry and materials, the app keeps
  them in `lastImport.meshes` (and so in `sourceMeshes` for teardown), the mirror never disposes them, and teardown detaches them.
  A rescale moves the matrices, not the meshes: `attachSourceMeshes` reuses the mesh a node already has, so one node stays one mesh however often the
  import is scaled to the confirmed count (README D41). The matrix is what keeps every raw mesh on its imported pose — before
  the payload the object is at the identity, after it at the payload's translation, and `applySources` re-derives each mesh's local matrix from it: the app
  never re-parents a mesh, never computes a placement, and never writes a mesh matrix itself. Whether they are shown is the mirror's flag and the panel's
  checkbox (`setSourceVisible` + `sceneVisible`) — `main` keeps no copy of it and never toggles `visible` on a mesh itself.
- The `Grid` group's settings live on the viewport's grid and never in the document: `panelContext.gridSettings` reads `WorldGrid`'s `gridMode`,
  `multiAxis`, and `multiOffset`, and the three grid actions write that one instance, so the panel and the grid it displays cannot disagree; no grid
  flag ever reaches `project`, a timeline track, or an export.
- The grid is put on the camera the frame is drawn through, and only the shown display is put there: the loop calls
  `worldGrid.update(renderCamera)` once a frame, after `renderCamera` is chosen and before the render, so a locked output camera gets the same
  reference as the editor camera while the two fixed displays and the hidden planes cost nothing (README D49). It is decoration on layer 1, which
  `frameAll` does not measure — it reads layers 0 and 2 — so a 512-unit plane can never widen an import's framing, and the export camera's layer 0
  never sees it.
- The timeline bar's visibility is the app's `timelineVisible` flag alone, and the bar is never shown or hidden without the canvas following:
  `index.html` carries the `hidden` attribute so the first paint is already collapsed, `setVisible` is the panel's only view of the flag and the
  rail's `Animation` button its only writer through `setTimelineVisible`, and the observer on `timelineRoot` refits the drawing buffer to the
  canvas' box whenever the boundary between the two moves (README D44). The bar's own contents are untouched by hiding it: the loop keeps writing
  the playhead through `setTime`.
- The authoring clock is whole milliseconds and the clip is seconds, and this file owns both conversions between them: `onScrub` divides the
  widget's milliseconds by 1000 on the way to `playback.setTime`, and the render loop multiplies `playback.time` by 1000 on the way into
  `setTime`. Every other time the app touches is already on its own side of that boundary — the export range and the HUD's frame count are the
  clip's seconds, and `project.timeline.durationMs` and every keyframe are the document's milliseconds (README D45).
- The gizmo is attached to exactly one node at a time: the carrier's node while `cameraControlSelected` is set — whatever the session mode, so a selected
  carrier keeps the handles even in `edit` mode — and otherwise the active object's
  mirrored node while the session is in `object` mode, so the carrier and an object can never both carry handles (README D39, D46). It pivots at the
  carrier's own origin, the camera position, for the carrier, and at that object's content center for an object (README D37). A gesture moves the
  object through `previewTransform`, which writes no document, and produces exactly one document write on release, from the matrix the gizmo reports
  and not from the node it was attached to; that write rebuilds the object, so the loop's identity comparison is what re-attaches the gizmo, and no
  gesture can leave the handles on a released node. The live transform and the committed one come from the same matrix, which is why the release
  moves nothing on screen.
- The carrier is a runtime-only handle on the output camera and never document data: its node is unnamed and on layer 1 with the rest of the
  decoration, so the raycaster cannot pick it, no export frame contains it, and the mixer's binding walk cannot reach it (README D22, D24, D46). It is
  never serialized, never a keyframe target, and never a second camera: it draws `mirror.camera`'s pose and writes back into `project.camera`. The
  pose lives on the node and the screen-size scale on its helper, never both on one, because the gizmo derives its drag from the node's own matrix. A
  drag owns the pose while `controls.gizmoBusy()`, so the per-frame `setPose` stands back for it and the commit is the single write the gesture makes,
  and the carrier is drawn only while it is selected and the lock is off. Its size is floored at the orbit radius, so a viewport sitting on the carrier
  cannot scale the drawing down to a dot, while the gizmo's own handles, which `TransformControls` sizes by the distance to the drawing camera, still
  degenerate there: the remedy is to orbit away, which moves the viewport off the carrier and leaves the carrier where it was.
- The camera path is a runtime-only view of the authored camera track and writes nothing: `refreshCameraPath` is its only writer, the drawing holds
  no document data, and `cameraPathVisible` is the app's flag with the panel's `Show camera path` box as its view. Fewer than two camera position
  keyframes is not a path, so the flag is cleared then and the box is disabled and unchecked; while the lock is on, the path is hidden with the
  carrier, because the viewport already is the output camera and the drawing would sit on it. The drawing is on layer 1 and unnamed, so it is never
  picked, never in an export frame, and never bound by the mixer (README D22, D24, D47).
- The pointer tool receives both live lookups it needs as closures — `getCamera()` for the render camera, `getGizmoBusy()` → `controls.gizmoBusy()` for
  the gizmo's claim — so neither is cached across frames. A left press therefore reaches `Picker.pick` whenever the gizmo is not dragging and no handle
  is hovered, which is what keeps cell selection reachable while the gizmo is attached to the active object.

## Errors
`importGlb`, `voxelize`, `applyVoxelizeResult`, and `ExportJob.run` failures reach `reportFailure`, which writes the `Result`'s `error` literal and
`detail` to the console — the panel has had no message area since D38 — and a failed import or voxelization leaves the project untouched (D12);
inner-ring programmer errors propagate. A cancelled settings dialog is not an error: `promptVoxelize` returns without a message, leaving the retained
import `'empty'` and displayed. There is deliberately no re-run path: the panel has no voxelize control and `main`
implements no `openVoxelizeDialog`, so a cancelled or regretted voxelization is redone by importing the file again — or by deleting the raw object and
dropping the file anew — and never by re-opening the prompt. That is the requested behaviour, not an oversight. A retained import whose every node is an outline has no source, which
`runVoxelizeJob`
treats the same way: it aborts the superseded job and returns. An aborted job's own `'cancelled'` result is reported like any
other failure, because `jobController` is the only thing that knows the job was superseded. The
camera lock has no failure path and reports nothing: it is reversible UI state, and its only write is a pose copy. The carrier's writes refuse rather
than report: `setCameraPose` returns before writing anything when any component is non-finite or the quaternion is zero-length, so a refused field never
becomes a partial pose on the document or the mirror camera; the `panels.refresh()` that follows — or the next frame —
re-seeds the fields from what the document then holds. `applyCameraMatrix` takes the matrix the gizmo derived from a real node transform, so it has
nothing to refuse (README D46).

## Dependencies
- `../document/project.js`, `../editor/{session,ops,pointer}.js` — `Project`, `EditorSession`, `EditResolution`, `applyVoxelizeResult`,
  `createGroup`, `deleteObject`, `renameObject`, `setObjectMaskColor`, `setObjectVisible`, `setObjectAlignToGrid`,
  `setObjectSubdivision`, `reparentObject`, `PointerTool`.
- `../voxels/voxelize/voxelize.js` — `voxelize`, `DEFAULT_CELL_BUDGET`, `VoxelizeSource`; `../three-runtime/import.js` — `importGlb`,
  `adoptImportedScene`, `scaleImportedScene`, `buildVoxelizeSource`, and `ImportedScene` for the retained import's type. There is no
  `VoxelizeTarget` to import any more: the confirmed count is baked into the scaled scene (README D41).
- `../voxels/uniform/grid.js` — `UniformGrid` for the demo cube's unit cells (README D41), and `HexColor`, `IntBox3` for the mask-color action
  and the selection text.
- `../three-runtime/{scene,picking,controls,capture,overlay,grid}.js` — `SceneMirror`, `Picker`, `ViewportControls`, `Capture`,
  `Overlay`, `WorldGrid`, and the `GridMode` type, plus `../three-runtime/gridPlane.js` for the `GridAxis` type — the two are imported as **types**
  alone, because they are what the panel context's `gridSettings` view and its three grid actions are typed with (README D49); and
  `../three-runtime/cameraControl.js` — `CameraControl`, the runtime-only carrier the gizmo aims the output camera with
  (README D46); `../three-runtime/cameraPath.js` — `CameraPath`, the runtime-only drawing of the authored camera's trajectory, and
  `../animation/trajectory.js` — `sampleCameraTrajectory` and `cameraKeyframePositions`, the points it is handed (README D47); `../animation/playback.js` and `../export/job.js` — `Playback`, `ExportJob`.
- `../ui/{panels,timeline,hud,dom}.js` — `Panels`, `TimelinePanel`, `Hud`, `el`, and the `CameraPose` type its `setCameraPose` action takes;
  `../ui/voxelizeDialog.js` — `VoxelizeDialog`,
  `DEFAULT_VOXELS_ACROSS` (the count an arriving import is scaled to) and its `VoxelizeDialogDefaults` seed type; `./files.js` — `pickGlbFile`, `wireDropTarget`, `saveMp4`;
  `three` — `WebGLRenderer`, `PerspectiveCamera`, and the `Matrix4` type `applyCameraMatrix` takes. Nothing may import this file: the dependency direction stops here.

## Tests
None of its own: it is the smoke target of the slice, verified by `npm run dev` plus a walk through Scenario A and Scenario B (README section 9).
Importing is now the first assertion of every walk (README D26): dropping a GLB must first show the model itself — `imported <scene name> (N
with the one imported object listed as `empty`, its node meshes attached and visible, and the camera fitted to the raw meshes, all of them scaled onto
the unit lattice so the model's longest axis is `DEFAULT_VOXELS_ACROSS` cells (README D41) — and then open the
settings dialog, seeded from that model, with no voxelize setting anywhere in the panel; `Voxelize` must run the job at what the dialog shows, replacing
the raw meshes with voxels, while `Cancel` and Escape must leave the object `'empty'` with its raw meshes displayed. None of it is announced in text
(D38): the object list, the HUD, and the viewport are the evidence. The panel must offer no voxelize control at all: the prompt that follows a successful parse is the only way
in, so a second look at the settings — a different voxel count — means importing the
file again, and `lastImport` retains the cancelled model only for the dialog's extent and for teardown. The
dialog's seeds must come from the outline-free bounds: importing `public/forest.glb` (79 nodes, 22 of them `*_Line _0` shells
holding 6410 of its 17628 triangles) opens the prompt at the constant `Voxels across` = 96, and the readout under the field must print that model's
dimensions in voxels — 96 along its longest axis — instead of a length; confirming it reports `voxelized 28893 cell(s) from 11218 triangle(s)` —
exactly the 57 non-outline nodes, in one payload — beside the boot demo cube; the 22 shells are drawn as that object's raw
meshes and their cells are nowhere in the payload. That confirmation is also the rescale walk: the model must be scaled again to the count the field
holds — the same raw meshes re-placed on it, not a second copy — before the job runs (README D41).
The same file is the measurement of the one-payload rule: the same 11218 triangles used to voxelize into 57 payloads holding 32854 cells, and the 3961 cells
of the difference are the ones two or more meshes claimed (the stones inside the soil box, the barbecue and the fire inside each other) — two objects whose
boxes overlapped drew exactly coincident cubes in different colours, and the first part now keeps such a cell. The repo's demo GLBs have
identity node transforms, so the placement half (D25) needs real content: a Sketchfab export whose root chain and mesh nodes carry a rotation and
non-uniform scales must land with the object translation-only and every raw mesh exactly where the import put it — through the object's identity transform
before the payload and the payload's `-origin` offset after it — with every voxel grid axis-aligned in world space, and `Show raw meshes` must bring the raw
meshes back exactly on top of their voxels — before the fix those meshes landed rotated, sheared, and mis-scaled relative to them.
Scenario A exercises the camera lock end to end: import a GLB — one object, the whole file — confirm the dialog, tick `Camera lock (output)`, steer the output camera
with middle/right drag, and `add` camera keyframes at two playhead times — the two keyframes must differ, the export must move the camera along them,
and pressing play must leave the authored pose untouched while the clip runs. The two object properties the panel exposes go through their ops on the
same walk: renaming the active object must change the object list and the HUD, unticking `Visible` must hide its node in the viewport, and a blank
name must come back as a reported failure with the object unchanged. The raw-mesh half of the walk: a click must select the imported object with no
selection or overlay, hovering must change nothing at all
`Show raw meshes` must bring them back over them and take them away again, and an export taken while they are shown must contain voxels only — the
output camera and `Capture` never test layer 2.

The carrier is walked on the same run (README D46): with the lock off, `Select` in the `Camera` group must show the carrier on the output camera and
put the gizmo on it, and a drag on the gizmo must aim the output camera — the numeric fields must land on the committed pose and an export must frame
it — while the live drag writes the document only on release. Typing any of the seven fields must move the shot and re-seed the others, a cleared or
non-numeric field must come back as what the camera holds rather than a partial pose, `Camera -> View` must author the pose the viewport shows,
`View -> Camera` must move the viewport to the authored shot and change no field, and `Deselect` must hand the gizmo back to the active object.
Two facts to check explicitly: the carrier is drawing the output camera rather than a second one — it moves with the authored pose, tracks the
sampled pose while a clip runs, and appears in no exported frame and in no pick — and the size floor is what `View -> Camera` needs: after the jump
the carrier is still visible while the gizmo's handles have degenerated to a dot on it, and a middle-drag away restores grabbable handles without the
carrier moving.

The path is walked on the same run (README D47): with two camera keyframes in the track, ticking `Show camera path` in the `Camera` group must draw the
white polyline through the sampled trajectory with one hollow ring per keyframe, following the camera as it is aimed and resizing as the viewport
orbits, and unticking it must take the drawing away; with fewer than two camera keyframes the box must be disabled and unchecked and nothing must be
drawn, and deleting a keyframe from a two-keyframe track must clear both again. Ticking `Camera lock (output)` must hide the path with the carrier,
since the viewport then *is* the output camera, and an exported frame must contain no part of the drawing — it is on layer 1 and unreachable by a pick.

The follow flow is walked on the same run (README D48): with follow on — its default — pressing play must engage the lock, take the viewport with the
clip, and disable the `Follow camera` box for the length of the run; pausing must stop the transport (the toggle reads `play`), release the lock, and
leave the editor camera on the frame the clip stopped at, and letting a non-looping run reach its end must stop the transport, return the playhead to
the run's start value, and put the view back where the run started from — with follow's own captured target, so the return is exact rather than
re-aimed. With follow off, a run must leave the editor camera exactly where it was — the only change is the transport's own overlay — while the
carrier is drawn for the length of the run so the camera can be seen moving along the clip, and the box must be enabled again once the run ends. Two
orders are worth checking explicitly: the pause's handoff must leave `project.camera.transform` untouched, and a run that starts while the lock is
already on must restore only the playhead.

## Open questions
- Brief section 4 has animation "mark mirrored objects dirty"; rebuilding from project truth while the mixer's transforms are animated would clobber
  them, so dirty marking stays on the edit and import paths.
- The `FOV (deg)` field authors `mirror.camera.fov` directly, so a `fov` track that is running overwrites the typed value on the next mixer
  sample while the document keeps it — the same ownership split the pose copy guards with `playback.playing`, but the projection has no such guard.
