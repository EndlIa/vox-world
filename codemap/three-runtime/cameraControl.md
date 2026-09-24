# src/three-runtime/cameraControl.ts

Ring: 2 · Layer: three-runtime · Depends on: `three`

## Responsibility
The output camera's stand-in in the viewport: three's own `CameraHelper` draws the frustum wireframe, derived from the
vertical field of view and the viewport's aspect, and the triangle the library puts above its near plane is what marks
which way is up. The drawing hangs off a runtime-only pose node, and that node is what the edit gizmo moves while the
carrier is selected; `app/main.ts` gives it the output camera's pose and writes a drag or a field back into
`project.camera` (README D46), so it is a handle on the authored camera and never a second camera: it renders nothing,
is no mixer target, is never serialized, and holds no document state of its own.

`CameraHelper` derives its frame from a `Camera`'s projection, so the carrier owns a display-only `PerspectiveCamera`:
it is never added to a scene, never rendered, never read for a matrix, and exists so the library can be handed the two
display planes `FRUSTUM_NEAR = 1` and `FRUSTUM_FAR = 2` and the current projection. Those planes are constants rather
than the authored camera's own near and far, which a kilometre-scale world (README D40) would turn into a frustum
spanning the whole scene; the near plane is where the library draws the marker frame and the up triangle, and the far
plane is a second frame behind it, which is the depth cue its frustum comes with.

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
1. Construction builds the node (`Object3D`) and one child `Group` — the scaled helper, which everything the distance
   is allowed to touch lives in — plus the display projection and the `CameraHelper` over it. The helper's own local
   matrix is replaced with a fresh identity `Matrix4` and `matrixAutoUpdate` is turned off: the library normally places
   the helper with the camera's world matrix — it holds that matrix by reference from its construction — which is only
   right for a scene child, while here the node owns the pose and the helper group owns the size, so the pose has to
   reach the helper from its parents instead. The helper is `frustumCulled = false` at
   `DECORATION_RENDER_ORDER = 1000`, its material is taken from the library (narrowed once, because the library types
   it as a generic `Material`) and given `depthTest: false` and `transparent: true`; the constructor appends the node
   to the scene it was given (`mirror.scene`), paints the idle colour, hides it, and walks `node.traverse` to put every
   child, the node itself included, on `OVERLAY_LAYER` — layer 1 (README D24), the number `overlay.ts`, `grid.ts`, and
   `controls.ts` share.
2. `setPose(position, quaternion, fovDegrees, aspect)` copies the pose onto the node unconditionally and returns
   before touching the projection when the FOV and aspect both equal the ones the current frustum was built for
   (`builtFov`, `builtAspect`), so a still camera rebuilds no geometry while a pose still lands every frame.
3. A projection change writes `fov` and `aspect` onto the display camera, calls its `updateProjectionMatrix()`, and
   then the helper's `update()`, which is what unprojects the library's own point set — the near and far frames, the
   cone from the apex, the up triangle, the axis and the two crosses — into the geometry it already owns. No vertex is
   built here: the frustum math is three's.
4. `setVisible(visible)` writes the node's `visible`, so the carrier is hidden from the frame it is called for; the app drives it with
   `!locked`, which draws the carrier whether or not it is selected — selecting it only changes its colour (D46) — while the locked view, which
   already is the output camera, shows no decoration.
5. `setSelected(selected)` paints the whole helper one colour — `SELECTED_COLOR = 0x4da3ff` while selected, the idle
   grey `0x9aa2ad` otherwise — by calling the library's `setColors` with the same `Color` for all five of its parts
   (the frustum, the cone, the up marker, the axis and the crosses), because the drawing is one decoration rather than
   five states. It returns early when the flag did not change, so the frame loop's per-frame call costs nothing, and
   the constructor applies the idle colour once so the drawing is never seen in the library's default scheme.
6. `setScreenScale(distance)` sets the helper group's uniform scale to `distance · SCREEN_SCALE`, clamped into
   `[MIN_SCREEN_SCALE, MAX_SCREEN_SCALE]` (`SCREEN_SCALE = 0.16`, `1e-3` to `1e7`); the node's own transform is
   untouched. It is the one thing the distance to the drawing camera changes.
7. `dispose()` calls the helper's own `dispose()` — which releases the geometry and the material it built — and
   removes the node from its parent. It is idempotent: disposing twice releases nothing twice and `removeFromParent`
   on a parentless node changes nothing. The display projection owns no GPU resource and is simply dropped with the
   instance.

## Invariants
- The pose lives on the node and the screen-size scale on the helper group, never both on one: a rescale never moves the
  node, and a pose update never rescales it. The split exists because the gizmo derives its drag from the node's
  own world matrix — a scale on that matrix would be folded into every reported matrix — while the drawing has to
  follow the viewing distance, which only the helper may carry.
- The whole carrier is on layer 1 and nothing is ever moved off it: the raycaster tests layers 0 and 2, so no line
  or triangle is ever picked, and the export camera enables layer 0 alone, so no part of the carrier can appear in
  an exported frame (README D24). The node being on the layer too is what makes a later child safe by construction.
- The node is unnamed, so the mixer's binding walk can never reach it, and the carrier is no keyframe target and no
  document node (README D22): it is a runtime-only handle on the authored camera.
- The frustum is a function of the vertical FOV, the aspect, and the two display planes alone, and is never derived
  from scene content; a `setPose` that changes neither projection input updates nothing.
- The display projection is never rendered, never added to a scene, and never read for a matrix: it is a projection
  descriptor for the helper. The app's two rendering cameras are untouched by this file (README D17).
- One frame or drag allocates nothing: the helper's point set and colour attribute are built once by the constructor,
  `setPose` rewrites them in place through the library's `update()`/`setColors()`, and `setScreenScale` writes one
  scalar.
- `dispose()` releases the helper's geometry and material and unparents the node; afterwards nothing of the carrier
  remains in the scene, and calling it again is safe.
- The drawing is `depthTest: false` at `DECORATION_RENDER_ORDER`, so the carrier draws over the scene rather than
  being buried in it — the same decoration choice the grid and the overlay make.

## Errors
- `TypeError` from the constructor when the argument is not a `THREE.Scene`: the node would otherwise be added to
  something that cannot hold it, leaving the drawing unreachable.
- Everything else is total. A `distance` outside the clamp range is clamped, never refused; `setSelected` and
  `setVisible` are legal at any time; `dispose()` is safe twice. Nothing here validates `fovDegrees` or `aspect` —
  the FOV the app hands over is the one `setCameraFov` already clamped, and the aspect comes from the canvas.

## Dependencies
- `three` — `Scene`, `Object3D`, `Group`, `PerspectiveCamera`, `CameraHelper`, `Color`, `Vector3`, `Quaternion`.
No outer-ring import: no project, editor, UI, or other three-runtime module. The caller hands in the scene, exactly
as it does for `Overlay` and `WorldGrid`, and `app/main.ts` is the only caller.

## Tests
`tests/cameraControl.test.ts` pins the drawing and the two separations a drag depends on in the node environment —
no DOM, no GPU — by reading the helper's own point map and colour attribute: see `codemap/tests/cameraControl.md`. What
needs a GPU stays app-verified (README §10): the carrier on screen with its two colours, following the output camera as
it is aimed and hidden while the viewport already is that camera, and absent from an exported frame.

## Open questions
- The two display planes (`1` and `2`) and the screen scale (`distance · 0.16`, clamped) are the drawing's whole size
  model: the on-screen size therefore follows the viewing distance, which is what keeps it readable in both a metre
  scene and a kilometre one (README D40, D41). A constant pixel size would need the drawing camera's projection here,
  which the file deliberately does not read.
- The library draws more than this carrier used to — a cone from the apex, the axis, and a cross at each frame — and
  they are painted one colour rather than removed, because trimming another library's geometry would mean rebuilding
  it. If the extra marks ever read as noise, the choice is between a smaller `far` and keeping a hand-built frustum.
- The carrier draws over the scene, so a camera behind a voxel is still visible through it. Occluding only where it
  really is in front was not needed for a decoration that has to stay findable.
- There is no query for the drawing's bounds or screen size, so an app that wanted to keep the handles off the
  carrier would have to derive it from `helper.scale` and the constants. Nothing needs that today.
