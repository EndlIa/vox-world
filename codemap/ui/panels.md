# src/ui/panels.ts

Ring: 4 · Layer: ui · Depends on: ./dom.js, ./floatingWindow.js, ../document/project.js, ../editor/session.js, ../voxels/uniform/grid.js

## Responsibility
The main control panel: import, edit, camera, export, and grid-display controls plus the project and session read-out. It renders state and forwards intent through
`PanelContext.actions`; it never mutates the project, never calls `editor/ops.ts`, and never imports `app/` — the composition root depends on `ui/`,
not the reverse. The voxelization settings are not here and neither is any way to reach them: they live in the `ui/voxelizeDialog.ts` modal (README
D26), which the app opens after a successful import, so no representation, voxel size, cell size, root size, or max depth is reachable from the panel
at all.

The panel is an overlay on the canvas, not a reserved column: it is anchored to the top-left of the window at
`width: 112px` and takes no space from the viewport, which keeps the whole window width. It is a rail of group
buttons — `Import`, `Edit`, `Camera`, `Render`, `Scene`, `Grid`, in that order, full width — with the `Animation`
toggle at its foot, and behind each group button that group's controls in a floating window
(`./floatingWindow.ts`): no group is expanded
until its button is pressed, several windows can be open at once, each is moved by dragging its title bar, and
each is closed by its `×` or by its button again. A button carries the existing `on` class for exactly as long
as its window is open, and two buttons do more than open a window: `Edit` also selects the edit mode
its tools belong to (README D39), and it is disabled while no object is active, because that mode edits one object's
voxels and there is nothing to edit until one is chosen; and `Animation` opens no window at all — it shows and hides
the timeline bar along the bottom of the page, and carries `on` while that bar is on screen (README D44). Everything that is *about the camera* lives in
the `Camera` group — the lock that points the viewport at it, the carrier that aims it, and its projection — while the keyframes stay in the timeline
bar, because they are animation (README D44, D46). The rail is
the whole overlay: the panel keeps no other row, and it has no message area of its
own — a job's progress and an operation's failure are not its business (README D38).

## Public interface
```ts
type CameraPose = {                 // one authored camera pose: the carrier's fields, and what a numeric field writes back
  position: [number, number, number];
  quaternion: [number, number, number, number];
  fov: number;
};
type CameraControlView = {          // what the carrier's controls read (README D46)
  selected: boolean;                // whether the gizmo currently drives the carrier
  mode: 'translate' | 'rotate';     // the gizmo's mode, shared with objects
  follow: boolean;                  // whether a run takes the viewport with it; the option applies to the next run (README D48)
  playing: boolean;                 // whether a run is in flight, which is when the follow option waits
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
    setGridVisible(visible: boolean): void;    // shows or hides the viewport's one world grid (README D35)
    setTimelineVisible(visible: boolean): void;     // shows or hides the timeline bar; the app owns the flag
    renameActive(name: string): void;           // renames the active object; the app trims and refuses ''
    reparentActive(parentId: ObjectId | null): void;
    setCameraFov(fov: number): void;         // authors the output camera's vertical FOV
    setCameraPose(pose: CameraPose): void;   // writes the whole authored pose; the app refuses a bad component
    toggleCameraControl(): void;             // selects or deselects the carrier (README D46)
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
1. The constructor builds every control once through `el` and places each group's controls in that group's own window: the
   import group (an import button, a dim line saying a `.glb` can be dropped on the viewport, and a `Show raw meshes`
   checkbox), the edit group (a `row` of the four `ActiveTool` tool buttons the `edit` mode uses, the `detachButton` in a `row` of its own directly under them — a plain button that is never a tool: its click is `context.actions.detachSelection()` and nothing else, no click writes a tool, and `refresh()` never gives it the `on` class — then the `Select` field — the shapes a press can select, `box` alone so far — and the `Color` field), the camera group (the the carrier's controls checkbox with a dim line saying what it does, the the carrier's controls checkbox directly after that hint and ahead of the `hr`, then a `row` of the carrier's `Select`/`Deselect` and mode buttons, a `row` of `Camera -> View` and `View -> Camera`, the `Show camera path` checkbox, a `row` of `X`, `Y`, and `Z` fields, a `row` of `QX`, `QY`, `QZ`, and `QW` fields, and the `FOV (deg)` number input), the export group shown as `Render` (a
   resolution select, fps, `from`, and `to` inputs, a beauty/mask mode select, and its `Render MP4` button), and the objects group
   shown as `Scene`, which is two halves in one window: above a plain `hr`, the `Create group` button and the object list — the
   part that chooses among every object — and below it the active object's `Mask color`, `Parent`, `Name`, `Visible`, `Grid align`, and `Subdivision` fields,
   the part that acts on the one the list selected. The `Grid align` checkbox is built beside `visibleInput`: it is `disabled` while
   nothing is active and its `change` event forwards `checked` through `setActiveAlignToGrid`. The `Subdivision` select is built beside
   `alignToGridInput` from the module constant `SUBDIVISIONS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512]` — one `option` per level, the
   number as both its value and its label, powers of two because a cell has to stay an exact binary fraction of the world unit and
   because the list is the UI's range rather than a rule of the grid (README D43) — and its `change` event forwards
   `Number(value)` through `setActiveSubdivision`. That divider is the group's only use of the
   stylesheet's `hr` rule. The `Grid` group is the rail's last one and holds one control, the viewport's `World grid` checkbox
   (README D35): its `change` event forwards `checked` through `setGridVisible(visible)` and nothing else, so the panel never touches
   the grid, the scene, or a mesh. There is no voxelize group: the settings live in `ui/voxelizeDialog.ts` (README D26).
2. Each group is one rail button plus one window, built together in the group order `Import`, `Edit`, `Camera`, `Render`,
   `Scene`, `Grid`: the button carries the group's name and toggles its window (the `Edit` one also calls `session.setMode('edit')` through the
   optional press hook `group()` takes, before it toggles), and the window is a `FloatingWindow`
   (`./floatingWindow.ts`) whose `body` is the group's content container — the group's controls are appended to
   `window.body` and are not copied, re-created, or re-parented anywhere else. A window opens at `128 + 28 · index` px left
   and `8 + 28 · index` px top, one step per group, so two windows opened at once never sit exactly on top of each other; it
   is moved by its title bar, closed by its `×`, and its `onVisibilityChange` puts the `on` class on its button for exactly
   as long as the window is open. The rail and the six windows go into `root`, and nothing else: `index.html` gives the rail
   `order: -1`, so it is the overlay's first row whatever order the nodes arrived in. One more button follows the six groups, `Animation`: the
   rail's one entry that opens no window, since the timeline is a bar along the bottom of the page rather than a group. It is built without an
   `index` — which is why adding it left the six group windows at the staggered positions they had — and its click is a plain toggle over the app's
   flag: it reads `context.timelineVisible()`, hands the opposite to `setTimelineVisible(visible)`, and puts its own `on` class in step, because no
   window's visibility can mark it. The panel appends nothing else to the element it is handed, and since D38 there is nothing else to append;
   `index.html`'s `#viewport { min-height: 0 }` is what keeps the canvas' row from flooring the column — a canvas carries an intrinsic size taken
   from its drawing-buffer attributes, and a grid item's automatic minimum would size that row with it, pushing the `auto` timeline row below past
   the bottom of the `100vh` column, where `body { overflow: hidden }` clipped it away, which is what hid the bar from the user (README D44). It
   ends with `refresh()`, and its listeners come from
   `on` and live for the page lifetime — there is no `dispose`.
3. The `Scene` group is the one group whose window holds a divider: `el('hr')` between the object list and the
   active object's fields, which the stylesheet draws as a `--line` rule across the body. Nothing else in the panel
   uses one, and no group's controls are split by anything but their own order.
4. A window's visibility and position are the window's own: `Panels` keeps no open flag, no rectangle, and no window list.
   Closing a window only sets `hidden`, so the group's nodes stay where they are, whatever the user typed survives, and a
   reopened window shows the current state.
5. `refresh()` re-reads `project` and `session` and rewrites text, `value`, and `disabled` state: object rows from `project.roots()` and
   `childrenOf()` with `session.activeObjectId` marked and its row carrying the trash button that deletes it, representation from `object.representation`, resolution from `session.resolutionOf(id)`,
   pressed state from `session.activeTool`, and `disabled` in the tool area for `detachButton` alone — `disabled` exactly while `session.selection.kind === 'none'`, because the region it commands is the one the `Select` tool already chose, so with no selection there is nothing for it to detach, while the tool buttons are never disabled — as well as for the rail's `Edit` button, which needs an active object for the mode it selects; the `Select` field from `session.selectionShape`, colors from `session.editColor` and `object.maskColor`, the parent
   select from `object.parentId`, and the `Subdivision` select from that same resolution: `refresh()` writes
   `resolution.subdivision` into it and disables the select whenever the resolution carries none, because an object with no uniform
   grid has no cell to subdivide, and it disables every option below the level the object holds, so the select can only offer that
   level or a finer one — that is what says coarsening is not offered. Calling it
   twice produces the same DOM. A row's button text is `name · representation` plus the resolution suffix: for a `uniform` object
   whose `EditResolution` carries `cells`, ` · <x>×<y>×<z>` — the object's occupied size per axis in cells, each rendered with
   `fmt(count, 0)` — and nothing otherwise, so an `'empty'` object and one whose resolution reports no cells both read bare
   representation. One cell is one world unit (README D41), so the suffix is a size in voxels, never a length in metres.
6. The camera group's `FOV (deg)` field is seeded from `project.camera.fov`, with a flag of its own. The
   `Scene` group's `Name` field is seeded from `object.name` with a flag of its own, set by its `input` event; because its seed depends on the selection,
   `refresh()` clears that flag whenever the active object is not the one the field is showing, so a re-selection always re-seeds instead of leaving
   the previous object's text behind, and it is emptied while nothing is active.
7. The only direct writes are `session` setters driven by user input: object rows call `session.setActiveObject(id)`, tool buttons call
   `session.setTool(tool)`, the `Select` field calls `session.setSelectionShape(shape)` once its value is matched back against the shape list, and the `Color` field calls `session.setEditColor(hex)` with `parseInt(value.slice(1,
   16)`. The `detach` button writes no session state at all: its click is `context.actions.detachSelection()` and nothing else, because that
   button is a command on the region the `Select` tool already chose rather than a tool choice (README D19, D23), so pressing it runs the
   operation and leaves no mode behind. No `project` mutator and no `editor/ops.ts` function is called here.
8. Project-changing intent leaves as callbacks: `pickImportFile()`, `exportMp4(options)`, `createGroup()`,
   `deleteObject(id)` from a row's trash, `setActiveMaskColor(hex)`, `setActiveVisible(checked)` from the visibility checkbox,
   `setActiveAlignToGrid(checked)` from the grid-align checkbox, `setActiveSubdivision(level)` from the subdivision select,
   `setGridVisible(checked)` from the `World grid` checkbox, `detachSelection()` from the `detach` button,
   `renameActive(value)` from the `Name` field,
   `reparentActive(parentId | null)` from the parent select — the panel forwards the control's own state and
   never tracks the lock itself, so the app stays the only owner of the flag — the carrier's four actions and its pose write
   (`toggleCameraControl()`, `toggleGizmoMode()`, `cameraToView()`, `viewToCamera()`, and `setCameraPose(pose)`), the camera path's toggle,
   and `setCameraPathVisible(checked)` from the `Show camera path` box, both of which leave as the same kind of callback (README D46, D47).
   `Visible` checkbox is document state: `refresh()` writes `object.visible` back into it, so it always shows what the project holds, and the
   `Grid align` checkbox is document state the same way (`refresh()` writes `active.alignToGrid` back into it). The `Name` field
   forwards on its `change` event only — never per keystroke — so a half-typed name cannot reach the document, and until the user types it displays the
   name the project holds. Each control is enabled
   only when the app could act on it — mask color, name, visibility, grid alignment, and reparent need an active object, subdivision
   needs an active object whose grid reports a level, and the `detach`
   button needs a selection, since it is a command on the selected region. The `Grid` group's three controls need no active object — they act
   on the viewport rather than on the document — and only the `Display` select is never disabled: the axis and the offset are `disabled`
   unless the display on screen is `multi`, because the ground and the work cube are fixed, so those two fields would pretend to do
   something (README D49). The `FOV (deg)` input
   forwards `parseFloat` of its value through `setCameraFov(fov)` on every `input` event, so the authored projection follows the field; the app
   validates and clamps what it receives.
9. `Show raw meshes` is the raw-versus-voxel toggle (README D24): its `change` event forwards `checked` through `setSourceVisible(enabled)` and nothing else, so the panel never touches the mirror, the scene, or a mesh. It is seeded from `context.sceneVisible()` when the context exposes that function — the app does, with `SceneMirror.sourceVisible` — and left untouched by `refresh()` when it does not, in which case the checkbox is a plain forward-only control and the app remains the only thing that knows whether the raw meshes are shown. `refresh()` therefore never invents a state for it. The `Grid` group follows the same rule through `context.gridSettings()`, which is the
   same kind of view of the viewport's own settings: when the app exposes that function `refresh()` writes `settings.mode` into the `Display`
   select, `settings.axis` into the `Plane axis` select, and `settings.offset` into the number field — the offset only while `touched.gridOffset`
   is unset, because its `change` event is what commits it — and it then derives the gating from that same answer:
   `gridAxisSelect.disabled` and `gridOffsetInput.disabled` are both `mode !== 'multi'`, so the two fields wait while the fixed ground or the
   work cube is on screen. With no such function the three controls are plain forward-only controls that `refresh()` leaves alone, and the two
   gated fields are disabled, since a settings source is also what tells the panel a movable plane exists. Either way the panel holds no grid
   display, no axis, and no offset of its own: `refresh()` only reads them back from the app. The
   rail's `Animation` button is seeded the same way through `context.timelineVisible()`: with that function `refresh()` writes the answer into the
   button's `on` class and the click hands the opposite back through `setTimelineVisible(visible)`, so the bar's flag stays the app's; with no such
   function the button is `disabled`, since a toggle with no flag behind it could not show anything (README D44).
10. The `Camera` group's carrier controls (README D46) are one carrier over one piece of app state: `Select`/`Deselect`, the mode button, `Camera -> View`, `View -> Camera`, and the seven `X`, `Y`, `Z`, `QX`, `QY`, `QZ`, `QW` number inputs, built in that order after the lock's `hr` and ahead of the `FOV (deg)` field. Each is a plain forward — the buttons call `toggleCameraControl`, `toggleGizmoMode`, `cameraToView`, and `viewToCamera`, and any field's `change` event calls `writeCameraPose()`, which sends the whole pose, the seven values plus the FOV field, because the fields are one state and a change to any component is a change to it. A non-finite component or a cleared field is refused by refreshing, so the fields come back showing what the camera actually holds instead of a half-written pose. With `context.cameraControl()` present, `refresh()` seeds the seven fields from the authored pose (`fmt(value, 4)`, skipping whichever field is focused, like the other view fields), writes `locked` into the lock checkbox and swaps the two button labels — `Deselect`/`Select`, and the mode button's text names the mode a press would move *to*, so a `rotate` carrier reads `-> Move` — and gates them: with no provider, or with the lock on, the select, the mode, `Camera -> View`, and `View -> Camera` are all `disabled`, because a viewport that already *is* the output camera has nothing left for the carrier to aim; the mode button is disabled too while the carrier is not selected, since a mode with nothing to move is no choice. The `Show camera path` box is seeded from the same provider — `checked` is `pathAvailable && pathVisible`, and it is `disabled` while `!pathAvailable` — because a path needs two keyframes to exist at all, so a below-two track leaves the box unchecked as well as disabled (README D47). The seven fields and the `FOV (deg)` field are never disabled: they author the camera whether or not the carrier is selected.
11. Export: the export button reads the resolution select (`960x540`, `1280x720`, `1920x1080`; the middle one is selected by default), the fps input,
   the `from` and `to` inputs, and the mode select (`beauty | mask`, where `mask` is the per-object identity-color render), and calls
   `actions.exportMp4(options)` with width and height rounded to even numbers, because H.264 and AV1 reject odd dimensions in some players and every
   encoder configuration is cleaner with them. The panel builds no `ExportRequest`: it forwards the numbers it displays. The fps, `from`, and `to`
   inputs are seeded on every `refresh()` — from `project.timeline.fps`, `0`, and `project.timeline.durationMs / 1000` — but only while untouched, each carrying
   its own flag set by its `input` event, so a re-render never overwrites a range the user typed. The division is the one place this panel meets the
   unit boundary: the export range is seconds, because the export job and the compiled clip are, while the clip is authored in milliseconds
   (README D45), and the field's label `To (s)` says which of the two it shows.

## Invariants
- The panel calls no `Project` mutator and no `editor/ops.ts` operation: after any interaction the project is exactly what the app left it; its only
  direct mutations are `EditorSession` setters driven by user input (`setActiveObject`, `setTool`, `setEditColor`).
- No voxelize setting is reachable from the panel, and neither is the dialog (README D26): it has no representation, voxel size, cell size, root size,
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
  work on (README D19, D23).
- The camera-lock checkbox forwards `checked` and nothing else: the panel never touches `ViewportControls`, the mirror, or any camera, and the app owns the flag. With `context.cameraControl()` present it is a view of that flag — `refresh()` writes `cameraControl.locked` into it — and with no such provider it stays forward-only and `refresh()` leaves it alone.
- The carrier's controls are a view of the app's own state and never a second copy of it: `refresh()` seeds the seven pose fields, the lock box, and the two button labels from `context.cameraControl()`, so what the fields show is what the app would record in a keyframe (README D46). The panel keeps no pose, no selection, and no mode of its own, and the four buttons are gated rather than tracked — `disabled` with no provider or with the lock on, and the mode button also while the carrier is not selected. The `Show camera path` box is seeded from the same view — `checked = pathAvailable && pathVisible`, `disabled = !pathAvailable` — so it can never show a drawn path below two keyframes and the panel holds no visibility flag of its own (README D47). The the carrier's controls box is seeded from the same view too — `checked = follow`, `disabled = playing` — because the option is read when a run starts rather than changing a run in flight, and the app owns the flag either way (README D48).
- `Show raw meshes` forwards `checked` and nothing else, and is the panel's only view of the raw-mesh override while `context.sceneVisible()` exists:
  it then displays that value on every `refresh()` and holds no copy of its own, so the mirror and the checkbox cannot disagree. With no `sceneVisible()`
  in the context the checkbox is forward-only and `refresh()` leaves it alone — the panel then displays the user's last click, and the app is the only
  thing that knows the real state. Either way no mesh, scene, layer, or mirror is touched here.
- The `Grid` group's one control is the viewport's own flag, not document state (README D35): while `context.gridVisible()` exists, `refresh()` writes
  it back into the checkbox, so the panel invents no state of its own and holds none, and it needs no active object. With no `gridVisible()` in the
  context the checkbox is forward-only and `refresh()` never rewrites it, exactly like `Show raw meshes` without `sceneVisible()` — the panel then shows
  the user's last click and the app is the only thing that knows the real state.
- The `FOV (deg)` input is the panel's view of the output camera's projection — the seven carrier fields are the pose half of the same view (README D46): it displays `project.camera.fov` while untouched, forwards the parsed number, and keeps no camera, no lock state, and no clamped copy of its own.
- The `Visible` checkbox is a view of `object.visible` and the `Name` field a view of `object.name`: neither holds document state, neither writes
  anything itself, and both are `disabled` while nothing is active. The `Name` field forwards only on `change`, so no keystroke of a name half-typed
  can reach the app, and a rejected rename simply re-seeds it from the project on the next `refresh()`.
- The Scene window's active-object fields describe the active object, and the `Grid align` checkbox is one of them (README D42): `refresh()` writes
  `active.alignToGrid` back into it and disables it while nothing is active, so it is not forward-only — it always shows the object the list selected.
- `Subdivision` is a view of the active object's own grid level and never a second copy of it: `refresh()` writes
  `session.resolutionOf(active.id).subdivision` into the select, so what it shows comes from the container and nowhere else, and the
  panel holds no level of its own. An object with no grid has no level to show, so the select is disabled; the options below the
  object's own are disabled too, so the select can only offer that level or a finer one — which is where the Scene group says
  coarsening is not offered. It is not a voxelize setting: it raises the level of a payload that already exists and never rescales a
  model.
- After `refresh()` the displayed active object, tool, representation, resolution, subdivision, colors, parent, name, visibility, and object tree match the current
  `project`/`session` values, and an untouched `FOV (deg)` field shows `project.camera.fov` while an untouched `To (s)` field shows the clip
  length in the clip's seconds, `project.timeline.durationMs / 1000` (README D45).
- The panel holds no state beyond its DOM nodes, the per-input touched flags, and the id of the object whose name the `Name` field currently shows.
- The rail holds one button per group plus the `Animation` toggle and nothing else — no heading, no control, no status text — and every group's
  content lives in its window's body alone: nothing is duplicated in the rail, and no second copy of a control exists anywhere.
- The rail's `Edit` button is a view of two pieces of session state, not a third place that stores any: its `disabled` flag follows
  `session.activeObjectId`, and pressing it writes `session.mode = 'edit'` rather than a panel field. It never switches back — the mode bar
  owns that (README D39) — so pressing it while edit mode is already selected only opens or closes its window.
- The rail's `Animation` button opens no window and owns no state either: `refresh()` writes its `on` class from `context.timelineVisible()` and
  disables it when the context exposes no such function, and its click hands the opposite of that answer to `setTimelineVisible(visible)`. The
  panel never shows or hides the bar itself — the bar is the app's, and this button is only the toggle over its flag (README D44).
- A window's controls are the panel's controls wherever the window is: `refresh()` reaches them through the same fields whether or not the window
  is open, and closing a window hides it (`hidden`) without clearing, re-creating, or re-parenting anything, so a reopened window shows the state
  the project and session hold and whatever the user had typed is still there.
- The rail and the windows are the overlay's whole content: the panel owns no status row, no progress row, and no error line, so nothing it
  renders ever sits under the buttons (D38). Every window floats over the viewport with `z-index: 15`, over `#hud` (10) and under the voxelize
  modal (20).
- The overlay swallows no canvas input it does not own: the panel box is `pointer-events: none` with `pointer-events: auto` on its children, so a
  press outside the rail buttons reaches the viewport.
- An object row is a container rather than a button: the name button takes the row's width and truncates, and — on the active row alone — a
  trash button sits at its right end. The trash names the object it deletes, so a delete never depends on which object happens to be active, and
  exactly one row can show a trash at a time, because exactly one object is active.
- Deleting is the app's business: the row's trash calls `deleteObject(id)` and the app clears `session.activeObjectId` when the deleted object was
  the active one. The panel deletes nothing itself and never guesses which object the session holds.
- A row's text is the object's name, its representation, and — for a `uniform` object whose resolution has cells — its size per
  axis in cells after a `·` (`Demo cube · uniform · 4×4×4`), taken from `EditResolution.cells` (README D41) and the same numbers
  the HUD's resolution row shows. The row reports a size in voxels, never a length in metres, and a resolution without `cells`
  adds nothing to it.
- `Panels` holds no window rectangle and no open flag of its own: each `FloatingWindow` owns its position and visibility, and the only link
  between a window and the rail is the `on` class its `onVisibilityChange` sets.

## Errors
No `Result` and no throwing. `pickImportFile` reports nothing back — a dismissed dialog is the app's business. Import, voxelize, export, and op
failures never reach the panel at all: the app logs them (`reportFailure`, D38). The panel has no voxelize path at all, so
there is no settings error to report and — deliberately — no way for the user to ask for the dialog a second time: a cancelled or regretted
voxelization is re-run by importing the file again, not by re-opening the prompt. That is the requested behaviour, not an oversight. A cleared
or non-numeric `FOV (deg)`
field parses to `NaN` and is forwarded as-is: refusing non-finite input is the app's job, so the panel never validates before forwarding. The `Name`
field is forwarded the same way — trimming it and refusing an empty name belong to the op, so a blank name comes back as a reported failure and the
field re-seeds from the project. The carrier's pose is the one place the panel refuses before forwarding: `writeCameraPose` sends the seven fields
plus the FOV as one pose, and a cleared or non-finite component makes it refresh instead — the fields come back showing what the camera holds — rather
than handing over a partial pose; the app checks what it receives again and refuses a zero-length quaternion (README D46). The `Plane offset (cells)` field is
forwarded as it reads, a fraction included, and the app drops what is not a whole number and refreshes the panel, so the panel validates nothing and the grid
never sees a value it would refuse (README D49).

## Dependencies
- `./dom.js` — `el`, `fmt` for construction and the row's cell counts.
- `./floatingWindow.js` — `FloatingWindow`, the one widget each group's controls are placed in; the panel supplies the title, the staggered
  start position, the `onVisibilityChange` that marks the rail button, and the body's content, and never touches the window's position or
  visibility itself.
- `../document/project.js` — `Project`, `ObjectId` for the object read-out and the reparent target.
- `../editor/session.js` — `EditorSession`, `ActiveTool`; the non-project state the panel reads and writes through its setters, including the
  `editColor` shared with the add and paint tools, and `EditResolution` for the cells a row reports (README D41) and the level the subdivision select shows.
- `../voxels/uniform/grid.js` — `HexColor` for the color inputs and the mask-color action. The panel no longer names `VoxelizeTarget`, so
  `../voxels/voxelize/voxelize.js` is no longer imported here.
- Mask color, the name, visibility, reparenting, the FOV, and the raw-mesh override arrive as `PanelContext` callbacks
  that `main` implements with
  `editor/ops.ts`, `three-runtime/controls.ts`, `three-runtime/scene.ts`, and the project camera; this file imports neither `editor/ops.js` nor anything from `app/`. No
  outer-ring import and no Three.js use. `sceneVisible` is a plain callback, so exposing it costs the app one closure and gives
  the panel no import it did not already have; the world grid's flag and its one action arrive the same way — a `gridVisible` closure and one callback —
  so the panel holds no grid state and imports nothing from `three-runtime` at all (README D35); the timeline bar's flag and its toggle arrive the
  same way, a `timelineVisible` closure and `setTimelineVisible`, so the rail's `Animation` button costs the panel no import either (README D44);
  the settings themselves are the dialog's, not the
  panel's, which is why neither `defaults` nor a voxelize target crosses this boundary any more, and why the panel holds no voxelize-related member at all.
  The carrier's four actions and its pose write arrive the same way — plain `PanelContext` callbacks that `main` implements over the carrier and the
  project camera, so the carrier costs the panel no import either (README D46) — and so does the camera path's toggle, `setCameraPathVisible`, which
  `main` implements over the drawing and the app's flag (README D47), and
  own flag and the transport it drives (README D48).

## Tests
None. The panel needs a DOM and vitest runs in the node environment, so it is verified by running the app (README section 10): the panel must show no
voxelize control or setting anywhere — no representation select, voxel size, cell size, root size, or max depth, and no button that would open the
dialog — so importing a GLB must ask for the settings in the modal and nothing in the panel asks again. The rest of the walk: set a mask color, type a name and confirm the object list and the HUD follow it — the row read-out is the object's size in cells, `Demo cube · uniform · 4×4×4` beside the boot cube, not a length in metres (README D41) — clear the name to see the refusal, untick `Visible` and confirm the
object disappears, click a row and confirm a trash appears at its right end on that row and on no other and that pressing it removes that object
from the list while the HUD stops naming it, reparent an object, tick the carrier's controls and steer the output camera, type a `FOV` and confirm the locked
view and the export follow it, tick and untick `Show raw meshes` against the raw meshes of an imported object and confirm they appear over and
disappear behind the voxels — in the same place — without changing what an export renders. The carrier walk is on the same group (README D46): with the lock off,
pressing `Select` must put the gizmo on the camera carrier and enable `Camera -> View`, `View -> Camera`, and the mode button, `Camera -> View` must author
the pose the viewport shows into the seven fields, a drag on the carrier must aim the shot and commit one pose into them, typing any of `X`, `Y`, `Z`,
`QX`, `QY`, `QZ`, `QW` must move the shot and re-seed the others, `View -> Camera` must move the viewport to the authored shot and change no field,
the mode button must read `-> Move` after a press and keep the carrier selected, `Deselect` must hand the gizmo back to the active object, and ticking
the carrier's controls must disable all four carrier buttons and leave the carrier off the screen, because the viewport then *is* the output camera
and a camera cannot see itself. The path box is on the same group (README D47): with two camera keyframes it must be enabled, and ticking it must
draw the white polyline through the trajectory with one ring per keyframe and unticking it must take the drawing away, while with fewer than two
camera keyframes it must be disabled and unchecked and nothing must be drawn; ticking the carrier's controls must hide the path along with the
carrier, and an export must contain no part of it. The follow option is on the same group (README D48): with follow on — its default — pressing play must take the viewport with the clip and disable the box for the length of the run, pausing must stop the transport, release the lock, and leave the viewport on the frame the clip stopped at, and letting a non-looping run reach its end must stop the transport, put the playhead back to the run's start value, and return the view to the one the run started from; with follow off, the box must be enabled again on the next run and a run must leave the editor camera where it was — the transport's own overlay is the only change — while the carrier shows the camera moving along the clip.

The rail and window walk is the same run: the overlay must show exactly the six group buttons `Import`, `Edit`, `Camera`, `Render`, `Scene`, `Grid`
plus the `Animation` toggle, and no
group control at all until one is pressed; with nothing selected `Edit` must be disabled and unpressable, and pressing it with an object selected must open one window
titled `Edit` holding that group's controls, mark the button `on`, and put the session in edit mode — the viewport mode switch must
follow, and the gizmo must be gone; dragging the window's title bar must move it and leave it under the pointer; `×` must close it and clear the button; opening `Edit` and
`Scene` together must show two windows at different positions, and pressing one must put it above the other; pressing `Grid` must open a window holding `Display`,
`Plane axis`, and `Plane offset (cells)`, and choosing `Volume` must put the work cube's ground and its two walls into the viewport in place of the single floor plane, while
choosing `Floor` again must take the walls away; the axis and the offset must be disabled under every display but `Multi plane`, and with `Multi plane` chosen an axis
press and a committed offset in cells must move that one plane onto the axis and to the offset while the fixed displays stay where they were (README D49); pressing `Animation` must show the timeline bar along the bottom of the page and mark the button
`on`, and pressing it again must hide the bar — leaving the keyframes it held intact when it is shown again — with the canvas' box and its drawing
buffer still in step (README D44); a drag far past an edge must park
the window against it with its title bar still reachable; a press below the rail must reach the viewport rather than the overlay; a second import
must still open the voxelize modal over every window with its fields and `Voxelize` working; and the overlay must hold the six group buttons, the
`Animation` toggle, and the open windows and nothing else — no progress row, no message row, no error line — however many windows are open (D38).
