/**
 * The per-voxel face border: one thin line around every face of every voxel.
 *
 * The reference product's default voxel appearance is its `Grid` texture, and this is what that draws — each face's
 * own colour darkened along the face's UV border — so a mass of cubes reads as countable cells instead of one
 * coloured blob. It is a screen-space quantity: a face's UV runs 0..1 whatever its cell's world size, so `fwidth`
 * gives the same one-pixel border at subdivision 1 and at subdivision 128, and no per-object or per-subdivision
 * work is needed. The line is attenuated by how tightly the faces pack on screen — the same anisotropy clamp the
 * reference's grid plane uses — so a face a few pixels across dims out instead of turning solid dark.
 *
 * It patches a material rather than replacing one: the voxel instances share a single `MeshLambertMaterial`, so the
 * border is a term on top of the existing shading rather than a second shading model. The mask pass swaps in a
 * `MeshBasicMaterial` of its own and must stay flat (README D11), and the raw imported meshes belong to the importer
 * (README D24), so neither is touched.
 *
 * Both transforms are pure, so the injection is checked in the node environment against three's own shader source.
 */

import type * as THREE from 'three';
import { insertBefore, insertChunks } from './shaderPatch.js';

/** How much of a face's own colour the line takes away, expressed as the reference's `line * 0.22`. */
const BORDER_STRENGTH = '0.22';

/** The vertex program gets the varying and the write that fills it; `uv` is three's own default attribute. */
const VERTEX_VARYING = 'varying vec2 vFaceUv;';
const VERTEX_WRITE = 'vFaceUv = uv;';

/**
 * The fragment program gets the border itself, ahead of the chunk that writes the colour, and the varying it reads
 * at the top of the program: the declaration has to be at global scope, because a `varying` inside `main` is a local
 * declaration and does not compile, while the border belongs inside `main` where `outgoingLight` lives.
 */
const FRAGMENT_VARYING = 'varying vec2 vFaceUv;';

/**
 * The border: distance to the face's edge in pixels (`fwidth` turns the UV distance into a screen distance), clamped
 * to a one-pixel line, then attenuated for faces whose borders are closer together than a few pixels.
 */
const FRAGMENT_BORDER = `
{
  vec2 border = abs(fract(vFaceUv - 0.5) - 0.5) / fwidth(vFaceUv);
  float edge = 1.0 - min(min(border.x, border.y), 1.0);
  edge *= clamp(1.0 / (length(vec2(dFdx(vFaceUv.x), dFdy(vFaceUv.y))) * 1.41421356 + 1.0) - 0.1, 0.0, 1.0);
  outgoingLight = mix(outgoingLight, vec3(0.0), edge * ${BORDER_STRENGTH});
}
`;

/** The chunk that writes the shaded colour, which is where the border has to have been applied. */
const FRAGMENT_ANCHOR = '#include <opaque_fragment>';

/** Adds the border to a shader pair. A program without the anchor is left exactly as it was found. */
export function withFaceBorder(
  vertexShader: string,
  fragmentShader: string,
): { vertexShader: string; fragmentShader: string } {
  return {
    vertexShader: insertChunks(vertexShader, VERTEX_VARYING, VERTEX_WRITE),
    // The varying rides with the border: a source that carries no anchor gets neither.
    fragmentShader: fragmentShader.includes(FRAGMENT_ANCHOR)
      ? `${FRAGMENT_VARYING}\n${insertBefore(fragmentShader, FRAGMENT_ANCHOR, FRAGMENT_BORDER)}`
      : fragmentShader,
  };
}

/** Patches one material, so every face it draws carries the border. */
export function applyFaceBorder(material: THREE.Material): void {
  material.onBeforeCompile = (shader): void => {
    const patched = withFaceBorder(shader.vertexShader, shader.fragmentShader);
    shader.vertexShader = patched.vertexShader;
    shader.fragmentShader = patched.fragmentShader;
  };
}
