# tests/scene.test.ts

Ring: 2 · Layer: tests (node, no GPU) · Depends on: `../src/document/project.js`,
`../src/three-runtime/scene.js`, `../src/voxels/uniform/grid.js`, `three`, `vitest`

## Responsibility
Pins the mirror's derived voxel geometry, the one place a cell size can go wrong without any document value
changing: a mirrored cube is the size of the object's own cell and sits half a cell past its cell coordinate
(README D41, D43), and `contentCenterOf` pivots on that same lattice. Picking, mask mode, dirty-marking, the
source-mesh layer, framing, and the mirror's document contract are not tested here.

## Public interface
`describe` / `it` names are this file's observable surface:
- `derived voxel geometry` — `draws one cube the size of the object's own cell, centered half a cell past
  its index`, `pivots the content center on the object's own lattice`

## Internal logic
1. `voxelObject(subdivision, cells)` builds the fixture: a fresh `Project`, a `UniformGrid.create(subdivision)`
   with every given cell set to `0x3366ff`, and `project.createVoxelObject({ name: 'cube', maskColor:
   0x112233, payload: { kind: 'uniform', grid }, position: new Vector3(10, 0, -3) })`. The object is placed
   away from the origin, so the geometry must not carry the placement: an instance matrix that folded the
   node's own transform in would draw the cell at `13.5` instead of `3.5` and fail.
2. `instances(mirror, id)` takes the mirrored node, requires it to be an `InstancedMesh`, and returns the
   translation of every instance matrix as a **sorted** list of rows plus the geometry's `parameters.width`.
   Instance order therefore never decides an assertion, and the cube's size is read off the `BoxGeometry` the
   rebuild built rather than off a constant.
3. Each case builds its own `Project`, grid, `SceneMirror`, and `sync()`, so the two subdivisions do not share
   a mirror and neither expectation can pass on the other's state.

## Invariants
- The cube's edge is the object's own cell size: the same cell coordinate is a width-`1` cube at subdivision 1
  and a width-`0.5` cube at subdivision 2, so a world-unit cube or a cube geometry shared across levels fails.
- Instance `(3, 0, 0)` is centered at `3.5` at subdivision 1 and at `1.75` at subdivision 2 — `(x + 0.5) * cell`
  on every axis, the coordinate in cells and the offset in world units. A translation that left `x` unscaled
  would read `3.5` at both levels, which is the drift the finer expectation catches.
- A `sync()`ed `uniform` object is one `InstancedMesh` whose instance translations are lattice positions alone:
  the fixture's `(10, 0, -3)` placement lives in the node's transform, where the document put it.
- `contentCenterOf` is half a cell of the object's own grid past the mid-point of its occupied box: `(1, 1, 1)`
  for the cells `(0, 0, 0)` and `(1, 1, 1)` at subdivision 1, and `(0.25, 0.25, 0.25)` for the same cells at
  subdivision 4, so the pivot is pinned against the world unit and not only against the grid.
- Only the instance matrices, the box geometry's parameters, and the content center are read: no material, no
  lookup, no layer, no camera, and no renderer is touched.

## Errors
- `instances()` throws `TypeError` when the mirrored node is not an `InstancedMesh`, so a rebuild that produced
  a `Group` fails as a broken fixture instead of as an empty expectation.
- The calls under test are total — the fixture always creates its object first — so no document or op result
  literal is asserted here.

## Dependencies
`../src/document/project.js` for `Project` and the object `createVoxelObject` returns;
`../src/three-runtime/scene.js` for `SceneMirror`; `../src/voxels/uniform/grid.js` for `UniformGrid`;
`three` for `InstancedMesh`, `BoxGeometry`, `Matrix4`, and `Vector3`; `vitest` for `describe`, `it`, `expect`.
No DOM and no GPU: the suite runs in the node environment.

## Tests
This file *is* the test, run by `npm test` in the node environment. It is the only coverage that constructs a
real `SceneMirror` — `tests/timeline.test.ts` binds a stand-in root shaped like it, and nothing else in `tests/`
imports the class — and it pins the two derived values a subdivision moves: the drawn cube and the content
center. The grid level and its derived `cellSize` are pinned in `tests/uniform.test.ts`; mask mode, the
instance-to-cell lookup and picking through it, the layer-2 source meshes, `frameAll`, and material and
lighting appearance are verified by running the application (README §10).
