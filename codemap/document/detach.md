# src/document/detach.ts

Ring: 1 · Layer: document · Depends on: ../voxels/uniform/grid.js, ./project.js, three

## Responsibility
Turns a selected box of a uniform voxel object into a new scene object: the box region's cells are re-indexed to a zero min corner and become a new uniform object. It owns the re-indexing, the new object's placement and naming, and the removal of the extracted cells from the source. It is not a voxel primitive (the container does the extraction) and not a selection tool — the caller resolves the box first (D6).

## Public interface
```ts
type DetachResult =
  | { ok: true; objectId: ObjectId; name: string }
  | { ok: false; error: 'missing-object' | 'wrong-representation' | 'empty-region'; detail: string };

function detachUniformBox(project: Project, sourceId: ObjectId, box: IntBox3): DetachResult;
```

## Internal logic
The path follows one rebasing rule (D20): the extracted content is expressed with its min corner at local `(0, 0, 0)`, the new object's placement follows D23, and the extracted cells are gone from the source afterwards. Under D21 the D23 placement is a pure translation, which is the translation-only transform it writes.

1. `src = project.get(sourceId)`; missing, or `representation !== 'uniform'` or `!src.uniform` → failure before any mutation.
2. `cells = src.uniform.extractBox(box, { remove: true })` — one pass, `Map<CellKey, HexColor>` of the occupied cells inside the inclusive box, already deleted from the source grid. An empty map means the region held nothing → `'empty-region'` and the project is unchanged.
3. `grid = UniformGrid.create()` — the lattice is the fixed `CELL_SIZE = 1`, so `create()` takes no size; for each entry, `unpackKey` yields the source-local cell, and the cell is written to `grid` at `(x - box.min[0], y - box.min[1], z - box.min[2])`. Extracted cells lie inside the box, so every re-indexed coordinate is `>= 0` and the min corner is local `(0, 0, 0)`.
4. `localMin = [box.min[0], box.min[1], box.min[2]]` — the region's min corner in the source object's local space (min-corner convention). Under D41 one voxel is one world unit, so a cell coordinate *is* a world coordinate and the box's min corner is the local offset itself: there is no `voxelSize` factor left to apply.
5. Placement is D23. `parentWorld = src.parentId === null ? identity : project.worldMatrix(src.parentId)`, `regionWorld = project.worldMatrix(sourceId)`, `M = parentWorld⁻¹ · regionWorld`, and the new transform is `M · T(+localMin)` (matrix product, `T` = pure translation), decomposed into `position`/`quaternion`/`scale`. Because the payload was rebased to a zero min corner, this is exactly the matrix that maps the extracted region to its original world placement under the inherited parent frame. Under D21 (`M` is a pure translation, since voxel objects and their ancestors carry translation-only transforms with identity rotation and scale) the decomposition yields `position = M · localMin`, an identity quaternion, and unit scale — the brief's translation-only statement, equal to the region's world min corner when the parent frame is the identity.
6. `project.createVoxelObject({ name, parentId: src.parentId, maskColor: project.nextMaskColor(), payload: { kind: 'uniform', grid }, position })` creates the object with that transform. The signature carries only `position`, which is sufficient because step 5's decomposition is a pure translation for everything D21 produces. That `position` is also what the creator reads to set `alignToGrid` (D42): a placement that came out whole — the identity-parent case — is created aligned, and one that came out fractional, which a turned or off-lattice ancestor produces, is created unaligned. Detach writes neither the flag nor the placement and never moves the region onto the lattice to satisfy it.
7. `name`: `"<src.name> part <n>"` with `n` the smallest positive integer for which no existing object already has that name. Deterministic, and stable across repeated detaches.
8. Return `{ ok: true, objectId, name }`.

## Invariants
- **World preservation (D23).** With `parentWorld = worldMatrix(src.parentId)` (identity when the parent is `null`), `regionWorld = worldMatrix(sourceId)`, and the new object's transform matrix `T = (parentWorld⁻¹ ∘ regionWorld) ∘ T(+localMin)`, every extracted local point `p` satisfies `parentWorld · T · (p − localMin) = regionWorld · p`: the content keeps its world placement. Under D21/D23 `parentWorld⁻¹ ∘ regionWorld` is a pure translation, so `T` is a pure translation with `position = (parentWorld⁻¹ ∘ regionWorld) · localMin`, and writing only `position` with an identity quaternion and unit scale is exact — with an identity parent frame that position is the region's world min corner, which is the brief's phrasing. If an ancestor ever carried rotation or scale, `T` would carry that rotation and scale as well instead of silently misplacing the content.
- **The flag follows the placement, never the content (D42).** `position` is the only thing the creator reads to set `alignToGrid`, so a region whose inherited frame put it between cells is created unaligned and keeps exactly the world placement the rule above gives it: detach never snaps an extracted region onto the lattice, and never writes the flag itself.
- **No duplicate occupancy.** The extracted cells exist in exactly one container: `extractBox(..., { remove: true })` deletes precisely the cells it returns, and the new grid receives exactly that cell set, so no coordinate is occupied in both objects and no cell is lost.
- A new object is created only on success, and the source object's own id, name, transform, parent, and mask color are never modified.
- `parentId` is inherited from the source, `maskColor` comes from `project.nextMaskColor()`, and the transform is translation-only (identity quaternion, unit scale).
- The new payload's local coordinates are non-negative, and the new grid is a plain `UniformGrid.create()`: there is one lattice size, so there is no source `voxelSize` for it to keep.
- Nothing else in `project.objects` is touched: no other object's payload, hierarchy, or timeline track changes.
- Failure paths mutate nothing: every check precedes `extractBox`/`createVoxelObject`.

## Errors
- `'missing-object'` — `project.get(sourceId)` is `undefined`.
- `'wrong-representation'` — the source is not a uniform object (including a missing `uniform` payload field).
- `'empty-region'` — the box intersected no occupied cell.
- `RangeError` — a box whose coordinates fall outside `[-512, 511]` propagates from `packKey` in `grid.ts`. Detaching an existing region never throws.
- All failure results carry `detail` with the offending id and region.

## Dependencies
- `../voxels/uniform/grid.js` — `IntBox3`, `UniformGrid.create`, `extractBox`, `unpackKey`; the only module that knows about packed cell keys.
- `./project.js` — `Project` for id allocation, payload binding, parent inheritance, mask colors, and `worldMatrix`.
- `three` — `Vector3` for `localMin` and the injected `position`; no container is a `Mesh` (D1).

## Tests
- `tests/detach.test.ts` — uniform box detach re-indexes to a zero min corner and preserves world positions; the source no longer reports the extracted cells; parent inheritance, mask color, and the `"part <n>"` naming.
- The same file pins the error literals for a missing object, a representation mismatch, and an empty box.

## Open questions
- D23's general form is a full transform, but `Project.createVoxelObject` accepts only `position`. Every case D21 produces reduces to a translation, so the slice is exact; if a rotated or scaled ancestor ever becomes authorable, either that signature must grow a full transform or detach must write `transform.quaternion`/`scale` after creation. Recorded so D23's general form is not silently reduced to a translation.
