# tests/ops.test.ts

Ring: 3 · Layer: tests (node, no GPU) · Depends on: `../src/document/project.js`,
`../src/editor/ops.js`, `three`, `vitest`

## Responsibility
Pins the grid-alignment half of the edit operations: the `Grid align` flag in both directions, and the
two-step snap `setTransformFromWorldMatrix` applies while it is set, previewed and committed from the same
matrix. The region operations, their guards, the voxelize attach path, and the panel that calls these
functions are not tested here.

## Public interface
`describe` / `it` names are this file's observable surface:
- `grid alignment` — `pulls the object onto the nearest cell as the flag turns on, and writes only the
  flag as it turns off`, `stores the whole cells a drag previewed for the same matrix`, `stores a
  placement between cells while the flag is off`

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

## Errors
- Every call in the suite resolves an object that exists, so `ok: true` is pinned and no failure literal
  is: the `'missing-object'` refusal of an unknown id and the `'degenerate-transform'` refusal of a matrix
  the local write cannot decompose are reached only through the application.

## Dependencies
`../src/document/project.js` for `Project` (its lookup, `worldMatrix`, and the alignment rule the
operations call) and `ObjectId`; `../src/editor/ops.js` for `setObjectAlignToGrid` and
`setTransformFromWorldMatrix`; `three` for `Matrix4` and `Euler`; `vitest` for `describe`, `it`, `expect`.
No DOM and no GPU: the suite runs in the node environment.

## Tests
This file *is* the test, run by `npm test` in the node environment. It is the only direct unit coverage for
`src/editor/ops.ts`, and it reaches `src/document/project.ts`'s alignment rule through the two operations
rather than pinning that rule itself; `tests/project.test.ts` is where the rule has its own suite.
