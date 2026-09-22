# src/ui/panels.ts

Ring: 4 · Layer: ui · Depends on: ./dom.js, ./floatingWindow.js, ../document/project.js, ../editor/session.js, ../voxels/uniform/grid.js

## Responsibility
The main control panel: import, edit, camera, and export controls plus the project and session read-out. It renders state and forwards intent through
`PanelContext.actions`; it never mutates the project, never calls `editor/ops.ts`, and never imports `app/` — the composition root depends on `ui/`,
not the reverse. The voxelization settings are not here and neither is any way to reach them: they live in the `ui/voxelizeDialog.ts` modal (README
D26), which the app opens after a successful import, so no representation, voxel size, cell size, root size, or max depth is reachable from the panel
at all.

The panel is an overlay on the canvas, not a reserved column: it is anchored to the top-left of the window at
`width: 112px` and takes no space from the viewport, which keeps the whole window width. It is a rail of group
buttons — `Import`, `Edit`, `Camera`, `Render`, `Scene`, in that order, full width, and nothing else — and
behind each button that group's controls in a floating window (`./floatingWindow.ts`): no group is expanded
until its button is pressed, several windows can be open at once, each is moved by dragging its title bar, and
each is closed by its `×` or by its button again. A button carries the existing `on` class for exactly as long
as its window is open, and `Edit` is the one button that does more than open its window: it also selects the edit mode
its tools belong to (README D39), and it is disabled while no object is active, because that mode edits one object's
voxels and there is nothing to edit until one is chosen. The rail is the whole overlay: the panel keeps no other row, and it has no message area of its
own — a job's progress and an operation's failure are not its business (README D38).

## Public interface
```ts
type PanelContext = {
  project: Project; session: EditorSession;
  sceneVisible?(): boolean;    // the app's raw-mesh override; absent => forward-only checkbox
  actions: {
    pickImportFile(): void;      // opens the file dialog from app/files.ts; ui never imports app
    exportMp4(options: { width: number; height: number; fps: number; from: number; to: number;
      mode: 'beauty' | 'mask' }): void;
    createGroup(): void;
    deleteObject(objectId: ObjectId): void;   // deletes that object; clears the session when it was active
    setActiveMaskColor(color: HexColor): void;
    setActiveVisible(visible: boolean): void;   // shows or hides the active object
    setActiveAlignToGrid(alignToGrid: boolean): void;   // turns the active object's grid alignment on or off
    detachSelection(): void;   // detaches the region the session selected; the app runs it through the pointer tool
    setSourceVisible(enabled: boolean): void;   // shows or hides every imported raw mesh
    renameActive(name: string): void;           // renames the active object; the app trims and refuses ''
    reparentActive(parentId: ObjectId | null): void;
    setCameraLock(enabled: boolean): void;   // hands viewport navigation to the output camera
    setCameraFov(fov: number): void;         // authors the output camera's vertical FOV
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
   checkbox), the edit group (a `row` of the four `ActiveTool` tool buttons the `edit` mode uses, the `detachButton` in a `row` of its own directly under them — a plain button that is never a tool: its click is `context.actions.detachSelection()` and nothing else, no click writes a tool, and `refresh()` never gives it the `on` class — then the `Select` field — the shapes a press can select, `box` alone so far — and the `Color` field), the camera group (one
   `Camera lock (output)` checkbox with a dim line saying what it does, and a `FOV (deg)` number input), the export group shown as `Render` (a
   resolution select, fps, `from`, and `to` inputs, a beauty/mask mode select, and its `Render MP4` button), and the objects group
   shown as `Scene`, which is two halves in one window: above a plain `hr`, the `Create group` button and the object list — the
   part that chooses among every object — and below it the active object's `Mask color`, `Parent`, `Name`, `Visible`, and `Grid align` fields,
   the part that acts on the one the list selected. The `Grid align` checkbox is built beside `visibleInput`: it is `disabled` while
   nothing is active and its `change` event forwards `checked` through `setActiveAlignToGrid`. That divider is the group's only use of the
   stylesheet's `hr` rule. There is no voxelize group: the settings live in `ui/voxelizeDialog.ts` (README D26).
2. Each group is one rail button plus one window, built together in the group order `Import`, `Edit`, `Camera`, `Render`,
   `Scene`: the button carries the group's name and toggles its window (the `Edit` one also calls `session.setMode('edit')` through the
   optional press hook `group()` takes, before it toggles), and the window is a `FloatingWindow`
   (`./floatingWindow.ts`) whose `body` is the group's content container — the group's controls are appended to
   `window.body` and are not copied, re-created, or re-parented anywhere else. A window opens at `128 + 28 · index` px left
   and `8 + 28 · index` px top, one step per group, so two windows opened at once never sit exactly on top of each other; it
   is moved by its title bar, closed by its `×`, and its `onVisibilityChange` puts the `on` class on its button for exactly
   as long as the window is open. The rail and the six windows go into `root`, and nothing else: `index.html` gives the rail
   `order: -1`, so it is the overlay's first row whatever order the nodes arrived in. The panel appends nothing else to the
   element it is handed, and since D38 there is nothing else to append. It ends with `refresh()`, and its listeners come from
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
   select from `object.parentId`. Calling it
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
   `setActiveAlignToGrid(checked)` from the grid-align checkbox, `detachSelection()` from the `detach` button,
   `renameActive(value)` from the `Name` field,
   `reparentActive(parentId | null)` from the parent select, and `setCameraLock(checked)` from the camera-lock checkbox — the panel forwards the checkbox's own state and
   never tracks the lock itself, so `refresh()` leaves that checkbox alone and the app stays the only owner of the flag. Unlike the camera lock, the
   `Visible` checkbox is document state: `refresh()` writes `object.visible` back into it, so it always shows what the project holds, and the
   `Grid align` checkbox is document state the same way (`refresh()` writes `active.alignToGrid` back into it). The `Name` field
   forwards on its `change` event only — never per keystroke — so a half-typed name cannot reach the document, and until the user types it displays the
   name the project holds. Each control is enabled
   only when the app could act on it — mask color, name, visibility, grid alignment, and reparent need an active object, and the `detach`
   button needs a selection, since it is a command on the selected region. The `FOV (deg)` input
   forwards `parseFloat` of its value through `setCameraFov(fov)` on every `input` event, so the authored projection follows the field; the app
   validates and clamps what it receives.
9. `Show raw meshes` is the raw-versus-voxel toggle (README D24): its `change` event forwards `checked` through `setSourceVisible(enabled)` and nothing else, so the panel never touches the mirror, the scene, or a mesh. It is seeded from `context.sceneVisible()` when the context exposes that function — the app does, with `SceneMirror.sourceVisible` — and left untouched by `refresh()` when it does not, in which case the checkbox is a plain forward-only control and the app remains the only thing that knows whether the raw meshes are shown. `refresh()` therefore never invents a state for it.
10. Export: the export button reads the resolution select (`960x540`, `1280x720`, `1920x1080`; the middle one is selected by default), the fps input,
   the `from` and `to` inputs, and the mode select (`beauty | mask`, where `mask` is the per-object identity-color render), and calls
   `actions.exportMp4(options)` with width and height rounded to even numbers, because H.264 and AV1 reject odd dimensions in some players and every
   encoder configuration is cleaner with them. The panel builds no `ExportRequest`: it forwards the numbers it displays. The fps, `from`, and `to`
   inputs are seeded on every `refresh()` — from `project.timeline.fps`, `0`, and `project.timeline.duration` — but only while untouched, each carrying
   its own flag set by its `input` event, so a re-render never overwrites a range the user typed.

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
- The camera-lock checkbox forwards `checked` and nothing else: the panel never touches `ViewportControls`, the mirror, or any camera, and its state
  is the user's, not the panel's, so `refresh()` never rewrites it.
- `Show raw meshes` forwards `checked` and nothing else, and is the panel's only view of the raw-mesh override while `context.sceneVisible()` exists:
  it then displays that value on every `refresh()` and holds no copy of its own, so the mirror and the checkbox cannot disagree. With no `sceneVisible()`
  in the context the checkbox is forward-only and `refresh()` leaves it alone — the panel then displays the user's last click, and the app is the only
  thing that knows the real state. Either way no mesh, scene, layer, or mirror is touched here.
- The `FOV (deg)` input is the panel's only view of the output camera's projection: it displays `project.camera.fov` while untouched, forwards the
  parsed number, and keeps no camera, no lock state, and no clamped copy of its own.
- The `Visible` checkbox is a view of `object.visible` and the `Name` field a view of `object.name`: neither holds document state, neither writes
  anything itself, and both are `disabled` while nothing is active. The `Name` field forwards only on `change`, so no keystroke of a name half-typed
  can reach the app, and a rejected rename simply re-seeds it from the project on the next `refresh()`.
- The Scene window's active-object fields describe the active object, and the `Grid align` checkbox is one of them (README D42): `refresh()` writes
  `active.alignToGrid` back into it and disables it while nothing is active, so it is not forward-only — it always shows the object the list selected.
- After `refresh()` the displayed active object, tool, representation, resolution, colors, parent, name, visibility, and object tree match the current
  `project`/`session` values, and an untouched `FOV (deg)` field shows `project.camera.fov`.
- The panel holds no state beyond its DOM nodes, the per-input touched flags, and the id of the object whose name the `Name` field currently shows.
- The rail holds one button per group and nothing else — no heading, no control, no status text — and every group's content lives in its window's
  body alone: nothing is duplicated in the rail, and no second copy of a control exists anywhere.
- The rail's `Edit` button is a view of two pieces of session state, not a third place that stores any: its `disabled` flag follows
  `session.activeObjectId`, and pressing it writes `session.mode = 'edit'` rather than a panel field. It never switches back — the mode bar
  owns that (README D39) — so pressing it while edit mode is already selected only opens or closes its window.
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
field re-seeds from the project.

## Dependencies
- `./dom.js` — `el`, `on` for construction and listener registration.
- `./floatingWindow.js` — `FloatingWindow`, the one widget each group's controls are placed in; the panel supplies the title, the staggered
  start position, the `onVisibilityChange` that marks the rail button, and the body's content, and never touches the window's position or
  visibility itself.
- `../document/project.js` — `Project`, `ObjectId` for the object read-out and the reparent target.
- `../editor/session.js` — `EditorSession`, `ActiveTool`; the non-project state the panel reads and writes through its setters, including the
  `editColor` shared with the add and paint tools, and `EditResolution` for the cells a row reports (README D41).
- `../voxels/uniform/grid.js` — `HexColor` for the color inputs and the mask-color action. The panel no longer names `VoxelizeTarget`, so
  `../voxels/voxelize/voxelize.js` is no longer imported here.
- Mask color, the name, visibility, reparenting, the camera lock, the FOV, and the raw-mesh override arrive as `PanelContext` callbacks
  that `main` implements with
  `editor/ops.ts`, `three-runtime/controls.ts`, `three-runtime/scene.ts`, and the project camera; this file imports neither `editor/ops.js` nor anything from `app/`. No
  outer-ring import and no Three.js use. `sceneVisible` is a plain callback, so exposing it costs the app one closure and gives
  the panel no import it did not already have; the settings themselves are the dialog's, not the panel's, which is why neither `defaults` nor a
  voxelize target crosses this boundary any more, and why the panel holds no voxelize-related member at all.

## Tests
None. The panel needs a DOM and vitest runs in the node environment, so it is verified by running the app (README section 10): the panel must show no
voxelize control or setting anywhere — no representation select, voxel size, cell size, root size, or max depth, and no button that would open the
dialog — so importing a GLB must ask for the settings in the modal and nothing in the panel asks again. The rest of the walk: set a mask color, type a name and confirm the object list and the HUD follow it — the row read-out is the object's size in cells, `Demo cube · uniform · 4×4×4` beside the boot cube, not a length in metres (README D41) — clear the name to see the refusal, untick `Visible` and confirm the
object disappears, click a row and confirm a trash appears at its right end on that row and on no other and that pressing it removes that object
from the list while the HUD stops naming it, reparent an object, tick `Camera lock (output)` and steer the output camera, type a `FOV` and confirm the locked
view and the export follow it, tick and untick `Show raw meshes` against the raw meshes of an imported object and confirm they appear over and
disappear behind the voxels — in the same place — without changing what an export renders.

The rail and window walk is the same run: the overlay must show exactly the five buttons `Import`, `Edit`, `Camera`, `Render`, `Scene` and no
group control at all until one is pressed; with nothing selected `Edit` must be disabled and unpressable, and pressing it with an object selected must open one window
titled `Edit` holding that group's controls, mark the button `on`, and put the session in edit mode — the viewport mode switch must
follow, and the gizmo must be gone; dragging the window's title bar must move it and leave it under the pointer; `×` must close it and clear the button; opening `Edit` and
`Scene` together must show two windows at different positions, and pressing one must put it above the other; a drag far past an edge must park
the window against it with its title bar still reachable; a press below the rail must reach the viewport rather than the overlay; a second import
must still open the voxelize modal over every window with its fields and `Voxelize` working; and the overlay must hold the five buttons and the
open windows and nothing else — no progress row, no message row, no error line — however many windows are open (D38).
