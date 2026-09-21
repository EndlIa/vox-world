# tests/voxelize.test.ts

Ring: 0 · Layer: tests (node, no GPU) · Depends on: `../src/voxels/voxelize/voxelize.js`,
`../src/voxels/voxelize/surface.js`, `../src/voxels/voxelize/colorSampler.js`,
`../src/voxels/uniform/grid.js`, `../src/voxels/octree/octree.js`, `three`, `vitest`

## Responsibility
Pins conservative surface voxelization and its color resolution: the exact cell set a closed
axis-aligned mesh produces, the budget, cancel, and grid-fit aborts, the
factor × texture × vertex-color precedence the sampler resolves, and its alpha-cutoff rule — a masked
sample colours its cell with the texture's visible average and never loses it. It does not test the app
import path, derived meshes, or rendering.

## Public interface
`describe` / `it` names are this file's observable surface:
- `voxelizeSurface` — `voxelizes an axis-aligned cube into exactly the cells its faces intersect`,
  `never emits a cell outside a triangle AABB`, `keeps the first triangle that claims a cell`,
  `returns budget-exceeded with the measured count`, `returns cancelled for an aborted signal`
- `resolvePrimitiveColor` — `multiplies the first vertex color into the base color factor for stride 3 and
  stride 4`, `resolves one texel per triangle through nearest-neighbour repeat addressing`, `samples the UV
  centroid of the triangle rather than one of its vertices`, `resolves a below-cutoff texel to the average of
  the visible texels`, `resolves every masked texel of one texture and cutoff to the same cached average`,
  `contributes no texture term for a fully transparent texel without a cutoff`, `multiplies only the factor
  and the vertex color when the cutoff hides every texel`, `multiplies the factor, the texture and the
  vertex color, and still exchanges a 0xRRGGBB hex`, `skips a missing texture or a missing uv instead of
  throwing`, `falls back to baseColor and exchanges both as 0xRRGGBB`, `throws RangeError for a vertex or an
  attribute slot outside the data`
- `voxelize` — `returns one output per source with the requested representation`, `derives the octree
  depth from targetCellSize and clamps it to maxDepth`, `places each origin at the payload world min
  corner`, `returns empty for soups with no triangles`, `returns unsupported-geometry for a malformed
  soup`, `returns exceeds-grid for a uniform extent past the key range and for an octree root box
  smaller than the source AABB, with detail naming the sourceId and the offending axis`, `exports
  DEFAULT_CELL_BUDGET as 4_000_000`, `reports cancel and budget failures with no outputs`, `colors each
  cell from the three vertices of the triangle that claimed it`, `keeps every cell of a masked sample,
  colouring it with the visible average`

## Internal logic
1. The main fixture is a closed 1.9 m cube of 12 axis-aligned triangles in world space at
   `voxelSize = 0.5`. Touching a cell counts as a hit, even along a shared boundary plane, so the
   expected result is the `4×4×4` block minus its `2×2×2` strictly interior cells: 56 cells. The side is
   1.9 m and not 2 m deliberately: under the `floor(min / v) .. floor(max / v)` candidate range a 2 m
   side spans five cell indices per axis and yields 98 cells, so a fixture that is exactly four cells
   wide cannot produce 56.
2. Expected cells are literal `packKey` values, not a count, so an off-by-one in the min-corner
   convention fails instead of matching a wrong total.
3. Cancel uses an `AbortController` aborted before the call; the budget case uses a limit below the
   measured count, so both failures are deterministic and independent of chunk boundaries.
4. Conservativeness is pinned separately: one right triangle with 1.8 m legs in a plane is claimed by
   exactly 10 cells, the ones satisfying `x + y ≤ 3`, even though its candidate AABB holds more. A
   candidate-range-only implementation fails this case.
5. Both `'exceeds-grid'` cases use tiny soups with a wildly wrong target instead of a huge mesh: a
   one-triangle source whose extent needs more than 512 cells per axis at the given `voxelSize`, and
   the same source against an octree `rootSize` smaller than its AABB. `DEFAULT_CELL_BUDGET` is only
   read as the exported constant — allocating that many cells to abort on it would not be a unit test.
6. Texture cases build every `ColorSource` by hand, so the file stays in the node environment (no
   canvas, no GPU): `quadrantTexture()` is a 2x2 texture whose four texels are red, green, blue and
   `(64, 128, 192)` in row-major readback order, and `flatUv(u, v)` is a triangle whose three vertices
   all sit on `(u, v)`, so its UV centroid is that point. A 3x3 texture whose centre texel is the only
   yellow one separates "samples the centroid" from "samples a vertex": the centroid lands on the
   centre while each vertex lands on red.
7. The masked path gets its own 2x2 fixture (`maskedTexture()`), chosen so that one texture covers every
   branch: an opaque red texel, a half-transparent green one (`alpha = 128`, so `128 / 255 ≈ 0.502` is
   visible at a cutoff of `0.5` and masked at `0.75`), and a fully transparent bottom row whose bytes are
   blue and white — the decoys a mask must not paint with. Every expected value is derived from
   `THREE.Color` (`setRGB(..., SRGBColorSpace)` for the visible average, `setHex(..., SRGBColorSpace)`,
   `multiply`, `setRGB(..., LinearSRGBColorSpace)` for vertex colors) rather than from a hand-written
   number, so the assertion is the documented conversion and not a re-implementation of it. The
   `voxelize`-level case runs one triangle through both a masked source and an uncutoff one: an equal
   `grid.size` is the proof that coverage did not change, and the per-cell colours are the proof that only
   the sampler's choice did.

## Invariants
- Cell `(x, y, z)` spans `[x*v, (x+1)*v]` on each axis, and a `SurfaceCells` value is an index into
  the input triangle array; no cell strictly inside the surface and none outside a triangle AABB.
- A cell keeps the lowest triangle index that claims it.
- Budget failure and cancellation return an error object with no partial cells and mutate nothing, and
  a source that does not fit its target grid fails the whole request with `'exceeds-grid'` rather than
  writing clamped, wrapped, or negative coordinates.
- `resolvePrimitiveColor` returns the product of the source's factor, its base color texture at the
  triangle's UV centroid, and the triangle's first vertex color, always as the value
  `THREE.Color.getHex()` exchanges; a missing term is skipped, an attribute that does not cover the
  vertices named is a `RangeError`.
- An alpha cutoff never changes the geometry: a sample below it keeps its cell and takes the texture's
  visible average, so the same soup voxelizes to the same cells with and without `alphaTest` — pinned by
  equal `grid.size` — and the only difference between the two runs is the colour of those cells. Without a
  cutoff, a fully transparent texel contributes no texture term, so a source whose factor is white keeps
  white, while an absent or `0` cutoff changes nothing about a visible texel.
- The visible average is one value per texture record and cutoff: two triangles sampling two different
  transparent texels of the same fixture agree, and the same fixture at a higher cutoff — which masks one
  more texel — gets the recomputed value instead of the first one.
- The vertex a cell's color comes from is the soup's own index entry, so a source whose index buffer
  names another vertex first colors its cells with that vertex's color.
- On success `outputs.length === sources.length`, `stats.cells` equals the summed occupied counts of
  the payloads, and `stats.triangles` equals the summed input triangle counts.
- Octree depth is `clamp(ceil(log2(rootSize / targetCellSize)), 1, maxDepth)`, the octree root box is
  `[0, rootSize]³`, and each `origin` is the payload's world min corner, so uniform coordinates inside
  a payload are non-negative.
- `DEFAULT_CELL_BUDGET` is `4_000_000` and is the value the app passes as `budget`; `voxelize` itself
  defaults nothing.

## Errors
- Literals pinned here: `'budget-exceeded'` and `'cancelled'` from `voxelizeSurface`; `'empty'`,
  `'unsupported-geometry'`, `'exceeds-grid'`, `'cancelled'`, and `'budget-exceeded'` from `voxelize`,
  all as returned results rather than throws.
- `'unsupported-geometry'` is reserved for geometry that cannot be voxelized at all (a malformed
  soup), while `'exceeds-grid'` covers both fit failures — a uniform extent past the `[-512, 511]` key
  range and an octree root box smaller than the source AABB — so the two are not interchangeable here.
- Throws are pinned only where they are a caller bug: `RangeError` for an invalid `voxelSize` or
  `budget`, for a `triangleVertices` entry that is not a non-negative integer, for a `vertexColorSize`
  of 0, for a `uv`, `vertexColors`, or `pixels` attribute that does not cover the vertex or texel it is
  indexed with, and for a non-finite UV component or a non-positive texture dimension.
- For `'exceeds-grid'` the suite asserts `detail` names the source `sourceId` and the offending axis
  plus the measured quantity (uniform cells on that axis, or the octree AABB extent). That wording is
  pinned by `voxels/voxelize/voxelize.md`, not by the brief.

## Dependencies
`../src/voxels/voxelize/voxelize.js` for `voxelize` and `DEFAULT_CELL_BUDGET` — the limit the app and
`editor/ops.ts` share, so an edit and a voxelization cannot disagree — plus `surface.js` and
`colorSampler.js` under test; `../src/voxels/uniform/grid.js` for `packKey`, `CellKey`, `IntBox3`;
`../src/voxels/octree/octree.js` for the octree payload; `three` for `Matrix4` (baking the fixtures
into world space), `Color`, `LinearSRGBColorSpace` and `SRGBColorSpace` (the documented conversions the
stride-4 and visible-average expectations derive from), and `Vector3`; `AbortController` and
`Uint8ClampedArray` from Node; `vitest`.

## Tests
This file *is* the test, run by `npm test` in the node environment — no GPU, no DOM, no
`WebGLRenderer`. It pins `surface.ts`, `colorSampler.ts`, and `voxelize.ts`; the app import path
(`three-runtime/import.ts`) is verified by running the application.
