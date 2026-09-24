# src/three-runtime/faceGrid.ts

Ring: 2 · Layer: three-runtime · Depends on: `three`, `./shaderPatch.js`

## Responsibility
The per-voxel face border: one thin line around every face of every voxel, which is what makes a mass of cubes read as
countable cells instead of one coloured blob. It is the reference product's default voxel appearance — its `Grid`
texture — reproduced as a shader term rather than a texture: each face's own colour darkened along the face's UV
border. The line is a screen-space quantity, because a face's UV runs 0..1 whatever its cell's world size, so the same
one-pixel border appears at subdivision 1 and at subdivision 128 with no per-object or per-subdivision work.

It patches a material instead of replacing one. The voxel instances share one `MeshLambertMaterial` (README D24's
derived-mesh rule), so the border is a term on top of the existing shading rather than a second shading model; the mask
pass swaps in a `MeshBasicMaterial` of its own and stays flat (README D11), and the raw imported meshes belong to the
importer (README D24), so neither carries the border.

## Public interface
```ts
function withFaceBorder(vertexShader: string, fragmentShader: string): { vertexShader: string; fragmentShader: string };
function applyFaceBorder(material: THREE.Material): void;   // installs the hook where three compiles the material
```

## Internal logic
1. `BORDER_STRENGTH = '0.22'` is the reference's `line * 0.22`: the share of a face's own colour the border takes away.
   `VERTEX_VARYING`/`VERTEX_WRITE` are the varying and the write that fills it; `FRAGMENT_VARYING` is the same varying
   on the fragment side; `FRAGMENT_BORDER` is the border block; `FRAGMENT_ANCHOR` is `#include <opaque_fragment>`, the
   chunk that writes the shaded colour, which is where the border has to have been applied.
2. `withFaceBorder` returns both programs patched: the vertex program gets the varying declared above `main` and
   `vFaceUv = uv;` at the end of its body (`insertChunks`), and the fragment program gets the varying and the border
   block immediately ahead of the anchor (`insertBefore`).
3. The border block: `border = abs(fract(vFaceUv - 0.5) - 0.5) / fwidth(vFaceUv)` is the distance to the face's edge in
   pixels on each axis; `edge = 1.0 - min(min(border.x, border.y), 1.0)` is a one-pixel ramp at that edge; the ramp is
   then multiplied by `clamp(1.0 / (length(vec2(dFdx(vFaceUv.x), dFdy(vFaceUv.y))) * 1.41421356 + 1.0) - 0.1, 0.0, 1.0)`
   — the same anisotropy clamp the reference's grid plane uses — so faces whose borders pack closer than a few pixels
   dim out instead of turning solid dark; and the result darkens the shaded colour with
   `outgoingLight = mix(outgoingLight, vec3(0.0), edge * 0.22)`.
4. `applyFaceBorder(material)` assigns `material.onBeforeCompile`, which runs `withFaceBorder` over the two strings
   three hands it. The material is the caller's own, so the hook is assigned rather than chained.
5. `uv` is three's own default vertex attribute: it is declared unconditionally in the program's vertex prefix, so the
   patch must not declare it again. The varying is named `vFaceUv` rather than `vUv` so it cannot collide with the
   `USE_UV` varying of a material that also carries a map.
6. The fragment anchor is the last chunk before the output, which is where three's lambert program has `outgoingLight`
   in scope — `#include <envmap_fragment>` sits just above it and does not reassign it.

## Invariants
- Both transforms are pure and total: a source that carries neither anchor comes back unchanged, so the patches cannot
  corrupt an unrelated program. `tests/faceGrid.test.ts` runs them over three's own `ShaderLib.lambert` source, so a
  three upgrade that renames the anchor fails the suite instead of rendering voxels without their borders.
- The border is expressed entirely in the face's UV space plus screen-space derivatives: it needs no world position, no
  per-instance data, and no second buffer, so it works for every object at every subdivision through one material.
- The border takes a share of the face's own colour rather than writing a fixed colour, so a dark voxel gets a darker
  edge and a light one a lighter edge, which is what the reference does.
- The mask pass and the raw imported meshes are untouched: the material this patches is the one the beauty pass draws
  voxels through, and no other material in the runtime gets the hook.
- `outgoingLight` is the name the patch reads: it exists in three's lambert fragment program and in no other program
  this hook is installed on.

## Errors
Nothing throws. `withFaceBorder` is total, and `applyFaceBorder` writes one property.

## Dependencies
- `three` — `Material` for the hook and the `WebGLProgramParametersWithUniforms` it is handed.
- `./shaderPatch.js` — `insertChunks` and `insertBefore`.

## Tests
`tests/faceGrid.test.ts` pins: the varying and the `uv` read with no duplicate attribute declaration; the border landing
ahead of `#include <opaque_fragment>` with the 22% of the face's own colour and the derivative clamp; the hook being
installed and applying both patches when three calls it; and the no-op on a source without the anchors. What needs a
GPU stays app-verified (README §10): the borders on screen, one pixel wide up close, dimmed rather than solid on a mass
seen from far away, and absent from a mask frame.

## Open questions
- `0.22` is the reference's strength. If borders read too strong over the editor's slate background, this constant is
  the single knob; nothing else depends on it.
- The line is one pixel at every distance by construction. A user who wants the border to thicken with the cell (a
  "drawn" look rather than a screen-space grid) would need the cell's world size, which the material does not carry
  per instance.
