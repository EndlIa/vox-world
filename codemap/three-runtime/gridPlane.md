# src/three-runtime/gridPlane.ts

Ring: 2 · Layer: three-runtime · Depends on: `three`, `@pmndrs/vanilla/core/Grid`

## Responsibility
One world grid plane: a quad whose grid a shader draws, as a single `Mesh` its owner adds to the scene, names, and
follows. It is the library boundary — the drawing is `@pmndrs/vanilla`'s `Grid`, the vanilla three descendant of the
shader grid the reference viewport is built on, so the lines are computed per fragment from screen-space derivatives
rather than tessellated: they anti-alias, they keep their apparent thickness, and the finer spacing fades with
distance instead of collapsing into noise as the camera pulls back. That is what line geometry cannot do, and why the
plane it replaces had to stop at 200 units (README D49). It is strictly presentational, like `cameraPath.ts` and
`overlay.ts`: it is handed an axis, an offset, and a camera, holds no document reference, and reads nothing but the
camera's position.

Three things here are ours rather than the library's, each because the display depends on it (see the numbered
internal logic): the logarithmic-depth chunks a custom shader is missing (README D40), a CPU follow snapped to whole
cells instead of the library's own `followCamera`, and layer 1 with `depthWrite = false` so the whole thing is
decoration the raycaster never tests, an export never contains, and voxels are never hidden by (README D24).

## Public interface
```ts
const GRID_CELL_SIZE = 1;          // the world unit, so the lines are the cell boundaries (README D41)
const GRID_SECTION_SIZE = 10;      // every tenth cell carries the coarser, brighter line
const GRID_PLANE_EXTENT = 512;     // the quad's side, in world units
const GRID_FADE_DISTANCE = 160;    // distance from the camera's point on the plane at which the grid is gone
const GRID_AXES = ['x', 'y', 'z'] as const;
type GridAxis = 'x' | 'y' | 'z';

function withLogDepth(vertexShader: string, fragmentShader: string):
  { vertexShader: string; fragmentShader: string };
function withAnisotropicAttenuation(fragmentShader: string): string;

class GridPlane {
  constructor(axis: GridAxis, offset: number);
  readonly mesh: THREE.Mesh;                  // the quad; the owner parents, names, and follows it
  setFacing(axis: GridAxis, offset: number): void;
  follow(camera: THREE.Camera): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}
```

## Internal logic
1. Constants. `GRID_CELL_SIZE` is the world unit, so the fine spacing is the cell boundaries themselves;
   `GRID_SECTION_SIZE` is the coarse one; `GRID_PLANE_EXTENT = 512` is well beyond twice `GRID_FADE_DISTANCE = 160`, so
   the quad's own edge is never on screen; the fade strength is the library's default `1`, a straight falloff; the
   cell and section thicknesses are `0.42` and `0.55` of their own spacing; and the two colours are the palette's
   greys, `0x9aa2ad` for the cell and `0xe6e8ea` for the brighter section (README D32, D35). `GRID_AXES` and `GridAxis`
   are the axes a plane can face, `y` being the horizontal one and so the world's ground. `OVERLAY_LAYER = 1` is the
   decoration layer D24 made, and `GRID_RENDER_ORDER = 0` sits below the `1000` the overlay's highlight, the carrier,
   and the camera path draw at.
2. The private tables are what `setFacing` and `follow` read: `AXIS_NORMALS` is the unit vector each axis turns the
   quad's own normal (`PLANE_NORMAL`, `(0, 1, 0)`) into, `AXIS_INDICES` the component that axis owns, and
   `COMPONENT_INDICES` every component, so a plane can snap the ones it does not face. Nothing here is mutated:
   `AXIS_NORMALS`' vectors are copied into the instance's own `normal`.
3. Construction asks the library for one `Grid` over a `GRID_PLANE_EXTENT` square: the spacings, thicknesses,
   colours, the fade distance and strength, and `side: DoubleSide`, then **`followCamera: false` and
   `infiniteGrid: false`**. Both of those change the grid *inside* the shader — `followCamera` shifts it by the camera's
   projected position, which slides the lines under a moving camera, and `infiniteGrid` rescales the plane's local
   coordinates — and each leaves the mesh where a raycast finds nothing, so the quad is moved instead, by whole cells,
   and the drawn grid and the mesh agree. It then puts the mesh on `OVERLAY_LAYER`, gives it
   `GRID_RENDER_ORDER`, sets `depthWrite = false` on the returned `ShaderMaterial`, and installs the one
   `onBeforeCompile` that applies the two patches of steps 4 and 5. The library's returned `update` is kept as
   `syncFade`, and the constructor ends by calling `setFacing(axis, offset)` — which is where a bad offset is refused.
4. `withLogDepth(vertexShader, fragmentShader)` is **pure** and total: it inserts three's `<common>` plus the four
   `logdepthbuf` chunks. The renderer defines `USE_LOGARITHMIC_DEPTH_BUFFER` for every material and sets `logDepthBufFC`
   for every program, but only these chunks read them, so a `ShaderMaterial` without them writes an unencoded depth and
   the plane sorts wrongly against every voxel (README D40). `<common>` comes along because the vertex chunk calls
   `isPerspectiveMatrix`, which only that chunk defines — without it the vertex program does not compile and nothing is
   drawn at all. The fragment side needs nothing of the sort: its chunks read varyings and a uniform, and the library's
   own tonemapping chunk defines the one helper it borrows.
5. `withAnisotropicAttenuation(fragmentShader)` is **pure** and replaces the library's `return 1.0 - min(line, 1.0);`
   with the same expression times a `clamp` over the screen-space derivative of `r.x`, and is a no-op on any source that
   is not the library's function. The library saturates a line as its spacing shrinks, which stops it flickering but
   leaves the far field a flat wash that beats against the pixel grid — a dark cross-hatch near the horizon at a
   one-unit spacing. Attenuating by the derivative is the reference material's own `maxNumberOfLines` clamp: it removes
   those lines instead, so what survives at distance is the coarse spacing and what reads up close is the fine one
   (README D49).
6. `insertChunks(source, declaration, statement)` is the shared helper both patches' insertion goes through: it finds
   `void main() {` and the last `}`, puts the declaration above the function and the statement at the end of its body,
   and returns the source unchanged when either marker is missing. A varying declared inside a body or a chunk left
   outside it would not compile or would never run, which is why the split is by position rather than appended at the
   end.
7. `setFacing(axis, offset)` refuses a non-integer `offset` with a `RangeError` — a plane between two cells would put
   its lines between the world's own — then records the axis and the offset and turns the quad onto the axis:
   `normal.copy(AXIS_NORMALS[axis])` and `mesh.quaternion.setFromUnitVectors(PLANE_NORMAL, normal)`. The axis and the
   offset are the state `follow` reads back, so the plane follows the axis it was last given.
8. `follow(camera)` is the one per-frame call. It copies the camera's position onto the quad and then, for each
   component, writes either the plane's own `offset` when that component is the axis the plane faces, or the camera's
   coordinate **rounded to a whole cell** otherwise. So the two in-plane coordinates follow the camera — which keeps
   the lines on the world's cell boundaries instead of sliding them — while the coordinate along the normal stays the
   plane's own, which is what keeps a wall a wall. It then calls `mesh.updateMatrixWorld()` and only then
   `syncFade(camera)`: the library's update reads the mesh's world matrix (and returns early when the mesh has no
   parent), and it is what measures the fade from the camera's own point projected onto the plane.
9. `setVisible(visible)` writes the mesh's `visible`, the only switch a plane has; an owner that wants a display off
   hides every plane of it.
10. `dispose()` takes the mesh out of the scene and disposes its geometry and its material. The second call runs the
    same three lines on a parentless mesh whose resources are already released — three's disposers only signal, so
    nothing is released twice — which is why a torn-down page can call it again.

## Invariants
- Everything is decoration: the mesh is on layer 1, `depthWrite = false`, and it draws at `GRID_RENDER_ORDER` below
  the overlay's highlight, the carrier, and the camera path, so the raycaster (layers 0 and 2) never picks it, the
  export camera (layer 0) never draws it, and it can never occlude a voxel (README D24).
- The lines never move with the camera: `followCamera` and `infiniteGrid` are both off, so the shader draws the grid
  it was built with and the mesh is what moves — by whole cells, so the lines stay on the world's own boundaries — and
  the geometry and the picture agree, so a raycast against the mesh finds the grid that is on screen.
- A plane keeps its own plane: `follow` writes the facing axis's component from the plane's own offset and never from
  the camera, so a wall at `-60` on `x` stays at `-60` whatever the camera does.
- The quad is wider than the fade: `GRID_PLANE_EXTENT > 2 * GRID_FADE_DISTANCE`, so the grid has faded out well
  before its own edge could be the thing that ends it.
- The fade is measured from the camera's point on the plane, not from the camera: `syncFade` is the library's own
  uniform update, and `follow` calls it after `updateMatrixWorld`, because that is the matrix it reads.
- The two patch functions are pure: they are handed strings and return strings, so what they do to a shader is
  checkable without a GPU (`withLogDepth` is total; `withAnisotropicAttenuation` is a no-op on a source without the
  library's line).
- `setFacing` is the only refusal in the file, and it refuses on the way in as well: the constructor routes through it,
  so `new GridPlane('y', 0.5)` throws before anything is built.

## Errors
- `RangeError` from `setFacing`, and from the constructor through it, when the offset is not a whole world unit
  (`Number.isInteger` is the test); the message names the method and the value.
- Everything else is total. `follow` accepts any camera and may be called before the mesh is in a scene — the
  library's uniform update then returns without a parent, so only the fade is skipped. `setVisible` writes whatever it
  is handed. `withLogDepth` and `withAnisotropicAttenuation` return their input unchanged when they find nothing to
  patch, and `dispose()` is safe twice. Nothing here throws `TypeError`.

## Dependencies
- `@pmndrs/vanilla` — `Grid`, imported from `@pmndrs/vanilla/core/Grid`. `^1.25.0`, MIT: pmndrs' framework-free port
  of the drei components, and the vanilla three descendant of Fyrestar's `InfiniteGridHelper` and of the shader grid
  the reference product is built on. It returns `{ mesh, update }`: the mesh (its `PlaneGeometry` and its
  `ShaderMaterial` with the spacings plus `worldCamProjPosition` and `worldPlanePosition` uniforms) and the uniform
  update this file keeps as `syncFade`. Its two transitive dependencies, `glsl-noise` and `meshline`, belong to
  components this file never imports and never reach the bundle.
- **The patches are fragile against that library, by design.** `withAnisotropicAttenuation` matches one exact line of
  its fragment source and is a no-op otherwise, and `withLogDepth` inserts at `void main() {` and the last `}`. An
  upgrade that renames an option or a uniform, changes that return line, or restructures the shader around those
  markers would silently un-patch the plane. `tests/gridPlane.test.ts` is what catches that: it drives the material's
  `onBeforeCompile` with a stand-in shader pair and asserts the injected chunks and the attenuation, and reads the
  library's own uniforms off the material. Re-check both patches whenever the dependency moves (README D49).
- `three` — `Mesh`, `ShaderMaterial`, `Material`, `Vector3`, `Color`, `DoubleSide`, and the `Camera` type.
  No project, editor, UI, document, or other three-runtime module: the owner hands the plane's mesh into the scene and
  calls `follow` once a frame, exactly as `Overlay` and `CameraPath` are driven.

## Tests
`tests/gridPlane.test.ts` pins the decoration layer and the no-depth-write rule, the two spacings and the fade
distance off the library's uniforms, the quad's extent against the fade, the whole-cell snap and the pinned facing
axis, the two patches through `material.onBeforeCompile` (with the no-op guards), the offset refusal, and the double
dispose — in the node environment, no DOM and no GPU; see `codemap/tests/gridPlane.md`. What needs a GPU stays
app-verified (README §10): the grid drawn over the scene with anti-aliased lines and the fine spacing fading before
the coarse one, no hard edge where the quad ends, the plane sorted correctly against the voxels by the log-depth
patches, the horizon reading as a faint moiré rather than an obvious one, and no shader or console error.

## Open questions
- The plane has to be followed by its owner every frame, and its quad is 512 units wide to keep its edge off screen at
  a 160-unit fade. A much larger fade would want a larger quad, or the library's own camera-following mode, which is
  exactly what cannot be used here.
- Offsets are whole world units only: a plane between two cells would draw its lines between the world's own, so a
  sub-cell work plane is not offered (README D49).
- The two patches are maintenance against the library's source. A future version that exposed its attenuation or its
  depth handling as options would remove one or both.
- The thicknesses, the two greys, and the fade strength are hand-picked for this viewport's slate background; a theme
  change that moved the palette would want them looked at again.
