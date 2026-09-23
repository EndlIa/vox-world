# tests/gridPlane.test.ts

Ring: 3 · Layer: tests (node, no GPU) · Depends on: `../src/three-runtime/gridPlane.js`, `three`, `vitest`

## Responsibility
Pins one grid plane as the library boundary: that it is decoration on the layer the raycaster never tests with no
depth write; that the fine spacing is the world unit and the coarse one its tenth, with the quad reaching past the
fade; that its in-plane coordinates snap to whole cells while the axis it faces keeps the plane's own offset; that the
two shader patches land the chunks the renderer's log depth needs and the attenuation the far field needs, and that
both are no-ops on a source they do not recognize; and that a plane between two cells is refused and that disposal is
safe twice (README D40, D49). It reads the mesh's layer, its material's `depthWrite` and uniforms, the mesh's position
and quaternion, and the patch functions' strings; the panel and app wiring, the palette as it renders, and every GPU
claim are not tested here.

## Public interface
`describe` / `it` names are this file's observable surface:
- `grid plane` — `draws as decoration, at the world unit and a brighter tenth`,
  `puts the lines on the world's cells, and its own axis where it was put`,
  `injects the logarithmic-depth chunks a custom shader is missing`,
  `refuses a plane between two cells and releases what it owns twice over`

## Internal logic
1. `cameraAt(x, y, z)` builds a fresh `PerspectiveCamera` at that position, which is the whole of what a plane reads
   from a camera — `follow` touches nothing else on it.
2. `attached(axis, offset)` puts a `GridPlane`'s mesh in a fresh `Scene` before returning it, because the plane is
   only meaningful once it has a parent: the library's own uniform update reads the mesh's world matrix and returns
   without one, so an unattached plane would make the follow half of that case meaningless.
3. `uniform(plane, name)` reads one uniform's value off the material, which is where the library keeps the spacing,
   the section size, and the fade: the assertions about the drawing are made against the library's own numbers rather
   than against a copy of them.
4. Each case builds its own planes and disposes them at the end, so no case runs against another's state — the refusal
   case is the one that creates a plane the constructor throws on, which therefore never has a mesh to dispose.
5. The patch case is the reason both functions are pure: it hands `material.onBeforeCompile` a stand-in shader pair
   whose fragment carries the library's own `return 1.0 - min(line, 1.0);`, runs it, and asserts the result. Nothing
   is rendered, and no shader is compiled.

## Invariants
- A plane is decoration: its `layers.mask` is `1 << 1` (2), so the raycaster (layers 0 and 2) and the export camera
  (layer 0) cannot reach it, and its material has `depthWrite === false`, so it can never occlude a voxel. The mask is
  asserted as the shifted literal, so a layer change fails here rather than in a frame.
- The material's own `cellSize` is `GRID_CELL_SIZE` (1, the world unit) and its `sectionSize` is `GRID_SECTION_SIZE`
  (10), which is the two-level arrangement D35 asked for and D49 redrew as a shader; its `fadeDistance` is
  `GRID_FADE_DISTANCE` (160), and `GRID_PLANE_EXTENT > 2 * GRID_FADE_DISTANCE` — the quad is wider than the fade, so
  the plane's own edge is never what ends the grid. The extent is asserted as that inequality rather than as `512`, so
  the property survives a retune.
- A ground plane at `y = 0` followed from `(12.4, 5.6, -3.2)` sits at `(12, 0, -3)` and, followed again from
  `(-0.6, 1, 7.5)`, at `(-1, 0, 8)`: the two in-plane coordinates round to whole cells — so the lines stay on the
  world's own boundaries instead of sliding under the camera — while the facing coordinate keeps the plane's own
  offset and never takes the camera's height. The second call is what pins the rounding of a negative coordinate.
- A wall on `x` at `-60` followed from `(4.2, 3.7, 9.1)` sits at `(-60, 4, 9)`, and the quad's own normal turned by
  its quaternion points along `+x`: the axis a plane faces is the one coordinate the camera may not move it along,
  which is what keeps a wall a wall, and the facing is the quaternion's, not a flag.
- `onBeforeCompile` puts all four `logdepthbuf` chunks — `logdepthbuf_pars_vertex`, `logdepthbuf_vertex`,
  `logdepthbuf_pars_fragment`, `logdepthbuf_fragment` — and three's `<common>` into the stand-in pair, and the
  ordering is asserted as well: `<common>` and the vertex declaration above `void main()`, the vertex statement after
  the body's `gl_Position`, and the fragment statement inside the body. `<common>` is there because the vertex chunk
  calls `isPerspectiveMatrix`, which only that chunk defines: without it the plane's shader does not compile and
  nothing is drawn at all (README D40).
- The fragment patch replaces the library's saturation with one that also reads `dFdx(r.x)`, which is what removes the
  far-field lines instead of washing them across the pixel grid. Both no-op guards are pinned with them:
  `withAnisotropicAttenuation('void main() {}')` returns its input unchanged, and `withLogDepth('no body', 'no body')`
  leaves a source without a body alone. A patch that appended instead of replacing, or one that threw on an
  unrecognized source, cannot pass.
- `new GridPlane('y', 0.5)` throws `RangeError` — a plane between two cells would draw its lines between the world's
  own — and the message comes from `setFacing`, which the constructor routes through, so the refusal happens before
  anything is built.
- `dispose()` signals the geometry's and the material's disposal exactly once each and leaves the mesh parentless; a
  second `dispose()` does not throw and `mesh.parent` is still `null`, which is what a page teardown that already
  released the app's scene does.

## Errors
The half-cell offset is the only error asserted, and the only one the class produces. Not pinned here: that the
`RangeError` for a fractional offset is also reachable by calling `setFacing` after construction, and the message's
wording.

## Dependencies
`../src/three-runtime/gridPlane.js` for `GridPlane`, the four exported constants, and the two patch functions;
`three` for `Scene`, `PerspectiveCamera`, `ShaderMaterial`, `Material`, `Vector3`, and the `WebGLRenderer` type the
`onBeforeCompile` callback is cast against; `vitest` for `describe`, `it`, `expect`. No DOM and no GPU: the suite runs
in the node environment, and the shader patch's callback is called by the test rather than by a renderer.

## Tests
This file *is* the test, run by `npm test` in the node environment. It is the only coverage of
`three-runtime/gridPlane.ts`. Not covered here: the thicknesses, the two colours, the fade strength, and the
render order this file sets; the `followCamera` / `infiniteGrid` options as such, because their effect — the drawn
lines sliding, or rescaling, under a stationary mesh — needs a renderer to see, while the mesh's own snap is what is
pinned; the `setVisible` write, which the display tests read back through the grid's planes; and the library's
`update` being stored at construction. What needs a GPU — the anti-aliased lines with
the fine spacing fading before the coarse one, the log-depth patches sorting the plane against the voxels, the horizon
reading as a faint rather than an obvious moiré, no hard edge where the quad ends, and no shader error — is verified
by running the application (README §10), never by rendering here.
