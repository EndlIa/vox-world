# src/three-runtime/grid.ts

Ring: 2 · Layer: three-runtime · Depends on: `three`, `@pmndrs/vanilla/core/Grid`, `./shaderPatch.js`

## Responsibility
The viewport's world grid: **one** horizontal plane of shader-drawn lines on the world's ground, shown or hidden by the
app's one `World grid` flag. It is the only grid — the vertical work planes (`volume`'s walls, the movable `multi`
plane) and the second copy of the ground the volume display carried are gone, because vox-world places and aligns
content on the world lattice itself (README D41, D42) and a wall of grid is a reference nothing here is built against.
The active object's own lattice is gone as well (README D49). The look is the reference viewport's floor plane: one
white line per world cell, a brighter one every `GRID_SECTION_SIZE` cells (README D35).

The plane is `@pmndrs/vanilla`'s shader grid with three pure patches applied where the material compiles:
three's logarithmic-depth chunks, the reference material's derivative-based line attenuation, and no distance fade.
The whole thing is decoration: layer 1, so the picker's raycaster (layers 0 and 2) never hits it and no export frame
contains it (README D24), and `depthWrite = false`, so it cannot occlude a voxel below the plane.

## Public interface
```ts
const GRID_CELL_SIZE = 1;        // one cell is one world unit: the lines are the cell boundaries (README D41)
const GRID_SECTION_SIZE = 20;    // the brighter line, the reference material's majorUnitFrequency
const GRID_PLANE_EXTENT = 4096;  // side of the quad, in world units

function withLogDepth(vertexShader: string, fragmentShader: string): { vertexShader: string; fragmentShader: string };
function withAnisotropicAttenuation(fragmentShader: string): string;
function withoutDistanceFade(fragmentShader: string): string;

class WorldGrid {
  constructor();
  readonly root: THREE.Group;   // the owner adds this to its scene
  get visible(): boolean;
  setVisible(visible: boolean): void;
  update(camera: THREE.Camera): void;   // once a frame, after the camera itself has been settled
  dispose(): void;
}
```

## Internal logic
1. Constants: `OVERLAY_LAYER = 1` (README D24), `GRID_RENDER_ORDER = 0` (below the 1000 the box preview and the
   camera path draw at), `GRID_CELL_SIZE = 1`, `GRID_SECTION_SIZE = 20`, `GRID_PLANE_EXTENT = 4096`,
   `CELL_THICKNESS = 0.42`, `SECTION_THICKNESS = 0.55`, one white `GRID_LINE_COLOR = 0xffffff`.
2. Construction builds the library's `Grid` with `args: [EXTENT, EXTENT]`, `cellSize`, `sectionSize`, the two
   thicknesses, both colours white, `followCamera: false`, `infiniteGrid: false`, `side: THREE.DoubleSide`, names the
   mesh `world-grid-plane`, leaves its quaternion the identity, gives it layer 1 and `GRID_RENDER_ORDER`, takes the
   material's `depthWrite` off, and installs its `onBeforeCompile` patch. The mesh goes into a `Group` named
   `world-grid`, which is what `root` is.
3. **No rotation is applied, and that is the whole orientation story.** The library's vertex program swizzles the
   geometry — `localPosition = position.xzy` — before the model matrix, so an unturned `PlaneGeometry` already lies in
   the plane whose normal is the world's up. A mesh rotation here (which the first version of this port had) turns the
   floor into a wall, and the app then draws no grid at all: it renders edge-on to the camera. `tests/grid.test.ts`
   pins both halves of that — the swizzle in the program and the identity quaternion on the mesh.
4. `setVisible` writes `root.visible`, which is what the app's checkbox reads back through `visible`. Nothing else in
   the file touches visibility.
5. `update(camera)` moves the quad to the camera's own cell — `x` and `z` rounded to whole cells, `y` left on the
   world's ground — so the lines stay on the cell boundaries however far the viewport travels. Nothing else follows the
   camera, and the library's own `update` (which only fed the distance fade) is not used, because the fade is patched
   out.
6. `withLogDepth` adds three's `<common>` and `<logdepthbuf_pars_vertex>` above `main` and `<logdepthbuf_vertex>` at the
   end of it, and the two fragment chunks, because a custom shader without them writes a depth nothing else in the
   scene can be compared against (README D40).
7. `withAnisotropicAttenuation` rewrites the library's `return 1.0 - min(line, 1.0);` to multiply the line by
   `clamp(1.0 / (length(vec2(dFdx(r.x), dFdy(r.x))) * 1.41421356 + 1.0) - 0.1, 0.0, 1.0)` — the reference grid
   material's anisotropy clamp, in the cell-space derivative the library hands it. Without it a unit grid saturates at
   the horizon and beats against the pixel grid.
8. `withoutDistanceFade` rewrites `float d = 1.0 - min(dist / fadeDistance, 1.0);` to `float d = 1.0;`: the reference
   grid does not fade with distance at all, and what thins its lines there is the clamp above.
9. `dispose()` takes the plane out of the scene, disposes its geometry and material, and empties the root. It is
   idempotent.

## Invariants
- The grid is one plane: `root.children.length === 1` from construction, and no mode, axis, or offset exists to change
  what is drawn — the app's `World grid` flag is the only state (README D35).
- The plane lies in the world's ground plane: the library's program swizzles the quad into its local `xz` plane and
  the mesh carries no rotation of its own, and `update` never moves it off `y = 0`.
- The plane's `x`/`z` always sit on whole cells, so every line falls on a cell boundary.
- The plane is on layer 1 with `depthWrite = false` and `GRID_RENDER_ORDER`, so a pick cannot reach it and it cannot
  occlude what is below it (README D24).
- The three patches are the only difference from the library's own shader, and each is a pure string transform, so each
  is checked without a GPU (`tests/grid.test.ts`). The library's `followCamera` and `infiniteGrid` stay off: both move
  the grid inside the shader, and the quad is moved instead so the mesh stays where the lines it draws are.
- `dispose()` releases the plane's geometry and material and is safe twice.

## Errors
Nothing throws. `update` accepts any camera, `setVisible` any boolean, and `dispose` is safe twice. `GRID_PLANE_EXTENT`
and `GRID_SECTION_SIZE` are module constants, not validated inputs.

## Dependencies
- `three` — `Group`, `Mesh`, `Vector3`, `Color`, `DoubleSide`, `ShaderMaterial`, `Camera`, `Scene` (by the caller).
- `@pmndrs/vanilla/core/Grid` — the shader grid itself: its material, geometry, and uniform set.
- `./shaderPatch.js` — `insertChunks`, the one transform the log-depth patch needs.

## Tests
`tests/grid.test.ts` pins the one plane, its layer and depth behaviour, the cell and section spacing, the white lines,
the floor orientation (the program's swizzle with no mesh rotation), the whole-cell follow, the visibility switch, the
two dispose calls, and each of the three patches — including that the material's own `onBeforeCompile` hook applies
them. What needs a GPU stays app-verified (README §10): the grid on screen, its lines on the cell boundaries, the
coarser level every twenty cells, and its absence from a pick and from an exported frame.

## Open questions
- `GRID_PLANE_EXTENT = 4096` is the answer to "the grid must not end in view" without a fade: the reference uses a disc
  of radius 5100 for the same reason. If a view ever shows the quad's edge, the extent is the knob.
- The reference's floor is a dark translucent surface (`mainColor` at `mesh.visibility = 0.1`) whose lines are white at
  the same 10%. This grid has no fill and no overall alpha: over the viewport's slate background the fill would only
  darken what is already there, and the two levels are told apart by line coverage instead of by two greys.
