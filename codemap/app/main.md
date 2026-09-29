# src/app/main.ts

Ring: 4 · Layer: app · Depends on: every module of rings 0-4 (see Dependencies)

## Responsibility
The composition root: the only file allowed to import every module. It creates the project and every long-lived object, wires the import → voxelize
→ edit → animate → export flow, and runs the render loop; it owns no algorithm, only calls into inner rings. It also owns the one `VoxelizeDialog`:
the voxelization settings live there, and this file is what asks for them — once per import, after the model is on screen. `main`
never holds the settings; it seeds the dialog from the retained import's per-axis extent and acts on the count it resolves —
scaling the imported model onto the unit lattice first, so that count is the model's length in voxels.

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
1. **Entry and project.** `index.html` pins the elements `main` resolves — `<canvas id="viewport">`, and the `#modebar`, `#panels`, `#timeline`, and `#hud`
   divs. The long-lived objects live in one `AppContext`; everything else stays `main`-local. The project opens with one demo voxel object — a
   `DEMO_CELLS`³ cube of unit cells, placed off the origin — so the viewport is not empty before the first import, and a clip of `DEFAULT_DURATION_MS`
   (10 000, the authoring unit, i.e. ten seconds once the clip is compiled) at `DEFAULT_FPS`. A cell coordinate is a world coordinate, so the demo content
   occupies the cells it names.
2. **Viewport.** `viewportCamera` is app-owned viewport state with camera layers 1 and 2 enabled: the viewport draws the overlay, the gizmo, and the other
   decorations (layer 1) and the imported raw meshes (layer 2), while the raycaster tests layers 0 and 2 and the export camera — and the `Capture` that
   renders through it — tests layer 0 alone. `mirror.camera` is the output camera; the `Capture` opens at the initial export size and every export resizes
   it to the resolution the panel asked for. Everything else in this step is viewport-only decoration: on layer 1, holding no document data, never picked,
   never in an export frame, and never bound by the mixer. That is the `Overlay`, the `WorldGrid` (its `root` added to `mirror.scene`), the `CameraControl`
   — the runtime-only carrier the edit gizmo aims the output camera with, which reports the authored camera rather than owning data and pivots at
   `CAMERA_CONTROL_PIVOT`, its own origin, the camera position — and the `CameraPath`, the runtime-only drawing of the authored camera's trajectory, hidden
   and unnamed and holding the points the app hands it. The viewport is fitted once at boot.
3. **Editor objects.** The pointer tool takes its two live lookups — the camera that drew the frame, and the gizmo's claim — as closures, so neither is
   cached across frames and a left press on empty space still reaches picking while the gizmo is attached; `controls` exists before the tool, and the
   lookup is deferred to call time. Its two callbacks keep the UI and the mirror in step: a session change re-syncs the gizmo, marks the active object
   dirty, and re-reads the readouts and the UI; the ids an operation wrote go straight to a mark-dirty plus a commit, so exactly those objects are rebuilt
   — which is what leaves neither half of a detach, whose two objects both changed, drawing stale geometry. The flags no module can own are the app's:
   `cameraControlSelected` (`false`; whether the gizmo drives the carrier instead of the active object), `gizmoMode` (`'translate'`; the one mode the
   carrier and an object share), and `cameraPathVisible` (`false`, which `refreshCameraPath` clears whenever the track holds fewer than two keyframes).
   `playbackView` is the viewport state a run started from — the camera's pose, the orbit target, and the playhead — or `undefined` when no run has
   captured one; it is what lets a pause hand the frame over and a run's end undo the whole thing.
4. **Animation.** `Playback` is built over the output camera — whose `fov` a track animates — and bound to every object's mirrored node; it names the bound
   objects itself.
5. **UI.** `ModeBar` is a view of the session like the panels are, and the `VoxelizeDialog` is mounted into the same element as the panels; both, like
   them, receive callbacks and no state. They live in this file, and so does the file dialog, because `ui` never imports `app/`: the closure that seeds the
   dialog, the handling of its outcome, and the file dialog itself are the app's. The `Camera` group's view is read from the app's flags and from
   `project.camera.transform` and `project.camera.fov` — never from the carrier node, because what the fields show is what a keyframe would record — and
   `pathAvailable` is whether the track holds the two keyframes a path needs to exist at all. The timeline bar's visibility is the app's `timelineVisible`,
   `false` so the bar opens collapsed; `setTimelineVisible` is its only writer, and the panel is told the flag as soon as it exists, so flag and markup
   agree from the first frame — `index.html` carries `hidden` rather than leaving it to the module, because a bar laid out by the first paint and hidden
   only when the bundle runs would flash. There is no status line and no message area: the overlay holds the rail and the windows only.
6. **Flow wiring**, the only place the modules meet:
   - Import — an arriving model is put on the unit lattice first (`DEFAULT_VOXELS_ACROSS`), because one voxel is one world unit: the count the prompt asks
     for is the model's length, and the raw meshes and the payload live in that one unit. The import becomes **one** object, and every node — outline
     shells included, since the whole file is displayed — gets its raw mesh on layer 2 placed by its own baked world matrix, because the model's placement
     lives in those matrices now that one object stands for the whole file and the object's own transform is about to carry the payload's. A rescale
     re-places those meshes rather than building new ones, and the scaled scene is what is retained — `lastImport` is the import's scene, its object, and
     its meshes. Nothing but the raw meshes is on screen yet — the object is `'empty'`, and no node count is announced anywhere — so the settings are asked
     for **after** the model is on screen and fitted, because the object must exist and be measurable before the question can be asked in context. An
     outline shell contributes no cells, its geometry never reaching `buildVoxelizeSource`, so no payload carries its inverted hull; a file of nothing but
     outlines still gets its one object and no voxels at all. A failed parse goes to `reportFailure` and leaves the project untouched.
   - Voxelize — `promptVoxelize` is the one prompt and `importFile` its one caller, which binds the prompt to the object it just adopted, so the job always
     lands on the model the dialog was about. `main` derives no count of its own: the dialog's answer is the whole request. A cancel writes nothing and
     reports nothing — the object stays `'empty'` with its source meshes displayed, so the raw model can be inspected first. A run re-scales the import to
     the answered count, the model's length in voxels, and — while the retained import is still the one the prompt was about — re-places the same raw
     meshes on it, so they stay glued to the content the job is about to voxelize; the shared job then runs on that scaled source.
   - One body, `runVoxelizeJob`, is what a confirmed prompt runs. It aborts the in-flight job first and unconditionally — a superseded confirmation must
     never attach its payloads after a newer one, and an import with nothing to voxelize still supersedes the running job — then returns if there is no
     source (an outline-only import). Otherwise it runs one source at `DEFAULT_CELL_BUDGET`, with no target and no voxel size, because the confirmed prompt
     has already scaled the model onto the unit lattice. Its payload is attached through a map keyed by the source's own id, the key every output carries,
     so it lands on the object the import created instead of beside it. Success marks the object dirty, commits, and fits the view **after** the payload:
     the `'empty'` placeholder renders as voxels now, its source meshes hide behind them unless the override is on, and the fit syncs before measuring, so
     the rebuilt payload meshes are what it measures. Nothing is written while it runs; failure goes to `reportFailure` and leaves the project untouched,
     and a superseded call reports itself as `'cancelled'`. There is no second prompt — the dialog after a successful parse is the only way in — so a
     cancelled or regretted voxelization is redone by importing the file again, which adopts a fresh object beside the raw one the cancelled prompt left
     behind.
   - Edit, Scene, and Ops — every panel action but `detachSelection` is a thin wrapper over one `editor/ops` call on `session.activeObjectId`: group
     creation, deletion, mask colour, visibility, alignment (which snaps the placement when it is turned on), subdivision (which replaces the payload, so
     the object keeps its placement and only its cells get smaller), rename (trimmed, an empty name refused), and reparent. Each returns without acting
     when nothing is active; a failure goes to `reportFailure` and leaves the project untouched; a success marks the object dirty and commits, and the
     panel is re-read only through that commit. Deleting is per row — the active object need not be the deleted one, and the deleted one is cleared from
     the session when it was active. Subdivision's refusals belong to the op: `RangeError` for a level that is not a power of two, `'wrong-representation'`
     for an object with no grid, `'unsupported-subdivision'` below the level the object holds, `'exceeds-grid'` when the refined cells would leave the key
     space, and `'budget-exceeded'` over `DEFAULT_CELL_BUDGET`, while the level the object already holds is an `ok` that writes no payload.
     `detachSelection` is the one action that goes through the pointer tool, because the button is a command on the region the `Select` tool already chose
     rather than a tool choice: it commits exactly as a viewport press would and reports the two objects it wrote through `onProjectChange`, so the app
     marks them dirty on the edit path and not in this wrapper; it defers the call to click time, which is what lets it name the `pointer` built later.
   - Gizmo — the attach is exclusive: the carrier's node while the carrier is selected (whatever the session mode), otherwise the active object's mirrored
     node while the session is in `object` mode, and nothing in `edit` mode or with an empty selection. The mirror's outline follows the same condition,
     because the outline says which object the handles are on. The pivot is the carrier's own origin — the camera position, since a camera has no content
     to center on — and the center of the object's own content for an object, so the handles sit on what the user edits rather than at the node origin the
     document transform means; both carry the one `gizmoMode`. A drag has two halves and writes the document once. The live half writes no document: the
     carrier's node takes the reported matrix directly, since the carrier *is* the node the gizmo derives from, and an object's mirrored node takes the
     world matrix the gesture asks for with the very rule the commit stores — preview and commit must match, or the release would step the object back onto
     the grid. The commit half is the one write, from the world matrix the gizmo reports and not from the node it was attached to; the rebuild that write
     triggers discards the preview and replaces the node, which is why the render loop compares `gizmoNodeNow()` against the attached node and re-attaches
     (see 7).
   - Camera carrier — the four `Camera` group commands. Both toggles flip their flag and re-sync, so selecting the carrier takes the gizmo from the active
     object and deselecting it gives the gizmo back from the session alone. `Camera -> View` authors the viewport's pose into both the document and the
     output camera and selects the carrier, because aiming it is what the user came for. `View -> Camera` moves the viewport to the authored shot and
     writes nothing, which is what makes it a safe way to look at what a render would frame. Only a command that changes what the `Camera` group shows
     refreshes it: `View -> Camera` refreshes nothing.
   - Camera path — `refreshCameraPath` is the one writer of the drawing and of `cameraPathVisible`: it clears the flag when the track holds fewer than two
     keyframes, and hands the sampled trajectory and the keyframe positions to the drawing, which is what keeps the `Show camera path` box a view of both.
     It runs on the timeline's `onEdited` (a keyframe edit is what changes the trajectory), from the toggle — which only writes the flag and calls it — and
     once at boot. The path is a view of the authored camera track and writes nothing: no keyframe, no pose, no transform, no document data of its own.
   - Authored-camera writes — the two write helpers end in the same two places, the document's `project.camera.transform` and the mirror's output camera,
     because `SceneMirror.sync` never touches that camera and every export renders through it. A carrier drag commits through `applyCameraMatrix`: the
     world matrix decomposed into the document transform, quaternion normalized, position and quaternion copied onto `mirror.camera`. The numeric grid
     writes through `setCameraPose`, which refuses rather than reports — a non-finite component, or a zero-length quaternion that is not to be normalized
     into a rotation, returns before the document is touched, so a refused field leaves the camera exactly as it was — and, past both checks, normalizes,
     writes the position, routes the FOV through `setCameraFov` (which owns the clamp and the projection refresh), and copies the pose onto the mirror
     camera. Both refresh the panel, so a refused field is re-seeded from what the camera then holds.
   - Raw meshes — `setSourceVisible` is the panel's one entry point for the override, and it writes the mirror's flag and nothing else: the mirror owns it,
     applies it at once and again on the next `sync()`, and the panel reads it back through `sceneVisible`, so the checkbox cannot drift from the mirror;
     no dirty mark or refresh is needed, and an export is unaffected either way.
   - Grid — the `Grid` group's one control is the viewport's flag, so the action and the view go through the `worldGrid` instance rather than through
     `app`: `Panels` refreshes inside its own constructor, before `app` is built, while the instance already exists. `setGridVisible` writes that one
     instance and refreshes, and the re-seed is what makes the checkbox a view of the app's state rather than a forward-only control. The grid holds no
     per-frame state beyond its own position, so a commit or a session change touches no grid at all.
   - Defaults — `defaults` seeds the dialog from the retained import's `voxelizeBounds`: that box's size per axis, which the dialog reads its count against
     to print the model's dimensions, handed over unrounded — only the printed readout rounds — and read once per `open()`. With no import, or an empty
     box, every axis falls back to `DEFAULT_EXTENT`, the count the prompt already opens at, because one voxel is one world unit, so the dialog is usable
     with no scene. Those bounds are the nodes that are voxelized, not every displayed node: a stylized export's outline shells are drawn around the model
     and a little larger, so seeding from them would stretch the printed dimensions for content they do not cover. A scene of nothing but outlines has no
     outline-free bounds, so it falls back to `scene.bounds`, which is what framing uses either way, because every node is displayed.
   - Animate — `onEdited` rebuilds the mixer, and the path refresh rides the same callback; `onTransport` is `togglePlayback`, so the widget's toggle
     reports the press and the app is what starts or pauses the run; `adoptViewAsCamera` is `captureViewAsCamera`, which is what makes a camera keyframe
     record the view the author is aiming; `onScrub` pauses and then seeks, the one place the widget's milliseconds become the clip's seconds — the scrub
     bar, the exact-time field, and a keyframe row's `key` all seek through it.
   - Transport — the transport is the app's, not the widget's, because a run of the clip changes the viewport too. `startPlayback` returns while a run is
     already going and captures `playbackView` before anything moves, cloning every value so nothing later writes through it. `pausePlayback` returns while
     nothing runs, pauses, and hands the view over to the editor camera at the pose the clip stopped at, so the frame can be judged and flown on from
     there. `finishPlayback`, the end of a non-looping run, clears `playbackView`, pauses, and, when there was a run, puts the playhead back and restores
     the saved view with its target, so the return is exact. `togglePlayback` is the only entry point — pause while running, start otherwise — and
     `controls.dispose()` drops the orbit registration, so no separate teardown call exists.
   - FOV — `setCameraFov` is the panel's one entry point for the output camera's projection: it ignores non-finite input, clamps to `[1, 179]`, writes the
     document's `fov`, and copies the clamped value onto `mirror.camera` with its projection refreshed, because assigning `fov` alone leaves the projection
     stale — so the next export shows the authored value and a `fov` keyframe records it.
   - Export — `exportMp4` refuses while a job is in flight (the app's one export slot), sizes the capture to the resolution the panel asked for, and runs
     the export job → `saveMp4`; a failure goes to `reportFailure`. The slot is released and the gizmo re-attached in a `finally`, so a run that fails or
     stalls cannot leave the button refusing to start another for the rest of the session. Resolution, frame rate, range, and mask mode are the panel's
     choices; `main` owns only the capture that must render at them.
   - Save / open project — `saveProject` is one call whose bytes are `document/serialize.ts`'s: no state of its own. `openProject` reads the text and hands
     it to `readJson`; a refusal goes to `reportFailure` with the file's own literal and detail and writes nothing, and a file that passes goes to
     `loadProject`.
   - The load sequence — `loadProject` is the one mutation that replaces the whole truth, and it is a sequence rather than a new `Project`: the project,
     the mirror, the mixer, and the session all survive it, so the state the replaced project left behind is reset in this order, and the order is the
     point. Abort the job — nothing may be in flight; pause the transport and drop `playbackView`, because a run's saved view belongs to the project that
     started it; release the carrier and the path, both being views of the project being replaced; drop the raw-mesh layer, its records before any id can
     be reused, since a source is recorded under an object id and the mirror's own pass would otherwise re-parent the replaced import's meshes under a
     loaded object, and reset the override with it; reset the session *before* the objects, because its setters validate against the project and must not
     see the load half-applied; write the truth; publish the two things no `sync()` writes, the scene settings and the output camera; mark every loaded id
     dirty and commit, because `sync()` keeps the node of an id it already has and a load normally reuses ids, so without the mark the replaced project's
     geometry would stay on screen; force the rebuild, so the rebinding sees the nodes the load just made; rebind the mixer explicitly, because the loop's
     own check only compares id sets, which reused ids satisfy, so the loop would never rebind on its own; put the playhead at zero; and refresh the views
     — the camera path, the readouts, the panels, and the timeline.
   - Drop — one drop target, two meanings: a dropped `.json` goes to `openProject`, anything else to `importFile`. It is decided here because this file is
     the only place that knows both.
   - Timeline bar — `setTimelineVisible`, the rail's `Animation` toggle, is a view-only write: it sets the app's flag and tells the panel what to show
     rather than asking, so the flag stays the only state, and the bar keeps its contents while hidden, because the render loop goes on writing the
     playhead into it. Beside the window `resize` listener, an observer on `timelineRoot` calls the same refit: anything that moves the boundary between
     the canvas and the bar — the bar's visibility, a keyframe row, its message line — changes how much of the column the canvas has, and the renderer's
     `setSize` never touches the canvas' style, so without that refit the drawing buffer and the box would disagree and the view would be stretched.
7. **Render loop.** One `requestAnimationFrame` callback drives everything, once a frame: it advances the transport by the elapsed time, clamped, a paused
   action not advancing, so the transport flag never has to be mirrored here; ends a non-looping run at its last frame, which is where the transport stops
   and the view goes back; syncs the mirror's dirty objects; re-attaches the gizmo whenever the node it should be on is no longer the one it is attached
   to, because a rebuild replaced it; rebuilds the bindings when they were flagged; and updates navigation, which always flies the viewport camera and so
   can never touch the output camera. It renders through the output camera while a clip previews the shot and through the viewport camera otherwise. Just
   before the render it drives the carrier: hidden while a run previews the shot, otherwise reporting the output camera as it stands right now — the
   authored pose, or the sampled one while a clip runs — with its colour following only the user's selection, and standing back while the carrier is
   selected and the gizmo is busy, because a drag owns the pose until it commits. The path's marker size comes from the viewing distance, floored at the
   distance navigation orbits from — the orbit radius is the scene's own scale — because a viewport that sits *on* the carrier, which is exactly what
   `View -> Camera` produces, would otherwise shrink the rings to a dot; the rings need no rotation write, because a point sprite faces the drawing camera
   by construction. The carrier needs none of that: its size is a fixed world size. The floor is the path's alone — `TransformControls` sizes its own
   handles by the distance to the drawing camera, so with the viewport on the carrier the handles still degenerate, and the flow that follows is to orbit
   away (a middle-drag moves the viewport off the carrier while the carrier stays where it was), after which they are grabbable again; sizing them the way
   the object gizmo already does was chosen over special-casing the carrier. The grid follows the same camera the frame is drawn through — it reads only
   that camera's position — and it is decoration, so nothing about it reaches the render or the framing. The frame ends by writing the clip's seconds into
   the widget's milliseconds, the mirror image of `onScrub`'s division, and a fresh `HudState` into the HUD.
8. The loop never reads or writes voxel data: no `UniformGrid` method is called and nothing is rasterized. An object is dirty only because an edit or an
   import changed its data, so `sync()` cannot overwrite a transform the mixer wrote for playback.
9. `HudState` is assembled here from the active object, its `EditResolution` (which carries the object's `subdivision` beside its `cells`), the session
   selection, `Math.round(playback.time * project.timeline.fps)`, and `project.timeline.fps`.
10. **Ownership.** `main` constructs and disposes every long-lived object and passes each dependency in; no module below it builds another module's
    dependencies (`Panels` never creates a `Project`, `PointerTool` receives its `Picker` and `Overlay`). The imported raw meshes are app-owned like the
    rest: they live in a `main`-local array, and teardown detaches them from the scene graph the mirror just released without disposing the geometry or
    materials they share with the imported scene. Disposal leaves nothing registered: the frame and the in-flight job are cancelled, the drop target
    detached, the dialog settled (a prompt still on screen is disposed as a cancel, so no prompt call is left waiting), the bar's observer disconnected,
    and everything in `AppContext` plus the renderer, the controls, the capture, the overlay, and the world grid disposed — each decoration releasing its
    own geometries, materials, and nodes, so nothing is left in the scene the mirror releases, and the controls releasing the gizmo's listeners and helper
    together with the orbit controls.

## Invariants
- `main()` creates the renderer, the mirror, and every listed object once, and schedules exactly one render loop.
- Project mutations get `mirror.markDirty` plus `panels.refresh()`, every session change refreshes the mode bar, the panels, and the timeline, and
  timeline edits go through `onEdited` → `playback.rebuild`; one job at a time. A commit re-aims nothing: the grid follows the camera in the loop
  rather than the document.
- Every path that can make geometry measurable re-fits the **viewport** camera: the import path fits right after `commitDirty()`, on the raw meshes the
  user is about to answer the dialog about, and a confirmed prompt fits again through `runVoxelizeJob`, whose success path fits after
  `applyVoxelizeResult` and `commitDirty()`, because a payload can only be measured once it is attached. No other path moves the camera, and the output
  camera is never framed.
- A project load is the app's own sequence rather than a new `Project`, and it is safe only because of what it resets: the raw-mesh
  records before any id can be reused, the session before the objects, a dirty mark for every loaded id (`sync()` keeps the node of an id it already
  has), an explicit `rebuildBindings()` (the loop's own `bindingsCurrent()` compares id sets, which reusing ids satisfies), and
  `mirror.applySettings()`/`applyCamera()` for the two things no `sync()` publishes. `readJson` runs first, so a refused file leaves the editor as it
  was.
- Importing and voxelizing are two steps, and the second one is the user's: a successful import ends with the model adopted, displayed as
  raw meshes, fitted, and listed, and with the settings dialog open — never with a job. Only `{ kind: 'run', cellsAcross }` starts one, through the one job body
  `runVoxelizeJob`, so a cancelled dialog is a state the app supports rather than a failure: the object stays `'empty'` with its source meshes
  displayed, and nothing reports the cancel. A cancelled import is re-run by importing the file again —
  the dialog that follows a successful parse is the only prompt — so a retained import is never re-asked about. There is no per-object or per-scope
  voxelize path, and a single prompt is on screen at a
  time because the dialog owns it. One import is one object, one
  payload, and one row in the object list; an outline shell contributes no cells but is still displayed as one of that object's source meshes,
  and an import of nothing but outlines has no source at all: the object stays `'empty'` and the job returns after the abort, which is the
  one confirmation that ends without a payload.
- The two bounds an import reports are used for exactly one thing each: `voxelizeBounds` gives `defaults()` its per-axis extent (and with it the
  whole dialog through the `() => defaults()` closure), `bounds` is what framing fits, and neither is ever mixed up. A shell that sticks out past the
  model therefore cannot stretch the dimensions the dialog prints while framing still fits what the user can see.
- One voxelization job runs at a time: `jobController` is aborted before a new job takes ownership, so a superseded confirmation can never attach its
  payloads after the newer one. A job that was aborted reports `'cancelled'`; a job that fails leaves the project untouched — `applyVoxelizeResult` is
  only reached on `ok: true`.
- The dialog is the only place the voxelization settings exist, and the dialog after an import is the only way in: `main` holds no target, voxel
  size, or count of its own, never reads one back out of the dialog's fields, and acts on the outcome verbatim — a confirm scales the import by
  `cellsAcross`, the model's length in voxels, which it neither rounds nor re-derives. The panel cannot open the prompt again, so
  `main` exposes no retained-import query to it.
- One voxel is one world unit, so an import is put on the lattice instead of being given a voxel size: as it arrives it is scaled to
  `DEFAULT_VOXELS_ACROSS` — which is what makes the count the prompt asks for the model's length in voxels — and a confirm scales the same scene
  again, to the count the user answered with. Both go through `scaleImportedScene`, whose factor is absolute against the file's `authoredExtent`, so
  the second call replaces the first rather than compounding, and the fitted view, the raw meshes, and the payload are all in that one unit.
- The render loop never reads or writes voxel data, and playback writes only mirror `Object3D` transforms and the camera `fov`.
- Authored camera pose (`project.camera.transform`) is written by exactly three paths and no others: `applyCameraMatrix`, on a carrier drag's commit;
  `setCameraPose`, the numeric grid's whole-pose write; and `cameraToView`. Navigation never writes it: it flies the viewport camera, so the authored
  camera is only ever moved by an explicit gesture on the carrier. `project.camera.fov` is written only by `setCameraFov`, which `setCameraPose` routes its FOV through. Nothing else reads a mirror
  transform back into the document while the mixer is running.
- A run of the clip is the app's transport and it is reversible: `togglePlayback` is the only entry point, `startPlayback` captures `playbackView` before
  anything moves, and the frame loop ends a non-looping run at its last frame through `finishPlayback` — so every run either pauses on the frame it
  stopped at or ends with the playhead and the view back at the values it started from.
- A playback end writes no authored data: handing the view over and restoring the saved view both go through `controls.setViewFrom`, which touches no
  document, so neither a running clip nor a handoff can drift the authored camera pose.
- `viewportCamera` (app-owned) renders every frame a run is not previewing, drives navigation, picking, and fitting, and it is the only camera navigation ever moves. Picking asks for
  it through `getCamera()`, and the output camera never gains layer 1 or layer 2, so neither a decoration nor a raw mesh can reach an export.
- Every imported node gets exactly one raw mesh on layer 2, attached by `attachSourceMeshes` right after `adoptImportedScene` to the import's single object
  and handed that node's own baked `node.matrixWorld`; the meshes share the imported geometry and materials, the app keeps
  them in `lastImport.meshes` (and so in `sourceMeshes` for teardown), the mirror never disposes them, and teardown detaches them.
  A rescale moves the matrices, not the meshes: `attachSourceMeshes` reuses the mesh a node already has, so one node stays one mesh however often the
  import is scaled to the confirmed count. The matrix is what keeps every raw mesh on its imported pose — before
  the payload the object is at the identity, after it at the payload's translation, and `applySources` re-derives each mesh's local matrix from it: the app
  never re-parents a mesh, never computes a placement, and never writes a mesh matrix itself. Whether they are shown is the mirror's flag and the panel's
  checkbox (`setSourceVisible` + `sceneVisible`) — `main` keeps no copy of it and never toggles `visible` on a mesh itself.
- The `Grid` group's flag lives on the viewport's grid and never in the document: `panelContext.gridVisible` reads `WorldGrid.visible` and
  `setGridVisible` writes that one instance, so the panel and the grid it displays cannot disagree; no grid flag ever reaches `project`, a
  timeline track, or an export.
- The grid is put on the camera the frame is drawn through: the loop calls `worldGrid.update(renderCamera)` once a frame, before the render. It is decoration on layer 1, which
  `frameAll` does not measure — it reads layers 0 and 2 — so its quad can never widen an import's framing, and the export camera's layer 0
  never sees it.
- The timeline bar's visibility is the app's `timelineVisible` flag alone, and the bar is never shown or hidden without the canvas following:
  `index.html` carries the `hidden` attribute so the first paint is already collapsed, `setVisible` is the panel's only view of the flag and the
  rail's `Animation` button its only writer through `setTimelineVisible`, and the observer on `timelineRoot` refits the drawing buffer to the
  canvas' box whenever the boundary between the two moves. The bar's own contents are untouched by hiding it: the loop keeps writing
  the playhead through `setTime`.
- The authoring clock is whole milliseconds and the clip is seconds, and this file owns both conversions between them: `onScrub` divides the
  widget's milliseconds by 1000 on the way to `playback.setTime`, and the render loop multiplies `playback.time` by 1000 on the way into
  `setTime`. Every other time the app touches is already on its own side of that boundary — the export range and the HUD's frame count are the
  clip's seconds, and `project.timeline.durationMs` and every keyframe are the document's milliseconds.
- The gizmo is attached to exactly one node at a time: the carrier's node while `cameraControlSelected` is set — whatever the session mode, so a selected
  carrier keeps the handles even in `edit` mode — and otherwise the active object's
  mirrored node while the session is in `object` mode, so the carrier and an object can never both carry handles. It pivots at the
  carrier's own origin, the camera position, for the carrier, and at that object's content center for an object. A gesture moves the
  object through `previewTransform`, which writes no document, and produces exactly one document write on release, from the matrix the gizmo reports
  and not from the node it was attached to; that write rebuilds the object, so the loop's identity comparison is what re-attaches the gizmo, and no
  gesture can leave the handles on a released node. The live transform and the committed one come from the same matrix, which is why the release
  moves nothing on screen.
- The carrier is a runtime-only handle on the output camera and never document data: its node is unnamed and on layer 1 with the rest of the
  decoration, so the raycaster cannot pick it, no export frame contains it, and the mixer's binding walk cannot reach it. It is
  never serialized, never a keyframe target, and never a second camera: it draws `mirror.camera`'s pose and writes back into `project.camera`. The
  pose lives on the node and a fixed world-size scale on its helper, never both on one, because the gizmo derives its drag from the node's own matrix.
  A drag owns the pose while `controls.gizmoBusy()`, so the per-frame `setPose` stands back for it and the commit is the single write the gesture makes,
  and the carrier is drawn from the first frame, in one colour or the other, and hidden only while a run previews the shot. Its size is one world unit per helper unit, so it is a scene-sized
  object that no view can inflate; the gizmo's own handles, which `TransformControls` sizes by the distance to the drawing camera, still
  degenerate in a viewport sitting on the carrier: the remedy is to orbit away, which moves the viewport off the carrier and leaves the carrier where it was.
- The camera path is a runtime-only view of the authored camera track and writes nothing: `refreshCameraPath` is its only writer, the drawing holds
  no document data, and `cameraPathVisible` is the app's flag with the panel's `Show camera path` box as its view. Fewer than two camera position
  keyframes is not a path, so the flag is cleared then and the box is disabled and unchecked; that one flag governs the drawing, and a run needs no rule of its own — the preview renders through the output camera, which enables layer 0 alone, so the drawing is simply not in the preview frames. The drawing is on layer 1 and unnamed, so it is never
  picked, never in an export frame, and never bound by the mixer.
- The pointer tool receives both live lookups it needs as closures — `getCamera()` for the render camera, `getGizmoBusy()` → `controls.gizmoBusy()` for
  the gizmo's claim — so neither is cached across frames. A left press therefore reaches `Picker.pick` whenever the gizmo is not dragging and no handle
  is hovered, which is what keeps cell selection reachable while the gizmo is attached to the active object.

## Errors
`importGlb`, `voxelize`, `applyVoxelizeResult`, and `ExportJob.run` failures reach `reportFailure`, which writes the `Result`'s `error` literal and
`detail` to the console — the panel has no message area — and a failed import or voxelization leaves the project untouched;
inner-ring programmer errors propagate. A cancelled settings dialog is not an error: `promptVoxelize` returns without a message, leaving the retained
import `'empty'` and displayed. There is deliberately no re-run path: the panel has no voxelize control and `main`
implements no action that reopens the dialog, so a cancelled or regretted voxelization is redone by importing the file again — or by deleting the raw object and
dropping the file anew — and never by re-opening the prompt. That is the requested behaviour, not an oversight. A retained import whose every node is an outline has no source, which
`runVoxelizeJob`
treats the same way: it aborts the superseded job and returns. An aborted job's own `'cancelled'` result is reported like any
other failure, because `jobController` is the only thing that knows the job was superseded.
The carrier's writes refuse rather
than report: `setCameraPose` returns before writing anything when any component is non-finite or the quaternion is zero-length, so a refused field never
becomes a partial pose on the document or the mirror camera; the `panels.refresh()` that follows — or the next frame —
re-seeds the fields from what the document then holds. `applyCameraMatrix` takes the matrix the gizmo derived from a real node transform, so it has
nothing to refuse.

## Dependencies
- `../document/project.js`, `../editor/{session,ops,pointer}.js` — `Project`, `EditorSession`, `EditResolution`, `applyVoxelizeResult`,
  `createGroup`, `deleteObject`, `renameObject`, `setObjectMaskColor`, `setObjectVisible`, `setObjectAlignToGrid`,
  `setObjectSubdivision`, `reparentObject`, `PointerTool`.
- `../voxels/voxelize/voxelize.js` — `voxelize`, `DEFAULT_CELL_BUDGET`, `VoxelizeSource`; `../three-runtime/import.js` — `importGlb`,
  `adoptImportedScene`, `scaleImportedScene`, `buildVoxelizeSource`, and `ImportedScene` for the retained import's type. There is no
  `VoxelizeTarget` to import any more: the confirmed count is baked into the scaled scene.
- `../voxels/uniform/grid.js` — `UniformGrid` for the demo cube's unit cells, and `HexColor`, `IntBox3` for the mask-color action
  and the selection text.
- `../three-runtime/{scene,picking,controls,capture,overlay,grid}.js` — `SceneMirror`, `Picker`, `ViewportControls`, `Capture`,
  `Overlay`, and `WorldGrid`, whose `visible` flag and `setVisible` are the panel's one grid control; and
  `../three-runtime/cameraControl.js` — `CameraControl`, the runtime-only carrier the gizmo aims the output camera with;
  `../three-runtime/cameraPath.js` — `CameraPath`, the runtime-only drawing of the authored camera's trajectory, and
  `../animation/trajectory.js` — `sampleCameraTrajectory` and `cameraKeyframePositions`, the points it is handed; `../animation/playback.js` and `../export/job.js` — `Playback`, `ExportJob`.
- `../ui/{panels,timeline,hud,dom}.js` — `Panels`, `TimelinePanel`, `Hud`, `el`, and the `CameraPose` type its `setCameraPose` action takes;
  `../ui/voxelizeDialog.js` — `VoxelizeDialog`,
  `DEFAULT_VOXELS_ACROSS` (the count an arriving import is scaled to) and its `VoxelizeDialogDefaults` seed type; `./files.js` — `pickGlbFile`,
  `pickProjectFile`, `saveJson`, `saveMp4`, `wireDropTarget`; `../document/serialize.js` — `toJson` and `readJson`, the project file's whole boundary;
  `three` — `WebGLRenderer`, `PerspectiveCamera`, and the `Matrix4` type `applyCameraMatrix` takes. Nothing may import this file: the dependency direction stops here.

## Tests
None of its own: it is the smoke target of the slice, verified by `npm run dev` plus a walk through Scenario A (README section 9).
Saving and loading is part of that walk: rename an object, press `Save project…`, reload the page, drop the downloaded `.json` back onto
the viewport, and the object with its cells, mask color, and placement plus the timeline (duration, fps, and any keyframe rows) must come back, with the
demo object gone, the panel showing one row, and nothing on the console.
Importing is now the first assertion of every walk: dropping a GLB must first show the model itself — `imported <scene name> (N
with the one imported object listed as `empty`, its node meshes attached and visible, and the camera fitted to the raw meshes, all of them scaled onto
the unit lattice so the model's longest axis is `DEFAULT_VOXELS_ACROSS` cells — and then open the
settings dialog, seeded from that model, with no voxelize setting anywhere in the panel; `Voxelize` must run the job at what the dialog shows, replacing
the raw meshes with voxels, while `Cancel` and Escape must leave the object `'empty'` with its raw meshes displayed. None of it is announced in text: the object list, the HUD, and the viewport are the evidence. The panel must offer no voxelize control at all: the prompt that follows a successful parse is the only way
in, so a second look at the settings — a different voxel count — means importing the
file again, and `lastImport` retains the cancelled model only for the dialog's extent and for teardown. The
dialog's seeds must come from the outline-free bounds: importing `public/forest.glb` (79 nodes, 22 of them `*_Line _0` shells
holding 6410 of its 17628 triangles) opens the prompt at the constant `Voxels across` = 96, and the readout under the field must print that model's
dimensions in voxels — 96 along its longest axis — instead of a length; confirming it reports `voxelized 28893 cell(s) from 11218 triangle(s)` —
exactly the 57 non-outline nodes, in one payload — beside the boot demo cube; the 22 shells are drawn as that object's raw
meshes and their cells are nowhere in the payload. That confirmation is also the rescale walk: the model must be scaled again to the count the field
holds — the same raw meshes re-placed on it, not a second copy — before the job runs.
The same file is the measurement of the one-payload rule: the same 11218 triangles used to voxelize into 57 payloads holding 32854 cells, and the 3961 cells
of the difference are the ones two or more meshes claimed (the stones inside the soil box, the barbecue and the fire inside each other) — two objects whose
boxes overlapped drew exactly coincident cubes in different colours, and the first part now keeps such a cell. The repo's demo GLBs have
identity node transforms, so the placement half — every raw mesh carrying its own baked node matrix — needs real content: a Sketchfab export whose root chain and mesh nodes carry a rotation and
non-uniform scales must land with the object translation-only and every raw mesh exactly where the import put it — through the object's identity transform
before the payload and the payload's `-origin` offset after it — with every voxel grid axis-aligned in world space, and `Show raw meshes` must bring the raw
meshes back exactly on top of their voxels — before the fix those meshes landed rotated, sheared, and mis-scaled relative to them.
Scenario A exercises the camera track end to end: import a GLB — one object, the whole file — confirm the dialog, aim the output camera (the numeric
fields, or `Camera -> View` after flying the view), and `add` camera keyframes at two playhead times — the two keyframes must differ, the export must
move the camera along them, and pressing play must leave the authored pose untouched while the clip runs. The two object properties the panel exposes go through their ops on the
same walk: renaming the active object must change the object list and the HUD, unticking `Visible` must hide its node in the viewport, and a blank
name must come back as a reported failure with the object unchanged. The raw-mesh half of the walk: a click must select the imported object with no
selection or overlay, hovering must change nothing at all
`Show raw meshes` must bring them back over them and take them away again, and an export taken while they are shown must contain voxels only — the
output camera and `Capture` never test layer 2.

The carrier is walked on the same run: with the viewport not previewing the shot, `Select` in the `Camera` group must show the carrier on the output camera and
put the gizmo on it, and a drag on the gizmo must aim the output camera — the numeric fields must land on the committed pose and an export must frame
it — while the live drag writes the document only on release. Typing any of the seven fields must move the shot and re-seed the others, a cleared or
non-numeric field must come back as what the camera holds rather than a partial pose, `Camera -> View` must author the pose the viewport shows,
`View -> Camera` must move the viewport to the authored shot and change no field, and `Deselect` must hand the gizmo back to the active object.
Two facts to check explicitly: the carrier is drawing the output camera rather than a second one — it moves with the authored pose, is off screen while a clip previews the shot, and appears in no exported frame and in no pick — and the size floor is what `View -> Camera` needs: after the jump
the carrier is still visible while the gizmo's handles have degenerated to a dot on it, and a middle-drag away restores grabbable handles without the
carrier moving.

The path is walked on the same run: with two camera keyframes in the track, ticking `Show camera path` in the `Camera` group must draw the
white polyline through the sampled trajectory with one hollow ring per keyframe, following the camera as it is aimed and resizing as the viewport
orbits, and unticking it must take the drawing away; with fewer than two camera keyframes the box must be disabled and unchecked and nothing must be
drawn, and deleting a keyframe from a two-keyframe track must clear both again; an exported frame must contain no part of the drawing — it is on layer 1 and unreachable by a pick.

The transport is walked on the same run: pressing play must render the viewport through the output camera for the length of the run — the shot
itself, which is what makes a camera animation visible — with the carrier hidden while it previews; pausing must stop the transport (the toggle reads `play`) and
hand the editor camera the pose the clip stopped at, and letting a non-looping run reach its end must stop the transport, return the playhead to
the run's start value, and put the view back where the run started from — with the target the run captured, so the return is exact rather than
re-aimed. Nothing is locked: the viewport is the author's again the moment the run pauses or ends. Two orders are worth checking explicitly: the
pause's handoff must leave `project.camera.transform` untouched, and a play pressed while a run is already going must change nothing — the captured
view stays the one the run started from.

## Open questions
- Dirty marking stays on the edit and import paths: rebuilding from project truth while the mixer's transforms are animated would clobber them.
- The `FOV (deg)` field authors `mirror.camera.fov` directly, so a `fov` track that is running overwrites the typed value on the next mixer
  sample while the document keeps it — the same ownership split the pose copy guards with `playback.playing`, but the projection has no such guard.
