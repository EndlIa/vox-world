# tests/pointer.test.ts

Ring: 3 · Layer: tests (node, no GPU) · Depends on: `../src/document/project.js`,
`../src/editor/pointer.js`, `../src/editor/session.js`, `../src/three-runtime/picking.js`,
`../src/voxels/uniform/grid.js`, `three`, `vitest`

## Responsibility
Pins the two ends of the box drag in `editor/pointer.ts`: which cell a face hit names, and what a box
does when the pointer leaves the model — it continues in the plane of the face the press landed on, into
cells the object does not have yet (README D19, D20, D41, D43). It drives the tool's real listeners with
pointer events and answers picks from a variable, against a real `Project`, `EditorSession`, and a
2×2×2 block. Real raycasting, the overlay, the mirror's instanced meshes, pointer capture, and
`detachSelection` are not tested here.

## Public interface
`describe` / `it` names are this file's observable surface:
- `box drag` — `takes the cells the picker named, on both corners`,
  `carries the box through empty space when the pointer leaves the model`

## Internal logic
1. `listeners` is the module's one sink for every listener the tool registers: the element stub and the
   `window` stub assigned to `globalThis` both write into it, so a test drives real tool callbacks
   without a real DOM. The `window` stub exists because the tool registers `pointerup`/`pointercancel`
   there; `removeEventListener` is a no-op.
2. The element stub answers `getBoundingClientRect()` with a 100 × 100 rectangle at the origin. With the
   event built at `clientX = 50 + ndcX * 50` and `clientY = 50`, NDC is exactly `(ndcX, 0)` — a
   position, not a pixel count, so an expectation never depends on the canvas size.
3. `fixture()` builds one case: a fresh `Project`, a `UniformGrid` with all eight cells of the origin
   2 × 2 × 2 block set to `0x3366ff`, `createVoxelObject({ name: 'cube', maskColor: 0x112233,
   payload: { kind: 'uniform', grid }, position: new Vector3(0, 0, 0) })`, and an `EditorSession` in
   `edit` mode with that object active. The picker is a stand-in `{ pick: () => hit }` reading the
   variable `setHit` writes, and the overlay is no-ops; the camera is a `PerspectiveCamera(50, 1, 0.1,
   100)` at `(0, 0, 10)`, `updateMatrixWorld()`ed, and `getCamera` returns it.
4. `event(type, ndcX)` is the pointer event the listeners are called with: button 0, `buttons` 1 while
   down and 0 on pointer-up, one `pointerId`, and the rectangle-relative client position above. The
   fixture's `down`/`move`/`up` look the listener up in `listeners` and call it, so the tool is never
   stubbed — only its two collaborators are.
5. `faceHit(cell)` is the only hit shape: a `'cell'` hit on `objectId: 'obj-0'` (the fixture's first
   object), color `0x3366ff`, `point` at the centre of the cell's `+z` face — `(x + 0.5, y + 0.5, z + 1)`
   — and `normal` `(0, 0, 1)`. The point therefore lies exactly on that face's plane, which is the
   position that used to floor into the next cell.
6. Each case constructs its own fixture and calls `pointer.dispose()` at the end, so nothing runs
   against another case's listeners.

## Invariants
- With the `select` tool, a press whose hit names `(1, 1, 1)` and a move naming `(1, 1, 0)` — both at the
  same NDC, so only the pick changes — leave the selection at
  `{ kind: 'box', objectId, box: { min: [1, 1, 0], max: [1, 1, 1] } }`: the box is exactly the two cells
  the lookup named, so a hit on the far `+z` face addresses that cell and not the one past it.
- With the `add` tool and `editColor` red, a press on `(0, 0, 0)` and a *missed* move at NDC x 0.5
  create `(2, 0, 0)` in red: one cell past the block's `+z` face, so the box left the object's
  occupancy — which is how `add` grows a model — with the cell size and frame it captured at the press.
- In that same drag `(1, 0, 0)` is red, because the box covered it, while `(1, 1, 0)` and `(1, 0, 1)`
  keep `0x3366ff`: the box stayed one cell deep on the two axes the drag did not travel, so the half-cell
  nudge back along the face normal did not drift the pressed cell.
- `grid.size` is 9 — the block's eight cells plus the one created — so exactly one cell is new; the
  repainted `(1, 0, 0)` does not change the count.
- Only the session's selection and the grid's cell colors and `size` are read: no overlay call is
  asserted, and the commit results, the mirror, and the object's transform are not consulted.

## Errors
- The picker answers a variable, so no `RangeError`, `TypeError`, or op refusal literal is reachable
  here; a miss is `undefined`, which the second case uses deliberately.
- Both collaborators and the element are cast stand-ins (`as never`,
  `as unknown as HTMLElement`); `down`/`move`/`up` rely on the listener names the tool registers, so a
  renamed or dropped listener fails as a call on `undefined` rather than as a missing expectation.

## Dependencies
`../src/document/project.js` for `Project` and the object `createVoxelObject` returns;
`../src/editor/pointer.js` for `PointerTool`; `../src/editor/session.js` for `EditorSession`;
`../src/three-runtime/picking.js` for the `PickHit` type the stand-in picker answers with;
`../src/voxels/uniform/grid.js` for `UniformGrid`; `three` for `PerspectiveCamera` and `Vector3`;
`vitest` for `describe`, `it`, `expect`. No renderer and no DOM: the element and `window` are stand-ins
and the suite runs in the node environment.

## Tests
This file *is* the test, run by `npm test` in the node environment. It is the coverage
`codemap/editor/pointer.md` points at, and the only place the tool's listeners are driven at all; the
grid math the drag's cell arithmetic divides by is pinned separately in `tests/uniform.test.ts`. Not
covered here: real raycasting (the picker answers a variable), the overlay preview, the three.js
instanced meshes a hit would come from, the pointer capture and the gizmo claim (`getGizmoBusy` is
always false), `detachSelection`, the `paint` and `remove` commits, and the object-mode and no-hit press
paths. What needs a viewport — the preview drawing the box the commit stores, the gizmo handoff, and the
raw-mesh walk — is verified by running the application (README §10).
