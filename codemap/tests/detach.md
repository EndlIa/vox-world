# tests/detach.test.ts

Ring: 1 · Layer: tests (node, no GPU) · Depends on: `../src/document/detach.js`,
`../src/document/project.js`, `../src/voxels/uniform/grid.js`, `three`, `vitest`

## Responsibility
Pins uniform detach: a box region of a uniform object becomes a new object whose local origin is the
region's min corner, whose world-space positions and appearance are unchanged, and whose source no
longer holds those cells. It does not test picking, UI selection, or name collisions.

## Public interface
`describe` / `it` names are this file's observable surface:
- `detachUniformBox` — `re-indexes the cells so the region min corner is the new local origin`, `sets a
  translation-only transform equal to the region world min corner`, `preserves the world position of
  every extracted cell`, `leaves the flag off when the parent it inherits is turned, instead of snapping
  the region`, `gives the new object the source's subdivision, with the region still in place`, `removes the
  extracted cells and leaves the rest intact`, `names the object
  "<source name> part <n>" and parents it to the source parent`, `fails with empty-region and changes
  nothing`, `fails with missing-object or wrong-representation`

## Internal logic
1. Each test builds a fresh `Project`, creates one voxel object from a hand-written grid, and
   asserts the source's id, name, transform, and mask color against the values the fixture gave it,
   so "source unchanged" is checked rather than assumed.
2. World-position preservation is asserted by applying `project.worldMatrix(id)` to the cell
   center — `(index + 0.5) · cell` per axis, with `cell` the object's own `uniform.cellSize` and
   `CELL_SIZE` as the fallback, because cell `i` spans `[i, i + 1]` cells and a cell is
   `CELL_SIZE / subdivision` world units (D41, D43) — before and after, never by reading the new grid
   by index alone.
3. The fixture uses a box with a negative local min corner, so a re-indexing bug that assumes
   a zero min corner cannot pass.
4. The alignment case reparents the fixture source under a parent that is turned and sits at a
   fractional position before detaching, so the frame the region inherits is off the lattice; flag and
   world center are asserted together, which is what separates "created unaligned" from "snapped and then
   claimed unaligned".

## Invariants
- The new object's local cell `(x, y, z)` holds what source cell `box.min + (x, y, z)` held, and its
  transform is translation-only with `position` at the region's world-space min corner: the
  assertion adds the box's integer min corner times the source's cell size to the source's position — the
  unit fixture's `1`, so the plain integer addition is what a wrong cell factor would break — and
  pins the identity quaternion and unit scale.
- The grid sizes are pinned: the re-indexed grid holds 3 cells, the source drops to 1, and a failed
  detach leaves the source at 4; the fixture's far-away cell at `(5, 5, 5)` keeps its color, so a
  detach that cleared or rewrote the rest of the source grid cannot pass.
- The naming case detaches from a source under a moved parent and checks that the new object's
  world min corner equals the region's world min corner, so the placement is pinned without an
  identity parent frame.
- Every detached cell's world center is identical before and after.
- A slice cut from a subdivided source keeps that source's level: the part of a `grid.subdividedBy(1)` source
  reports `subdivision` `2` and the cell that was `(-4, -2, 0)` there is its local `(0, 0, 0)` with the same
  world center, so a detach that re-created the payload on the unit lattice — or re-scaled the region — cannot pass.
- The flag is derived, not asserted: detaching from a source under a parent that is turned and sits at a
  fractional position gives an object with `alignToGrid` clear whose extracted cell center still lands
  where the source's own frame puts it, so the creation rule is pinned against a snap in the same
  assertion.
- The source grid reports no occupancy at the detached coordinates afterwards, and the source
  object's id, name, transform, `maskColor`, and `representation` are unchanged.
- The new object keeps the source's `representation`, takes `parentId === source.parentId`, is
  `visible`, and takes the `maskColor` that `project.nextMaskColor()` returned during the call.
- `'wrong-representation'` is exercised with an `'empty'` placeholder — the only representation left
  that cannot carry a box — and the attempt changes nothing about it.
- Names come from `"<source name> part <n>"`, where
  `n` is the smallest positive integer that no existing object already carries.
- A failed detach mutates nothing: object count, grid state, and the id sequence are unchanged, so
  no id is burned on failure.

## Errors
- `detachUniformBox` returns `{ ok: false, error, detail }` and never throws: `'missing-object'` for an
  unknown `ObjectId`, `'wrong-representation'` when the source is not a uniform object,
  `'empty-region'` for an all-empty box.
- `detail` names the source id and the offending region; the suite asserts the literal and that the
  message is non-empty, not its wording.

## Dependencies
`../src/document/detach.js` for `detachUniformBox`, `DetachResult`;
`../src/document/project.js` for `Project` (lookup, `createObject`, `worldMatrix`, `nextMaskColor`);
`../src/voxels/uniform/grid.js` for `CELL_SIZE`, `UniformGrid`, and `IntBox3`; `three` for
`Vector3` and `Euler`; `vitest`.

## Tests
This file *is* the test, run by `npm test` in the node environment. It pins `src/document/detach.ts`,
which `editor/ops.ts` reaches through `detachSelection`; the UI flow that produces a selection is
verified by running the application.
