# tests/detach.test.ts

Ring: 1 · Layer: tests (node, no GPU) · Depends on: `../src/document/detach.js`,
`../src/document/project.js`, `../src/voxels/octree/octree.js`, `../src/voxels/uniform/grid.js`,
`three`, `vitest`

## Responsibility
Pins cross-representation detach: the extracted region becomes a new object whose local origin is the
region's min corner, whose world-space positions and appearance are unchanged, and whose source no
longer holds those cells. It does not test picking, UI selection, or name collisions.

## Public interface
`describe` / `it` names are this file's observable surface:
- `detachUniformBox` — `re-indexes the cells so the region min corner is the new local origin`, `sets a
  translation-only transform equal to the region world min corner`, `preserves the world position of
  every extracted cell`, `removes the extracted cells and leaves the rest intact`, `names the object
  "<source name> part <n>" and parents it to the source parent`, `fails with empty-region and changes
  nothing`, `fails with missing-object or wrong-representation`
- `detachOctreeLeaf` — `creates a one-leaf root box whose rootSize equals the leaf edge`, `carries the
  source leaf attributes into the new root leaf`, `can be split further after the detach`, `uses the
  leaf label as the object name`, `removes the source leaf and prunes the branches it empties`,
  `detaches a root leaf by clearing the source root occupancy`, `fails with not-a-leaf for a branch id`

## Internal logic
1. Each test builds a fresh `Project`, creates one voxel object from a hand-written container, and
   records the source's transform, name, and mask color before the call, so "source unchanged" is
   checked rather than assumed.
2. World-position preservation is asserted by applying `project.worldMatrix(id)` to the cell or leaf
   center before and after, never by reading the new container by index alone.
3. The uniform fixture uses a box with a negative local min corner, so a re-indexing bug that assumes
   a zero min corner cannot pass; the octree fixture detaches a depth-2 leaf of an occupied subtree,
   which leaves siblings behind and gives the new root box an edge of `rootSize / 4`.

## Invariants
- The new object's local cell `(x, y, z)` holds what source cell `box.min + (x, y, z)` held, and its
  transform is translation-only with `position` at the region's world-space min corner.
- Every detached cell's world center is identical before and after, in both representations.
- The source container reports no occupancy at the detached coordinates afterwards, and the source
  object's id, name, transform, `maskColor`, and `representation` are unchanged. A root-leaf target —
  the only leaf of a one-leaf octree — is pinned too: the detach returns `ok` with the attrs on the new
  object's root leaf and leaves the source with `occupiedLeafCount === 0` rather than throwing, and a
  second attempt at that emptied leaf returns `'empty-region'`.
- The new object keeps the source's `representation`, takes `parentId === source.parentId`, is
  `visible`, and takes the `maskColor` that `project.nextMaskColor()` returned during the call.
- The new `Octree` has `rootSize` equal to the source's `leafSize(leafDepth)`, the same `maxDepth`,
  `leafCount === 1`, and one occupied root leaf `"0:"` carrying the source leaf's `occupied`, `color`,
  and `label`, so the result can be split and detached again.
- Names come from the leaf's non-empty `label` when present, otherwise `"<source name> part <n>"`, where
  `n` is the smallest positive integer that no existing object already carries.
- A failed detach mutates nothing: object count, container state, and the id sequence are unchanged, so
  no id is burned on failure.

## Errors
- Both functions return `{ ok: false, error, detail }` and never throw: `'missing-object'` for an
  unknown `ObjectId`, `'wrong-representation'` when the source holds the other container,
  `'empty-region'` for an all-empty box or an unoccupied leaf, `'not-a-leaf'` for a branch id or a
  leaf id the source octree does not have.
- `detail` names the source id and the offending region; the suite asserts the literal and that the
  message is non-empty, not its wording.

## Dependencies
`../src/document/detach.js` for `detachUniformBox`, `detachOctreeLeaf`, `DetachResult`;
`../src/document/project.js` for `Project` (lookup, `worldMatrix`, `nextMaskColor`);
`../src/voxels/octree/octree.js` for the octree source; `three` for `Vector3` and `Matrix4`; `vitest`.

## Tests
This file *is* the test, run by `npm test` in the node environment. It pins `src/document/detach.ts`,
which `editor/ops.ts` reaches through `detachSelection`; the UI flow that produces a selection is
verified by running the application.
