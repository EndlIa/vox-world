# tests/overlay.test.ts

Ring: 3 · Layer: tests (node, no GPU) · Depends on: `../src/three-runtime/overlay.js`, `../src/voxels/uniform/grid.js`, `three`, `vitest`

## Responsibility
Pins the box-drag preview frame's placement and its one-object lifecycle: the frame is drawn where the inclusive cell box
is, at the owning object's own cell size and in that object's world space — the rotated, non-uniformly scaled case
included, which is the reason the drawing is a library box composed with a group rather than one decomposed transform —
and the overlay is hidden until it is asked for, replaces what it drew, colours itself, and leaves the scene on
`dispose` (README D24, D41, D43). It reads the scene graph and world-space bounds; the app wiring, the pointer drag, and
the materials as they render are not tested here.

## Public interface
`describe` / `it` names are this file's observable surface:
- `box preview overlay` — `starts hidden and draws one frame on the decoration layer only`,
  `rejects a non-scene, a non-matrix, a fractional corner, and a non-positive cell`,
  `draws the inclusive cell box at the owning object cell size, in that object world space`,
  `follows a rotated and non-uniformly scaled object without shearing the frame`,
  `replaces the previous frame, colours itself, hides on clear, and releases the scene on dispose`

## Internal logic
1. `helperOf(scene)` walks the scene for the one `THREE.Box3Helper`, which is how the drawing is found without the class
   exposing it; the *group* around it is the object the overlay hides and unparents. A missing helper throws rather than
   letting a case pass vacuously.
2. `drawnBounds(scene)` updates the scene's matrices and returns `new THREE.Box3().setFromObject(helper)`: the world
   extent the viewport would actually show, rather than a reading of the helper's own fields.
3. `expectedBounds(boxLocal, matrixWorld, cell)` computes the same extent from the request — the eight corners of
   `[min · cell, (max + 1) · cell]` transformed by the matrix — so the assertion is the placement itself, not a
   restatement of the implementation.
4. Every case builds its own `Scene` and `Overlay` — except the constructor-refusal case, which builds only a scene —
   and disposes what it built.

## Invariants
- The helper exists from construction, is visible itself, and sits under a group that starts hidden; both the group and
  the helper are on layer 1 (`layers.mask === 1 << OVERLAY_LAYER`), which is what keeps the frame out of a pick and out
  of an export frame (README D24).
- `new Overlay(new THREE.Object3D() as unknown as THREE.Scene)` throws `TypeError`; a non-`Matrix4` matrix and a
  fractional corner are refused too (`TypeError` and `RangeError`), and so is a cell size of zero. Each refusal leaves
  the overlay usable.
- The drawn world bounds equal the request's own: with `cell = 0.5` and an inclusive box of three cells, the frame spans
  exactly `1.5` world units — not three, and not one — and its corners are the transformed cells, so a wrong scale, a
  wrong min-corner convention, or a missing translation all fail the case.
- A matrix with a 60° rotation and a non-uniform scale inside it draws the same sheared box the corners describe: this is
  the case a single decomposed transform could not express, and the reason the frame is composed as two matrices.
- `showBox` replaces what was drawn rather than adding to it: a 4-cell box followed by a 1-cell box leaves a frame one
  cell across, with one helper in the scene throughout. The optional colour reaches the material
  (`color.getHex()`), `clear()` hides the frame without removing it, and `dispose()` leaves the scene empty and is safe
  twice.

## Errors
The three refusals above are the only errors asserted, and they are the ones the class documents. Nothing here pins what
a GPU does with the frame: its colour on screen, its blending over voxels, and its absence from an exported image are
app-verified (README §10).

## Dependencies
`../src/three-runtime/overlay.js` for `Overlay`; `../src/voxels/uniform/grid.js` for the `IntBox3` shape the requests are
written in; `three` for `Scene`, `Box3`, `Box3Helper`, `Matrix4`, `LineBasicMaterial`, and `Vector3`; `vitest` for
`describe`, `it`, `expect`. No DOM and no GPU: the overlay's scene graph and world matrices are all this suite reads.

## Tests
This file *is* the test, run by `npm test` in the node environment, and it is the only coverage of
`three-runtime/overlay.ts`. Not covered here: the pointer tool that calls `showBox` during a drag and `clear()` on a miss,
the app's teardown order, and the materials as they render — including the `depthTest: false` that lets the frame read
over the voxels it surrounds.
