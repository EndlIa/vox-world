# src/ui/panels.ts

Ring: 4 · Layer: ui · Depends on: ./dom.js, ../document/project.js, ../editor/session.js, ../voxels/voxelize/voxelize.js, ../voxels/uniform/grid.js

## Responsibility
The main control panel: import, voxelize settings, edit, camera, and export controls plus the project and session read-out. It renders state, seeds its voxelize
defaults from `PanelContext.defaults()`, and forwards intent through `PanelContext.actions`; it never mutates the project, never calls
`editor/ops.ts`, and never imports `app/` — the composition root depends on `ui/`, not the reverse. There is no `Voxelize` button and no
scope checkbox (README D26): importing voxelizes the whole imported scene, and every voxelize control re-voxelizes it when its value is committed,
so a changed setting is itself the request.

## Public interface
```ts
type PanelContext = {
  project: Project; session: EditorSession;
  sceneVisible?(): boolean;    // the app's raw-mesh override; absent => forward-only checkbox
  defaults(): { uniformVoxelSize: number; targetCellSize: number; octreeMaxDepth: number;
    octreeRootSize: number };   // seeded by the app from the imported bounds
  actions: {
    pickImportFile(): void;      // opens the file dialog from app/files.ts; ui never imports app
    revoxelize(options: { target: VoxelizeTarget }): void;  // re-voxelizes the retained import; cancels any in-flight job
    exportMp4(options: { width: number; height: number; fps: number; from: number; to: number;
      mode: 'beauty' | 'mask' }): void;
    createGroup(): void;
    deleteActive(): void;
    setActiveMaskColor(color: HexColor): void;
    setActiveVisible(visible: boolean): void;   // shows or hides the active object
    setSourceVisible(enabled: boolean): void;   // shows or hides every imported raw mesh
    renameActive(name: string): void;           // renames the active object; the app trims and refuses ''
    reparentActive(parentId: ObjectId | null): void;
    setLeafLabel(label: string): void;
    setCameraLock(enabled: boolean): void;   // hands viewport navigation to the output camera
    setCameraFov(fov: number): void;         // authors the output camera's vertical FOV
  };
};
class Panels {
  constructor(root: HTMLElement, context: PanelContext);
  setProgress(label: string, ratio: number): void;
  clearProgress(): void;
  reportError(message: string): void;
  refresh(): void;
}
```

## Internal logic
1. The constructor builds the DOM once under `root` through `el`: an import button plus a `Show raw meshes` checkbox; a voxelize settings group (representation select `uniform | octree`,
   voxel-size, target-cell-size, root-size, and max-depth inputs — no run button and no scope checkbox, README D26); an edit row (create group, delete active,
   `ActiveTool` tool buttons, box height, edit color, mask color, a parent select, a leaf-label input, a `Name` text input, and a `Visible` checkbox); a camera group (one `Camera lock (output)`
   checkbox with a dim line saying what it does, and a `FOV (deg)` number input); an export group (a resolution select, fps,
   `from`, and `to` inputs, a beauty/mask mode select, and an export button); an object list; a status line;
   an error line. It ends with `refresh()`, and its listeners come from `on` and live for the page lifetime — there is no `dispose`.
2. `refresh()` re-reads `project` and `session` and rewrites text, `value`, and `disabled` state: object rows from `project.roots()` and
   `childrenOf()` with `session.activeObjectId` marked, representation from `object.representation`, resolution from `session.resolutionOf(id)`,
   pressed state from `session.activeTool`, box height from `session.boxHeight`, colors from `session.editColor` and `object.maskColor`, the parent
   select from `object.parentId`, and the label input from the selected leaf. Calling it twice produces the same DOM.
3. The four voxelize inputs are seeded from `context.defaults()` on every `refresh()`, but only while untouched: each carries a flag set by its own
   `input` event, so `uniformVoxelSize`, `targetCellSize`, `octreeMaxDepth`, and `octreeRootSize` arrive from the app without ever overwriting a value
   the user typed. The camera group's `FOV (deg)` field is seeded the same way, from `project.camera.fov`, with its own flag. The edit group's `Name`
   field is seeded from `object.name` with a flag of its own, set by its `input` event; because its seed depends on the selection, `refresh()` clears
   that flag whenever the active object is not the one the field is showing, so a re-selection always re-seeds instead of leaving the previous object's
   text behind, and it is emptied while nothing is active.
4. The only direct writes are `session` setters driven by user input: object rows call `session.setActiveObject(id)`, tool buttons call
   `session.setTool(tool)`, box height writes `session.boxHeight`, and edit color calls `session.setEditColor(hex)` with `parseInt(value.slice(1),
   16)`. No `project` mutator and no `editor/ops.ts` function is called here.
5. Project-changing intent leaves as callbacks: `pickImportFile()`, `revoxelize({ target })`, `exportMp4(options)`, `createGroup()`,
   `deleteActive()`, `setActiveMaskColor(hex)`, `setActiveVisible(checked)` from the visibility checkbox, `renameActive(value)` from the `Name` field,
   `reparentActive(parentId | null)` from the parent select, `setLeafLabel(label)` from the label
   input (empty string when cleared), and `setCameraLock(checked)` from the camera-lock checkbox — the panel forwards the checkbox's own state and
   never tracks the lock itself, so `refresh()` leaves that checkbox alone and the app stays the only owner of the flag. Unlike the camera lock, the
   `Visible` checkbox is document state: `refresh()` writes `object.visible` back into it, so it always shows what the project holds. The `Name` field
   forwards on its `change` event only — never per keystroke — so a half-typed name cannot reach the document, and until the user types it displays the
   name the project holds. Each control is enabled
   only when the app could act on it — mask color, name, visibility, and reparent need an active object, leaf label needs a leaf selection. The `FOV (deg)` input
   forwards `parseFloat` of its value through `setCameraFov(fov)` on every `input` event, so the authored projection follows the field; the app
   validates and clamps what it receives.
6. `Show raw meshes` is the raw-versus-voxel toggle (README D24): its `change` event forwards `checked` through `setSourceVisible(enabled)` and nothing else, so the panel never touches the mirror, the scene, or a mesh. It is seeded from `context.sceneVisible()` when the context exposes that function — the app does, with `SceneMirror.sourceVisible` — and left untouched by `refresh()` when it does not, in which case the checkbox is a plain forward-only control and the app remains the only thing that knows whether the raw meshes are shown. `refresh()` therefore never invents a state for it.
7. Voxelize settings (README D26): `readTarget()` derives a complete `VoxelizeTarget` from the fields exactly as the removed button did — `{ kind:
   'uniform', voxelSize }` or `{ kind: 'octree', rootSize, maxDepth, targetCellSize }`, and `undefined` when the active branch's numbers do not parse —
   and `revoxelize()` forwards it through `actions.revoxelize({ target })` when it is defined, so an impossible target never reaches the app. The select
   enables only the active branch's inputs. Each field commits on its `change` event and calls `revoxelize()`, exactly one call per commit; its `input`
   event only sets the touched flag, so a half-typed number never starts a job — the same split the `Name` field uses. The representation select runs
   `refresh()` before `revoxelize()`: `refresh()` enables the new branch's inputs and seeds the untouched ones from `context.defaults()`, so the target
   that follows describes the branch the user is now looking at. There is no run button and no `disabled` gate on one: a field that does not parse is not
   a request, and the app decides what to do when there is no retained import.
8. Export: the export button reads the resolution select (`960x540`, `1280x720`, `1920x1080`; the middle one is selected by default), the fps input,
   the `from` and `to` inputs, and the mode select (`beauty | mask`, where `mask` is the per-object identity-color render), and calls
   `actions.exportMp4(options)` with width and height rounded to even numbers, because H.264 and AV1 reject odd dimensions in some players and every
   encoder configuration is cleaner with them. The panel builds no `ExportRequest`: it forwards the numbers it displays. The fps, `from`, and `to`
   inputs are seeded on every `refresh()` — from `project.timeline.fps`, `0`, and `project.timeline.duration` — but only while untouched, each carrying
   its own flag set by its `input` event, so a re-render never overwrites a range the user typed.
9. `setProgress(label, ratio)` writes `label` and `${Math.round(clamp(ratio, 0, 1) * 100)}%` into the status line. A label plus a ratio is the whole
   progress surface: the app runs voxelization on the main thread in chunks, so there is no job object, no cancel button, and no per-source row.
10. `clearProgress()` empties both parts of the status line for the next job; `reportError(message)` writes the message verbatim into the error line.
   The app passes the failing `Result`'s `error` literal and `detail` unchanged, so nothing is translated, truncated, or reformatted, and no error
   string is constructed here.

## Invariants
- The panel calls no `Project` mutator and no `editor/ops.ts` operation: after any interaction the project is exactly what the app left it; its only
  direct mutations are `EditorSession` setters driven by user input (`setActiveObject`, `setTool`, `boxHeight`, `setEditColor`).
- The voxelize group has no run button and no scope checkbox (README D26): its five controls are the whole surface, and each commits a complete
  `VoxelizeTarget` — never a partial one and never a bare number — through `revoxelize({ target })` on its `change` event, only when the active branch
  parses. The panel itself never decides how much of the scene to voxelize and never starts a job; cancelling an in-flight one is the app's.
- Every project-changing control reaches the app as a `PanelContext` callback; the panel imports no module from `app/` and never performs an edit
  itself.
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
- After `refresh()` the displayed active object, tool, representation, resolution, colors, parent, leaf label, name, visibility, and object tree match the current
  `project`/`session` values, every untouched voxelize input shows the app-seeded default, and an untouched `FOV (deg)` field shows
  `project.camera.fov`.
- `setProgress` clamps `ratio` into `[0, 1]`; `clearProgress` and `reportError` never touch each other's element.
- The panel holds no state beyond its DOM nodes, the per-input touched flags, and the id of the object whose name the `Name` field currently shows.

## Errors
No `Result` and no throwing. `pickImportFile` reports nothing back — a dismissed dialog is the app's business. Import, voxelize, export, and op
failures reach the panel through `reportError` from the app, never as a rejection the panel has to catch. A voxelize field with an unparsable value
is simply not forwarded: `readTarget()` returns `undefined` and `revoxelize()` returns before calling the app, so the panel never passes an impossible
`VoxelizeTarget` and never has to report a validation error of its own. A cleared or non-numeric `FOV (deg)`
field parses to `NaN` and is forwarded as-is: refusing non-finite input is the app's job, so the panel never validates before forwarding. The `Name`
field is forwarded the same way — trimming it and refusing an empty name belong to the op, so a blank name comes back as a reported failure and the
field re-seeds from the project.

## Dependencies
- `./dom.js` — `el`, `on` for construction and listener registration.
- `../document/project.js` — `Project`, `ObjectId` for the object read-out and the reparent target.
- `../editor/session.js` — `EditorSession`, `ActiveTool`; the non-project state the panel reads and writes through its setters, including the
  `editColor` shared with the box and paint tools.
- `../voxels/voxelize/voxelize.js` — `VoxelizeTarget` type only; `../voxels/uniform/grid.js` — `HexColor` for the color inputs and the mask-color
  action.
- Mask color, the name, visibility, reparenting, leaf labeling, the camera lock, the FOV, the raw-mesh override, and re-voxelization arrive as `PanelContext.actions` callbacks that `main` implements with
  `editor/ops.ts`, `three-runtime/controls.ts`, `three-runtime/scene.ts`, the voxelizer, and the project camera; this file imports neither `editor/ops.js` nor anything from `app/`. No
  outer-ring import and no Three.js use. `sceneVisible` is a plain callback, so exposing it costs the app one closure and gives the panel no import it did not already have.

## Tests
None. The panel needs a DOM and vitest runs in the node environment, so it is verified by running the app (README section 10): import a GLB and the viewport must show voxels with no
further click (there is no `Voxelize` button and no scope checkbox to find), then commit a new voxel size, target cell size, root size, or max depth, or switch `Representation`, and the
imported sources must re-voxelize at what the fields show with progress and no extra interaction;
set a mask color, type a name and confirm the object list and the HUD follow it, clear the name to see the refusal, untick `Visible` and confirm the
object disappears, reparent an object, label a leaf, tick `Camera lock (output)` and steer the output camera, type a `FOV` and confirm the locked
view and the export follow it, tick and untick `Show raw meshes` against the raw meshes of an imported object and confirm they appear over and
disappear behind the voxels — in the same place — without changing what an export renders, and watch progress and errors.
