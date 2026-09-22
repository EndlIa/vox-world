# tests/cameraControl.test.ts

Ring: 3 · Layer: tests (node, no GPU) · Depends on: `../src/three-runtime/cameraControl.js`, `three`, `vitest`

## Responsibility
Pins the camera carrier's drawing and the two separations a drag depends on: the frustum is derived from the
vertical field of view and the viewport aspect, the pose stays on the node while the screen-size scale stays on the
helper, and the up marker sits above the far frame (README D46). It reads `Object3D` names, layers, visibility,
transforms, and the two line buffers plus the marker's vertices; the app wiring, the gizmo, the panel, materials as
they render, and the export path are not tested here.

## Public interface
`describe` / `it` names are this file's observable surface:
- `camera carrier` — `adds its node to the scene on the decoration layer, unnamed and hidden`,
  `rejects anything that is not a scene, so the drawing can never be orphaned`,
  `derives the frustum from the vertical field of view and the viewport aspect`,
  `carries the pose on the node and the screen-size scale on the helper, never both on one`,
  `marks up above the far frame, so a banked pose reads as banked`,
  `recolours on selection and releases the node on dispose, twice without complaint`

## Internal logic
1. `parts(control)` walks `control.node` and separates the drawing by what each piece is rather than by the order
   the constructor added it: the body is the `LineSegments` whose position count is 24 (the fixed 12-edge box) and
   the frustum the one whose count is 16 (the 8-segment frame, 8 × 2 vertices), so the class has to expose neither.
   The up marker is the walk's one `Mesh`. A missing piece throws rather than letting a test pass vacuously.
2. `farCorners(frustum)` returns the frustum vertices with a non-zero `z` — the far rectangle's four corners — as
   `{ x, y }`, so a projection is read off the geometry without restating `FRUSTUM_DEPTH`.
3. `OVERLAY_LAYER` is `1`, the decoration layer (README D24), restated here as the literal the whole-drawing walk
   asserts.
4. Each case builds its own `CameraControl` and disposes it at the end — except the constructor-refusal case, which never gets one — so no case runs against another's scene or node.

## Invariants
- The node is added to the scene it was given, is unnamed (`name === ''`), and starts hidden; every node in
  `node.traverse` has `layers.mask === 1 << OVERLAY_LAYER` (2), and the walk finds exactly 5 objects — the node,
  the helper group, and the three pieces — so a childless walk cannot pass the layer assertion vacuously.
- `new CameraControl(new THREE.Object3D() as unknown as THREE.Scene)` throws `TypeError`, which is the one error
  path the class has.
- At FOV 90 and aspect 1 every far corner is `|y| ≈ 1` and `|x| ≈ 1`; the same FOV at aspect 2 widens the frame to
  `|x| ≈ 2` and leaves `|y| ≈ 1`, so the height follows the vertical FOV and the width follows the aspect.
- The pose stays on the node: after `setPose((3, 4, 5), …, 60, 1)` the node's position is `[3, 4, 5]` and its scale
  is `[1, 1, 1]`. The size stays on the helper (`node.children[0]`): rescaling from distance 10 to 20 doubles the
  helper's `scale.x`, the node's position and unit scale are unchanged, and a later `setPose((6, 0, 0), …, 45, 1)`
  leaves the helper's scale alone while moving the node.
- The up marker rides above the far frame: at FOV 60 every one of its vertices has a `y` greater than the highest
  far corner and a `z < 0`, so it sits in front of the apex and points away from the frustum.
- Selection recolours all three materials: the body's idle colour changes when `setSelected(true)` and the
  frustum's and the marker's colours equal the body's new one; `setSelected(false)` returns the body to the idle
  hex. `dispose()` sets `node.parent` to `null`, and a second `dispose()` does not throw.

## Errors
- The non-scene constructor argument is the only error asserted, and it is the only one the class produces. The
  screen-scale clamps (a distance of zero and one past the maximum) and the `setPose` early-out for an unchanged
  projection are not pinned here.

## Dependencies
`../src/three-runtime/cameraControl.js` for `CameraControl`; `three` for `Scene`, `Object3D`, `LineSegments`,
`Mesh`, `LineBasicMaterial`, `MeshBasicMaterial`, `Vector3`, and `Quaternion`; `vitest` for `describe`, `it`,
`expect`. No DOM and no GPU: the suite runs in the node environment.

## Tests
This file *is* the test, run by `npm test` in the node environment. It is the only coverage of
`three-runtime/cameraControl.ts`. Not covered here: the app wiring that gives the carrier its pose, selection,
visibility, and screen scale; the gizmo attachment and the drag's two callbacks; the panel's `Camera` group; the
materials as they render (colour and depth behaviour need a GPU); the export path; and the `dispose()` of the six
resources' actual GPU memory, which only a renderer holds. What needs a GPU — the carrier visible in the viewport
with its two colours, following the output camera, hidden while the viewport already is that camera, and absent
from an exported frame — is verified by running the application (README §10).
