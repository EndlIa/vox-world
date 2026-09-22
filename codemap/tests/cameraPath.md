# tests/cameraPath.test.ts

Ring: 3 · Layer: tests (node, no GPU) · Depends on: `../src/three-runtime/cameraPath.js`, `three`, `vitest`

## Responsibility
Pins the camera path drawing's structure and the separations a frame depends on: the root is in the scene, unnamed,
hidden, and every node in its subtree is on the decoration layer; the polyline's buffer grows and its draw range
follows the list in both directions; the ring pool is reused with the surplus hidden; a marker's size changes without
its position moving; the billboard copy lands; and `dispose` empties the scene (README D47). The app wiring, the materials as they
render, and the export path are not tested here.

## Public interface
`describe` / `it` names are this file's observable surface:
- `camera path drawing` — `adds an unnamed group to the scene, hidden, with every child on the decoration layer`,
  `rejects anything that is not a scene, so the drawing can never be orphaned`, `buffers the polyline it is given,
  grows for a longer one, and empties for none`, `keeps one ring per marker, reuses the pool, and hides the surplus`,
  `rescales the rings without moving them off the path`, `turns the rings to face the camera and releases everything
  on dispose, twice without complaint`

## Internal logic
1. `OVERLAY_LAYER` is `1`, the decoration layer (README D24), restated here as the literal the whole-drawing walk
   asserts.
2. `line(path)` and `markers(path)` find the drawing by what each piece is rather than through the class's private
   fields: `path.root.traverse` collects the one `THREE.Line` and every `THREE.Mesh`. A missing line throws rather
   than letting a case pass vacuously, and the marker list is read in walk order, which is the order `setMarkers`
   created the meshes in.
3. Each case constructs its own `CameraPath` on a fresh `Scene` and disposes it at the end — except the
   constructor-refusal case, which never gets one — so no case runs against another's scene.
4. The polyline case keeps the geometry it read first and asserts the draw range and the `position` attribute across a
   grow and a shrink, so capacity and range are told apart.

## Invariants
- The root is added to the scene it was given, is unnamed (`name === ''`), and starts hidden; every node in
  `root.traverse` has `layers.mask === 1 << OVERLAY_LAYER` (2), and the walk finds exactly 3 objects — the root, the
  polyline, and the marker group, no markers existing yet — so a childless walk cannot pass the layer assertion
  vacuously.
- `new CameraPath(new THREE.Object3D() as unknown as THREE.Scene)` throws `TypeError`, which is the one error path
  the class has.
- An empty trajectory sets `drawRange.count` to 0 without needing a buffer; three points set it to 3 and write
  `(1, 2, 3)` into the second vertex; a fourth point grows the buffer and sets the range to 4 with `x = 7` at index 3;
  and the three-point list again only narrows the range back to 3.
- The ring pool is one mesh per point and never shrinks: three markers are three meshes at `x = 1, 2, 3`, all visible;
  one marker afterwards leaves the same three meshes with `[true, false, false]`; and three again is three meshes, all
  visible, so deleting and re-adding a keyframe reuses meshes rather than rebuilding the pool.
- `setScreenScale(10)` then `(20)` doubles the marker's `scale.x` (to six places) while its `position` stays
  `(5, 6, 7)`: the size follows the viewing distance and the ring stays on the point of the path it belongs to, which
  a scale on the marker group would not give.
- `faceCamera(quaternion)` puts a marker's quaternion on the one it was handed (`angleTo` ≈ 0). `dispose()` sets
  `root.parent` to `null`, and a second `dispose()` does not throw.

## Errors
The non-scene constructor argument is the only error asserted, and it is the only one the class produces. The
screen-scale clamps (a distance of zero and one past the maximum) and the layer of a marker created after
construction are not pinned here; the two traversal helpers throw their own fixture errors rather than letting a
missing piece pass.

## Dependencies
`../src/three-runtime/cameraPath.js` for `CameraPath`; `three` for `Scene`, `Object3D`, `Mesh`, `Line`, `Vector3`,
`Quaternion`, and `Euler`; `vitest` for `describe`, `it`, `expect`. No DOM and no GPU: the suite runs in the node
environment.

## Tests
This file *is* the test, run by `npm test` in the node environment. It is the only coverage of
`three-runtime/cameraPath.ts`. Not covered here: the app wiring that hands the path its points, its visibility, its
scale, and its quaternion; the `Camera` group's `Show camera path` box; the marker geometry and material values; the
clamps and the empty-then-grow path; and the resources' actual GPU memory, which only a renderer holds. What needs a
GPU — the white polyline and its rings drawn over the scene, facing the viewport as it orbits, resizing with the
viewing distance, following the toggle, and absent from an exported frame and from a pick — is verified by running the
application (README §10).
