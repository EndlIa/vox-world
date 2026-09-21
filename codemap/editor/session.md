# src/editor/session.ts

Ring: 3 · Layer: editor · Depends on: document/project.ts, voxels/uniform/grid.ts, voxels/octree/leafId.ts

## Responsibility
Holds the editing state no other module owns: active object, active tool, selection, box height, and the subscriber list. It is a view-model — it holds no project data, mutates no voxel container, and performs no edit; operations live in `editor/ops.ts` and are invoked by the caller.

## Public interface
```ts
import type { ObjectId, Project } from '../document/project.js';
import type { HexColor, IntBox3 } from '../voxels/uniform/grid.js';
import type { LeafId } from '../voxels/octree/leafId.js';

type Selection =
  | { kind: 'none' }
  | { kind: 'box'; objectId: ObjectId; box: IntBox3 }
  | { kind: 'leaf'; objectId: ObjectId; leafId: LeafId };
type ActiveTool = 'select' | 'box' | 'paint' | 'remove' | 'split' | 'merge' | 'detach';
type EditResolution = { representation: 'empty' | 'uniform' | 'octree'; voxelSize?: number; leafSize?: number };

class EditorSession {
  constructor(project: Project);
  activeObjectId: ObjectId | null;
  activeTool: ActiveTool;
  selection: Selection;
  boxHeight: number;                                   // fixed-height override for the box drag
  editColor: HexColor;                                 // paint/box color, set from the UI
  resolutionOf(objectId: ObjectId): EditResolution | undefined;
  setActiveObject(id: ObjectId | null): void;
  setTool(tool: ActiveTool): void;
  setSelection(selection: Selection): void;
  setEditColor(color: HexColor): void;
  subscribe(listener: () => void): () => void;
  notify(): void;
}
```

## Internal logic
1. Construction keeps the `Project` and initializes `activeObjectId = null`, `activeTool = 'select'`, `selection = { kind: 'none' }`, `boxHeight = 1`, `editColor = 0xffffff`, `listeners = new Set<() => void>()`.
2. `notify()` iterates a copy of the set, so a listener that subscribes or unsubscribes during the fan-out cannot corrupt the iteration or skip a sibling. It is synchronous, and every mutator calls it exactly once after the new state is fully assigned.
3. `setActiveObject(null)` clears the active object and the selection. A non-null id must resolve through `project.get(id)`. When the active object actually changes, the selection resets to `{ kind: 'none' }`, because a `Selection` names the object it describes and must not outlive it; re-selecting the current id keeps the selection.
4. `setSelection` validates before assigning: `'none'` is always legal, `'box'` requires `representation === 'uniform'`, `'leaf'` requires `representation === 'octree'`. An invalid selection throws and leaves the previous one in place.
5. `setTool` only assigns and notifies. It does not clear the selection, because `box`/`paint`/`remove`/`detach` all consume the same box region and `split`/`merge` the same leaf (README D19).
6. `setEditColor(color)` assigns and notifies. The color is the *appearance* channel the paint and box operations write (`HexColor`, `0xRRGGBB`, README D14) and has nothing to do with `SceneObject.maskColor`, which is the identity channel (README D11). The session stores it so the paint tool has no hidden constant: `pointer.ts` reads `session.editColor` at commit time.
7. `resolutionOf` reads the project on every call, so the reported resolution cannot go stale: `undefined` for an unknown id, `{ representation: 'empty' }` for a transform-only node, `{ representation: 'uniform', voxelSize: grid.voxelSize }` for a uniform object, and `{ representation: 'octree', leafSize: octree.leafSize(depth) }` for an octree object when the current selection is a leaf of it. `leafSize` is omitted otherwise, since there is no current depth before a leaf is picked. This value is what the HUD shows.
8. `subscribe` adds to the set and returns an unsubscribe closure; calling that closure twice is a no-op.

## Invariants
- `selection.objectId` resolves in `project` at the time it is set, and its kind matches the representation: `'box'` only on uniform, `'leaf'` only on octree.
- `selection` is exactly one variant, never a list, so an object can never hold a box selection and a leaf selection at the same time.
- A selection never survives a change of active object.
- Every public mutator calls `notify()` exactly once, synchronously, after the state change.
- `boxHeight` is `1` when there is no override; a value greater than `1` is the third-axis override `pointer.ts` applies, and any value `<= 1` means "no override".
- `editColor` is always a valid `0xRRGGBB` value and is the appearance channel only; it is never written to `SceneObject.maskColor`.
- `resolutionOf` is pure, and the session holds no mesh, matrix, or derived render state.

## Errors
- `setActiveObject(id)` with an id that does not resolve → `RangeError`; state unchanged.
- `setSelection` with an unknown object, a box on a non-uniform object, or a leaf on a non-octree object → `RangeError`; previous selection preserved.
- `setEditColor(color)` with a non-finite value, a negative value, or one above `0xFFFFFF` → `RangeError`; the previous color is preserved.
- `subscribe` with a non-function → `TypeError`.
- There is no `Result` union here: the session has no user-facing failure mode, and nothing throws for a merely unusual but legal selection.

## Dependencies
- `../document/project.ts` — `Project`, `ObjectId`; object lookup plus the `representation`/`uniform`/`octree` reads behind `resolutionOf`.
- `../voxels/uniform/grid.ts` — `IntBox3` for the box selection payload and `HexColor` for `editColor` (type only).
- `../voxels/octree/leafId.ts` — `LeafId` for the leaf selection payload (type only).
No `three` and no `three-runtime` import: being DOM- and renderer-free is what lets `ui/hud.ts` and `app/main.ts` read the session without owning a canvas.

## Tests
No `tests/*.test.ts` covers this file in the demo slice; README section 10 verifies editing by running the application. A later `tests/editor.test.ts` (node environment — the session needs no DOM) should pin: a box selection refused on an octree object and a leaf refused on a uniform object, a selection cleared by a change of active object, `setEditColor` refusing an out-of-range value without changing the color, and `resolutionOf` reporting `voxelSize` for uniform, the selected leaf's `leafSize` for octree, and no `leafSize` before a leaf is picked.
