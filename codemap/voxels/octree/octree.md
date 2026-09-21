# src/voxels/octree/octree.ts

Ring: 0 · Layer: voxels/octree · Depends on: `./leafId.js`, `../uniform/grid.js` (`HexColor` only —
registered same-ring edge, README D8), `three` (`Vector3`, `Matrix4`)

## Responsibility
One sparse editable octree container: leaves carry `occupied`, `color`, and an optional `label`, and the class
owns allocation-time writes (`insertAtDepth`), `split`, `merge`, `removeLeaf`, painting, depth-first iteration,
and leaf-box math in octree local space. Object identity, transforms, and hierarchy are `document`'s job
(README D10); this container is never a scene graph.

## Public interface
```ts
type LeafAttrs = { occupied: boolean; color: HexColor; label?: string };
type LeafBox = { center: THREE.Vector3; size: number; depth: number };

class Octree {
  static create(opts: { rootSize: number; maxDepth: number }): Octree;   // root leaf, occupied: false
  readonly rootSize: number;
  readonly maxDepth: number;
  get leafCount(): number;
  get occupiedLeafCount(): number;
  leafSize(depth: number): number;                                       // rootSize / 2^depth
  hasLeaf(id: LeafId): boolean;
  getLeaf(id: LeafId): LeafAttrs | undefined;
  setLeaf(id: LeafId, attrs: LeafAttrs): void;                           // existing leaf only
  removeLeaf(id: LeafId): boolean;                                       // deletes the node, prunes empty branches
  paintLeaf(id: LeafId, color: HexColor): boolean;
  setLabel(id: LeafId, label: string | undefined): boolean;
  split(id: LeafId): { ok: true; children: LeafId[] } | { ok: false; error: 'missing' | 'branch' | 'max-depth' };
  merge(id: LeafId): { ok: true } | { ok: false; error: 'missing' | 'branch' | 'incomplete' | 'incompatible' };
  insertAtDepth(cell: readonly [number, number, number], depth: number, attrs: LeafAttrs): void;
  leafBox(id: LeafId): LeafBox;
  forEachLeaf(cb: (id: LeafId, attrs: LeafAttrs) => void): void;         // depth-first, octant order
  forEachOccupiedLeaf(cb: (id: LeafId, attrs: LeafAttrs) => void): void;
  transformLeafToWorld(id: LeafId, matrix: THREE.Matrix4): THREE.Vector3; // leaf center in world space
}
```

## Internal logic
1. **Node model.** All nodes live in one `Map<LeafId, Node>`; a node is a leaf (carries `LeafAttrs`) or a branch (carries 1..8 child ids), never both. A branch that loses its last child is pruned at once, so empty branches never exist. `create` installs exactly one node, the root leaf `"0:"`, with `occupied: false`.
2. **Geometry.** Local root box `[0, rootSize]³`; at depth `d` the leaf edge is `ℓ = rootSize / 2^d` and integer coordinates `(i, j, k)` run over `[0, 2^d)³`; leaf `(i, j, k)` spans `[i*ℓ, (i+1)*ℓ]` per axis, so all octree coordinates are non-negative. Id digits are `octantOf` parities of the coordinate bits, coarsest level first.
3. **Leaf boxes.** `leafBox` gives `center = ((i+0.5)ℓ, (j+0.5)ℓ, (k+0.5)ℓ)` in local space, `size = ℓ`, and the leaf's own `depth`; `transformLeafToWorld` applies the world matrix to that center and returns the point, not a size, so a caller wanting a world edge length scales `size` itself.
4. **split.** The eight children are `childLeafIds(id)`, each created with a copy of the parent's `occupied`, `color`, and `label`, so occupied volume and appearance are unchanged; `id` becomes a branch, so `hasLeaf(id)` is `false` and `getLeaf(id)` is `undefined` afterwards. At `maxDepth` the call is refused.
5. **merge.** Requires `id` to be a branch whose eight children are all present and all leaves with equal `occupied`, `color`, and `label`; the children are then deleted and `id` becomes a leaf carrying those attrs. Differences are never discarded and children are never invented: a mismatch is `'incompatible'`, fewer than eight leaves is `'incomplete'`, a child that has children of its own is `'branch'` — `merge` never recurses.
6. **removeLeaf / pruning.** After deleting a leaf the walk goes upward through `parentLeafId`, deleting every branch left with zero children. The root is never removed: `removeLeaf("0:")` returns `false`, and an emptied container is expressed by `setLeaf("0:", { occupied: false, ... })` while the root is still a leaf.
7. **insertAtDepth.** Validates `depth ∈ [0, maxDepth]` and `cell ∈ [0, 2^depth)³`, then walks from the root: at every level below `depth` the current node that is still a leaf is split (children inherit its attrs, so an unoccupied leaf adds no volume and an occupied one keeps its volume) and the walk continues into the child whose digit equals that level's coordinate bit. A leaf reached at the target depth receives the new `attrs`. If the target node is a branch — the cell is already covered by finer leaves — the walk descends without allocating and writes `attrs` in full onto each leaf under that path: the container's only overlap-resolution rule (README D18), so a write never allocates over finer leaves and no cell is ever covered twice.
8. **Iteration.** `forEachLeaf` and `forEachOccupiedLeaf` are depth-first in octant order `0..7` and visit leaves only, never branches; a leaf's depth comes from its id. `leafCount` and `occupiedLeafCount` are maintained incrementally on node creation and deletion.

## Invariants
- Exactly one root node `"0:"` always exists; every other node's parent exists and its id is its parent's id plus one octant digit, with depth one greater. No branch has fewer than one child.
- Every node is a leaf or a branch, never both; leaves are spatially disjoint, so no cell is covered twice (D18).
- After `split(id)` the eight children tile the parent box exactly, each carries the parent's pre-split attrs, and `id` is a branch: occupied volume and colors are unchanged. After `merge(id)`, `id` is a leaf carrying the children's common attrs and the eight child ids no longer exist. Split-then-merge restores attrs and both counts; `merge` is refused whenever it would discard a difference.
- After `insertAtDepth(cell, depth, attrs)` every leaf intersecting the target cell box reports exactly `attrs`, and no existing leaf was removed or renumbered; `leafCount` grows only by nodes actually allocated and stays unchanged when the write lands in finer leaves.
- `leafBox(id)` agrees with `leafSize(depth)`, equal ids give equal boxes, and counts and traversals are deterministic for a given operation sequence.

## Errors
- `split` returns `'missing'` (no such node), `'branch'` (the node already has children), or `'max-depth'` (the node is at `maxDepth`); `merge` returns `'missing'`, `'branch'` (a present child is itself a branch), `'incomplete'` (fewer than eight children present, which is also where a merge target that is still a leaf lands), or `'incompatible'` (the children differ in `occupied`, `color`, or `label`). `'branch'` always names a node that has children. The tree is unchanged on any failure.
- `removeLeaf`, `paintLeaf`, and `setLabel` return `false` for a missing leaf or a branch id and never throw for a well-formed id. `setLeaf`, `leafBox`, and `transformLeafToWorld` throw `TypeError` when the id names no existing leaf, having no meaningful value for a branch or an absent node — a wrong-kind argument is a `TypeError`, a number outside its range is a `RangeError`.
- `create` throws `RangeError` unless `rootSize` is finite and positive and `maxDepth` is a non-negative integer; `leafSize` throws `RangeError` outside `[0, maxDepth]`; `insertAtDepth` throws `RangeError` for an out-of-range `depth` or a cell outside `[0, 2^depth)³`. A malformed id propagates `decodeLeafId`'s `TypeError` and is never reported as `'missing'`.

## Dependencies
- `./leafId.js` — `LeafId`, `decodeLeafId`, `parentLeafId`, `childLeafIds`, `octantOf`, `OCTANT_COUNT`: ids are encoded and navigated there and never re-parsed here.
- `../uniform/grid.js` — `HexColor` only, so both representations speak one color format (same-ring edge, D8).
- `three` — `Vector3` for `LeafBox.center` and the transformed center, `Matrix4` for `transformLeafToWorld`; the octree is not a `Mesh` and carries no scene state.

## Tests
`tests/octree.test.ts`: `split` preserves occupied volume and appearance and keeps leaf boxes disjoint; `merge` refuses incompatible children, incomplete branches, and branch children, and is the inverse of `split`; `insertAtDepth` descends into finer leaves instead of allocating a duplicate (leaving `leafCount` unchanged) while a write into empty space allocates at the requested depth; `removeLeaf` prunes empty branches but never the root; depth-first octant traversal order; `leafBox` center and size against `leafSize(depth)`.
