# tests/uniform.test.ts

Ring: 0 · Layer: tests (node, no GPU) · Depends on: `../src/voxels/uniform/grid.js`, `vitest`

## Responsibility
Pins the sparse uniform grid: key packing bounds, box normalization and volume math, cell overwrite
and removal, the four region operations with their written-cell counts, and the subdivision a grid
carries with its derived cell size and block replication. Rendering, `Map`
internals, and the packed key layout are not tested here — only observable behavior; the cube size and
content centre that consume a grid's `cellSize` are pinned in `tests/scene.test.ts`.

## Public interface
`describe` / `it` names are this file's observable surface:
- `packKey / unpackKey` — `round-trips coordinates inside [-512, 511]`, `throws RangeError outside it`
- `box helpers` — `normalizes swapped corners`, `counts a box volume`, `compares boxes by corners`
- `UniformGrid cells` — `reports size, presence, and color`, `overwrites an occupied cell's color`,
  `returns presence from remove`
- `UniformGrid regions` — `fills and counts writes`, `clears and counts removals`, `paints only
  occupied cells`, `bounds the occupied set and returns null when empty`
- `extractBox` — `extracts without changing the grid`, `extracts and removes the cells`
- `subdivision` — `is one cell per world unit by default, and a power of two otherwise`, `refuses a
  level that is not a positive power of two`, `replaces each cell with a block of itself, colors and
  all`, `can be applied twice for four levels, and refuses a non-positive level count`

## Internal logic
1. One fresh grid per test, through `UniformGrid.create()` — the constructor is private and `create` takes only a subdivision, defaulting to the unit lattice (README D41); no grid is shared between tests.
2. Region expectations are literal coordinate lists, never loops over the grid, so a count change
   fails visibly instead of re-deriving the same mistake.
3. Packing samples the corners and interior triples containing `-512` and `511`, with `-513` and `512`
   as the rejections; `extractBox` is checked on the returned `Map` and again by re-reading the grid.
4. The subdivision cases read `subdivision` and `cellSize` off the grids instead of assuming a level, put one source cell at a negative coordinate so a replication that only walks forward fails, and re-read the source grid after `subdividedBy` so "the receiver is untouched" is asserted rather than assumed.

## Invariants
- `UniformGrid.create()` defaults to `subdivision` `1` with `cellSize === CELL_SIZE`, and `create(4)` reports `4` and `0.25`: the world unit stays the base and the level a grid carries is the only spacing it holds (README D41, D43), fixed when the grid is made.
- `isSubdivision` is true exactly for the integer powers of two `>= 1` the suite samples (`1`, `2`, `512`) and false for `0`, `-2`, `3`, `1.5`, and `NaN`, each of which `create` refuses.
- `subdividedBy(1)` doubles the subdivision and replaces each occupied cell with an eight-cell block of itself in the same color — including a cell at a negative coordinate, whose block stays in the negative frame, and one whose block stops short of the empty coordinate past it — and leaves the receiver's `subdivision`, `size`, and colors unchanged.
- Applying `subdividedBy(1)` twice reaches subdivision `4`, with blocks of `4³` cells and 64 cells written for one source cell; a `levels` of `0` is refused rather than clamped.
- `packKey` is injective over `[-512, 511]` per axis, throws `RangeError` outside that range, and
  `unpackKey(packKey(x, y, z))` returns `[x, y, z]`.
- `size` equals occupancy and the count `forEach` visits; `set` on an occupied cell replaces its color
  and leaves `size` unchanged.
- `fillBox` returns cells written, `clearBox` cells removed, and `paintBox` only the occupied cells it
  recolored, so `paintBox <= fillBox` for the same box.
- `extractBox` returns a key/color snapshot: with `remove: true` those cells are gone afterwards, with
  `remove: false` the grid is unchanged.
- `bounds()` returns inclusive corners of the occupied set and `null` exactly when the grid is empty.

## Errors
- `RangeError` from `packKey` and from any coordinate-taking operation for a non-integer axis value or
  one outside `[-512, 511]`; the suite asserts the literal bound only on `packKey`.
- `create` and `subdividedBy` throw `RangeError` for a subdivision that is not a positive power of two and for a `levels` that is not a positive integer; the suite asserts the error type, never the message.
- No result unions here: every operation is total once its coordinates are in range, and an inverted
  box writes nothing instead of throwing.

## Dependencies
`../src/voxels/uniform/grid.js` for `CELL_SIZE`, `UniformGrid`, `isSubdivision`, `packKey`, `unpackKey`,
`normalizeBox`, `boxCount`, `boxEquals`, `IntBox3`; `vitest` for `describe`, `it`, `expect`, `beforeEach`. No `three` import.

## Tests
This file *is* the test, run by `npm test` (`vitest run`) in the node environment. It pins
`src/voxels/uniform/grid.ts`; `document/detach.ts` and `editor/ops.ts` reuse the box algebra it covers.
`tests/scene.test.ts` is where the derived geometry these grids feed is pinned instead: one mirrored cube
per cell at the object's own `cellSize`, placed half a cell past its cell coordinate, and
`contentCenterOf` mid-pointed on that same lattice, both asserted at subdivision `1` against a finer level
(`2` for the cube, `4` for the centre), so a grid-level mistake that leaves every cell coordinate intact
shows up there rather than here.
