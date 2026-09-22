# src/voxels/voxelize/surface.ts

Ring: 0 · Layer: voxels/voxelize · Depends on: `../uniform/grid.js` (`CELL_SIZE`, `CellKey`)

## Responsibility
Conservative surface voxelization: given one indexed triangle soup, produce the set of grid cells whose
cube the surface actually touches. A cell is the world unit cube (`CELL_SIZE`, README D41), so the kernel
has no cell size to take. It is not a volume filler, it samples no colors, and it allocates no
payload container — `voxelize.ts` owns both of those steps.

## Public interface
```ts
type TriangleSoup = { positions: Float32Array; index: Uint32Array };  // already in target space
type SurfaceCells = { cells: Map<CellKey, number>; triangleCount: number };  // value = triangle index

function voxelizeSurface(soup: TriangleSoup, opts: {
  budget: number;
  onProgress?: (ratio: number) => void;
  signal?: AbortSignal;
}): SurfaceCells | { error: 'budget-exceeded' | 'cancelled'; detail: string };
```
Each map value is the index of the first triangle *within `soup`* that claimed that cell; the caller
translates it to a global triangle index and then to a color.

## Internal logic
1. Module-local `const CHUNK = 512`: the repository chunking convention, declared here and exported by
   nobody.
2. `triangleCount = index.length / 3`. A soup with zero triangles returns
   `{ cells: new Map(), triangleCount: 0 }` immediately — an empty but valid input, and whether that is
   an error is the caller's decision, not this file's.
3. Per triangle `t`, in ascending index order:
   - read the three vertices, take the component-wise min/max;
   - candidate cells are `Math.floor(min) .. Math.floor(max)` per axis — one cell per lattice span covered
     by the triangle's AABB, the min-corner convention at the world unit (README D41) — and a cell's cube is
     that cell's unit cube, half extent `CELL_SIZE / 2`. A face lying exactly on a lattice plane therefore
     claims the cells on both sides;
   - iterate candidates in `z`, then `y`, then `x` order (deterministic);
   - keep a candidate only when the triangle and the cell cube are not separated: separating-axis test
     over 13 axes — the 3 box normals, the triangle plane normal, and the 9 cross products of each
     triangle edge with each box axis. A zero-area triangle skips the degenerate plane axis, which the
     candidate range already bounds;
   - `cells.set(key, t)` only when the key is absent: the first triangle that claims a cell keeps it,
     which is what makes the resulting color deterministic.
4. Chunking, settled: every `CHUNK` processed triangles call `onProgress(processed / triangleCount)` and, when
   `signal.aborted` is true, return
   `{ error: 'cancelled', detail: 'cancelled after <processed> of <triangleCount> triangles' }`. This kernel is synchronous and
   awaits nothing: `voxelize.ts` owns the per-`CHUNK` host yield and calls this function once per `CHUNK`-triangle slice of the soup.
5. Budget: before a new key would grow the map past `opts.budget`, return
   `{ error: 'budget-exceeded', detail: 'cell budget exceeded: <cells.size + 1> cells at the limit of <budget>' }`.
   The check runs before the write, so the map never grows past the budget and the caller has not yet
   allocated a payload (README D12).

## Invariants
- Every key in `cells` is a cell cube the surface really intersects; no candidate is kept otherwise.
- `cells.size <= budget` on every return path.
- Determinism: identical `soup` and `budget` give the identical map and identical
  per-key triangle indices for any callback or signal.
- A key is never reassigned, and its triangle index is always `< triangleCount`.
- `onProgress` receives a non-decreasing ratio in `[0, 1]`, once per processed `CHUNK`, and is not
  called at all for an empty soup.
- Cell indices are neither clamped nor aligned here; the caller aligns the soup so that the payload
  containers' coordinate ranges hold (see `voxelize.ts`).

## Errors
Returned, never thrown:
- `{ error: 'budget-exceeded'; detail }` — the map would pass `opts.budget`.
- `{ error: 'cancelled'; detail }` — `signal.aborted` at a chunk boundary.
Thrown (programmer errors):
- `TypeError` when `index.length % 3 !== 0` or `positions.length % 3 !== 0`.
- `RangeError` when `budget` is not a non-negative integer, or when an `index` entry is not a valid
  vertex of `positions`. `voxelize.ts` pre-validates soups so that mesh-driven malformations surface as
  `'unsupported-geometry'` results instead of throws.

## Dependencies
- `../uniform/grid.js` — `CellKey` as a type, and `CELL_SIZE` as a value: the lattice is the world unit
  (README D41), so the kernel reads it instead of taking a cell size. This file packs its own keys with
  the *same layout* the container uses, so the container's `unpackKey` inverts them, but without the
  container's `[-512, 511]` guard: every coordinate that reaches this kernel is non-negative and already
  aligned to the lattice, and the kernel must not throw from a data-driven path. The guard stays
  where an out-of-range coordinate is a caller bug, in `UniformGrid` itself.
- No `three` import and no outer-ring import: nothing from the library is needed, because the
  intersection test is scalar arithmetic over `Float32Array` reads.

## Tests
`tests/voxelize.test.ts` pins: an axis-aligned triangle slab at unit cells yields exactly the
expected `CellKey` set and not the cells of its interior, the first-claiming triangle index per key,
the `budget-exceeded` abort, and the `cancelled` abort through an already-aborted signal.

## Open questions
- `TriangleSoup` is indexed by construction, so non-indexed geometry has no representation here; the
  importer is expected to index it before building a soup.
