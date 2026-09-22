# src/voxels/uniform/grid.ts

Ring: 0 · Layer: voxels/uniform · Depends on: nothing (innermost module; no Three.js import)

## Responsibility
Sparse uniform voxel grid for exactly one object: integer cell coordinates to `HexColor`, plus integer-box
region operations (fill, clear, paint, extract) and allocation-free integer keys. It holds no
transform, identity, or scene state, and allocates no Three.js object per cell. The lattice is the world
unit (`CELL_SIZE`, README D41), so a cell coordinate is a world coordinate and the grid stores no size.

## Public interface
```ts
const CELL_SIZE = 1; // the world unit: one voxel is one world unit (README D41)
type CellKey = number;
type HexColor = number; // 0xRRGGBB, the THREE.Color.getHex()/setHex() exchange form
type IntBox3 = { min: readonly [number, number, number]; max: readonly [number, number, number] };

class UniformGrid {
  static create(): UniformGrid;
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
  extractBox(box: IntBox3, opts: { remove: boolean }): Map<CellKey, HexColor>;
}

function packKey(x: number, y: number, z: number): CellKey;
function unpackKey(key: CellKey): [number, number, number];
function normalizeBox(a: readonly [number, number, number], b: readonly [number, number, number]): IntBox3;
function boxCount(box: IntBox3): number;
function boxEquals(a: IntBox3, b: IntBox3): boolean;
```

## Internal logic
1. Storage is `Map<CellKey, HexColor>`; the occupied set is exactly the key set, so `size === map.size`, `has` is `map.has(packKey(...))`, and `getColor` returns `undefined` for an unoccupied cell.
2. `packKey(x, y, z) = (x + 512) * 1024 * 1024 + (y + 512) * 1024 + (z + 512)`, with each axis an integer in `[-512, 511]`; every key therefore lies in `[0, 1074790398]` and is an exact 32-bit integer. `unpackKey` is the exact inverse and re-checks nothing.
3. Min-corner convention at the world unit (README D41): cell `(x, y, z)` occupies `[x, x + 1]` on each axis, because `CELL_SIZE` is `1`. The grid stores integers only and never converts to meters or another space; that conversion is the owning object's transform.
4. `set` assigns unconditionally — overwrite-on-set — never throwing on an occupied cell, and never growing `size` when the cell was already occupied. `remove` is `map.delete` and reports whether the cell was occupied.
5. `fillBox` iterates the inclusive integer box and writes every cell, costing `O(boxCount(box))` and returning `boxCount(box)`. `clearBox` and `paintBox` instead scan the existing entries and test containment — `O(size)`, not `O(box volume)`: `clearBox` deletes each contained entry and returns that count, `paintBox` replaces each contained entry's color and returns that count without ever creating a cell.
6. `extractBox` builds a fresh `Map<CellKey, HexColor>` holding the original packed keys of the cells inside the box; with `opts.remove === true` it also deletes those cells from this grid, and the returned map is a copy that later grid writes never touch.
7. `bounds` is one pass over the entries, narrowing min and max componentwise, and returns `null` when the grid is empty. `boxCount` is the product of the inclusive extents, `boxEquals` compares the six numbers, and `normalizeBox` returns the componentwise min and max of its corners, so `min <= max` on every axis.
8. `forEach` visits entries in `Map` insertion order — deterministic for a given mutation sequence, not sorted by coordinate.

## Invariants
- `CELL_SIZE` is `1`, so cell coordinates are world coordinates; the grid holds no size to multiply them by, and `create()` takes no argument (README D41).
- Every key present was produced by `packKey` from in-range integer coordinates; no cell outside `[-512, 511]³` is ever stored.
- After `set(x, y, z, c)`: `has(x, y, z)` is true, `getColor(x, y, z) === c`, and `size` grew by one only if the cell was previously unoccupied.
- After `fillBox(box, c)` every cell of `box` is occupied with color `c` and the return value is `boxCount(box)`; after `clearBox(box)` no occupied cell lies inside `box` and `size` fell by exactly the returned count.
- After `paintBox(box, c)`: `size` is unchanged, no cell outside `box` changed color, and every occupied cell inside `box` has color `c`.
- After `extractBox(box, { remove: true })` the grid holds no cell inside `box`, and the returned map holds exactly the previously occupied cells of that box under identical keys.
- `normalizeBox(a, b) === normalizeBox(b, a)` with `min <= max` per axis; `IntBox3` is inclusive on both corners everywhere in the project.
- No operation allocates a Three.js object; per-cell allocation is limited to `Map` entries.

## Errors
- `packKey` and every coordinate-taking method throw `RangeError` for a non-integer or out-of-range axis value, naming the axis and the value; the accepted range is `[-512, 511]` per axis.
- An inverted box (`min > max` on an axis) is normalized by callers through `normalizeBox`; the region methods treat the box as given and inclusive, so an inverted box writes nothing and `boxCount` is `0` rather than throwing.
- These are all programmer errors and throw; the grid has no `Result` type and never returns a silently degenerate value. The per-object voxel budget is not enforced here — callers check it before writing (README D12).

## Dependencies
None. `CellKey`, `HexColor`, and `IntBox3` are declared here and imported from `voxels/uniform/grid.js` by
`voxels/voxelize`, `three-runtime/scene.ts`, `three-runtime/overlay.ts`, and `editor/ops.ts`, which must not
re-declare them. `CELL_SIZE` is the single constant this module declares, and it is what makes the lattice
the world unit (README D41): `voxels/voxelize/surface.ts` and `three-runtime/scene.ts` read it for cell cubes
and half extents, so nothing may hard-code a second copy of the world unit.

## Tests
`tests/uniform.test.ts`: key packing at both range ends and `RangeError` outside them; `packKey`/`unpackKey`
round-trip; `normalizeBox` with reversed corners; `fillBox`/`clearBox`/`paintBox` counts and their effect on
`size`; `extractBox` with and without `remove`, including that the returned keys unpack to the box coordinates;
overwrite-on-set leaves `size` unchanged; `bounds` is `null` when empty and inclusive when not.
