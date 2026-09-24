/**
 * The per-voxel face border: the two shader transforms that add it, and the fact that they land in three's own
 * lambert program — the anchor is a chunk name, so a three upgrade that moves it has to fail here rather than
 * quietly rendering voxels without their borders. Node-side and GPU-free.
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyFaceBorder, withFaceBorder } from '../src/three-runtime/faceGrid.js';

describe('face border', () => {
  it('declares its varying and reads the face\u2019s own uv, which three already declares', () => {
    const patched = withFaceBorder(THREE.ShaderLib.lambert.vertexShader, THREE.ShaderLib.lambert.fragmentShader);
    expect(patched.vertexShader).toContain('varying vec2 vFaceUv;');
    expect(patched.vertexShader).toContain('vFaceUv = uv;');
    // `uv` is three's own default attribute: declaring it again would not compile.
    expect(patched.vertexShader).not.toContain('attribute vec2 uv;');
    expect(patched.fragmentShader).toContain('varying vec2 vFaceUv;');
    // The declaration is at global scope: a `varying` inside `main` is a local and does not compile, which is exactly
    // how this patch failed the first time the app rendered it.
    expect(patched.fragmentShader.indexOf('varying vec2 vFaceUv;')).toBeLessThan(
      patched.fragmentShader.indexOf('void main()'),
    );
  });

  it('darkens the shaded colour along the face\u2019s edge, before the colour is written out', () => {
    const patched = withFaceBorder(THREE.ShaderLib.lambert.vertexShader, THREE.ShaderLib.lambert.fragmentShader);
    const border = patched.fragmentShader.indexOf('outgoingLight = mix(outgoingLight, vec3(0.0)');
    expect(border).toBeGreaterThan(0);
    expect(border).toBeLessThan(patched.fragmentShader.indexOf('#include <opaque_fragment>'));
    // The line is a screen-space quantity, so it is the same width at any subdivision, and it takes 22% of the face's
    // own colour — the reference's `Grid` texture.
    expect(patched.fragmentShader).toContain('fract(vFaceUv - 0.5)');
    expect(patched.fragmentShader).toContain('fwidth(vFaceUv)');
    expect(patched.fragmentShader).toContain('* 0.22');
    // Dimmed for faces whose borders pack closer than a few pixels, so a distant mass does not turn solid dark.
    expect(patched.fragmentShader).toContain('1.41421356');
  });

  it('patches a material where three compiles it, so every face it draws carries the border', () => {
    const material = new THREE.MeshLambertMaterial();
    applyFaceBorder(material);
    expect(material.onBeforeCompile).toBeTypeOf('function');
    // The hook reads only the two shader strings, so a stub carrying them is what it is handed here.
    const shader = {
      vertexShader: THREE.ShaderLib.lambert.vertexShader,
      fragmentShader: THREE.ShaderLib.lambert.fragmentShader,
    };
    material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
    expect(shader.vertexShader).toContain('vFaceUv = uv;');
    expect(shader.fragmentShader).toContain('outgoingLight = mix(outgoingLight, vec3(0.0)');
  });

  it('is a no-op on a source that carries neither anchor', () => {
    const patched = withFaceBorder('no main here', 'no chunk here');
    expect(patched.vertexShader).toBe('no main here');
    expect(patched.fragmentShader).toBe('no chunk here');
  });
});
