# src/editor/pointer.ts

Ring: 3 · Layer: editor · Depends on: document/project.ts, editor/session.ts, editor/ops.ts, three-runtime/picking.ts, three-runtime/overlay.ts, voxels/uniform/grid.ts, voxels/octree/leafId.ts, three

## Responsibility
All pointer handling in the viewport, in one place: point pick (leaf, cell, or object), box drag, hover preview, and commit of the active tool. It translates pointer events into session state and `editor/ops.ts` calls. It never mutates voxel data, never renders, and never owns navigation — `OrbitControls` owns that.

## Public interface
```ts
import type { Project } from '../document/project.js';
import type { EditorSession } from './session.js';
import type { Picker } from '../three-runtime/picking.js';
import type { Overlay } from '../three-runtime/overlay.js';
import type * as THREE from 'three';

type PointerCallbacks = {
  onSessionChange(): void;      // selection or tool changed
  onProjectChange(): void;      // voxels or objects changed, mirror needs sync
  onStatus(text: string): void;
};

class PointerTool {
  constructor(opts: { dom: HTMLElement; project: Project; session: EditorSession;
    picker: Picker; overlay: Overlay; getCamera: () => THREE.PerspectiveCamera;
    getGizmoBusy: () => boolean; callbacks: PointerCallbacks });
  dispose(): void;
}
```

`getGizmoBusy` is the gizmo's claim on the pointer (`ViewportControls.gizmoBusy()` in `app/main.ts`): the tool defers a left press exactly when it answers `true`, and takes the press itself otherwise.

## Internal logic
1. The constructor stores the seven arguments — `getCamera`, the closure that names the `PerspectiveCamera` the viewport is currently rendered with, and `getGizmoBusy`, the closure that reports whether the gizmo owns the pointer — plus private drag state (one `DragState`: `pointerId`, `objectId`, `voxelSize`, `anchorCell`, `cornerCell`, `dragging`) and the `pressActive` flag, and adds `pointerdown`/`pointermove` on `dom` and `pointerup`/`pointercancel` on `window`, so a drag that leaves the canvas still ends. It touches no `dom.style` and no controls state.
2. NDC from an event: `x = (clientX - rect.left) / rect.width * 2 - 1`, `y = -((clientY - rect.top) / rect.height * 2 - 1)` with `dom.getBoundingClientRect()`, so picking matches what the canvas shows at any CSS size. Every pick then passes that NDC *and* `getCamera()` to the picker, resolved for that one call: the closure names the camera that rendered the
frame on screen — the app-owned viewport camera normally, `SceneMirror.camera` while the camera lock retargets rendering (README D17) — so a
click always lands on what the user is looking at.
3. Only button 0 starts an edit. `OrbitControls` is configured `LEFT: null` (middle rotates, right pans, wheel zooms), so no left drag is navigation; buttons 1 and 2 return immediately without `preventDefault()` and without touching state.
4. Gizmo precedence: a left press belongs to the gizmo exactly when `getGizmoBusy()` answers `true` — `ViewportControls.gizmoBusy()` reports `TransformControls.dragging` and a non-null hovered `axis`, so it is true for a drag in progress and for a pointer resting on a handle, and false before any attachment or while the gizmo is disabled. Pointer capture is deliberately *not* consulted: `TransformControls` calls `setPointerCapture` on the shared `dom` element on **every** press, whether or not a handle was hit, so `dom.hasPointerCapture(event.pointerId)` — and `defaultPrevented` with it — says nothing about which layer owns the gesture, and treating it as a claim would swallow every press and make leaf and cell selection unreachable. A gesture of the gizmo's is bracketed by `ViewportControls.onGizmoChange` during the drag and `onGizmoCommit` once on pointer-up, with the mirrored node already holding the dragged transform in between; `app/main.ts` wires that commit to `ops.setTransformFromMatrix` and marks the object dirty, which is why this file does not import `controls.ts`.
5. `pointerdown` (button 0, unclaimed) picks with `picker.pick(ndc, this.getCamera())`. No hit clears the selection to `{ kind: 'none' }`, clears the overlay, and calls `onSessionChange()`. A hit makes the object active, then maps the hit to the selection kind that matches its representation: `'cell'` (uniform) → `{ kind: 'box' }` with the degenerate `normalizeBox(cell, cell)`; `'leaf'` (octree) → `{ kind: 'leaf' }`, one leaf per click; `'object'` (an imported raw mesh on layer 2, README D24) → `{ kind: 'none' }`, because the mesh has no cells or leaves to name yet and activating its object is the whole press. The object arm drops any armed drag, paints nothing, and returns before the commit path, so a press on a raw mesh can never act as a cell or leaf edit. `onSessionChange()` follows a changed selection.
6. Box drag arming: when the active tool is `box`, `paint`, `remove`, or `detach` and the hit is a uniform object, the anchor comes from `picker.pickSurface(ndc, this.getCamera())`: the anchor cell is `floor(pointLocal / voxelSize)` per axis (min-corner convention). If `pickSurface` returns nothing or a different `objectId`, no drag is armed and the point selection stands. An anchor on the object's own raw mesh is legal: a source mesh shares its object's local space, so it addresses the same cells (README D24).
7. Drag tracking: each tracked `pointermove` re-picks the surface with `picker.pickSurface(ndc, this.getCamera())` and keeps the previous corner when the move hits another object or nothing, so a box cannot jump between objects. The box is `normalizeBox(anchorCell, cornerCell)`, inclusive on both corners, and once the drag has a tracked move and `session.boxHeight > 1` its y extent is forced to `[anchorCell[1], anchorCell[1] + boxHeight - 1]`; `boxHeight <= 1` is not an override (README D19). The override is armed by a tracked move, not by the height field alone, which is what keeps step 9's "a press with no tracked move commits exactly the 1×1×1 box" true while a height is set: a click is a point edit at any height, and only a drag produces the slab.
8. Live preview only: each tracked move calls `overlay.showBox(box, grid.voxelSize, project.worldMatrix(objectId))` and reports the box dimensions and `boxCount(box)` through `onStatus`. Nothing is written to the container while the button is down.
9. Commit on `pointerup`, one operation per press, chosen by `session.activeTool` after the box is stored with `session.setSelection`: `box` → `addBox(project, objectId, box, session.editColor)`, `paint` → `paintBox(project, objectId, box, session.editColor)`, `remove` → `removeBox(project, objectId, box)`, `detach` → `detachSelection(project, session.selection)` with the new object becoming active and the selection reset to `{ kind: 'none' }`. `select` writes no voxels and keeps the box selected; `split`/`merge` do not consume a box and the status line names the tool that does apply. Success that wrote voxels calls `onProjectChange()` so the mirror rebuilds; failure calls only `onStatus(result.detail)`. The overlay is then cleared and re-shown with the committed selection for tools that keep one. A press with no tracked move commits the degenerate 1×1×1 box, so point add, remove, paint, and detach need no separate tool.
10. Octree commit: with `split`/`merge`/`remove`/`paint` active and a leaf selected, a click runs `splitLeaf`/`mergeLeaf`/`removeLeaf`/`paintLeaf(project, objectId, leafId, session.editColor)`, and `detach` runs `detachSelection` with the leaf selection — same status and `onProjectChange` rules as step 9.
11. Hover: with no button down, each `pointermove` re-picks with `picker.pick(ndc, this.getCamera())`. A leaf hit shows `overlay.showLeafBounds(octree.transformLeafToWorld(leafId, project.worldMatrix(objectId)), leafSize, color)` and sends depth, size, occupancy, and color to `onStatus` — the text `ui/hud.ts` displays. A cell hit reports the cell and its color. An object hit — an imported raw mesh that has no cells or leaves yet — clears the overlay, because there is no region to outline, and reports the hit object's document name through the same `onStatus`. No hit clears the overlay. Hover mutates nothing but the overlay and never calls the session or project callbacks.
12. Every voxel write goes through `editor/ops.ts`. This file never calls `grid.set`, `fillBox`, `clearBox`, `paintBox`, `octree.split`, `merge`, `removeLeaf`, `paintLeaf`, or any other container mutator directly — that is what keeps pointer code from bypassing the budget and the result reporting.
13. `dispose()` removes every listener it added, including the window-level ones, clears the overlay and the drag state, and is idempotent.

## Invariants
- No voxel container is mutated outside `editor/ops.ts`.
- A drag's box always lies in the anchor object's local grid, is inclusive on both corners, and its y extent is exactly `boxHeight` whenever a tracked move happened and `session.boxHeight > 1`.
- One press commits at most one operation, and a press with no tracked move commits exactly a 1×1×1 box — with or without a height set, because the height override is armed by the tracked move alone. A press on a source mesh commits none: it leaves the selection at `{ kind: 'none' }`, so `commit()` finds no box and no leaf to act on.
- A source-mesh hit is never treated as a leaf or a cell anywhere: it only makes its object active, and it clears the selection and the overlay instead of inventing a region for an object that has no payload yet (README D24).
- Middle and right buttons never start an edit and never alter navigation state.
- A left press with no gizmo handle under the pointer always reaches this tool, so leaf and cell selection work while the gizmo is attached to the active object: `getGizmoBusy()` is the only claim test, and it is false whenever no drag is running and no handle is hovered. Pointer capture is never read as a claim — `TransformControls` sets it on every press, hit or miss.
- Every `picker.pick`/`picker.pickSurface` call resolves `getCamera()` and passes that result, so a pick always uses the camera that rendered the
  frame the user is looking at: the app-owned viewport camera while the lock is off, `SceneMirror.camera` — the output camera — while the lock is on
  (README D17). No camera instance is cached, so retargeting rendering between frames cannot leave picking behind.
- The session selection always names an object the pick hit, with the kind `session.ts` accepts for that object's representation.
- The color written by `box` and `paint` commits is always `session.editColor`; this file defines no color of its own and never writes `maskColor`.
- Between pointerdown and pointerup no voxel data changes; only the overlay and the status text update, and hover never mutates project or session.
- After `dispose()` no listener remains on `dom` or `window`.

## Errors
- There is no `Result` union: this is presentation-layer code, and every operation outcome is surfaced through `onStatus(result.detail)`.
- A `RangeError` from ring 0 (a box reaching outside the packable `[-512, 511]` cell range) is a programmer error and is not caught here.
- A pick with no hit is not an error: it clears the selection.
- Pressing with the wrong tool for the object's representation (`split` on a uniform object, `box` on an octree object) is not an error either: the object becomes active, the matching selection kind is set where one exists, and the mismatch is reported as status text. Pressing a raw source mesh is the same kind of not-an-error: the object becomes active, there is no selection kind to set, and no tool acts on it.

## Dependencies
- `../document/project.ts` — `Project`, `worldMatrix`, `get`.
- `./session.ts` — `EditorSession`, `Selection`, `ActiveTool`; `./ops.ts` — `addBox`, `removeBox`, `paintBox`, `splitLeaf`, `mergeLeaf`, `removeLeaf`, `paintLeaf`, `detachSelection`, `OpResult`.
- `../three-runtime/picking.ts` — `Picker`, `PickHit`, `SurfaceHit`; both pick methods take the `camera` argument, which this file supplies per call from `getCamera()`. `../three-runtime/overlay.ts` — `Overlay`, `showBox`, `showLeafBounds`, `clear`.
- `../voxels/uniform/grid.ts` — `IntBox3`, `normalizeBox`, `boxCount`; `../voxels/octree/leafId.ts` — `LeafId` (type only).
- `three` — `PerspectiveCamera` as the `getCamera()` return type, `Vector2`/`Vector3` for NDC and cell math, `Matrix4` for world matrices.
Not imported: `three-runtime/controls.ts`. The gizmo and `OrbitControls` are wired in `app/main.ts`, which hands this file the gizmo's claim as the `getGizmoBusy` closure; this file only asks that closure (see Open questions).

## Tests
No `tests/*.test.ts` covers this file: the demo slice verifies rendering, picking, and export by running the application (README section 10). The checks are manual and observable: drag a box with the height field set and confirm the slab's y extent, click once and confirm a single cell changes, drag across two objects and confirm the box stays in the anchor object, drag the gizmo and confirm no voxels change while the transform does, and middle/right drag to confirm only the camera moves. With the gizmo attached — the default `select` state for an active object — a click on a leaf or a cell must select it, moving the status line and the overlay to the picked leaf or cell and leaving the transform alone; only a press on a handle may move the object. Then tick `Camera lock (output)`, steer the output camera, and click an object: the hit
must be what the locked view shows, which is the per-pick camera lookup. A fresh import is the raw-mesh walk (README D24): before any voxelization a click must select the imported object — the object list and the HUD follow, no selection or overlay appears, and no voxel changes — hovering must name the object in the status line, ticking `Show raw meshes` must bring the meshes back over the voxels once the object has been voxelized, and clicks must then act on the voxel surface in front of them, not on the mesh behind them.

## Open questions
- The gizmo's claim arrives here as the `getGizmoBusy` closure (`ViewportControls.gizmoBusy()` in `app/main.ts`), so `pointer.ts` still imports nothing from `three-runtime/controls.ts`. The closure is captured at construction, which is correct only because the composition root builds `controls` before it builds `pointer`.
