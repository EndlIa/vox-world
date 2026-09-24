# tests/faceGrid.test.ts

Ring: 3 · Layer: tests (node, no GPU) · Depends on: `../src/three-runtime/faceGrid.js`, `three`, `vitest`

## Responsibility
Pins the per-voxel face border's two shader transforms and, more importantly, that they land in three's **own** lambert
program: the varying and the `uv` read with no duplicate attribute declaration, the border applied to the shaded colour
ahead of the chunk that writes it, the 22% of the face's own colour, the derivative clamp that dims a distant mass, the
hook being installed and applied when three calls it, and the no-op on a source without the anchors. The voxel
material's wiring in `scene.ts` and the border as it renders are not tested here.

## Public interface
`describe` / `it` names are this file's observable surface:
- `face border` — `declares its varying and reads the face's own uv, which three already declares`,
  `darkens the shaded colour along the face's edge, before the colour is written out`,
  `patches a material where three compiles it, so every face it draws carries the border`,
  `is a no-op on a source that carries neither anchor`

## Internal logic
1. The first three cases run `withFaceBorder` over `THREE.ShaderLib.lambert.vertexShader` and
   `THREE.ShaderLib.lambert.fragmentShader` rather than over a fixture. That is the point of the file: the patch's
   anchor is a chunk name and a variable name inside a library shader, so an upgrade that moves either has to fail
   here instead of rendering voxels without borders.
2. The hook case builds a plain `MeshLambertMaterial`, installs the patch with `applyFaceBorder`, and calls the hook
   with a stub carrying only the two shader strings — which is all the hook reads — so the wiring from material to
   patch is exercised without a renderer.
3. The last case feeds both transforms a source with neither anchor and asserts the input comes back unchanged.

## Invariants
- The vertex program carries `varying vec2 vFaceUv;` and `vFaceUv = uv;`, and does **not** carry
  `attribute vec2 uv;`: three declares that attribute unconditionally in its vertex prefix, so a second declaration
  would not compile.
- The fragment program carries the varying, and the border statement appears before `#include <opaque_fragment>` —
  asserted by comparing the two indices, because a border applied after that chunk would change nothing.
- The border computes its distance in face UV space (`fract(vFaceUv - 0.5)`, `fwidth(vFaceUv)`), takes `0.22` of the
  face's own colour, and multiplies by a clamp carrying `1.41421356` — the anisotropy clamp that keeps a face a few
  pixels across from turning solid dark.
- `applyFaceBorder` leaves `onBeforeCompile` a function, and calling it patches both strings it is handed.
- A source with neither anchor is returned unchanged by both transforms, so the patches cannot corrupt an unrelated
  program.

## Errors
Nothing is asserted to throw: both transforms are total and the hook writes one property.

## Dependencies
`../src/three-runtime/faceGrid.js` for `withFaceBorder` and `applyFaceBorder`; `three` for `ShaderLib`,
`MeshLambertMaterial`, and the two compile-time types the hook is handed; `vitest` for `describe`, `it`, `expect`.
No DOM and no GPU.

## Tests
This file *is* the test, run by `npm test` in the node environment. Not covered here: `scene.ts` installing the patch on
the shared voxel material, the mask material staying flat, and the border as it renders — one pixel wide up close,
dimmed rather than solid on a distant mass, and absent from a mask frame.
