# src/voxels/uniform/region.ts

Ring: 0 · Layer: voxels/uniform · Depends on: ./grid.ts

## Responsibility
Which cells an edit addresses, and the four operations that read or write them: a region is a *shape* — an
inclusive integer box, every occupied cell of one colour, or the face-connected island a seed cell belongs
to — and this module is the only place that turns one into cells. It holds no state, no transform, no
identity, and no scene: every cell is in the owning grid's own integer coordinates, and a shape is plain data
a caller can hold, compare, or store between two calls.

Everything here is pure input and pure output. A walk never mutates, a writer mutates only the one grid it is
handed, and no function allocates a Three.js object. The box path deliberately costs what the grid's own box
operations always cost; a colour or an island is the path that allocates, and it allocates the keys it is
about to write.

## Public interface
```ts
import type { CellKey, HexColor, IntBox3, UniformGrid } from './grid.js';

type RegionShape =
  | { kind: 'box'; min: readonly [number, number, number]; max: readonly [number, number, number] }
  | { kind: 'color'; color: HexColor }
  | { kind: 'island'; seed: readonly [number, number, number] };

function regionCount(grid: UniformGrid, shape: RegionShape): number;
function regionBounds(grid: UniformGrid, shape: RegionShape): IntBox3 | null;
function visitRegion(grid: UniformGrid, shape: RegionShape, visit: (x: number, y: number, z: number, color: HexColor | undefined) => void): void;
function fillRegion(grid: UniformGrid, shape: RegionShape, color: HexColor): number;
function clearRegion(grid: UniformGrid, shape: RegionShape): number;
function paintRegion(grid: UniformGrid, shape: RegionShape, color: HexColor): number;
```

## Internal logic
1. `RegionShape` names a region without naming cells. A `box` is inclusive on both corners and is the only
   shape that can name an empty cell; a `color` is every occupied cell carrying that exact `HexColor`; an
   `island` is the seed cell plus everything reachable from it through face neighbours while staying occupied.
2. One walker, `forEachShapeCell`, backs all three shapes and hands each cell's coordinates and — when it has
   one — its colour to a callback. A box iterates its coordinates in order and asks `grid.getColor` per cell,
   so its `color` argument is `undefined` exactly where the cell is not occupied. A colour filters
   `grid.forEach`, which is what makes it read the container in the container's own insertion order. An island
   floods outward: `packKey(seed)` seeds a `Set<CellKey>` and a queue, each popped key visits its cell and
   probes the six face neighbours, and a neighbour joins the queue only when it is inside the key space and
   occupied.
3. `NEIGHBOURS` is the six face steps and never a diagonal: two blocks that touch only at a corner are two
   islands, which is the rule a flood fill has to state rather than inherit from the coordinate math.
4. The packed key space is a hard edge for the flood fill, not a wrap: a probe whose neighbour would fall
   outside `KEY_MIN..KEY_MAX` is skipped before `packKey` is called, because `packKey` throws there. A box has
   no such guard — its corners are its caller's, and a box outside the key space throws `RangeError` from
   `packKey` the same way `grid.fillBox` always has.
5. `regionCount` answers how many cells a shape names, and a box answers with `boxCount` — its whole extent,
   occupied or not — which is what makes it an upper bound for a write rather than a delta. A colour or an
   island counts the cells the walk reaches, so it is exact for them.
6. `regionBounds` answers the inclusive corners of the shape. A box reports its own extent even where it
   holds nothing, because the extent is what the shape says; a colour or an island accumulates the extremes
   of the cells it found and answers `null` when it found none. A caller that draws a frame can therefore
   tell "a region with no cells" from "a box over empty space".
7. `visitRegion` is the same walk, exposed for reading rather than writing: a caller that has to see the
   region before it is written to — an edit recorder capturing what an operation is about to change — walks
   it through here rather than reimplementing the shapes. It touches nothing.
8. The three writers share one shape-blind structure: a box delegates to the grid's own box operation
   (`fillBox`, `clearBox`, `paintBox`), and every other shape collects its keys through the walker and writes
   afterwards. Collecting first is not an optimisation — the walk reads the very map a write mutates, so
   writing during the walk would skip or revisit cells.
9. A writer returns the number of cells it touched, with the same meaning the grid's box operations give it:
   `fillRegion` counts the cells it wrote, `clearRegion` the occupied cells it removed, `paintRegion` the
   occupied cells it recoloured. Nothing creates a cell except `fillRegion`.

## Invariants
- Nothing here mutates except the three writers, and each of them touches only the grid it was handed: no
  function reads or writes a second container, a transform, or any state outside its arguments.
- A shape is interpreted the same way by `regionCount`, `regionBounds`, and all three writers: one walker and
  one neighbour table, so a count can never disagree with the write it guards.
- The box path is the grid's own: `fillRegion`, `clearRegion`, and `paintRegion` on a box call `grid.fillBox`,
  `grid.clearBox`, and `grid.paintBox` directly, so a box costs exactly what it always did and keeps the
  grid's own definition of an inverted box writing nothing.
- Every cell a walk yields is inside the packed key space, and an island never leaves it: the flood fill stops
  at the edge instead of throwing through `packKey`.
- An empty shape is not an error: an inverted box, a colour no cell carries, and a seed cell that is not
  occupied all name zero cells, and the writers answer `0` while `regionCount` answers `0` and `regionBounds`
  answers `null` for the last two.

## Errors
- Nothing throws for a shape that names no cell. The only throw is ring 0's own: a box whose corners fall
  outside `[-512, 511]` throws `RangeError` from `packKey`, which is a programmer error rather than a
  user-facing failure, exactly as it is for the grid's box operations.
- No writer partially fails: every shape is fully resolved into cells before the first write, so a writer
  either touches all of them or none.

## Dependencies
- `./grid.ts` — `UniformGrid` (the container), `HexColor`, `IntBox3`, `CellKey` (types), and the helpers
  `boxCount`, `normalizeBox`, `packKey`, `unpackKey`, `KEY_MIN`, `KEY_MAX`.
No Three.js import: a shape is integers and a colour, and nothing here needs a vector or a matrix.

## Tests
`tests/region.test.ts` is the direct coverage, and it pins what a shape *means* rather than the arithmetic
underneath it: a box reports its own extent and count even where it is empty, a colour no cell carries names
nothing, a colour's reach spans the container, an island stops at a corner neighbour and at the key space's
edge, an empty seed names no island while leaving the container alone, and the writers touch exactly their
own shape — a box painting only where cells already are, a colour clearing only itself, an island recolouring
without touching its neighbour. The writers' end-to-end behavior is driven through `tests/pointer.test.ts`,
which presses with each shape and reads the document back.
