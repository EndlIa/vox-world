# tests/ops.test.ts

Ring: 3 · Layer: tests (node, no GPU) · Depends on: `../src/document/project.js`,
`../src/editor/ops.js`, `../src/voxels/uniform/grid.js`, `three`, `vitest`

## Responsibility
Pins two halves of the edit operations: the `Grid align` flag in both directions, with the two-step snap
`setTransformFromWorldMatrix` applies while it is set, previewed and committed from the same matrix; and
`setObjectSubdivision`, whose block replication and refusals are checked against the payload it replaces.
The region operations, their guards, the voxelize attach path, and the panel that calls these functions are
not tested here.

## Public interface
`describe` / `it` names are this file's observable surface:
- `grid alignment` — `pulls the object onto the nearest cell as the flag turns on, and writes only the
  flag as it turns off`, `stores the whole cells a drag previewed for the same matrix`, `stores a
  placement between cells while the flag is off`
- `subdivision` — `replaces every cell with a block of itself, without moving the object`, `treats the
  level it already holds as done and refuses to go back down`, `refuses a level whose blocks would leave
  the packed key space`, `refuses an object with no grid, and a level that is not a power of two`

## Internal logic
1. One fixture per test: a fresh `Project` with a parent moved to `(-3, 1, 2)` and turned on all three
   axes, and a child of it — so a snap taken in world coordinates instead of the object's own frame cannot
   pass. The fixture relies on the creator setting `alignToGrid`; a case that needs it off clears it.
2. Preview and commit are compared on the same `Matrix4`: `project.alignWorldMatrix` is called for what the
   drag showed and `setTransformFromWorldMatrix` for what the document stored, then the stored transform is
   recomposed and its translation checked against the preview with the parent's world matrix divided out —
   to nine digits, close enough for the matrix arithmetic without being bit-for-bit.
3. Placement is read off the transform, and in the flag-off case off `project.worldMatrix`, so a wrong
   world-to-local division fails as a wrong world placement rather than as a component mismatch.
4. The `subdivision` describe brings its own fixture instead: a 2×2×2 cube of one color at subdivision 1,
   placed at `(1, 2, 3)` so the object is on the lattice and a move would show. The call is asserted
   through the payload it replaced — `subdivision`, `cellSize`, `size`, `bounds()`, and individual cell
   colors — and the placement is re-read from the object reference the test took before the call, so an
   operation that rebuilt the object instead of its payload would fail as a moved placement.

## Invariants
- Turning the flag on leaves the object's own `position` whole per axis — `(1.4, 0, -2.6)` becomes
  `(1, 0, -3)` — and turning it off writes the flag alone, so the fractional `(0.5, 0.5, 0.5)` placement is
  still there with `alignToGrid` false.
- For one incoming matrix the commit stores what the preview showed: the stored local translation equals
  the preview with the parent's world matrix divided out, and every component of the stored `position` is
  an integer, so the `1.9999999999999998` a matrix round trip leaves cannot reach the document.
- The whole-cell rule belongs to the object's own frame: with the parent both moved and turned, the stored
  local placement is whole although its world position is fractional.
- While the flag is off the call is a plain world-to-local write: the object's world translation equals the
  matrix's own translation, fraction and all, so the alignment steps are gated by the flag rather than
  always on.
- Both directions of the flag report `ok: true`, and neither the detail strings nor the session and mirror
  a caller would update are asserted here.
- Subdividing replicates blocks in place (README D43): each of the cube's eight cells becomes a 2×2×2 block
  of its own color, so the old `(0, 0, 0)` covers `(0..1)³` and the old `(1, 0, 0)` starts at `(2, 0, 0)`,
  `size` goes from 8 to 64, and `bounds()` grows to `(0, 0, 0)..(3, 3, 3)` with `cellSize` at `0.5` — while
  the object's `position` and `alignToGrid` are exactly what they were.
- The level a grid already holds is a success that rewrites nothing, and a lower level is refused with
  `'unsupported-subdivision'` while the grid keeps the finer level, so the suite pins that the operation
  only climbs.
- The key space is pinned from the outside: one cell at 300 in a subdivision-1 grid makes a subdivision-2
  request fail as `'exceeds-grid'` and leaves the grid at subdivision 1.
- The remaining two cases are pinned by kind: an object that carries no grid is `'wrong-representation'`,
  and a level of 3 — not a power of two — throws `RangeError` rather than returning data.

## Errors
- The alignment calls all resolve an object that exists, so for them `ok: true` is pinned and no failure
  literal is: the `'missing-object'` refusal of an unknown id and the `'degenerate-transform'` refusal of a
  matrix the local write cannot decompose are reached only through the application.
- The `subdivision` describe does pin failures by literal — `'unsupported-subdivision'`, `'exceeds-grid'`,
  `'wrong-representation'` — plus the `RangeError` a level of 3 throws, and a refused level change is
  checked to have left the grid where it was. `'budget-exceeded'` is not pinned here: nothing in this file
  builds a grid large enough for a subdivision to pass `DEFAULT_CELL_BUDGET`.

## Dependencies
`../src/document/project.js` for `Project` (its lookup, `worldMatrix`, and the alignment rule the
operations call) and `ObjectId`; `../src/editor/ops.js` for `setObjectAlignToGrid`,
`setTransformFromWorldMatrix`, and `setObjectSubdivision`; `../src/voxels/uniform/grid.js` for
`UniformGrid`, the cube's payload; `three` for `Matrix4`, `Euler`, and `Vector3`; `vitest` for `describe`,
`it`, `expect`. No DOM and no GPU: the suite runs in the node environment.

## Tests
This file *is* the test, run by `npm test` in the node environment. It is the only direct unit coverage for
`src/editor/ops.ts`: it reaches `src/document/project.ts`'s alignment rule through the two alignment
operations rather than pinning that rule itself — `tests/project.test.ts` is where the rule has its own
suite — and it reaches the grid's subdivision through `setObjectSubdivision`, whose `subdividedBy` has its
own `subdivision` describe in `tests/uniform.test.ts`.
