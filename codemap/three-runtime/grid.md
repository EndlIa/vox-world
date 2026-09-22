# src/three-runtime/grid.ts

Ring: 2 · Layer: three-runtime · Depends on: `../voxels/uniform/grid.js`, `three`

## Responsibility
The viewport's grids: a base reference plane at `y = 0` that tells the user how big a metre is — which a
viewport showing a bare model against a flat background otherwise cannot (README D35) — and the *active*
object's own lattice, drawn at that object's subdivision over its occupancy plus a margin of its cells, on the
plane of its lowest occupied cell and in its own frame (README D43). Where the lattice is drawn the base plane
is cut away, so the two never read as one grid at two scales.

Both layers are decorations in every direction: layer 1 means the raycaster never picks them (it tests 0 and
2) and an export never contains them (the export camera enables 0 alone), `depthWrite = false` means they
cannot occlude voxels, and `frameAll` ignores the layer, so a grid can never widen the framing of an import.
It owns the two layers, their line geometry, and the three display settings behind the Grid group; it holds no
project data, does no per-frame work, and rebuilds a layer only when the caller hands it something new.

## Public interface
```ts
const DEFAULT_GRID_MARGIN = 8;

class WorldGrid {
  constructor();
  readonly root: THREE.Group;   // `world-grid`: `world-grid-base` + `world-grid-lattice`
  get baseVisible(): boolean;
  get objectVisible(): boolean;
  get margin(): number;
  setBaseVisible(visible: boolean): void;
  setObjectVisible(visible: boolean): void;
  setMargin(cells: number): void;
  showObjectLattice(grid: UniformGrid | undefined, matrixWorld: THREE.Matrix4 | undefined): void;
  dispose(): void;
}
```

## Internal logic
1. Every line lives in a `LineSet` — a `LineSegments` with its `LineBasicMaterial` (transparent,
   `depthWrite = false`, layer 1, `frustumCulled = false`) and a render order. `setVertices` replaces a set's
   geometry wholesale and disposes the geometry it had, so a rebuild leaves nothing behind.
2. Construction builds the base as two sets: `minor` at render order 0 (`0x9aa2ad` at 0.28) and `major` at 1
   (`0xe6e8ea` at 0.5), so the brighter line is drawn last where the two levels coincide on the same `y = 0`.
   Both come from `baseVertices`, with `step` 1 and `step` 10 over the fixed `GRID_EXTENT = 200`. The lattice
   is one set at render order 2 (`0xe6e8ea` at 0.6 — brighter than either base level, so it reads as the finer
   measure), `matrixAutoUpdate = false`, inside a group that starts hidden. `root` is `world-grid`; the two
   groups are `world-grid-base` and `world-grid-lattice`.
3. The base's colours are panel greys rather than the reference grid's pure white, which reads as a stray
   frame line against this viewport's slate background (README D32 is the same lesson).
4. `baseVertices(step, hole)` walks the plane's fixed coordinates from `-100` to `100` by `step` and emits each
   line as one ground-plane segment, or — when that fixed coordinate falls strictly inside the hole's rectangle
   — as the one or two pieces outside it (`pushSegment`, which drops a zero-length piece). A line that only
   touches the hole's edge, and a line outside it, is emitted whole, so the plane keeps its extent and simply
   has a rectangle missing.
5. `latticeVertices(grid, margin)` returns the object-frame segments plus the local rectangle they span, or
   `undefined` for a grid with no occupied cell. With `cell = grid.cellSize` it draws the cell boundaries along
   x and z, one per cell index from `bounds.min - margin` through `bounds.max + 1 + margin` — `bounds ± margin`
   cells — with every vertex at `y = bounds.min[1] * cell`, the plane of the lowest occupied cell.
6. `showObjectLattice` returns before doing anything when the same grid instance, the same matrix elements, and
   the same margin are already shown (`shown` keeps the instance, a clone of the matrix, and the margin it was
   built for). With either argument missing, or a grid with no occupied cell, it clears: `shown` unset, the
   layer hidden, empty geometry, and the base restored (`setHole(undefined)`). Otherwise it rebuilds the lines,
   copies `matrixWorld` into `lines.matrix` with `matrixWorldNeedsUpdate = true` — so the placement and any
   parent rotation are carried rather than baked into the vertices — shows the layer only while
   `objectVisible`, and cuts the base with `footprintOf(local, matrixWorld)`: the world-space x/z bounding box
   of the local rectangle's four corners, so a turned object is cut by its extent rather than exactly.
7. `setMargin` re-shows the lattice at the new margin through the same path, using the retained grid and matrix
   clone; `setBaseVisible` and `setObjectVisible` only toggle their own group — hiding the lattice leaves the
   hole where it is, and `setObjectVisible(true)` shows the layer only if `shown` exists.

## Invariants
- Everything is on layer 1: the raycaster tests layers 0 and 2, so no grid is ever picked, and the export
  camera enables layer 0 alone, so no grid ever appears in a frame (README D24). `frameAll` measures layers 0
  and 2, so a grid can never widen the framing of an import.
- `depthWrite = false` throughout, so a grid can never occlude a voxel, and the order between the two base
  levels and between the layers is fixed by `renderOrder` (0, 1, 2) rather than by geometry.
- The base keeps its extent: the fixed-coordinate set is the same with and without a hole — 201 lines per
  direction at `step` 1 — and only a rectangle is missing, because a crossing line is emitted as its pieces
  and those pieces reach the plane's edges. With no hole the whole plane is back.
- A repeat `showObjectLattice` with the same grid instance, the same matrix elements, and the same margin
  rebuilds nothing: the lattice's geometry is replaced only when the answer differs.
- The lattice is always the object's own cells at its own level: it is built from `bounds()` in cell
  coordinates times `cellSize`, on the object's lowest plane, so a subdivision change moves it and no world
  unit is involved.
- The three settings are the only state, and no method is per-frame: nothing here reads a camera, a project, or
  a session.
- `dispose()` disposes all three geometries and materials, empties the two groups and `root`, and unsets
  `shown`; the group is left childless, so a second call has nothing left to empty.

## Errors
- `setMargin` throws `RangeError` for a non-integer or negative `cells`, naming the method and the value.
- Every other path is total: `showObjectLattice` reads `undefined` as "clear this layer" rather than failing,
  and an unoccupied grid is `undefined` from `latticeVertices` rather than a throw. Nothing here throws
  `TypeError`.

## Dependencies
- `../voxels/uniform/grid.js` — `UniformGrid` (type-only import), for `grid.bounds()` and `grid.cellSize` in
  `latticeVertices`.
- `three` — `Group`, `LineSegments`, `LineBasicMaterial`, `BufferGeometry`, `Float32BufferAttribute`,
  `Matrix4`, `Vector3`. No project, editor, UI, or other three-runtime module; the owner passes the scene in by
  adding `root` itself, exactly as `Overlay` is used.

## Tests
`tests/grid.test.ts` pins the two layers' geometry and the three settings in the node environment; see
`codemap/tests/grid.md`. What needs a GPU stays app-verified (README §10): the base and the lattice visible
with their palettes and contrast, sitting under the voxels rather than over them, not pickable (a click on an
empty grid area selects nothing), and absent from an exported frame.

## Open questions
- The cut is a rectangle: `footprintOf` takes the lattice rectangle's axis-aligned world x/z box, so a rotated
  object cuts away more of the base than its lattice actually covers. An exact per-line cut was not needed for
  the placements the editor produces today.
- The base's side is fixed at 200 world units, its cell at one, and its bright level at every tenth. A scene
  much larger than that would want the extent to follow the content or the camera; it is a viewport
  convenience, and it may never change the stored data (a grid is decoration, never a source of scale).
- The margin is a fixed default of 8 cells, so a fine grid with a small occupancy still gets a wide rectangle
  around it. A margin that followed the camera's zoom would keep the lattice at a readable density.
