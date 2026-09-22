# src/voxels/uniform/grid.ts

Ring: 0 · Layer: voxels/uniform · Depends on: nothing (innermost module; no Three.js import)

## Responsibility
Sparse uniform voxel grid for exactly one object: integer cell coordinates to `HexColor`, plus integer-box
region operations (fill, clear, paint, extract) and allocation-free integer keys. It holds no
transform, identity, or scene state, and allocates no Three.js object per cell. The lattice is the world
unit (`CELL_SIZE`) a grid subdivides: cell `(x, y, z)` occupies `[x / subdivision, (x + 1) / subdivision]` of a
world unit, so a cell coordinate is a world coordinate times the subdivision the grid carries and the grid
stores no size (README D41, D43).

## Public interface
```ts
const CELL_SIZE = 1; // the world unit: the base cell size a grid subdivides
const KEY_MIN = -512;                                // exported inclusive per-axis bounds of the key space
const KEY_MAX = 511;
type CellKey = number;
type HexColor = number; // 0xRRGGBB, the THREE.Color.getHex()/setHex() exchange form
type IntBox3 = { min: readonly [number, number, number]; max: readonly [number, number, number] };

class UniformGrid {
  static create(subdivision = 1): UniformGrid;         // validates the level
  readonly subdivision: number;                        // cells per world unit, fixed for the grid's life
  get cellSize(): number;                              // CELL_SIZE / subdivision
  get size(): number;                                  // occupied cell count
  has(x: number, y: number, z: number): boolean;
  getColor(x: number, y: number, z: number): HexColor | undefined;
  set(x: number, y: number, z: number, color: HexColor): void;         // overwrites color
  remove(x: number, y: number, z: number): boolean;
  forEach(cb: (x: number, y: number, z: number, color: HexColor) => void): void;
  bounds(): IntBox3 | null;                            // null when empty
  fillBox(box: IntBox3, color: HexColor): number;      // returns cells written
  clearBox(box: IntBox3): number;                      // returns cells deleted
  paintBox(box: IntBox3, color: HexColor): number;     // occupied cells only
  subdividedBy(levels: number): UniformGrid;           // a copy 2**levels finer; the receiver is untouched
  extractBox(box: IntBox3, opts: { remove: boolean }): Map<CellKey, HexColor>;
}

function isSubdivision(value: number): boolean;        // integer power of two >= 1
function packKey(x: number, y: number, z: number): CellKey;
function unpackKey(key: CellKey): [number, number, number];
function normalizeBox(a: readonly [number, number, number], b: readonly [number, number, number]): IntBox3;
function boxCount(box: IntBox3): number;
function boxEquals(a: IntBox3, b: IntBox3): boolean;
```

## Internal logic
1. Storage is `Map<CellKey, HexColor>`; the occupied set is exactly the key set, so `size === map.size`, `has` is `map.has(packKey(...))`, and `getColor` returns `undefined` for an unoccupied cell.
2. `packKey(x, y, z) = (x − KEY_MIN) · AXIS_SPAN² + (y − KEY_MIN) · AXIS_SPAN + (z − KEY_MIN)`, where the exported `KEY_MIN`/`KEY_MAX` are `-512`/`511` and `AXIS_SPAN = KEY_MAX − KEY_MIN + 1` is derived from them; each axis must be an integer in `[KEY_MIN, KEY_MAX]`. Every key therefore lies in `[0, 1074790398]` and is an exact 32-bit integer. `unpackKey` is the exact inverse and re-checks nothing.
3. Min-corner convention on the world lattice: cell `(x, y, z)` occupies `[x / subdivision, (x + 1) / subdivision]` of a world unit on each axis, because `CELL_SIZE` is `1` and one cell is `1 / subdivision` of it. The grid stores integers only and never converts to meters or another space; that conversion is the owning object's transform.
4. `set` assigns unconditionally — overwrite-on-set — never throwing on an occupied cell, and never growing `size` when the cell was already occupied. `remove` is `map.delete` and reports whether the cell was occupied.
5. `fillBox` iterates the inclusive integer box and writes every cell, costing `O(boxCount(box))` and returning `boxCount(box)`. `clearBox` and `paintBox` instead scan the existing entries and test containment — `O(size)`, not `O(box volume)`: `clearBox` deletes each contained entry and returns that count, `paintBox` replaces each contained entry's color and returns that count without ever creating a cell.
6. `extractBox` builds a fresh `Map<CellKey, HexColor>` holding the original packed keys of the cells inside the box; with `opts.remove === true` it also deletes those cells from this grid, and the returned map is a copy that later grid writes never touch.
7. `bounds` is one pass over the entries, narrowing min and max componentwise, and returns `null` when the grid is empty. `boxCount` is the product of the inclusive extents, `boxEquals` compares the six numbers, and `normalizeBox` returns the componentwise min and max of its corners, so `min <= max` on every axis.
8. `forEach` visits entries in `Map` insertion order — deterministic for a given mutation sequence, not sorted by coordinate.
9. `create(subdivision = 1)` validates through `assertSubdivision`, which throws unless `isSubdivision` holds (an integer `>= 1` whose `Math.log2` is an integer, so a cell is an exact binary fraction), and passes the level to a private constructor: `subdivision` is `readonly` and fixed for the grid's life, while `cellSize` is derived from it (`CELL_SIZE / subdivision`) instead of being stored. The default is the unit lattice, so a caller that never names a level gets one voxel per world unit.
10. `subdividedBy(levels)` copies rather than mutates: it throws `RangeError` unless `levels` is a positive integer, builds a grid at `subdivision · 2**levels`, and writes every source cell `(x, y, z)` as the `2**levels`-cube block based at `(x · factor, y · factor, z · factor)` in the same color, leaving the receiver and every other cell of the copy untouched. A block *is* the old cell in world space — the new cell is `1 / 2**levels` of it and both grids keep the same placement — so refinement adds no detail and moves nothing. Too fine a level near the boundary is refused by the key space, not clamped: the copy's coordinates leave `[KEY_MIN, KEY_MAX]` and `packKey` throws, so a caller that can be asked for one checks the level first (`editor/ops.ts`).

## Invariants
- `CELL_SIZE` is `1` and `subdivision` is a power of two fixed at creation, so `cellSize === CELL_SIZE / subdivision` and a cell coordinate is a world coordinate times that subdivision; the grid stores no length to multiply them by.
- Every key present was produced by `packKey` from in-range integer coordinates; no cell outside `[KEY_MIN, KEY_MAX]³` is ever stored.
- `create(subdivision)` accepts exactly what `isSubdivision` accepts — integer powers of two `>= 1` — and `assertSubdivision` is the only gate, so a grid can never hold a `0`, negative, or fractional level, and the constructor stays private.
- `subdividedBy(levels)` never writes the receiver: the copy's subdivision is exactly `subdivision · 2**levels`, each source cell's `2**levels`-cube block is occupied there in the same color with no other cell written, and the source's `subdivision`, `size`, and colors are unchanged.
- After `set(x, y, z, c)`: `has(x, y, z)` is true, `getColor(x, y, z) === c`, and `size` grew by one only if the cell was previously unoccupied.
- After `fillBox(box, c)` every cell of `box` is occupied with color `c` and the return value is `boxCount(box)`; after `clearBox(box)` no occupied cell lies inside `box` and `size` fell by exactly the returned count.
- After `paintBox(box, c)`: `size` is unchanged, no cell outside `box` changed color, and every occupied cell inside `box` has color `c`.
- After `extractBox(box, { remove: true })` the grid holds no cell inside `box`, and the returned map holds exactly the previously occupied cells of that box under identical keys.
- `normalizeBox(a, b) === normalizeBox(b, a)` with `min <= max` per axis; `IntBox3` is inclusive on both corners everywhere in the project.
- No operation allocates a Three.js object; per-cell allocation is limited to `Map` entries.

## Errors
- `packKey` and every coordinate-taking method throw `RangeError` for a non-integer or out-of-range axis value, naming the axis and the value; the accepted range is `[KEY_MIN, KEY_MAX]` per axis.
- `create`/`assertSubdivision` throw `RangeError` for a subdivision that is not an integer power of two `>= 1`, and `subdividedBy` throws `RangeError` for a `levels` that is not a positive integer, both naming the offending value. A legal level whose blocks would leave the key space is not clamped: `packKey` throws out of `subdividedBy` instead, which is why `editor/ops.ts` checks the refined extents before asking.
- An inverted box (`min > max` on an axis) is normalized by callers through `normalizeBox`; the region methods treat the box as given and inclusive, so an inverted box writes nothing and `boxCount` is `0` rather than throwing.
- These are all programmer errors and throw; the grid has no `Result` type and never returns a silently degenerate value. The per-object voxel budget is not enforced here — callers check it before writing (README D12).

## Dependencies
None. `CellKey`, `HexColor`, and `IntBox3` are declared here and imported from `voxels/uniform/grid.js` by
`voxels/voxelize`, `three-runtime/scene.ts`, `three-runtime/overlay.ts`, and `editor/ops.ts`, which must not
re-declare them. `CELL_SIZE` is the base cell size a grid subdivides (README D41): `voxels/voxelize/surface.ts`
reads it for a voxel's half extent and `document/project.ts` for the cell an aligned object with no payload
grid rounds to, while `three-runtime/scene.ts` draws each cube at the grid's own `cellSize` and
`three-runtime/overlay.ts` takes the cell from its caller, so nothing may hard-code a second copy of the world
unit. `KEY_MIN`/`KEY_MAX` export the key space's
per-axis bounds and `isSubdivision` its level rule, both consumed
by `editor/ops.ts` to refuse a subdivision it cannot apply; the instance's `subdivision` and derived `cellSize`
are read rather than re-derived by `document/project.ts`, `document/detach.ts`, `three-runtime/scene.ts`,
`editor/pointer.ts`, and `editor/session.ts`.

## Tests
`tests/uniform.test.ts`: key packing at both range ends and `RangeError` outside them; `packKey`/`unpackKey`
round-trip; `normalizeBox` with reversed corners; `fillBox`/`clearBox`/`paintBox` counts and their effect on
`size`; `extractBox` with and without `remove`, including that the returned keys unpack to the box coordinates;
overwrite-on-set leaves `size` unchanged; `bounds` is `null` when empty and inclusive when not. Its `subdivision`
describe pins the default level (`1`, `cellSize === CELL_SIZE`) and a finer one (`create(4)` → `0.25`), the
rejections (`0`, `-2`, `3`, `1.5`, `NaN` throw while `isSubdivision` is true for `1`, `2`, `512`), block
replication including a negative cell (`subdividedBy(1)` → subdivision `2`, `size` 16, per-cell colors and
`bounds`, with the source's own `subdivision` and `size` unchanged), a second level applied to the result
(subdivision `4`, `size` 64), and the `RangeError` for `subdividedBy(0)`.
