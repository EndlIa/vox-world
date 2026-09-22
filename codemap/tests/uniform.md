# tests/uniform.test.ts

Ring: 0 · Layer: tests (node, no GPU) · Depends on: `../src/voxels/uniform/grid.js`, `vitest`

## Responsibility
Pins the sparse uniform grid: key packing bounds, box normalization and volume math, cell overwrite
and removal, and the four region operations with their written-cell counts. Rendering, `Map`
internals, and the packed key layout are not tested — only observable behavior.

## Public interface
`describe` / `it` names are this file's observable surface:
- `packKey / unpackKey` — `round-trips coordinates inside [-512, 511]`, `throws RangeError outside it`
- `box helpers` — `normalizes swapped corners`, `counts a box volume`, `compares boxes by corners`
- `UniformGrid cells` — `reports size, presence, and color`, `overwrites an occupied cell's color`,
  `returns presence from remove`
- `UniformGrid regions` — `fills and counts writes`, `clears and counts removals`, `paints only
  occupied cells`, `bounds the occupied set and returns null when empty`
- `extractBox` — `extracts without changing the grid`, `extracts and removes the cells`

## Internal logic
1. One fresh grid per test, through a bare `UniformGrid.create()` — the constructor takes no size, because a cell is the world unit (README D41); no grid is shared between tests.
2. Region expectations are literal coordinate lists, never loops over the grid, so a count change
   fails visibly instead of re-deriving the same mistake.
3. Packing samples the corners and interior triples containing `-512` and `511`, with `-513` and `512`
   as the rejections; `extractBox` is checked on the returned `Map` and again by re-reading the grid.

## Invariants
- `UniformGrid.create()` takes no argument and the grid exposes no cell size: coordinates are the world unit (README D41), so there is no spacing left to pin.
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
- No result unions here: every operation is total once its coordinates are in range, and an inverted
  box writes nothing instead of throwing.

## Dependencies
`../src/voxels/uniform/grid.js` for `UniformGrid`, `packKey`, `unpackKey`, `normalizeBox`, `boxCount`,
`boxEquals`, `IntBox3`; `vitest` for `describe`, `it`, `expect`, `beforeEach`. No `three` import.

## Tests
This file *is* the test, run by `npm test` (`vitest run`) in the node environment. It pins
`src/voxels/uniform/grid.ts`; `document/detach.ts` and `editor/ops.ts` reuse the box algebra it covers.
