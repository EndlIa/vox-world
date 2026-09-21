# src/document/detach.ts

Ring: 1 · Layer: document · Depends on: ../voxels/uniform/grid.js, ../voxels/octree/octree.js, ../voxels/octree/leafId.js, ./project.js, three

## Responsibility
Turns a selected region of one voxel object into a new scene object of the same representation: a uniform box region, or one octree leaf. It owns the re-indexing, the new object's placement and naming, and the removal of the extracted cells from the source. It is not a voxel primitive (the containers do the extraction) and not a selection tool — the caller resolves the box or the leaf id first (D6).

## Public interface
```ts
type DetachResult =
  | { ok: true; objectId: ObjectId; name: string }
  | { ok: false; error: 'missing-object' | 'wrong-representation' | 'empty-region' | 'not-a-leaf'; detail: string };

function detachUniformBox(project: Project, sourceId: ObjectId, box: IntBox3): DetachResult;
function detachOctreeLeaf(project: Project, sourceId: ObjectId, leafId: LeafId): DetachResult;
```

## Internal logic
Both paths share one rebasing rule (D20): the extracted content is expressed with its min corner at local `(0, 0, 0)`, the new object's placement follows D23, and the extracted cells are gone from the source afterwards. Under D21 the D23 placement is a pure translation, which is the translation-only transform both paths write.

**Uniform path**
1. `src = project.get(sourceId)`; missing, or `representation !== 'uniform'` or `!src.uniform` → failure before any mutation.
2. `cells = src.uniform.extractBox(box, { remove: true })` — one pass, `Map<CellKey, HexColor>` of the occupied cells inside the inclusive box, already deleted from the source grid. An empty map means the region held nothing → `'empty-region'` and the project is unchanged.
3. `grid = UniformGrid.create(src.uniform.voxelSize)`; for each entry, `unpackKey` yields the source-local cell, and the cell is written to `grid` at `(x - box.min[0], y - box.min[1], z - box.min[2])`. Extracted cells lie inside the box, so every re-indexed coordinate is `>= 0` and the min corner is local `(0, 0, 0)`.
4. `localMin = [box.min[0] * voxelSize, box.min[1] * voxelSize, box.min[2] * voxelSize]` — the region's min corner in the source object's local space, in meters (min-corner convention).
5. Placement is D23. `parentWorld = src.parentId === null ? identity : project.worldMatrix(src.parentId)`, `regionWorld = project.worldMatrix(sourceId)`, `M = parentWorld⁻¹ · regionWorld`, and the new transform is `M · T(+localMin)` (matrix product, `T` = pure translation), decomposed into `position`/`quaternion`/`scale`. Because the payload was rebased to a zero min corner, this is exactly the matrix that maps the extracted region to its original world placement under the inherited parent frame. Under D21 (`M` is a pure translation, since voxel objects and their ancestors carry translation-only transforms with identity rotation and scale) the decomposition yields `position = M · localMin`, an identity quaternion, and unit scale — the brief's translation-only statement, equal to the region's world min corner when the parent frame is the identity.
6. `project.createVoxelObject({ name, parentId: src.parentId, maskColor: project.nextMaskColor(), payload: { kind: 'uniform', grid }, position })` creates the object with that transform. The signature carries only `position`, which is sufficient because step 5's decomposition is a pure translation for everything D21 produces.
7. `name`: uniform cells carry no label, so it is `"<src.name> part <n>"` with `n` the smallest positive integer for which no existing object already has that name. Deterministic, and stable across repeated detaches.
8. Return `{ ok: true, objectId, name }`.

**Octree path**
1. Same source resolution against `representation === 'octree'` and `src.octree`.
2. `attrs = src.octree.getLeaf(leafId)`; `undefined` (missing node or a branch) → `'not-a-leaf'`; `attrs.occupied === false` → `'empty-region'`, since an unoccupied leaf would produce an object with no occupancy.
3. Read `leafBox = src.octree.leafBox(leafId)` **before** removing: `size` is the leaf edge, `center` is its local center. `localMin = center - (size / 2, size / 2, size / 2)` — the leaf's min corner in local space.
4. The source gives up the leaf. `parentLeafId(leafId) === null` means the target **is** the root leaf,
   which `removeLeaf` never removes, so a one-leaf octree would otherwise make its own detach
   impossible: the occupancy is cleared with `src.octree.setLeaf(leafId, { occupied: false, color: attrs.color })`
   and the source stays a legal one-leaf octree with nothing occupied. For every other leaf
   `src.octree.removeLeaf(leafId)` deletes the node and prunes branches that became empty; a `false`
   there would contradict step 2 and throws `RangeError` as an internal invariant violation.
5. `octree = Octree.create({ rootSize: leafBox.size, maxDepth: src.octree.maxDepth })` — the root box `[0, size]³`, i.e. exactly the detached leaf box.
6. `octree.setLeaf('0:', { occupied: attrs.occupied, color: attrs.color, label: attrs.label })`. The new object is a one-leaf octree of the same depth budget, so it can be split further and detached again — this is what makes character → hands and feet work with no special case.
7. Same D23 placement as the uniform path (`parentWorld⁻¹ · (regionWorld · localMin)`), with `parentId = src.parentId` and `maskColor = project.nextMaskColor()`.
8. `name = attrs.label` when it is a non-empty string, otherwise the `"<src.name> part <n>"` fallback of the uniform path.
9. Return `{ ok: true, objectId, name }`.

## Invariants
- **World preservation (D23).** With `parentWorld = worldMatrix(src.parentId)` (identity when the parent is `null`), `regionWorld = worldMatrix(sourceId)`, and the new object's transform matrix `T = (parentWorld⁻¹ ∘ regionWorld) ∘ T(+localMin)`, every extracted local point `p` satisfies `parentWorld · T · (p − localMin) = regionWorld · p`: the content keeps its world placement. Under D21/D23 `parentWorld⁻¹ ∘ regionWorld` is a pure translation, so `T` is a pure translation with `position = (parentWorld⁻¹ ∘ regionWorld) · localMin`, and writing only `position` with an identity quaternion and unit scale is exact — with an identity parent frame that position is the region's world min corner, which is the brief's phrasing. If an ancestor ever carried rotation or scale, `T` would carry that rotation and scale as well instead of silently misplacing the content.
- **No duplicate occupancy.** The extracted cells exist in exactly one container: `extractBox(..., { remove: true })` deletes precisely the cells it returns, and the new grid receives exactly that cell set, so no coordinate is occupied in both objects and no cell is lost.
- **No duplicate leaf.** `removeLeaf` deletes the source leaf, and octree leaves are disjoint, so the new root leaf's box is no longer covered by the source; `attrs` is copied, not shared. When the target is the source's root leaf the source box does still spatially overlap the new object, and the guarantee is the one that matters: that box is no longer *occupied* in the source, because the extracted attrs moved into the new object's single root leaf.
- **An existing, occupied leaf always detaches.** No path throws for a leaf the source actually has; the only `RangeError` left in the octree path is the internal invariant violation of step 4, which requires `removeLeaf` to report a non-root leaf it failed to remove.
- A new object is created only on success, and the source object's own id, name, transform, parent, and mask color are never modified.
- `parentId` is inherited from the source, `maskColor` comes from `project.nextMaskColor()`, and the transform is translation-only (identity quaternion, unit scale).
- The new payload's local coordinates are non-negative; the uniforms keep the source `voxelSize`, the octree keeps the source `maxDepth`.
- Nothing else in `project.objects` is touched: no other object's payload, hierarchy, or timeline track changes.
- Failure paths mutate nothing: every check precedes `extractBox`/`removeLeaf`/`createVoxelObject`.

## Errors
- `'missing-object'` — `project.get(sourceId)` is `undefined`.
- `'wrong-representation'` — the source's `representation` does not match the called path (including a missing payload field).
- `'empty-region'` — uniform: the box intersected no occupied cell; octree: the leaf exists but is unoccupied, which includes the emptied root leaf a previous root detach left behind.
- `'not-a-leaf'` — octree: `leafId` resolves to nothing or to a branch node.
- `RangeError` — a uniform box whose coordinates fall outside `[-512, 511]` propagates from `packKey` in `grid.ts`; a `removeLeaf` on a non-root leaf that returns `false` throws as an internal invariant violation. Detaching an existing leaf never throws: the root leaf is handled by step 4.
- All failure results carry `detail` with the offending id, region, or leaf id.

## Dependencies
- `../voxels/uniform/grid.js` — `IntBox3`, `UniformGrid.create`, `extractBox`, `unpackKey`; the only module that knows about packed cell keys.
- `../voxels/octree/octree.js` — `Octree.create`, `getLeaf`, `leafBox`, `removeLeaf`, `setLeaf`.
- `../voxels/octree/leafId.js` — `LeafId` type, `parentLeafId` for the root-leaf test in step 4, and the root id literal `'0:'`.
- `./project.js` — `Project` for id allocation, payload binding, parent inheritance, mask colors, and `worldMatrix`.
- `three` — `Vector3` for `localMin` and the injected `position`; no container is a `Mesh` (D1).

## Tests
- `tests/detach.test.ts` — uniform box detach re-indexes to a zero min corner and preserves world positions; octree leaf detach produces a one-leaf root box with identical `occupied`/`color`/`label`; the source no longer reports the extracted cells; the octree result can be split again; parent inheritance, mask color, and the `"part <n>"` naming.
- The same file pins the error literals for a missing object, a representation mismatch, an empty box, and a branch leaf id.

## Open questions
- D23's general form is a full transform, but `Project.createVoxelObject` accepts only `position`. Every case D21 produces reduces to a translation, so the slice is exact; if a rotated or scaled ancestor ever becomes authorable, either that signature must grow a full transform or detach must write `transform.quaternion`/`scale` after creation. Recorded so D23's general form is not silently reduced to a translation.
- Whether detaching a uniform region should accept a label source (uniform cells have no label field), or whether uniform objects are meant to always fall back to the `"<name> part <n>"` naming.
