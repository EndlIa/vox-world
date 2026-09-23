# src/three-runtime/cameraPath.ts

Ring: 2 · Layer: three-runtime · Depends on: `three`

## Responsibility
Draws the authored camera's trajectory in the viewport: a white polyline through the sampled points and one hollow
ring per authored keyframe, as one runtime-only root. It is strictly presentational, like the grid and the overlay:
it is handed points, holds no document reference, and knows nothing about the timeline. Its whole subtree — the root
included, so a child added later cannot escape — is on layer 1, so `Picker` cannot hit it and no export frame
contains it (README D24), and nothing in it is named, so the mixer's binding walk never reaches it (README D22). It is
never serialized, never a keyframe target, and never a camera: it is the picture of the track
`animation/trajectory.ts` hands it (README D47), and it shares the viewing distance and the hidden-with-the-carrier rule with
`three-runtime/cameraControl.ts`, the carrier it pairs with (README D46).

Both halves are three's own primitives: a `Line` over a buffer it grows on demand, and one `Points` set whose material
draws the ring from a `DataTexture` rather than a mesh per keyframe. A point sprite faces the drawing camera by
construction, so nothing here turns a marker to the camera and the app has no per-frame call for it.

## Public interface
```ts
class CameraPath {
  constructor(scene: THREE.Scene);
  readonly root: THREE.Group;   // the whole drawing; not a document node and not a gizmo target
  setTrajectory(points: readonly THREE.Vector3[]): void;
  setMarkers(points: readonly THREE.Vector3[]): void;
  setScreenScale(distance: number): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}
```

## Internal logic
1. Constants: `OVERLAY_LAYER = 1`, the decoration layer `grid.ts`, `overlay.ts`, `controls.ts`, and `cameraControl.ts`
   share (README D24); `DECORATION_RENDER_ORDER = 1000`; the ring's `MARKER_INNER_RATIO = 0.62` and the
   `MARKER_TEXTURE_SIZE = 64` texels it is drawn into; the size rule's `MARKER_SCALE = 0.036` — the ring's diameter as
   a share of the viewing distance, which is the 1.8 helper units the old per-marker scale added up to — clamped into
   `[1.8e-4, 1.8e6]`; and the one colour, `0xffffff`.
2. `ringTexture()` builds the marker's whole appearance from data: one white annulus in an RGBA `Uint8Array`, its band
   feathered by a texel at each edge and its two filters set to `LinearFilter`, so a 64-texel ring does not read as a
   staircase. It is a `DataTexture` rather than a canvas texture because it needs no DOM, which is what keeps this file
   testable in the node environment; the alpha at the centre and outside the outer radius is zero, which is what makes
   the marker read as a ring rather than a disc. The texture is then flagged with `needsUpdate = true`, because a
   `DataTexture` does not flag itself for upload and a material given an unuploaded map draws nothing at all.
3. Construction builds one `Group` root holding the `Line` over its own `BufferGeometry` and the `Points` over theirs.
   The line material is `LineBasicMaterial({ color, depthTest: false, transparent: true })`; the point material is
   `PointsMaterial({ color, map: ringTexture(), size: 0, sizeAttenuation: true, depthTest: false, transparent: true })`;
   both objects are `frustumCulled = false` at `DECORATION_RENDER_ORDER`. The root then takes the layer along with
   every child (`root.traverse`, the root itself included), is hidden, and is added to the scene it was given
   (`mirror.scene`). The five resources — two geometries, two materials, and the texture — are collected in
   `resources` for `dispose`.
4. `setTrajectory(points)` replaces the polyline. An empty list only narrows the draw range, `setDrawRange(0, 0)`, and
   never dereferences a `position` attribute that may not exist yet, because a path that has never been drawn has no
   buffer. A list longer than `lineCapacity` grows the buffer first — a fresh `BufferAttribute(new Float32Array(count *
   3), 3)`, which replaces the old one because growth is the rare path — and only then are the points written with
   `setXYZ` per index and the attribute marked `needsUpdate`. `setDrawRange(0, points.length)` is what makes two points
   one segment and one point nothing, and `computeBoundingSphere()` follows, because the sphere is still what a measure
   or a ray would read even though the line is never frustum-culled.
5. `setMarkers(points)` writes the same way into the point set's one buffer, with its own `markerCapacity`: one point
   per authored keyframe, drawn exactly as far as the list goes. The draw range is what the count follows, so a
   keyframe deleted and added again reallocates nothing and no mesh is ever created per marker.
6. `setScreenScale(distance)` writes one scalar, the material's `size`, as `clamp(distance * MARKER_SCALE,
   MIN_MARKER_SCALE, MAX_MARKER_SCALE)`. It never walks the markers: a point sprite's size is its material's, so their
   positions cannot be touched by a resize — which is also why scaling a group, the arrangement that would move the
   markers off the path, is not available here.
7. `setVisible(visible)` writes the root's `visible`, which takes the whole drawing — polyline and markers — off the
   screen in one write; a hidden path is not seen, picked, or exported either way.
8. `dispose()` disposes the two geometries, the two materials, and the ring texture from `resources`, empties that list,
   and unparents the root. The second call disposes nothing and `removeFromParent` on a parentless node changes nothing,
   so it is idempotent.

## Invariants
- The whole subtree is on layer 1 at every moment: the construction walk covers the root and both children, and nothing
  is ever moved off it, so the raycaster's layers and the export camera's cannot reach the drawing (README D24).
- Nothing is named — the root, the line, and the point set carry no name — so the mixer's binding walk, which resolves
  `<ObjectId>` nodes and `camera`, can never bind a path object (README D22).
- The line and the points use `depthTest: false` at `DECORATION_RENDER_ORDER`, so the path draws over the scene
  rather than being buried in it — the same decoration choice the grid, the overlay, and the carrier make.
- Position and size are separate: `setScreenScale` writes the material and never a point, and `setMarkers` never sizes
  anything, so a ring is always drawn at the point it belongs to, whatever its size.
- Each buffer's capacity only grows, and growth is the one allocation: a shorter list narrows the draw range and
  overwrites the same `Float32Array`, and an empty one touches no buffer at all.
- A marker faces the drawing camera by construction — it is a point sprite — so no per-frame rotation exists for the
  app to call and no marker can be left facing the wrong way.
- `dispose()` releases both geometries, both materials, and the ring texture, and unparents the root; afterwards nothing
  of the path is in the scene and calling it again is safe.

## Errors
- `TypeError` from the constructor when the argument is not a `THREE.Scene`: the root would otherwise be added to
  something that cannot hold it, leaving the drawing unreachable.
- Everything else is total. `setScreenScale` clamps a distance outside the range rather than refusing it;
  `setTrajectory`, `setMarkers`, and `setVisible` accept whatever they are handed and may be called in any order,
  including before any trajectory exists; `dispose()` is safe twice. Nothing here validates that a point is finite —
  the points come from the sampler and the authored keyframes, which are finite by construction.

## Dependencies
- `three` — `Scene`, `Group`, `Line`, `LineBasicMaterial`, `Points`, `PointsMaterial`, `BufferGeometry`,
  `BufferAttribute`, `DataTexture`, `LinearFilter`, `RGBAFormat`, `Vector3`.
No outer-ring import: no project, timeline, editor, UI, or other three-runtime module. The caller hands in the scene,
exactly as it does for `Overlay` and `CameraControl`, and `app/main.ts` is the only caller.

## Tests
`tests/cameraPath.test.ts` pins the layer and naming invariants, the polyline buffer and its draw range, the marker set
and its draw range, the ring the material draws from its texture data, the position/size separation, and `dispose`, in
the node environment — no DOM, no GPU — see `codemap/tests/cameraPath.md`. What needs a GPU stays app-verified
(README §10): the white polyline and its rings on screen over the scene, staying readable as the viewport orbits and as
the viewing distance changes, following the toggle, and absent from an exported frame and from a pick.

## Open questions
- Every marker shares one geometry, one texture, and one material, so per-marker colouring — marking the keyframe under
  the playhead, for instance — would need a second material or a per-point attribute. Nothing asks for it today.
- The polyline is a `Line`, so it carries the platform's one-pixel width; a thicker path would need a different
  primitive. At demo scale the rings carry the reading anyway.
- The ring is a fixed 64-texel annulus stretched to the distance-derived size, so a marker very close to the camera is
  magnified rather than crisp. A screen-space size would need the drawing camera's projection here, which this file
  deliberately does not read.
