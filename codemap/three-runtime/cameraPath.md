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

## Public interface
```ts
class CameraPath {
  constructor(scene: THREE.Scene);
  readonly root: THREE.Group;   // the whole drawing; not a document node and not a gizmo target
  setTrajectory(points: readonly THREE.Vector3[]): void;
  setMarkers(points: readonly THREE.Vector3[]): void;
  faceCamera(quaternion: THREE.Quaternion): void;
  setScreenScale(distance: number): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}
```

## Internal logic
1. Constants: `OVERLAY_LAYER = 1`, the decoration layer `grid.ts`, `overlay.ts`, `controls.ts`, and `cameraControl.ts`
   share (README D24); `DECORATION_RENDER_ORDER = 1000`; the ring's `MARKER_RADIUS = 0.9`, `MARKER_INNER_RATIO =
   0.62`, and `MARKER_SEGMENTS = 24`; the size rule's `MARKER_SCALE = 0.02`, clamped into `[1e-4, 1e6]`; and the one
   colour, `0xffffff`.
2. Construction builds one `Group` root holding a `Line` over its own `BufferGeometry` and a marker `Group`. The line
   material is `LineBasicMaterial({ color, depthTest: false, transparent: true })`; the line is `frustumCulled =
   false` at `DECORATION_RENDER_ORDER`; and every marker will share one
   `RingGeometry(MARKER_RADIUS * MARKER_INNER_RATIO, MARKER_RADIUS, MARKER_SEGMENTS)` and one
   `MeshBasicMaterial({ color, side: DoubleSide, depthTest: false, transparent: true })`. The root then takes the
   layer along with every child (`root.traverse`, the root itself included), is hidden, and is added to the scene it
   was given (`mirror.scene`). The four resources — two geometries, two materials — are collected in `resources` for
   `dispose`.
3. `setTrajectory(points)` replaces the polyline. An empty list only narrows the draw range, `setDrawRange(0, 0)`, and
   never dereferences a `position` attribute that may not exist yet, because a path that has never been drawn has no
   buffer. A list longer than `capacity` grows the buffer through `grow(count)` first, and only then are the points
   written with `setXYZ` per index and the attribute marked `needsUpdate`. `setDrawRange(0, points.length)` is what
   makes two points one segment and one point nothing, and `computeBoundingSphere()` follows, because the sphere is
   still what a measure or a ray would read even though the line is never frustum-culled.
4. `grow(count)` allocates a fresh `BufferAttribute(new Float32Array(count * 3), 3)` and installs it as `position`,
   recording the new `capacity`. It replaces the old buffer rather than reusing it: growth is the rare path — a longer
   trajectory than any seen so far — and a shorter one afterwards only narrows the draw range and overwrites the same
   array.
5. `setMarkers(points)` is the ring pool. Index `i` reuses `markers[i]` when it exists and otherwise creates one
   `Mesh` from the shared geometry and material, `frustumCulled = false`, at `DECORATION_RENDER_ORDER`, on
   `OVERLAY_LAYER`, and adds it to the marker group; then it copies `points[i]` into `marker.position` and shows it.
   A list shorter than the pool hides the surplus (`visible = false`) instead of removing it, so a keyframe deleted
   and added again reuses the meshes it had.
6. `faceCamera(quaternion)` copies the drawing camera's quaternion onto every visible marker. Three has no billboard
   mode on a mesh, so this is one copy per marker per frame — the price of a ring that reads as a circle from any
   angle, and the reason the app calls it every frame rather than on change.
7. `setScreenScale(distance)` scales every marker mesh by `clamp(distance * MARKER_SCALE, MIN_MARKER_SCALE,
   MAX_MARKER_SCALE)`. It writes the meshes, never the marker group: a scale on the group would scale the markers'
   world positions with their size, and the rings would drift off the path they belong to.
8. `setVisible(visible)` writes the root's `visible`, which takes the whole drawing — polyline and markers — off the
   screen in one write; a hidden path is not seen, picked, or exported either way.
9. `dispose()` disposes the two geometries and the two materials from `resources`, empties that list and the marker
   pool, and unparents the root. The second call disposes nothing and `removeFromParent` on a parentless node changes
   nothing, so it is idempotent; the marker meshes stay children of the marker group, but nothing draws through them
   and the root is out of the scene.

## Invariants
- The whole subtree is on layer 1 at every moment: the construction walk covers the root and both children, and each
  marker is put on the layer as it is created. Nothing is ever moved off it, so the raycaster's layers and the export
  camera's cannot reach the drawing (README D24).
- Nothing is named — the root, the line, the marker group, and every marker carry no name — so the mixer's binding
  walk, which resolves `<ObjectId>` nodes and `camera`, can never bind a path object (README D22).
- The line and the markers use `depthTest: false` at `DECORATION_RENDER_ORDER`, so the path draws over the scene
  rather than being buried in it — the same decoration choice the grid, the overlay, and the carrier make.
- Position and size are separate: `setScreenScale` never moves a marker and `setMarkers` never rescales one, so a
  ring is always drawn at the point it belongs to, whatever its size.
- The buffer's capacity only grows, and growth is the one allocation: a shorter trajectory narrows the draw range and
  overwrites the same `Float32Array`, and an empty one touches no buffer at all.
- The marker pool only grows with the widest marker list seen; surplus markers are hidden, never removed, so the mesh
  count and the keyframe count can differ without anything being rebuilt.
- `dispose()` releases both geometries and both materials exactly once, drops the marker pool, and unparents the root;
  afterwards nothing of the path is in the scene and calling it again is safe.

## Errors
- `TypeError` from the constructor when the argument is not a `THREE.Scene`: the root would otherwise be added to
  something that cannot hold it, leaving the drawing unreachable.
- Everything else is total. `setScreenScale` clamps a distance outside the range rather than refusing it;
  `setTrajectory`, `setMarkers`, `faceCamera`, and `setVisible` accept whatever they are handed and may be called in
  any order, including before any trajectory exists; `dispose()` is safe twice. Nothing here validates that a point is
  finite — the points come from the sampler and the authored keyframes, which are finite by construction.

## Dependencies
- `three` — `Scene`, `Group`, `Line`, `LineBasicMaterial`, `BufferGeometry`, `BufferAttribute`, `Mesh`,
  `RingGeometry`, `MeshBasicMaterial`, `Vector3`, `Quaternion`, `DoubleSide`.
No outer-ring import: no project, timeline, editor, UI, or other three-runtime module. The caller hands in the scene,
exactly as it does for `Overlay` and `CameraControl`, and `app/main.ts` is the only caller.

## Tests
`tests/cameraPath.test.ts` pins the layer and naming invariants, the polyline buffer and its draw range, the ring
pool, the position/size separation, the billboard copy, and `dispose`, in the node environment — no DOM, no GPU — see
`codemap/tests/cameraPath.md`. What needs a GPU stays app-verified (README §10): the white polyline and its rings on
screen over the scene, turning to face the viewport as it orbits, resizing with the viewing distance, following the
toggle, and absent from an exported frame and from a pick.

## Open questions
- Every marker shares one geometry and one material, so per-marker colouring — marking the keyframe under the
  playhead, for instance — would need a second material. Nothing asks for it today.
- The polyline is a `Line`, so it carries the platform's one-pixel width; a thicker path would need a different
  primitive. At demo scale the rings carry the reading anyway.
