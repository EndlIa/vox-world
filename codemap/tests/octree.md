# tests/octree.test.ts

Ring: 0 · Layer: tests (node, no GPU) · Depends on: `../src/voxels/octree/octree.js`,
`../src/voxels/octree/leafId.js`, `three`, `vitest`

## Responsibility
Pins the octree as a container: leaf identity, `split`/`merge` preserving occupied volume and
appearance, `insertAtDepth` overlap resolution, `removeLeaf` pruning, and depth-first octant
traversal. It does not test rendering, instance buckets, or picking — only container state.

## Public interface
`describe` / `it` names are this file's observable surface:
- `leaf id encoding` — `round-trips a root-to-leaf path`, `returns null parent at the root and eight
  children in octant order`, `derives the octant from coordinate parity for negative and positive
  triples`, `throws TypeError on a malformed id`
- `split` — `gives the eight children the parent occupied, color, and label`, `halves the edge and
  keeps the occupied volume`, `reports missing, branch, and max-depth without mutating`
- `merge` — `restores the parent from eight compatible leaves`, `refuses incomplete and incompatible
  children without mutating`
- `insertAtDepth` — `splits occupied leaves on the way down`, `paints finer leaves instead of
  duplicating them`, `never makes one node both a leaf and a branch`
- `removeLeaf and pruning` — `prunes branches that lose their last child but never the root`,
  `returns false for a missing leaf`
- `traversal and geometry` — `visits leaves depth-first in octant order 0..7`, `reports each leaf box
  center and edge in local space`

## Internal logic
1. Fixtures are built through the public API only (`create`, `insertAtDepth`, `split`, `merge`); no
   test reaches into nodes, so a change of internal layout cannot break them.
2. Traversal order is captured into an array and compared with a literal expected array, never as a set.
3. `merge` and `split` failures are checked against a snapshot taken before the call, so "refuses"
   means "changed nothing". The overlap fixture splits an occupied leaf and writes into the same cell
   again at a coarser depth, the only overlap-resolution path the container owns.

## Invariants
- The root leaf is `"0:"` and spans `[0, rootSize]³`; a depth-`d` leaf has edge `rootSize / 2^d` and
  integer cell `(i, j, k)` in `[0, 2^d)³`. Octree coordinates are never negative.
- A node is either a leaf or a branch, never both, and every branch survives with at least one child.
- `split` preserves total occupied volume and copies `occupied`, `color`, and `label` to all eight
  children; `merge` succeeds only when all eight children are present leaves with equal attributes.
- `insertAtDepth` leaves no two leaves covering the same point: it splits on the way down or paints the
  finer leaves it finds, and the target cell ends occupied with the requested attributes.
- Leaf paths are prefix-closed: the parent path of every non-root leaf is a branch.

## Errors
- `split` returns `'missing' | 'branch' | 'max-depth'` and `merge` returns
  `'missing' | 'branch' | 'incomplete' | 'incompatible'`, all as `{ ok: false, error }`, never throws:
  `'missing'` for an unknown id, `'branch'` for a target or merge child that has children,
  `'incomplete'` for a merge target that is still a leaf or has fewer than eight children, and
  `'incompatible'` for eight children whose `occupied`, `color`, or `label` differ.
- `decodeLeafId` throws `TypeError` on a malformed id; `setLeaf` throws `TypeError` for an id that is
  not an existing leaf; `leafSize` throws `RangeError` outside `[0, maxDepth]`.

## Dependencies
`../src/voxels/octree/octree.js` for `Octree`, `LeafAttrs`, `LeafBox`; `../src/voxels/octree/leafId.js`
for `LeafId`, `encodeLeafId`, `decodeLeafId`, `parentLeafId`, `childLeafIds`, `octantOf`; `three` for
`Vector3` and `Matrix4` in `leafBox` and `transformLeafToWorld`; `vitest`.

## Tests
This file *is* the test, run by `npm test` in the node environment. It pins
`src/voxels/octree/octree.ts` and `src/voxels/octree/leafId.ts`; volume preservation is also what
`document/detach.ts` relies on when it re-roots a leaf.
