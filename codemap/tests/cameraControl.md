# tests/cameraControl.test.ts

Ring: 3 · Layer: tests (node, no GPU) · Depends on: `../src/three-runtime/cameraControl.js`, `three`, `vitest`

## Responsibility
Pins the camera carrier's drawing and the two separations a drag depends on: the frustum three's `CameraHelper` builds
from the vertical field of view and the viewport aspect, the pose staying on the node while a fixed world-size scale stays
on the helper group, the up marker sitting above the marker frame, the whole drawing painted one colour on selection,
and the node released on `dispose` (README D46). It reads `Object3D` names, layers, visibility, transforms, the
helper's own point map, and its colour attribute; the app wiring, the gizmo, the panel, materials as they render, and
the export path are not tested here.

## Public interface
`describe` / `it` names are this file's observable surface:
- `camera carrier` — `adds its node to the scene on the decoration layer, unnamed and hidden`,
  `rejects anything that is not a scene, so the drawing can never be orphaned`,
  `derives the frustum from the vertical field of view and the viewport aspect`,
  `carries the pose on the node and a fixed world-size scale on the helper, never both on one`,
  `marks up above the marker frame, so a banked pose reads as banked`,
  `paints every part one colour on selection and releases the node on dispose, twice without complaint`

## Internal logic
1. `cameraHelper(control)` walks `control.node` for the one `THREE.CameraHelper`, which is how the drawing is found
   without the class exposing it. A missing helper throws rather than letting a case pass vacuously.
2. `helperGroup(control)` returns `control.node.children[0]`, the child that owns the drawing and its fixed scale, which is
   the node the size separation is asserted on.
3. `corner(control, name)` reads one point of the frustum through the helper's own `pointMap` and the geometry's
   `position` attribute, so the projection is read off the library's drawing rather than restated from it. A name the
   helper does not carry throws.
4. `colorAt(control, index)` reads one vertex of the geometry's `color` attribute: `setColors` writes the palette
   there rather than onto a material, so that attribute is the carrier's colour, not `material.color`.
5. `OVERLAY_LAYER` is `1`, the decoration layer (README D24), restated here as the literal the whole-drawing walk
   asserts.
6. Each case builds its own `CameraControl` and disposes it at the end — except the constructor-refusal case, which never gets one — so no case runs against another's scene or node.

## Invariants
- The node is added to the scene it was given, is unnamed (`name === ''`), and starts hidden; every node in
  `node.traverse` has `layers.mask === 1 << OVERLAY_LAYER` (2), and the walk finds exactly 3 objects — the node, the
  helper group, and the helper — so a childless walk cannot pass the layer assertion vacuously.
- `new CameraControl(new THREE.Object3D() as unknown as THREE.Scene)` throws `TypeError`, which is the one error
  path the class has.
- At FOV 90 and aspect 1 every near corner (`n1`–`n4`) is `|y| ≈ 1` and `|x| ≈ 1`; the same FOV at aspect 2 widens the
  frame to `|x| ≈ 2` and leaves `|y| ≈ 1`, so the height follows the vertical FOV and the width follows the aspect.
  The far plane is the same frame one display plane further out: `f4`'s `z` is twice `n4`'s and its `|x|` is twice
  `n4`'s, which is what pins the two display planes the projection is built for.
- The pose stays on the node: after `setPose((3, 4, 5), …, 60, 1)` the node's position is `[3, 4, 5]` and its scale
  is `[1, 1, 1]`. The size stays on the helper group and never moves: its `scale` is `[1, 1, 1]` — one world unit per helper
  unit, which is the carrier's whole size model (README D46) — and a later `setPose((6, 0, 0), …, 45, 1)` leaves that scale
  alone while moving the node.
- The up marker rides above the marker frame: at FOV 60 each of `u1`–`u3` has a `y` greater than the highest near
  corner and a `z < 0`, so it sits in front of the apex and points away from the frustum.
- Selection paints the whole drawing one colour: at idle every vertex of the colour attribute is the same triple,
  `setSelected(true)` changes it to a different triple that is again uniform, and `setSelected(false)` restores the
  idle triple — i.e. the library's own five-part default scheme is never what the carrier draws. `dispose()` sets
  `node.parent` to `null`, and a second `dispose()` does not throw.

## Errors
- The non-scene constructor argument is the only error asserted, and it is the only one the class produces. The `setPose`
  early-out for an unchanged projection is not pinned here.

## Dependencies
`../src/three-runtime/cameraControl.js` for `CameraControl`; `three` for `Scene`, `Object3D`, `CameraHelper`,
`BufferAttribute`, `Vector3`, and `Quaternion`; `vitest` for `describe`, `it`, `expect`. No DOM and no GPU: the suite
runs in the node environment.

## Tests
This file *is* the test, run by `npm test` in the node environment. It is the only coverage of
`three-runtime/cameraControl.ts`. Not covered here: the app wiring that gives the carrier its pose, selection, and
visibility; the gizmo attachment and the drag's two callbacks; the panel's `Camera` group; the
materials as they render (colour and depth behaviour need a GPU); the export path; and the `dispose()` of the geometry
and material's actual GPU memory, which only a renderer holds. What needs a GPU — the carrier visible in the viewport
with its two colours, following the output camera, hidden while the viewport already is that camera, and absent
from an exported frame — is verified by running the application (README §10).
