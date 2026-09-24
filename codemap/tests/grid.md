# tests/grid.test.ts

Ring: 3 · Layer: tests (node, no GPU) · Depends on: `../src/three-runtime/grid.js`, `three`, `vitest`

## Responsibility
Pins the world grid as one plane of decoration with the reference's look — the world unit and a brighter line every
twenty cells, in white — on the world's ground rather than standing up, following the camera on whole cells, shown or
hidden by one flag, released twice over, and adapted by exactly three patches to the library's shader (README D35).
The app wiring that flips the flag, the panel's checkbox, and the grid as it renders are not tested here.

## Public interface
`describe` / `it` names are this file's observable surface:
- `world grid` — `is one plane of decoration, on the layer a pick and an export both exclude`,
  `draws the world unit with a brighter line every twenty cells, in white`,
  `lies in the world's ground plane rather than standing up as a wall`,
  `follows the camera on whole cells and keeps its height on the world's ground`,
  `draws the whole grid with one switch, and hides all of it`, `releases the plane and its material, twice over`
- `grid shader patches` — `injects the logarithmic-depth chunks a custom shader is missing`,
  `attenuates a line by how fast it varies across a pixel`, `drops the library's distance fade, and leaves any other
  source alone`, `adapts the library's own shader where the material compiles it`

## Internal logic
1. `plane(grid)` finds the one mesh by the name the grid gives it (`world-grid-plane`); a missing plane or a
   non-mesh throws rather than letting a case pass vacuously.
2. `material(grid)` narrows that mesh's material to `THREE.ShaderMaterial`, which is what carries the library's
   uniforms and the patch hook.
3. `uniform(grid, name)` reads one uniform's value, the way the library writes its spacing and colours.
4. `cameraAt(x, y, z)` builds a camera at a position, which is all `update` reads from one.

## Invariants
- The grid holds exactly one plane from construction, that plane is on layer 1 (`layers.mask === 1 << 1`), its material
  has `depthWrite === false`, and `visible` starts true: the app's checkbox is a view of that flag.
- `cellSize === 1` and `sectionSize === 20`, and the test asserts the literal twenty, because the reference material's
  `majorUnitFrequency` is the number the port has to keep (README D35). Both line colours are white (`getHex()`).
- The plane lies in the world's ground plane by two halves: the material's vertex program carries the library's swizzle
  (`position.xzy`), and the mesh's quaternion is the identity. A rotation added here — this port had one — stands the
  grid up as a wall and the app draws nothing.
- `update(cameraAt(3.4, 12.6, -8.1))` puts the plane at `[3, 0, -8]` and a later update at `[-0.6, 0.2, 0.49]` puts it
  at `[-1, 0, 0]`: `x`/`z` are rounded to whole cells on both sides of the origin and `y` never leaves the ground.
- `setVisible(false)` makes `visible` false and the plane's parent invisible, and `setVisible(true)` restores both.
- `dispose()` empties the root and a second `dispose()` does not throw.
- The three patch transforms each change the source they are aimed at and only that source: the log-depth chunk names
  are added, the attenuation adds the derivative clamp, and the distance fade becomes `float d = 1.0;` while an
  unrelated source is returned unchanged.
- The plane's own `onBeforeCompile` applies all three: handed a shader pair carrying the library's fade line and its
  grid function, the fragment source it leaves carries both the fade replacement and the attenuation.

## Errors
Nothing is asserted to throw: the class has no error path. A missing plane or a non-shader material in a fixture throws
from the helpers rather than letting a case pass.

## Dependencies
`../src/three-runtime/grid.js` for `WorldGrid`, the three constants it exports, and the three patch transforms;
`three` for `Mesh`, `ShaderMaterial`, `Color`, `Vector3`, `PerspectiveCamera`, and `WebGLProgramParametersWithUniforms`;
`vitest` for `describe`, `it`, `expect`. No DOM and no GPU.

## Tests
This file *is* the test, run by `npm test` in the node environment, and it is the only coverage of
`three-runtime/grid.ts`. Not covered here: the `World grid` checkbox and the app action behind it, the per-frame
`update` call in the render loop, and the grid as it renders — its lines on the cell boundaries, the coarser level
every twenty cells, and its absence from a pick and from an exported frame.
