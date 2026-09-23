import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  GRID_CELL_SIZE,
  GRID_FADE_DISTANCE,
  GRID_PLANE_EXTENT,
  GRID_SECTION_SIZE,
  GridPlane,
  withAnisotropicAttenuation,
  withLogDepth,
} from '../src/three-runtime/gridPlane.js';
import type { GridAxis } from '../src/three-runtime/gridPlane.js';

/** A camera at this position, which is all a plane reads from one. */
function cameraAt(x: number, y: number, z: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(x, y, z);
  return camera;
}

/** A plane in a scene, because it only follows once it has a parent to read a world matrix through. */
function attached(axis: GridAxis, offset: number): GridPlane {
  const plane = new GridPlane(axis, offset);
  new THREE.Scene().add(plane.mesh);
  return plane;
}

/** The material's uniform value, which is where the library keeps the spacing and the fade. */
function uniform(plane: GridPlane, name: string): unknown {
  return (plane.mesh.material as THREE.ShaderMaterial).uniforms[name]?.value;
}

describe('grid plane', () => {
  it('draws as decoration, at the world unit and a brighter tenth', () => {
    const plane = attached('y', 0);
    // Layer 1 keeps it out of the raycaster's reach (which tests layers 0 and 2) and out of an export frame.
    expect(plane.mesh.layers.mask).toBe(1 << 1);
    expect((plane.mesh.material as THREE.ShaderMaterial).depthWrite).toBe(false);
    expect(uniform(plane, 'cellSize')).toBe(GRID_CELL_SIZE);
    expect(uniform(plane, 'sectionSize')).toBe(GRID_SECTION_SIZE);
    // The quad reaches well past where its lines have faded, so its own edge is never what ends the grid.
    expect(GRID_PLANE_EXTENT).toBeGreaterThan(2 * GRID_FADE_DISTANCE);
    expect(uniform(plane, 'fadeDistance')).toBe(GRID_FADE_DISTANCE);
    plane.dispose();
  });

  it('puts the lines on the world\u2019s cells, and its own axis where it was put', () => {
    const ground = attached('y', 0);
    ground.follow(cameraAt(12.4, 5.6, -3.2));
    // Snapped to whole cells, so the lines stay on the world's own boundaries as the camera moves; the plane keeps
    // its own height rather than following the camera's.
    expect(ground.mesh.position.toArray()).toEqual([12, 0, -3]);
    ground.follow(cameraAt(-0.6, 1, 7.5));
    expect(ground.mesh.position.toArray()).toEqual([-1, 0, 8]);

    const wall = attached('x', -60);
    wall.follow(cameraAt(4.2, 3.7, 9.1));
    // The axis the wall faces is the one coordinate the camera may not move it along, which is what keeps a wall a
    // wall; its two in-plane coordinates follow.
    expect(wall.mesh.position.toArray()).toEqual([-60, 4, 9]);
    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(wall.mesh.quaternion);
    expect(normal.x).toBeCloseTo(1, 6);

    ground.dispose();
    wall.dispose();
  });

  it('injects the logarithmic-depth chunks a custom shader is missing', () => {
    const plane = attached('y', 0);
    const material = plane.mesh.material as THREE.ShaderMaterial;
    const shader = {
      vertexShader: 'precision highp float;\nvoid main() {\n\tgl_Position = vec4(0.0);\n}',
      fragmentShader:
        'precision highp float;\nfloat getGrid(float size, float thickness) {\n\tvec2 r = localPosition.xz / size;\n\treturn 1.0 - min(line, 1.0);\n}\nvoid main() {\n\tgl_FragColor = vec4(1.0);\n}',
    } as unknown as Parameters<THREE.Material['onBeforeCompile']>[0];
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    // The renderer defines the macro and sets the uniform for every material, but only these chunks read them, so a
    // plane without them writes a depth nothing else in the scene can be compared against (README D40).
    for (const name of [
      'logdepthbuf_pars_vertex',
      'logdepthbuf_vertex',
      'logdepthbuf_pars_fragment',
      'logdepthbuf_fragment',
    ]) {
      expect(`${shader.vertexShader}\n${shader.fragmentShader}`).toContain(`#include <${name}>`);
    }
    // `isPerspectiveMatrix` is three's, and only `<common>` defines it, so the vertex program needs that chunk too:
    // without it the plane's shader does not compile and nothing is drawn at all.
    expect(shader.vertexShader).toContain('#include <common>');
    // Declarations belong above `main` and the statements inside it: a varying declared in a function body would not
    // compile, and a chunk left outside the body would never run.
    expect(shader.vertexShader.indexOf('#include <common>')).toBeLessThan(shader.vertexShader.indexOf('void main()'));
    expect(shader.vertexShader.indexOf('#include <logdepthbuf_pars_vertex>')).toBeLessThan(
      shader.vertexShader.indexOf('void main()'),
    );
    expect(shader.vertexShader.indexOf('#include <logdepthbuf_vertex>')).toBeGreaterThan(
      shader.vertexShader.indexOf('gl_Position = vec4(0.0)'),
    );
    expect(shader.fragmentShader.indexOf('#include <logdepthbuf_fragment>')).toBeLessThan(
      shader.fragmentShader.lastIndexOf('}'),
    );
    // The far field needs the attenuation too, and it is a no-op on anything that is not the library's function.
    expect(shader.fragmentShader).toContain('dFdx(r.x)');
    expect(withAnisotropicAttenuation('void main() {}')).toBe('void main() {}');
    expect(withLogDepth('no body', 'no body').vertexShader).toBe('no body');
    plane.dispose();
  });

  it('refuses a plane between two cells and releases what it owns twice over', () => {
    expect(() => new GridPlane('y', 0.5)).toThrow(RangeError);
    const plane = attached('y', 0);
    let geometryReleases = 0;
    let materialReleases = 0;
    plane.mesh.geometry.addEventListener('dispose', () => {
      geometryReleases += 1;
    });
    (plane.mesh.material as THREE.Material).addEventListener('dispose', () => {
      materialReleases += 1;
    });
    plane.dispose();
    expect(geometryReleases).toBe(1);
    expect(materialReleases).toBe(1);
    // Withdrawing it a second time is what a page teardown does after the app already released it.
    expect(() => plane.dispose()).not.toThrow();
    expect(plane.mesh.parent).toBeNull();
  });
});
