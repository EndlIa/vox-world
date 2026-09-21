# src/editor/ops.ts

Ring: 3 · Layer: editor · Depends on: document/project.ts, document/detach.ts, editor/session.ts, voxels/uniform/grid.ts, voxels/octree/leafId.ts, voxels/voxelize/voxelize.ts, three

## Responsibility
The edit operations: each mutates the project in place and returns an `OpResult` summarizing what happened. There is no undo, no command object, and no transaction here (README D9) — they are plain functions so a command layer can wrap them later unchanged. Selection state, pointer handling, and rendering are not part of this file.

## Public interface
```ts
import type { ObjectId, Project } from '../document/project.js';
import type { HexColor, IntBox3 } from '../voxels/uniform/grid.js';
import type { LeafId } from '../voxels/octree/leafId.js';
import { DEFAULT_CELL_BUDGET, type VoxelizeResult } from '../voxels/voxelize/voxelize.js';
import type { Selection } from './session.js';
import type * as THREE from 'three';

type OpResult = { ok: true; detail: string; cells?: number } | { ok: false; error: string; detail: string };

function applyVoxelizeResult(project: Project, result: Extract<VoxelizeResult, { ok: true }>, opts?: { attachTo?: ReadonlyMap<string, ObjectId>; parentId?: ObjectId | null }): { objectIds: ObjectId[] };  // attaching a payload leaves the object translation-only (README D25)
function addBox(project: Project, objectId: ObjectId, box: IntBox3, color: HexColor): OpResult;
function removeBox(project: Project, objectId: ObjectId, box: IntBox3): OpResult;
function paintBox(project: Project, objectId: ObjectId, box: IntBox3, color: HexColor): OpResult;
function splitLeaf(project: Project, objectId: ObjectId, leafId: LeafId): OpResult;
function mergeLeaf(project: Project, objectId: ObjectId, leafId: LeafId): OpResult;
function removeLeaf(project: Project, objectId: ObjectId, leafId: LeafId): OpResult;
function paintLeaf(project: Project, objectId: ObjectId, leafId: LeafId, color: HexColor): OpResult;
function setLeafLabel(project: Project, objectId: ObjectId, leafId: LeafId, label: string | undefined): OpResult;
function detachSelection(project: Project, selection: Selection): OpResult & { objectId?: ObjectId };
function createGroup(project: Project, name: string): OpResult & { objectId: ObjectId };
function deleteObject(project: Project, objectId: ObjectId): OpResult;
function reparentObject(project: Project, objectId: ObjectId, parentId: ObjectId | null): OpResult;
function setObjectMaskColor(project: Project, objectId: ObjectId, color: HexColor): OpResult;
function setTransformFromMatrix(project: Project, objectId: ObjectId, matrix: THREE.Matrix4): OpResult;
function setObjectVisible(project: Project, objectId: ObjectId, visible: boolean): OpResult;
function renameObject(project: Project, objectId: ObjectId, name: string): OpResult;
```

## Internal logic
1. Guard order is the same everywhere: resolve the object (`missing-object`), check the representation (`wrong-representation`), then mutate. A failed guard returns before any write, so no operation can leave a half-applied edit.
2. Uniform region operations consume one inclusive integer box in the addressed object's local grid (README D19). It arrives from `pointer.ts` already normalized and is re-normalized with `normalizeBox` before measuring, because `boxCount` drives the budget check.
3. Budget before write (README D19, D12): `addBox` computes `boxCount(box)` and compares `grid.size + added` against `DEFAULT_CELL_BUDGET` imported from `voxels/voxelize/voxelize.ts` before calling `fillBox`. Over budget returns `error: 'budget-exceeded'` and leaves `grid.size` unchanged. `removeBox` and `paintBox` cannot grow the grid and are not checked.
4. `addBox` writes every cell through `grid.fillBox`, `removeBox` clears through `grid.clearBox`, `paintBox` recolors only occupied cells through `grid.paintBox`; the call's return value becomes `cells`. A region that touches nothing is not a failure: `ok: true` with `cells: 0`, so a click on empty space yields a status line instead of an error.
5. Leaf operations delegate to `Octree` and translate its result unions into `OpResult` with the same literal reasons: `split()` → `'missing' | 'branch' | 'max-depth'`, `merge()` → `'missing' | 'branch' | 'incomplete' | 'incompatible'`. `removeLeaf`, `paintLeaf`, and `setLabel` report `false` as `error: 'missing'`.
6. `detachSelection` dispatches on `selection.kind`: `'none'` → `'empty-selection'`; `'box'` → `detachUniformBox(project, objectId, box)`; `'leaf'` → `detachOctreeLeaf(project, objectId, leafId)`. A `DetachResult` failure keeps its literal unchanged; success returns `ok: true` with the new object's id. That the source container no longer holds those cells is `document/detach.ts`'s guarantee, not re-checked here.
7. Object operations delegate to `Project`: `createGroup` → `createObject({ name, parentId: null, representation: 'empty' })`; `deleteObject` → `remove(id)`; `reparentObject` → `reparent(id, parentId)` mapping `'missing' | 'cycle'` through; `setObjectMaskColor` assigns the identity field `maskColor` directly (README D11 — never a cell color). None touch the session; the caller clears a selection that named a deleted object.
8. `setObjectVisible` and `renameObject` write the two object-level identity fields the mirror reads, `visible` and `name`, in place on the object — no payload, cell, transform, or mask-color write. `setObjectVisible` stores the flag verbatim (the mirror assigns it to the scene node); `renameObject` trims the argument with `String.prototype.trim` and refuses a result of length 0 as `'invalid-name'` before writing, so a stored name is never blank or padded.
9. `setTransformFromMatrix` decomposes with `Matrix4.decompose` into the object's existing `position`/`quaternion`/`scale` instances, mutated in place so holders of those references see the update. A matrix with non-finite entries or `determinant() === 0` is refused with `'degenerate-transform'` and the transform is left as it was; a gizmo can otherwise produce a silently invisible object.
10. `applyVoxelizeResult` walks the successful outputs in order. When `opts.attachTo` maps an output's `sourceId` (the caller's own key from `VoxelizeSource`, not a document id) to an existing object, the payload is attached to that object with `project.setPayload(id, payload)`, so the object keeps its id, name, parent, and mask color and only gains voxels. Otherwise a new object is created with `createVoxelObject({ name, parentId: opts.parentId ?? null, maskColor: project.nextMaskColor(), payload, position: origin })`. **Both** paths then put the object on its placement with `placePayload(object, output.origin)`, which writes `position = origin`, identity quaternion, unit scale: `voxelize` bakes node transforms into world space (README D21), so a payload is axis-aligned world space and a node that still carried an imported rotation or non-uniform scale would transform it a second time. On the attach path that is a real change — the placeholder may hold any imported transform — and on the create path it makes the invariant explicit instead of incidental. See D25. The returned ids are in output order, and this is why import can create `'empty'` placeholders that voxelization later fills instead of producing duplicate objects. It returns `{ objectIds }` rather than an `OpResult` because the failure already happened inside `voxelize`.
11. Everything is synchronous, allocation-light, and `await`-free: no operation yields, none is chunked, and none is cancellable.

## Invariants
- Guards precede writes: an `ok: false` return never leaves project state modified, and the uniform budget check runs before the first cell is written.
- Every voxel write goes through the addressed object's own container; no operation reaches a second object, the session, or the mirror.
- A region edit is expressed only as an `IntBox3` and a leaf edit only as one `LeafId` — never a cell list, a screen rectangle, or a connected component. Uniform selection is exactly one dragged integer box (no marquee, no flood fill) and octree selection stays a single picked leaf (README D19).
- Octree failure literals pass through unchanged, so ring 0 tests already exercise the vocabulary this layer reports.
- Deletion and detach leave no dangling parent: `Project.remove` reparents children, and detach parents the new object to the source's parent.
- `applyVoxelizeResult` preserves identity where `attachTo` matches: the existing object keeps its id, name, parent, and mask color, and only its payload and transform change.
- Attaching a payload is what makes a node translation-only, on both paths (README D21, D25): after `applyVoxelizeResult` the object's `quaternion` is the identity and its `scale` is `(1, 1, 1)`, because the payload's cells are axis-aligned in world space and any imported rotation or non-uniform scale would transform them a second time. This is an invariant of the operation, not a side effect of `createVoxelObject` happening to start from an identity transform.
- No history is kept anywhere here, and no operation assumes it is the only caller (README D9); the only session-shaped input is the `Selection` argument of `detachSelection`.
- `setObjectVisible` and `renameObject` write only the object's own `visible`/`name` field and only after the object resolved, so a refused rename leaves the previous name in place.

## Errors
- Returned: `'missing-object'`, `'wrong-representation'`, `'budget-exceeded'`, `'empty-selection'`, `'degenerate-transform'`, `'invalid-name'`; passed through: `'missing'`, `'branch'`, `'max-depth'`, `'incomplete'`, `'incompatible'`, `'empty-region'`, `'not-a-leaf'`.
- Nothing throws for a user-facing failure, and no operation returns a degenerate success.
- Programmer errors propagate instead of being converted: cell coordinates outside the packable `[-512, 511]` range throw `RangeError` from `grid.ts`, and a `Matrix4` argument is checked only for finiteness and invertibility.

## Dependencies
- `../document/project.ts` — `Project`, `ObjectId`, `SceneObject`: lookup, hierarchy, id allocation, `nextMaskColor`.
- `../document/detach.ts` — `detachUniformBox`, `detachOctreeLeaf` for `detachSelection`.
- `./session.ts` — `Selection` (type only); `../voxels/uniform/grid.ts` — `IntBox3`, `HexColor`, `boxCount`, `normalizeBox`.
- `../voxels/octree/leafId.ts` — `LeafId` (type only); `../voxels/voxelize/voxelize.ts` — `DEFAULT_CELL_BUDGET` (the budget `addBox` enforces) and `VoxelizeResult` (type only).
- `three` — `Matrix4` for `setTransformFromMatrix` and `Vector3` (type only) for the `placePayload` argument.
No `three-runtime` import: operations neither render nor pick, and marking the mirror dirty is the caller's step.

## Tests
No `tests/*.test.ts` covers this module in the demo slice; README section 10 verifies editing by running the application. The operations are DOM-free and would be testable as `tests/ops.test.ts`, which should pin: a rejected `addBox` leaves `grid.size` unchanged, octree literal pass-through (`mergeLeaf` on incompatible children reports `'incompatible'`, not a generic error), `detachSelection` dispatching on kind including `'empty-selection'`, `setTransformFromMatrix` refusing a zero-scale matrix without writing the transform, `renameObject` returning `'invalid-name'` for a whitespace-only name while leaving `object.name` untouched, and `applyVoxelizeResult` leaving every object it filled translation-only — identity quaternion, unit scale, `position` equal to the output's `origin` — including on the `attachTo` path over an object that carries an imported rotation and non-uniform scale.

## Open questions
- `Octree.paintLeaf`, `removeLeaf`, and `setLabel` collapse "leaf absent" and "leaf present but not occupied" into `false`, and all three are reported as `'missing'`. If ring 0 ever distinguishes them, the finer literal should pass through.
