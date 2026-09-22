# src/three-runtime/cameraControl.ts

Ring: 2 · Layer: three-runtime · Depends on: `three`

## Responsibility
The output camera's stand-in in the viewport: a body, a frustum wireframe derived from the vertical field of view
and the viewport's aspect, and a triangle that marks which way is up, drawn as one hidden runtime-only carrier. Its
node is what the edit gizmo moves while the carrier is selected, and `app/main.ts` gives it the output camera's pose
and writes a drag or a field back into `project.camera` (README D46), so it is a handle on the authored camera and
never a second camera: it renders nothing, is no mixer target, is never serialized, and holds no document state of
its own.

Everything it draws is on layer 1 — the node itself included, so a child added later cannot escape the layer — which
keeps it out of the `Picker`'s raycast (layers 0 and 2) and out of every export frame (layer 0 alone, README D24).
The node carries no name, so the mixer's binding walk, which reaches `<ObjectId>`-named nodes and `camera`, can
never bind it (README D22).

## Public interface
```ts
class CameraControl {
  constructor(scene: THREE.Scene);
  readonly node: THREE.Object3D;   // the pose node: the gizmo's target, and the app's handle on the carrier
  setPose(position: THREE.Vector3, quaternion: THREE.Quaternion, fovDegrees: number, aspect: number): void;
  setVisible(visible: boolean): void;
  setSelected(selected: boolean): void;
  setScreenScale(distance: number): void;
  dispose(): void;
}
```

## Internal logic
1. Construction builds the node (`Object3D`), a child helper `Group`, and the three pieces that sit in the helper:
   a fixed 12-edge body box (`BODY_HALF = 0.06`, 24 vertices from one `Float32Array` built once), an 8-segment
   frustum frame over a preallocated 16-vertex buffer, and the up triangle. Each is `frustumCulled = false`, at
   `DECORATION_RENDER_ORDER = 1000`, with `depthTest: false` and `transparent: true`, and the body and the frustum
   share the idle grey `0x9aa2ad`; the triangle is a `Mesh` with a `MeshBasicMaterial` so it is filled. The
   constructor appends the node to the scene it was given (`mirror.scene`), hides it, and walks `node.traverse` to
   put every child, the node itself included, on `OVERLAY_LAYER` — layer 1 (README D24), the number `overlay.ts`,
   `grid.ts`, and `controls.ts` share.
2. `setPose(position, quaternion, fovDegrees, aspect)` copies the pose onto the node unconditionally and returns
   before rebuilding when the FOV and aspect both equal the ones the current frustum was built for (`builtFov`,
   `builtAspect`), so a still camera rebuilds no geometry while a pose still lands every frame.
3. `rebuildFrustum(fovDegrees, aspect)` derives the far rectangle from the projection: half-height
   `tan(fov / 2) · FRUSTUM_DEPTH` and half-width that times the aspect (depth 1), four corners at
   `z = -FRUSTUM_DEPTH`, and the apex at the pose itself, `(0, 0, 0)`, which is where a camera's frustum starts. It
   writes eight segments — four from the apex to each corner, four around the rectangle — into the preallocated
   buffer, marks the attribute, and recomputes the bounding sphere.
4. The up marker is a triangle in the helper's own XY plane, riding above the far rectangle's top edge
   (`base = halfHeight + UP_MARKER_HEIGHT`) with its apex a further `UP_MARKER_HEIGHT` out, all at
   `z = -FRUSTUM_DEPTH`: it points away from the frustum along the pose's own up, so a banked pose reads as banked
   rather than as an unrolled frame (`UP_MARKER_HEIGHT = 0.1`).
5. `setVisible(visible)` writes the node's `visible`, so the carrier is hidden from the frame it is called for; the app drives it with
   `selected && !locked`, because a camera cannot see itself, and the panel's gating keeps a hidden carrier unselectable.
6. `setSelected(selected)` recolours all three materials — `SELECTED_COLOR = 0x4da3ff` while selected, the idle
   grey otherwise — and returns early when the flag did not change, so the frame loop's per-frame call costs
   nothing.
7. `setScreenScale(distance)` sets the helper's uniform scale to `distance · SCREEN_SCALE`, clamped into
   `[MIN_SCREEN_SCALE, MAX_SCREEN_SCALE]` (`SCREEN_SCALE = 0.16`, `1e-3` to `1e7`); the node's own transform is
   untouched. It is the one thing the distance to the drawing camera changes.
8. `dispose()` disposes the six resources the constructor collected (three geometries, three materials), empties
   that list, and removes the node from its parent. It is idempotent: the emptied list makes the second call
   dispose nothing, and `removeFromParent` on a parentless node changes nothing.

## Invariants
- The pose lives on the node and the screen-size scale on the helper, never both on one: a rescale never moves the
  node, and a pose update never rescales it. The split exists because the gizmo derives its drag from the node's
  own world matrix — a scale on that matrix would be folded into every reported matrix — while the drawing has to
  follow the viewing distance, which only the helper may carry.
- The whole carrier is on layer 1 and nothing is ever moved off it: the raycaster tests layers 0 and 2, so no line
  or triangle is ever picked, and the export camera enables layer 0 alone, so no part of the carrier can appear in
  an exported frame (README D24). The node being on the layer too is what makes a later child safe by construction.
- The node is unnamed, so the mixer's binding walk can never reach it, and the carrier is no keyframe target and no
  document node (README D22): it is a runtime-only handle on the authored camera.
- The frustum is a function of the vertical FOV and the aspect alone, and is never derived from scene content; a
  `setPose` that changes neither projection input rebuilds nothing.
- Nothing here reads a project, a session, a camera, or a size: the caller passes in the position, quaternion, FOV,
  aspect, visibility, selection, and distance. The carrier is never a source of truth.
- The constructor allocates the frustum's and the marker's vertex arrays once — the body's edges are a module-level
  constant shared by every carrier — and `setPose`/`rebuildFrustum` rewrite the frustum's 16 vertices and the
  marker's 3 in place, `setSelected` recolours in place, and `setScreenScale` writes one scalar: no geometry buffer
  is ever reallocated by a frame or a drag.
- `dispose()` releases all six resources and unparents the node; afterwards nothing of the carrier remains in the
  scene, and calling it again is safe.
- All three pieces share `DECORATION_RENDER_ORDER` with `depthTest: false`, so the carrier draws over the scene
  rather than being buried in it — the same decoration choice the grid and the overlay make.

## Errors
- `TypeError` from the constructor when the argument is not a `THREE.Scene`: the node would otherwise be added to
  something that cannot hold it, leaving the drawing unreachable.
- Everything else is total. A `distance` outside the clamp range is clamped, never refused; `setSelected` and
  `setVisible` are legal at any time; `dispose()` is safe twice. Nothing here validates `fovDegrees` or `aspect` —
  the FOV the app hands over is the one `setCameraFov` already clamped, and the aspect comes from the canvas.

## Dependencies
- `three` — `Scene`, `Object3D`, `Group`, `LineSegments`, `Mesh`, `LineBasicMaterial`, `MeshBasicMaterial`,
  `BufferGeometry`, `BufferAttribute`, `Vector3`, `Quaternion`, `MathUtils`.
No outer-ring import: no project, editor, UI, or other three-runtime module. The caller hands in the scene, exactly
as it does for `Overlay` and `WorldGrid`, and `app/main.ts` is the only caller.

## Tests
`tests/cameraControl.test.ts` pins the drawing and the two separations a drag depends on in the node environment —
no DOM, no GPU — see `codemap/tests/cameraControl.md`. What needs a GPU stays app-verified (README §10): the
carrier on screen with its two colours, following the output camera as it is aimed and hidden while the viewport
already is that camera, and absent from an exported frame.

## Open questions
- The body's half-size, the frustum's depth, and the marker's height are helper-space constants (`0.06`, `1`, `0.1`),
  and the screen scale is `distance · 0.16` clamped: the drawing's on-screen size therefore follows the viewing
  distance, which is what keeps it readable in both a metre scene and a kilometre one (README D40, D41). A constant
  pixel size would need the drawing camera's projection here, which the file deliberately does not read.
- The carrier draws over the scene, so a camera behind a voxel is still visible through it. Occluding only where it
  really is in front was not needed for a decoration that has to stay findable.
- There is no query for the drawing's bounds or screen size, so an app that wanted to keep the handles off the
  carrier would have to derive it from `helper.scale` and the constants. Nothing needs that today.
