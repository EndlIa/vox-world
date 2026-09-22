# tests/grid.test.ts

Ring: 2 · Layer: tests (node, no GPU) · Depends on: `../src/three-runtime/grid.js`,
`../src/voxels/uniform/grid.js`, `three`, `vitest`

## Responsibility
Pins the viewport grids' drawn geometry: the base plane's line spacing at the world unit and its brighter
companion every tenth (README D35), the active object's lattice at its own cell size on the plane of its
lowest occupied cell (README D43), the hole that lattice cuts into the base, and the three settings behind the
Grid group. It reads only `LineSegments` geometry, `renderOrder`, `visible`, and `lines.matrix`; material
colours and opacities, layer assignment, picking, framing, export, and the panel and app wiring are not tested
here.

## Public interface
`describe` / `it` names are this file's observable surface:
- `world grid` — `draws a base plane at the world unit with a brighter line every tenth`,
  `draws the active object's lattice at its own cell size, on the plane of its lowest cell`,
  `cuts the base plane away where the lattice is drawn, and leaves it alone everywhere else`,
  `follows the two switches and the margin`

## Internal logic
1. `block(subdivision)` is the only fixture grid: every cell of a 4 x 4 x 4 block from the origin set to
   `0x3366ff`, so the bounds are `0..3` on all three axes whatever subdivision is asked for — the lattice
   expectation is the block's own cells, not a literal extent.
2. `layer(grid, name)` finds a group by name under `grid.root` and requires a `Group`; `baseLineSets` filters
   the base layer's `LineSegments` and sorts them by `renderOrder` to name `faint` (0) and `bright` (1), while
   `latticeLines` takes the lattice layer's single set. The two layers are therefore addressed by the names the
   app uses, not through the class's private fields.
3. `vertices(lines)` returns the `position` attribute as a plain array; `coordinates(lines, axis)` collects the
   distinct values on one axis, one per line, so a spacing is read off the geometry without restating a
   constant.
4. Each case constructs its own `WorldGrid`, asserts, and calls `dispose()`, so no case runs against another's
   state.

## Invariants
- The base at `step` 1 draws 201 lines per direction (one per world unit across the 200-unit plane) and the
  every-tenth set draws 21, both at `y = 0` — an extent or a spacing change fails the coordinate list, not just
  a count.
- The lattice at subdivision 2 with the default margin has lines at `-4 .. 6` in half units: `(index - 8) * 0.5`
  over 21 values, on the plane of the lowest occupied cell (`y = 0`), and its placement sits in `lines.matrix`
  (`makeTranslation(5, 0, 0)`) rather than in the vertices — a moved object moves its grid.
- `DEFAULT_GRID_MARGIN` is 8, and `setMargin(0)` re-cuts the same lattice to `[0, 1, 2, 3, 4]`: the object's own
  cells alone, at its own cell size.
- With a lattice shown, no base vertex is strictly inside its footprint (`-4 .. 6` on both axes): every vertex
  sits outside it on x, or outside it on z, or on the cut edge. The plane is still whole — the step-1 set keeps
  all 201 line coordinates, `-100` and `100` included — so the cut takes material out of lines, not lines away.
- Clearing with `showObjectLattice(undefined, undefined)` hides the lattice layer and restores the plane to
  `201 * 2 * 2 * 3` floats (201 lines, two segments each, two vertices, three floats).
- `setObjectVisible(false)` hides the lattice layer and `setBaseVisible(false)` the base layer, and both back
  to `true` restore; the two switches are read off the groups, not through the getters.
- The lattice layer is visible once shown.

## Errors
- `setMargin(-1)` throws `RangeError`; the non-integer branch of the same guard is not pinned here.

## Dependencies
`../src/three-runtime/grid.js` for `WorldGrid` and `DEFAULT_GRID_MARGIN`; `../src/voxels/uniform/grid.js` for
the `UniformGrid` fixture; `three` for `Group`, `LineSegments`, `Matrix4`, and `Vector3`; `vitest` for
`describe`, `it`, `expect`. No DOM and no GPU: the suite runs in the node environment.

## Tests
This file *is* the test, run by `npm test` in the node environment. It is the only coverage of
`three-runtime/grid.ts`. Not covered here: the skip of an unchanged `showObjectLattice` call, the axis-aligned
extent a rotated object's footprint cuts with, the `baseVisible` / `objectVisible` / `margin` getters, the
render orders, layers, and material values of the three line sets, and the Grid group's panel and app wiring.
What needs a GPU — the grid visible in the viewport with its palette, under the voxels, unpickable, and absent
from an exported frame — is verified by running the application (README §10).
