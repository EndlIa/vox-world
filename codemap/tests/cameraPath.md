# tests/cameraPath.test.ts

Ring: 3 · Layer: tests (node, no GPU) · Depends on: `../src/three-runtime/cameraPath.js`, `three`, `vitest`

## Responsibility
Pins the camera path drawing's structure and the separations a frame depends on: the root is in the scene, unnamed,
hidden, and every node in its subtree is on the decoration layer; the polyline's buffer grows and its draw range
follows the list in both directions; one marker set draws exactly the points it was handed; the ring the points are
drawn with is hollow and white; a marker's size changes without its position moving; and `dispose` empties the scene
(README D47). The app wiring, the materials as they render, and the export path are not tested here.

## Public interface
`describe` / `it` names are this file's observable surface:
- `camera path drawing` — `adds an unnamed group to the scene, hidden, with every child on the decoration layer`,
  `rejects anything that is not a scene, so the drawing can never be orphaned`, `buffers the polyline it is given,
  grows for a longer one, and empties for none`, `draws exactly one marker per point handed over, in one set`,
  `draws each marker as a white ring whose middle is hollow`, `sizes the rings from the viewing distance without moving
  one off the path`, `releases everything on dispose, twice without complaint`

## Internal logic
1. `OVERLAY_LAYER` is `1`, the decoration layer (README D24), restated here as the literal the whole-drawing walk
   asserts.
2. `polyline(path)`, `markerSet(path)`, and `markerMaterial(path)` find the drawing by what each piece is rather than
   through the class's private fields: `path.root.traverse` collects the one `THREE.Line` and the one `THREE.Points`,
   and the material helper narrows the point set's material to `PointsMaterial`. A missing piece throws rather than
   letting a case pass vacuously.
3. Each case constructs its own `CameraPath` on a fresh `Scene` and disposes it at the end — except the
   constructor-refusal case, which never gets one — so no case runs against another's scene.
4. The polyline case keeps the geometry it read first and asserts the draw range and the `position` attribute across a
   grow and a shrink, so capacity and range are told apart.
5. The ring case reads the `DataTexture`'s own texels and counts opaque and clear ones, which is how "hollow ring"
   becomes an assertion instead of a claim about a geometry that no longer exists.

## Invariants
- The root is added to the scene it was given, is unnamed (`name === ''`), and starts hidden; every node in
  `root.traverse` has `layers.mask === 1 << OVERLAY_LAYER` (2), and the walk finds exactly 3 objects — the root, the
  polyline, and the marker set — so a childless walk cannot pass the layer assertion vacuously.
- `new CameraPath(new THREE.Object3D() as unknown as THREE.Scene)` throws `TypeError`, which is the one error path
  the class has.
- An empty trajectory sets `drawRange.count` to 0 without needing a buffer; three points set it to 3 and write
  `(1, 2, 3)` into the second vertex; a fourth point grows the buffer and sets the range to 4 with `x = 7` at index 3;
  and the three-point list again only narrows the range back to 3.
- One marker per point and never more: three markers set the range to 3 with `(2, 0, 0)` at index 1, one marker
  afterwards narrows it to 1 with nothing rebuilt, a fourth grows the buffer and is drawn (`x = 4` at index 3), and an
  empty list sets the range to 0 — the count is the track's, in one set.
- The marker material maps a `DataTexture` whose texels are all white, with more than one fully opaque texel and more
  than one fully clear one, the centre texel clear and the first (corner) texel clear: a ring-shaped, anti-aliased
  sprite rather than a disc, a blank square, or a filled texture. Its `version` is above zero, which is the one thing
  that makes a `DataTexture` reach the GPU — an unuploaded map draws nothing, and a fresh `DataTexture` does not flag
  itself for upload.
- `setScreenScale(10)` then `(20)` doubles the material's `size` (to six places) while the point at index 0 stays
  `(5, 6, 7)`: the size follows the viewing distance and the ring stays on the point of the path it belongs to, which
  a scale on a group would not give.
- `dispose()` sets `root.parent` to `null`, and a second `dispose()` does not throw.

## Errors
The non-scene constructor argument is the only error asserted, and it is the only one the class produces. The
screen-scale clamps (a distance of zero and one past the maximum) are not pinned here; the traversal helpers throw
their own fixture errors rather than letting a missing piece pass.

## Dependencies
`../src/three-runtime/cameraPath.js` for `CameraPath`; `three` for `Scene`, `Object3D`, `Line`, `Points`,
`PointsMaterial`, `DataTexture`, and `Vector3`; `vitest` for `describe`, `it`, `expect`. No DOM and no GPU: the ring is
built from raw texel data rather than from a canvas, which is what keeps this suite runnable in the node environment.

## Tests
This file *is* the test, run by `npm test` in the node environment. It is the only coverage of
`three-runtime/cameraPath.ts`. Not covered here: the app wiring that hands the path its points, its visibility, and its
scale; the `Camera` group's `Show camera path` box; the texture's filtering and colour space as they render; and the
resources' actual GPU memory, which only a renderer holds. What needs a GPU — the white polyline and its rings drawn
over the scene, staying readable as the viewport orbits and the viewing distance changes, following the toggle, and
absent from an exported frame and from a pick — is verified by running the application (README §10).
