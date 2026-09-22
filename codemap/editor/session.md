# src/editor/session.ts

Ring: 3 · Layer: editor · Depends on: document/project.ts, voxels/uniform/grid.ts

## Responsibility
Holds the editing state no other module owns: active object, active tool, selection, and the subscriber list. It is a view-model — it holds no project data, mutates no voxel container, and performs no edit; operations live in `editor/ops.ts` and are invoked by the caller.

## Public interface
```ts
import type { ObjectId, Project } from '../document/project.js';
import type { HexColor, IntBox3 } from '../voxels/uniform/grid.js';

type Selection =
  | { kind: 'none' }
  | { kind: 'box'; objectId: ObjectId; box: IntBox3 };
type ActiveTool = 'select' | 'paint' | 'add' | 'remove';
type EditorMode = 'object' | 'edit';   // what a viewport press is for (README D39)
type SelectionShape = 'box';   // what a press selects; the only variant `Selection` has
type EditResolution = { representation: 'empty' | 'uniform'; subdivision?: number; cells?: [number, number, number] };

class EditorSession {
  constructor(project: Project);
  activeObjectId: ObjectId | null;
  mode: EditorMode;
  activeTool: ActiveTool;
  selectionShape: SelectionShape;
  selection: Selection;
  editColor: HexColor;                                 // paint/box color, set from the UI
  resolutionOf(objectId: ObjectId): EditResolution | undefined;
  setActiveObject(id: ObjectId | null): void;
  setMode(mode: EditorMode): void;
  setTool(tool: ActiveTool): void;
  setSelectionShape(shape: SelectionShape): void;
  setSelection(selection: Selection): void;
  setEditColor(color: HexColor): void;
  subscribe(listener: () => void): () => void;
  notify(): void;
}
```

## Internal logic
1. Construction keeps the `Project` and initializes `activeObjectId = null`, `activeTool = 'select'`, `selection = { kind: 'none' }`, `editColor = 0xffffff`, `listeners = new Set<() => void>()`.
2. `notify()` iterates a copy of the set, so a listener that subscribes or unsubscribes during the fan-out cannot corrupt the iteration or skip a sibling. It is synchronous, and every mutator calls it exactly once after the new state is fully assigned.
3. `setActiveObject(null)` clears the active object, the selection, and the mode: it assigns `mode = 'object'` as well, because the edit mode
   edits one object's voxels and has nothing to do without one — which is what lets the UI disable both ways into it while nothing is active
   (README D39). A non-null id must resolve through `project.get(id)`. When the active object actually changes, the selection resets to `{ kind: 'none' }`, because a `Selection` names the object it describes and must not outlive it; re-selecting the current id keeps the selection.
4. `setSelection` validates before assigning: `'none'` is always legal, `'box'` requires `representation === 'uniform'`. An invalid selection throws and leaves the previous one in place.
5. `setMode(mode)` only assigns and notifies, like `setTool`, and drops the selection when the mode it assigns is `object`: a cell
   region is what the edit mode works on, and the gizmo mode has no use for one.
6. `setTool` only assigns and notifies. It does not clear the selection, because the box tools — `select`, `add`, `paint` and `remove` — all share the same region; a detach is a command on the selected region rather than a tool, so it is not in the union at all (README D19).
7. `setSelectionShape(shape)` only assigns and notifies, like `setTool`: the shapes are a closed union, so there is nothing to validate. The shape is what `pointer.ts` builds a selection as when a press hits an object, which is why `box` is the only value and the only variant `Selection` has (README D19).
8. `setEditColor(color)` assigns and notifies. The color is the *appearance* channel the add and paint operations write (`HexColor`, `0xRRGGBB`, README D14) and has nothing to do with `SceneObject.maskColor`, which is the identity channel (README D11). The session stores it so the paint tool has no hidden constant: `pointer.ts` reads `session.editColor` at commit time.
9. `resolutionOf` reads the project on every call, so the reported resolution cannot go stale: `undefined` for an unknown id; `{ representation: 'empty' }` for a node whose representation carries no payload — a transform-only node, or a uniform object whose grid has not been attached yet; and for a uniform object that has a grid, `{ representation: 'uniform', subdivision: grid.subdivision }`, because the subdivision is a property of the grid and is reported whenever one is attached, occupied or not (README D43). `cells` is added on top of that, derived from `grid.bounds()` as `bounds.max[i] - bounds.min[i] + 1` per axis, while the grid holds at least one occupied cell, and there is no `cells` while it holds none — the counts need an occupied cell to have a size at all. A cell is `1 / subdivision` of the world unit (README D41, D43), so `cells` is a per-axis count of the active object's own cells and the subdivision is what says how much world each of them spans. This value is what the HUD shows.
10. `subscribe` adds to the set and returns an unsubscribe closure; calling that closure twice is a no-op.

## Invariants
- `selection.objectId` resolves in `project` at the time it is set, and its kind matches the representation: `'box'` only on a uniform object.
- `selection` is exactly one variant, never a list, so a selection is always either empty or one box.
- `mode` decides what a press is for and is the only switch between them: the composition root shows the gizmo only in `object` mode, and
  `pointer.ts` writes voxels only in `edit` mode, so no press can both transform an object and edit one.
- A selection never survives a change of active object.
- Every public mutator calls `notify()` exactly once, synchronously, after the state change.
- `editColor` is always a valid `0xRRGGBB` value and is the appearance channel only; it is never written to `SceneObject.maskColor`.
- `resolutionOf` is pure, and the session holds no mesh, matrix, or derived render state: the resolution is recomputed on every read from `representation`, the payload's presence, `grid.subdivision`, and `grid.bounds()`, and `cells` carries three numbers only while the grid actually holds an occupied cell.

- The session leaves `edit` mode when its active object is cleared: `setActiveObject(null)` assigns `mode = 'object'` as well as dropping the selection, so no UI path — both of whose entries are disabled while nothing is active — reaches a mode there is nothing to edit in (README D39). `setMode` itself validates nothing, like `setTool`, so a caller that bypasses the UI can still select `edit` with no active object; the session does not refuse it.

## Errors
- `setActiveObject(id)` with an id that does not resolve → `RangeError`; state unchanged.
- `setSelection` with an unknown object, or a box on an object whose representation is not `uniform` → `RangeError`; previous selection preserved.
- `setEditColor(color)` with a non-finite value, a negative value, or one above `0xFFFFFF` → `RangeError`; the previous color is preserved.
- `subscribe` with a non-function → `TypeError`.
- There is no `Result` union here: the session has no user-facing failure mode, and nothing throws for a merely unusual but legal selection.

## Dependencies
- `../document/project.ts` — `Project`, `ObjectId`; object lookup plus the `representation`/`uniform` reads behind `resolutionOf`.
- `../voxels/uniform/grid.ts` — `IntBox3` for the box selection payload and `HexColor` for `editColor` (type only).
No `three` and no `three-runtime` import: being DOM- and renderer-free is what lets `ui/hud.ts` and `app/main.ts` read the session without owning a canvas.

## Tests
No `tests/*.test.ts` covers this file in the demo slice; README section 10 verifies editing by running the application. A later `tests/editor.test.ts` (node environment — the session needs no DOM) should pin: a box selection refused on an object that is not uniform, a selection cleared by a change of active object, `setEditColor` refusing an out-of-range value without changing the color, and `resolutionOf` reporting the per-axis `cells` of a uniform object's bounds and `empty` for one whose payload is not attached.
