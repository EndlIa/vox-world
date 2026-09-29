# src/ui/panels.ts

Ring: 4 · Layer: ui · Depends on: ./dom.js, ./floatingWindow.js, ../document/project.js, ../editor/session.js, ../voxels/uniform/grid.js

## Responsibility
The main control panel: import, edit, camera, export, and grid-display controls plus the project and session read-out. It renders state and forwards intent through
`PanelContext.actions`; it never mutates the project, never calls `editor/ops.ts`, and never imports `app/` — the composition root depends on `ui/`, not the reverse.

The voxelization settings are not here

The panel is an overlay on the canvas, not a reserved column: it is anchored to the top-left of the window at
`width: 112px` and takes no space from the viewport, which keeps the whole window width. It is a rail of group
buttons — `Import`, `Edit`, `Camera`, `Render`, `Scene`, `Grid`, `Project`, in that order, full width — with the `Animation`
toggle at its foot, and behind each group button that group's controls in a floating window
(`./floatingWindow.ts`): no group is expanded
until its button is pressed, several windows can be open at once, each is moved by dragging its title bar, and
each is closed by its `×` or by its button again. A button carries the existing `on` class for exactly as long
as its window is open, and two buttons do more than open a window: `Edit` also selects the edit mode
its tools belong to, and it is disabled while no object is active, because that mode edits one object's
voxels and there is nothing to edit until one is chosen; and `Animation` opens no window at all — it shows and hides
the timeline bar along the bottom of the page, and carries `on` while that bar is on screen. Everything that is *about the camera* lives in
the `Camera` group — the carrier that aims the output camera, and its projection — while the keyframes stay in the timeline
bar, because they are animation.

## Public interface
```ts
type CameraPose = {                 // one authored camera pose: the carrier's fields, and what a numeric field writes back
  position: [number, number, number];
  quaternion: [number, number, number, number];
  fov: number;
};
type CameraControlView = {          // what the carrier's controls read
  selected: boolean;                // whether the gizmo currently drives the carrier
  mode: 'translate' | 'rotate';     // the gizmo's mode, shared with objects
  playing: boolean;                 // whether a run is in flight; the app skips the `Camera -> View` capture while one is
  pose: CameraPose;                 // the authored camera, i.e. what a keyframe would record
  pathVisible: boolean;             // whether the camera path is drawn; the app's flag, not the panel's
  pathAvailable: boolean;           // whether the track holds a path at all (two keyframes or more)
};
type PanelContext = {
  project: Project; session: EditorSession;
  sceneVisible?(): boolean;    // the app's raw-mesh override; absent => forward-only checkbox
  gridVisible?(): boolean;     // the viewport's one world grid's flag; absent => forward-only checkbox
  timelineVisible?(): boolean;   // the app's timeline-bar flag; absent => the rail's `Animation` button is disabled
  cameraControl?(): CameraControlView;   // the carrier's state; absent => the carrier's controls are disabled
  actions: {
    pickImportFile(): void;      // opens the file dialog from app/files.ts; ui never imports app
    saveProject(): void;         // writes the whole project to one JSON download
    openProject(): void;         // opens a project file, replacing what is open
    exportMp4(options: { width: number; height: number; fps: number; from: number; to: number;
      mode: 'beauty' | 'mask' }): void;
    createGroup(): void;
    deleteObject(objectId: ObjectId): void;   // deletes that object; clears the session when it was active
    setActiveMaskColor(color: HexColor): void;
    setActiveVisible(visible: boolean): void;   // shows or hides the active object
    setActiveAlignToGrid(alignToGrid: boolean): void;   // turns the active object's grid alignment on or off
    setActiveSubdivision(subdivision: number): void;    // raises the active object's own grid level; a coarser one is not offered
    detachSelection(): void;   // detaches the region the session selected; the app runs it through the pointer tool
    setSourceVisible(enabled: boolean): void;   // shows or hides every imported raw mesh
    setGridVisible(visible: boolean): void;    // shows or hides the viewport's one world grid
    setTimelineVisible(visible: boolean): void;     // shows or hides the timeline bar; the app owns the flag
    renameActive(name: string): void;           // renames the active object; the app trims and refuses ''
    reparentActive(parentId: ObjectId | null): void;
    setCameraFov(fov: number): void;         // authors the output camera's vertical FOV
    setCameraPose(pose: CameraPose): void;   // writes the whole authored pose; the app refuses a bad component
    toggleCameraControl(): void;             // selects or deselects the carrier
    toggleGizmoMode(): void;                 // flips the gizmo between moving and rotating, for whatever it is on
    cameraToView(): void;                    // `Camera -> View`: authors the pose the viewport shows
    viewToCamera(): void;                    // `View -> Camera`: moves the viewport, writes nothing
    setCameraPathVisible(visible: boolean): void;   // draws or hides the camera path; a view switch, so it writes nothing else
  };
};
class Panels {
  constructor(root: HTMLElement, context: PanelContext);
  refresh(): void;
}
```

## Internal logic
1. Construction and lifetime. Every control is built once and lives for the page lifetime, with no `dispose`. Each group's controls are appended to that group's
   own window body — a `FloatingWindow` (`./floatingWindow.ts`) — and are never copied, re-created, or re-parented, so no control has a second copy in the rail.
   The rail and the seven windows are the panel's whole content: nothing else is appended to `root`, and `index.html` gives the rail `order: -1`, so it is the
   overlay's first row whatever order the nodes arrived in. `refresh()` runs at the end of the constructor.
2. Rail and windows. Each group is one rail button plus one window, built together in the order `Import`, `Edit`, `Camera`, `Render`, `Scene`, `Grid`,
   `Project`, `Project` last. The window's `onVisibilityChange` puts the `on` class on its button for exactly as long as the window is open, so the rail is the
   only place the panel says which groups are on screen. Windows open one stagger step down and right of the previous group's, so two opened at once never sit
   exactly on top of each other. `Edit` is the one group whose press does more than toggle its window: its press hook selects the edit mode its tools belong to
   (`session.setMode('edit')`), and the button is disabled while no object is active, because that mode edits one object's voxels and there is nothing to edit
   until one is chosen. A window's visibility and position are the window's own: `Panels` keeps no open flag, no rectangle, and no window list, and closing a
   window only hides it, so its nodes stay where they are, whatever the user typed survives, and a reopened window shows the current state.
3. `Animation` is the rail's one entry that opens no window, because the timeline is a bar along the bottom of the page rather than a group; it is built without
   a stagger step, which is why adding it left the group windows at the positions they had. Its click is a plain toggle over the app's flag: it reads
   `context.timelineVisible()`, hands the opposite to `setTimelineVisible(visible)`, and puts its own `on` class in step, because no window's visibility can
   mark it. With no `timelineVisible()` in the context the button is `disabled`, since a toggle with no flag behind it could not show anything, and the panel
   never shows or hides the bar itself. That bar is visible at all only because `index.html` gives `#viewport { min-height: 0 }`: a canvas carries an intrinsic
   size from its drawing-buffer attributes, so without it the canvas floors the grid row and the `auto` timeline row is pushed past the bottom of the `100vh`
   column, into what `body { overflow: hidden }` clips away.
4. `Import` group: the GLB import button forwards `pickImportFile()`, a dim line says a `.glb` can be dropped on the viewport instead, and `Show raw meshes` is
   the raw-versus-voxel toggle. Its `change` event forwards `checked` through `setSourceVisible(enabled)` and nothing else, so the panel never touches the
   mirror, the scene, or a mesh. It is seeded from `context.sceneVisible()` when the context exposes that function — the app does, with
   `SceneMirror.sourceVisible` — and left untouched by `refresh()` when it does not, in which case the checkbox is a plain forward-only control, the panel
   displays the user's last click, and the app remains the only thing that knows whether the raw meshes are shown; `refresh()` therefore never invents a state
   for it.
5. `Edit` group, the group of the `edit` mode whose tools its buttons show. The four `ActiveTool` buttons forward `session.setTool(tool)` and are never
   disabled, because a press is what creates the region those tools work on. `detach` is a plain button that is never a tool: its click is
   `context.actions.detachSelection()` and nothing else, no click writes a tool, and `refresh()` never gives it the `on` class — it is a command on the region
   the `Select` tool already chose rather than a tool choice, so pressing it runs the operation and leaves no mode behind, and it is `disabled` exactly while
   `session.selection.kind === 'none'`, because with no region there is nothing for it to detach. The `Select` field is the select tool's shape parameter —
   `box` alone so far, the list it will grow into — and forwards the value through `session.setSelectionShape(shape)`. `Add wall` is the add tool's own
   thickness in cells and a view of `session.addHeight`: `refresh()` seeds it and it forwards a whole number at least one through `setAddHeight(height)`,
   ignoring a blank, fractional, or negative field so the session keeps the height it had while the field is retyped — which is why the setter's own
   `RangeError` is unreachable from here. `Color` is the `editColor` shared with the add and paint tools: `refresh()` seeds it from `session.editColor` and it
   forwards an unsigned hex number through `setEditColor(hex)`.
6. `Camera` group: everything that is *about the camera* lives here — the carrier that aims the output camera (`Select`/`Deselect`, the gizmo-mode button,
   `Camera -> View`, `View -> Camera`, and the seven `X`, `Y`, `Z`, `QX`, `QY`, `QZ`, `QW` number fields, built in that order) and its projection, the
   `FOV (deg)` field, which follows them in the same window — while the keyframes stay in the timeline bar, because they are animation. The four buttons and the
   seven fields are plain forwards over the carrier and the camera, and any field's `change` event sends the whole pose — the seven values plus the `FOV (deg)`
   field — because the fields are one state and a change to any component is a change to it; a cleared or non-finite component makes that write refresh instead,
   so the fields come back showing what the camera actually holds rather than a half-written pose. With `context.cameraControl()` present `refresh()` seeds the
   seven fields from the authored pose (skipping whichever field is focused, so the field being typed into is never overwritten) and swaps the two button
   labels: the select reads `Deselect` while the carrier is selected, and the mode button names the mode a press would move *to*, so a `rotate` carrier reads
   `-> Move`. The four controls are gated rather than tracked: with no provider the select, the mode, and the two view switches are all `disabled`, because a
   context with no carrier has nothing for them to aim, and the mode button is disabled too while the carrier is not selected, since a mode with nothing to move
   is no choice. `Show camera path` is seeded from the same provider — `checked = pathAvailable && pathVisible`, `disabled = !pathAvailable` — because a path
   needs two keyframes to exist at all, so a track below two is unchecked as well as disabled, and the panel holds no path flag of its own. The seven pose
   fields and the `FOV (deg)` field are never disabled: they author the camera whether or not the carrier is selected. `FOV (deg)` displays `project.camera.fov`
   until the user types in it, forwards `parseFloat` of its value through `setCameraFov(fov)` on every `input` event, and holds no camera and no clamped copy of
   its own; the app validates and clamps what it receives.
7. `Render` group, the export: the `Render MP4` button reads the resolution select (`960x540`, `1280x720`, `1920x1080`, the middle one selected by default), the
   fps, `from`, and `to` inputs, and the mode select (`beauty | mask`, where `mask` is the per-object identity-color render), and calls
   `actions.exportMp4(options)` with width and height rounded to even numbers, because H.264 and AV1 reject odd dimensions in some players and every encoder
   configuration is cleaner with them. The panel builds no `ExportRequest`: it forwards the numbers it displays, and it refuses to forward a non-positive or
   non-finite fps or a non-finite range, so a bad range runs no export. The fps, `from`, and `to` inputs are seeded on every `refresh()` — from
   `project.timeline.fps`, `0`, and `project.timeline.durationMs / 1000` — but only while untouched, each carrying its own flag set by its `input` event, so a
   re-render never overwrites a range the user typed. That division is the one place this panel meets the unit boundary: the export range is seconds, because
   the export job and the compiled clip are, while the clip is authored in milliseconds, and the field's label `To (s)` says which of the two it shows.
8. `Scene` group: the object tree and the fields that act on the active object are two halves of one window, and the `hr` between them is the only divider any
   group uses — the stylesheet draws it as a `--line` rule across the body, and no other group's controls are split by anything but their own order. Above it
   are `Create group`, which forwards `createGroup()`, and the object list, the part that chooses among every object: `refresh()` builds its rows from
   `project.roots()` and `childrenOf()`, listing children under their parent, marks the row `session.activeObjectId` holds, and puts the trash button on that
   active row alone, so exactly one row can show a trash at a time and a delete never depends on which object happens to be active. Below the divider are the
   active object's own fields — `Mask color`, `Parent`, `Name`, `Visible`, `Grid align`, `Subdivision` — and each is a view of that object, never a second copy
   of it: `refresh()` writes `object.maskColor`, `active.visible`, and `active.alignToGrid` back into `Mask color`, `Visible`, and `Grid align`, builds
   `Parent`'s options from the project's objects minus the active one (an object cannot be its own parent) and selects `object.parentId`, and re-seeds `Name`
   from `object.name` whenever the active object is not the one the field is showing, so a re-selection never leaves the previous object's text behind.
   `Visible` forwards `checked` through `setActiveVisible(visible)` and `Grid align` forwards `checked` through `setActiveAlignToGrid(alignToGrid)`; turning
   grid alignment on moves the object onto the lattice now rather than at its next edit, and off, a drag may leave it between cells. `Name` keeps a flag of its
   own, set by its `input` event, and forwards on its `change` event only — never per keystroke — so a half-typed name cannot reach the document; until the user
   types it displays the name the project holds, the field is emptied while nothing is active, and a rejected rename simply re-seeds it on the next `refresh()`.
   `Parent` forwards `reparentActive(parentId | null)`, the `(root)` option sending `null`. `Subdivision` is a view of the active object's own grid level and
   never a second copy of it: `refresh()` writes `session.resolutionOf(active.id).subdivision` into it, disables it whenever the resolution carries none — an
   object with no uniform grid has no cell to subdivide — and disables every option below the level the object holds, so the select can only offer that level or
   a finer one, which is where the Scene group says coarsening is not offered. Its levels are the module constant `SUBDIVISIONS`, and it forwards the chosen
   level through `setActiveSubdivision(level)`; they are powers of two because a cell has to stay an exact binary fraction of the world unit, and the list is
   the UI's range rather than a rule of the grid. It is not a voxelize setting: it raises the level of a payload that already exists and never rescales a model.
9. `Grid` group: one control, the viewport's `World grid` checkbox. Its `change` event forwards `checked` through `setGridVisible(visible)` and nothing else, so
   the panel never touches the grid, the scene, or a mesh, and it is never disabled: it acts on the viewport rather than on the document, it needs no active
   object, and it is a plain toggle over the app's own flag, so there is nothing for the panel to gate it on. It follows the same view rule as
   `Show raw meshes`: while `context.gridVisible()` exists `refresh()` writes its answer into the checkbox and the panel holds no grid flag of its own; with no
   such function the checkbox is forward-only, `refresh()` never rewrites it, and the app is the only thing that knows whether the grid is drawn.
10. `Project` group: two plain forwards — `Save project…` and `Open project…` in one row — over `saveProject()` and `openProject()`, and the hint that a `.json`
    can be dropped on the viewport as well. It reads no state and shows none: what a project file is belongs to `document/serialize.ts` and to the app. There is
    no voxelize group: the settings live in `ui/voxelizeDialog.ts`, and no representation, voxel size, cell size, root size, or max depth is reachable from the
    panel at all.
11. `refresh()` re-reads `project` and `session` and rewrites text, `value`, and `disabled` so the panel matches current state — the object tree and the trash
    button, the pressed tool, `detach`'s disablement, and every active-object field come from that re-read — and it never invents a state for a forward-only
    control. Calling it twice produces the same DOM. A row's button text is `name · representation` plus the resolution suffix: for a `uniform` object whose
    `EditResolution` carries `cells`, ` · <x>×<y>×<z>` — the object's occupied size per axis in cells, each rendered with `fmt(count, 0)` — and nothing
    otherwise, so an `'empty'` object and one whose resolution reports no cells both read bare representation. One cell is one world unit, so the suffix is a
    size in voxels, never a length in metres.
12. Direct writes. The only direct writes are `session` setters driven by user input: object rows call `session.setActiveObject(id)`, tool buttons call
    `session.setTool(tool)`, the `Select` field calls `session.setSelectionShape(shape)`, the `Color` field calls `session.setEditColor(hex)`, and the
    `Add wall` field calls `session.setAddHeight(height)`. The `detach` button writes no session state at all: its click is `context.actions.detachSelection()`
    and nothing else. No `project` mutator and no `editor/ops.ts` function is called here.
13. Callbacks and gating. Every project-changing control leaves as a `PanelContext` callback and the panel performs no edit itself; `Visible` and `Grid align`
    are document state rather than forward-only views, so they always show what the project holds. Each control is enabled only when the app could act on it:
    mask color, name, visibility, grid alignment, and reparent need an active object; subdivision needs an active object whose grid reports a level; `detach`
    needs a selection, since it is a command on the selected region; and the rail's `Edit` needs an active object. The group buttons, the `World grid` checkbox,
    and `Animation` need no active object.

## Invariants
- The panel calls no `Project` mutator and no `editor/ops.ts` operation: after any interaction the project is exactly what the app left it; its only
  direct mutations are `EditorSession` setters driven by user input (`setActiveObject`, `setTool`, `setSelectionShape`, `setEditColor`, `setAddHeight`).
- No voxelize setting is reachable from the panel, and neither is the dialog: it has no representation, voxel size, cell size, root size,
  or max depth control, and no button, checkbox, or field that opens the settings modal. The panel never builds a `VoxelizeTarget`, never decides how
  much of the scene to voxelize, and never starts or cancels a job — all of that is the dialog's answer and the app's reaction to it, and the dialog
  that follows a successful import is the only prompt there is.
- Every project-changing control reaches the app as a `PanelContext` callback; the panel imports no module from `app/` and never performs an edit
  itself.
- The `detach` button is a command, not a tool: its click calls `detachSelection()`, a
  `PanelContext` callback like the rest, so the operation runs in the app (through the pointer tool) and the panel performs no edit; because it
  is a command, pressing it can never leave a mode behind — it writes no tool, so the next viewport press does what the still-selected tool says
  rather than a detach. It is `disabled` exactly while `session.selection.kind === 'none'`, because it commands the region the session already
  selected and with no region there is nothing to detach; the tool buttons are never disabled, since a press is what creates the region those tools
  work on.
- The carrier's controls are a view of the app's own state and never a second copy of it: `refresh()` seeds the seven pose fields and the two button labels from `context.cameraControl()`, so what the fields show is what the app would record in a keyframe. The panel keeps no pose, no selection, and no mode of its own, and the four buttons are gated rather than tracked — `disabled` with no provider, and the mode button also while the carrier is not selected. The `Show camera path` box is seeded from the same view — `checked = pathAvailable && pathVisible`, `disabled = !pathAvailable` — so it can never show a drawn path below two keyframes and the panel holds no visibility flag of its own.
- `Show raw meshes` forwards `checked` and nothing else, and is the panel's only view of the raw-mesh override while `context.sceneVisible()` exists:
  it then displays that value on every `refresh()` and holds no copy of its own, so the mirror and the checkbox cannot disagree. With no `sceneVisible()`
  in the context the checkbox is forward-only and `refresh()` leaves it alone — the panel then displays the user's last click, and the app is the only
  thing that knows the real state. Either way no mesh, scene, layer, or mirror is touched here.
- The `Grid` group's one control is the viewport's own flag, not document state: while `context.gridVisible()` exists, `refresh()` writes
  it back into the checkbox, so the panel invents no state of its own and holds none, and it needs no active object. With no `gridVisible()` in the
  context the checkbox is forward-only and `refresh()` never rewrites it, exactly like `Show raw meshes` without `sceneVisible()` — the panel then shows
  the user's last click and the app is the only thing that knows the real state.
- The `FOV (deg)` input is the panel's view of the output camera's projection — the seven carrier fields are the pose half of the same view: it displays `project.camera.fov` while untouched, forwards the parsed number, and keeps no camera and no clamped copy of its own.
- The `Visible` checkbox is a view of `object.visible` and the `Name` field a view of `object.name`: neither holds document state, neither writes
  anything itself, and both are `disabled` while nothing is active. The `Name` field forwards only on `change`, so no keystroke of a name half-typed
  can reach the app, and a rejected rename simply re-seeds it from the project on the next `refresh()`.
- The Scene window's active-object fields describe the active object, and the `Grid align` checkbox is one of them: `refresh()` writes
  `active.alignToGrid` back into it and disables it while nothing is active, so it is not forward-only — it always shows the object the list selected.
- `Subdivision` is a view of the active object's own grid level and never a second copy of it: `refresh()` writes
  `session.resolutionOf(active.id).subdivision` into the select, so what it shows comes from the container and nowhere else, and the
  panel holds no level of its own. An object with no grid has no level to show, so the select is disabled; the options below the
  object's own are disabled too, so the select can only offer that level or a finer one — which is where the Scene group says
  coarsening is not offered. It is not a voxelize setting: it raises the level of a payload that already exists and never rescales a
  model.
- After `refresh()` the displayed active object, tool, representation, resolution, subdivision, colors, parent, name, visibility, and object tree match the current
  `project`/`session` values, and an untouched `FOV (deg)` field shows `project.camera.fov` while an untouched `To (s)` field shows the clip
  length in the clip's seconds, `project.timeline.durationMs / 1000`.
- The panel holds no state beyond its DOM nodes, the per-input touched flags, and the id of the object whose name the `Name` field currently shows.
- The rail holds one button per group plus the `Animation` toggle and nothing else — no heading, no control, no status text — and every group's
  content lives in its window's body alone: nothing is duplicated in the rail, and no second copy of a control exists anywhere.
- The rail's `Edit` button is a view of two pieces of session state, not a third place that stores any: its `disabled` flag follows
  `session.activeObjectId`, and pressing it writes `session.mode = 'edit'` rather than a panel field. It never switches back — the mode bar
  owns that — so pressing it while edit mode is already selected only opens or closes its window.
- The rail's `Animation` button opens no window and owns no state either: `refresh()` writes its `on` class from `context.timelineVisible()` and
  disables it when the context exposes no such function, and its click hands the opposite of that answer to `setTimelineVisible(visible)`. The
  panel never shows or hides the bar itself — the bar is the app's, and this button is only the toggle over its flag.
- A window's controls are the panel's controls wherever the window is: `refresh()` reaches them through the same fields whether or not the window
  is open, and closing a window hides it (`hidden`) without clearing, re-creating, or re-parenting anything, so a reopened window shows the state
  the project and session hold and whatever the user had typed is still there.
- The rail and the windows are the overlay's whole content: the panel owns no status row, no progress row, and no error line, so nothing it
  renders ever sits under the buttons. Every window floats over the viewport with `z-index: 15`, over `#hud` (10) and under the voxelize
  modal (20).
- The overlay swallows no canvas input it does not own: the panel box is `pointer-events: none` with `pointer-events: auto` on its children, so a
  press outside the rail buttons reaches the viewport.
- An object row is a container rather than a button: the name button takes the row's width and truncates, and — on the active row alone — a
  trash button sits at its right end. The trash names the object it deletes, so a delete never depends on which object happens to be active, and
  exactly one row can show a trash at a time, because exactly one object is active.
- Deleting is the app's business: the row's trash calls `deleteObject(id)` and the app clears `session.activeObjectId` when the deleted object was
  the active one. The panel deletes nothing itself and never guesses which object the session holds.
- A row's text is the object's name, its representation, and — for a `uniform` object whose resolution has cells — its size per
  axis in cells after a `·` (`Demo cube · uniform · 4×4×4`), taken from `EditResolution.cells` and the same numbers
  the HUD's resolution row shows. The row reports a size in voxels, never a length in metres, and a resolution without `cells`
  adds nothing to it.
- `Panels` holds no window rectangle and no open flag of its own: each `FloatingWindow` owns its position and visibility, and the only link
  between a window and the rail is the `on` class its `onVisibilityChange` sets.

## Errors
No `Result` and no throwing. `pickImportFile` reports nothing back — a dismissed dialog is the app's business. Import, voxelize, export, and op
failures never reach the panel at all: the app logs them (`reportFailure`). The panel has no voxelize path at all, so
there is no settings error to report and — deliberately — no way for the user to ask for the dialog a second time: a cancelled or regretted
voxelization is re-run by importing the file again, not by re-opening the prompt. That is the requested behaviour, not an oversight. A cleared
or non-numeric `FOV (deg)`
field parses to `NaN` and is forwarded as-is: refusing non-finite input is the app's job, so the panel never validates before forwarding. The `Name`
field is forwarded the same way — trimming it and refusing an empty name belong to the op, so a blank name comes back as a reported failure and the
field re-seeds from the project. The carrier's pose is the one place the panel refuses before forwarding: `writeCameraPose` sends the seven fields
plus the FOV as one pose, and a cleared or non-finite component makes it refresh instead — the fields come back showing what the camera holds — rather
than handing over a partial pose; the app checks what it receives again and refuses a zero-length quaternion.

## Dependencies
- `./dom.js` — `el`, `fmt` for construction and the row's cell counts.
- `./floatingWindow.js` — `FloatingWindow`, the one widget each group's controls are placed in; the panel supplies the title, the staggered
  start position, the `onVisibilityChange` that marks the rail button, and the body's content, and never touches the window's position or
  visibility itself.
- `../document/project.js` — `Project`, `ObjectId` for the object read-out and the reparent target.
- `../editor/session.js` — `EditorSession`, `ActiveTool`; the non-project state the panel reads and writes through its setters, including the
  `editColor` shared with the add and paint tools, the `addHeight` the add tool's drag reads, and `EditResolution` for the cells a row reports and the level the subdivision select shows.
- `../voxels/uniform/grid.js` — `HexColor` for the color inputs and the mask-color action. The panel no longer names `VoxelizeTarget`, so
  `../voxels/voxelize/voxelize.js` is no longer imported here.
- Mask color, the name, visibility, reparenting, the FOV, and the raw-mesh override arrive as `PanelContext` callbacks
  that `main` implements with
  `editor/ops.ts`, `three-runtime/controls.ts`, `three-runtime/scene.ts`, and the project camera; this file imports neither `editor/ops.js` nor anything from `app/`. No
  outer-ring import and no Three.js use. `sceneVisible` is a plain callback, so exposing it costs the app one closure and gives
  the panel no import it did not already have; the world grid's flag and its one action arrive the same way — a `gridVisible` closure and one callback —
  so the panel holds no grid state and imports nothing from `three-runtime` at all; the timeline bar's flag and its toggle arrive the
  same way, a `timelineVisible` closure and `setTimelineVisible`, so the rail's `Animation` button costs the panel no import either;
  the settings themselves are the dialog's, not the
  panel's, which is why neither `defaults` nor a voxelize target crosses this boundary any more, and why the panel holds no voxelize-related member at all.
  The carrier's four actions and its pose write arrive the same way — plain `PanelContext` callbacks that `main` implements over the carrier and the
  project camera, so the carrier costs the panel no import either — and so does the camera path's toggle, `setCameraPathVisible`, which
  `main` implements over the drawing and the app's flag.

## Tests
None. The panel needs a DOM and vitest runs in the node environment, so it is verified by running the app: the panel must show no
voxelize control or setting anywhere — no representation select, voxel size, cell size, root size, or max depth, and no button that would open the
dialog — so importing a GLB must ask for the settings in the modal and nothing in the panel asks again. The rest of the walk: set a mask color, type a name and confirm the object list and the HUD follow it — the row read-out is the object's size in cells, `Demo cube · uniform · 4×4×4` beside the boot cube, not a length in metres — clear the name to see the refusal, untick `Visible` and confirm the
object disappears, click a row and confirm a trash appears at its right end on that row and on no other and that pressing it removes that object
from the list while the HUD stops naming it, reparent an object, press the carrier's `Select` and steer the output camera, type a `FOV` and confirm the output camera
and the next export both take it, tick and untick `Show raw meshes` against the raw meshes of an imported object and confirm they appear over and
disappear behind the voxels — in the same place — without changing what an export renders. The carrier walk is on the same group:
pressing `Select` must put the gizmo on the camera carrier and enable `Camera -> View`, `View -> Camera`, and the mode button, `Camera -> View` must author
the pose the viewport shows into the seven fields, a drag on the carrier must aim the shot and commit one pose into them, typing any of `X`, `Y`, `Z`,
`QX`, `QY`, `QZ`, `QW` must move the shot and re-seed the others, `View -> Camera` must move the viewport to the authored shot and change no field,
the mode button must read `-> Move` after a press and keep the carrier selected, `Deselect` must hand the gizmo back to the active object, and the carrier
must be drawn from the first frame and hidden only while a run previews the shot, because the preview renders the viewport through the output camera
and a camera cannot see itself. The path box is on the same group: with two camera keyframes it must be enabled, and ticking it must
draw the white polyline through the trajectory with one ring per keyframe and unticking it must take the drawing away, while with fewer than two
camera keyframes it must be disabled and unchecked and nothing must be drawn; a run must hide the path along with the rest of the
viewport decoration, and an export must contain no part of it. A run changes no panel control: pressing play must take the viewport with the clip,
pausing must stop the transport and leave the viewport on the frame the clip stopped at, and a non-looping run that reaches its end must stop the
transport, put the playhead back to the run's start value, and return the view to the one the run started from.

The rail and window walk is the same run: the overlay must show exactly the seven group buttons `Import`, `Edit`, `Camera`, `Render`, `Scene`, `Grid`, `Project`
plus the `Animation` toggle, and no
group control at all until one is pressed; with nothing selected `Edit` must be disabled and unpressable, and pressing it with an object selected must open one window
titled `Edit` holding that group's controls, mark the button `on`, and put the session in edit mode — the viewport mode switch must
follow, and the gizmo must be gone; dragging the window's title bar must move it and leave it under the pointer; `×` must close it and clear the button; opening `Edit` and
`Scene` together must show two windows at different positions, and pressing one must put it above the other; pressing `Grid` must open a window holding one
`World grid` checkbox, and unticking it must take the grid out of the viewport and ticking it must bring it back; pressing `Animation` must show the timeline bar along the bottom of the page and mark the button
`on`, and pressing it again must hide the bar — leaving the keyframes it held intact when it is shown again — with the canvas' box and its drawing
buffer still in step; a drag far past an edge must park
the window against it with its title bar still reachable; a press below the rail must reach the viewport rather than the overlay; a second import
must still open the voxelize modal over every window with its fields and `Voxelize` working; and the overlay must hold the seven group buttons, the
`Animation` toggle, and the open windows and nothing else — no progress row, no message row, no error line — however many windows are open.
