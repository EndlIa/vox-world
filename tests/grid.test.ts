/**
 * The world grid: one plane of shader-drawn lines on the world's ground, the look the Grid group's one switch shows
 * or hides, and the three patches that adapt the library's shader. Node-side and GPU-free: `three` builds the plane,
 * its uniforms, and its material without a renderer.
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  GRID_CELL_SIZE,
  GRID_SECTION_SIZE,
  WorldGrid,
  withAnisotropicAttenuation,
  withoutDistanceFade,
  withLogDepth,
} from '../src/three-runtime/grid.js';

/** A camera at this position, which is all the grid reads from one. */
function cameraAt(x: number, y: number, z: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(x, y, z);
  return camera;
}

/** The grid's one plane, wherever the last `update` put it. */
function plane(grid: WorldGrid): THREE.Mesh {
  const found = grid.root.getObjectByName('world-grid-plane');
  if (!(found instanceof THREE.Mesh)) throw new TypeError('WorldGrid: no plane');
  return found;
}

/** The plane's material, which is where the library keeps the spacing, the colours, and the patch hook. */
function material(grid: WorldGrid): THREE.ShaderMaterial {
  const found = plane(grid).material;
  if (!(found instanceof THREE.ShaderMaterial)) throw new TypeError('WorldGrid: the plane is not a shader grid');
  return found;
}

/** A uniform's value, read the way the library writes it. */
function uniform(grid: WorldGrid, name: string): unknown {
  return material(grid).uniforms[name]?.value;
}

describe('world grid', () => {
  it('is one plane of decoration, on the layer a pick and an export both exclude', () => {
    const grid = new WorldGrid();
    expect(grid.root.children).toHaveLength(1);
    expect(plane(grid).layers.mask).toBe(1 << 1);
    expect(material(grid).depthWrite).toBe(false);
    // Shown from construction: the app's checkbox is a view of this flag (README D35).
    expect(grid.visible).toBe(true);
    grid.dispose();
  });

  it('draws the world unit with a brighter line every twenty cells, in white', () => {
    const grid = new WorldGrid();
    expect(uniform(grid, 'cellSize')).toBe(GRID_CELL_SIZE);
    expect(uniform(grid, 'sectionSize')).toBe(GRID_SECTION_SIZE);
    // The reference material's `majorUnitFrequency` (README D35): a coarser level every twenty cells, not every ten.
    expect(GRID_SECTION_SIZE).toBe(20);
    expect((uniform(grid, 'cellColor') as THREE.Color).getHex()).toBe(0xffffff);
    expect((uniform(grid, 'sectionColor') as THREE.Color).getHex()).toBe(0xffffff);
    grid.dispose();
  });

  it('lies in the world\u2019s ground plane rather than standing up as a wall', () => {
    const grid = new WorldGrid();
    // Two halves make the floor: the library's vertex program swizzles the quad into its local `xz` plane
    // (`localPosition = position.xzy`), and the mesh carries no rotation of its own on top of that. A turn here —
    // which this port had — stands the grid up instead, and the app then renders no grid at all.
    expect(material(grid).vertexShader).toContain('position.xzy');
    expect(plane(grid).quaternion.toArray()).toEqual([0, 0, 0, 1]);
    grid.dispose();
  });

  it('follows the camera on whole cells and keeps its height on the world\u2019s ground', () => {
    const grid = new WorldGrid();
    grid.update(cameraAt(3.4, 12.6, -8.1));
    expect(plane(grid).position.toArray()).toEqual([3, 0, -8]);
    // Snapping is what keeps the lines on the cell boundaries instead of sliding with the view.
    grid.update(cameraAt(-0.6, 0.2, 0.49));
    expect(plane(grid).position.toArray()).toEqual([-1, 0, 0]);
    grid.dispose();
  });

  it('draws the whole grid with one switch, and hides all of it', () => {
    const grid = new WorldGrid();
    grid.setVisible(false);
    expect(grid.visible).toBe(false);
    expect(plane(grid).parent?.visible).toBe(false);
    grid.setVisible(true);
    expect(grid.visible).toBe(true);
    grid.dispose();
  });

  it('releases the plane and its material, twice over', () => {
    const grid = new WorldGrid();
    grid.dispose();
    expect(grid.root.children).toHaveLength(0);
    expect(() => grid.dispose()).not.toThrow();
  });
});

describe('grid shader patches', () => {
  it('injects the logarithmic-depth chunks a custom shader is missing', () => {
    const patched = withLogDepth('void main() {\n}\n', 'void main() {\n}\n');
    expect(patched.vertexShader).toContain('#include <common>');
    expect(patched.vertexShader).toContain('#include <logdepthbuf_pars_vertex>');
    expect(patched.vertexShader).toContain('#include <logdepthbuf_vertex>');
    expect(patched.fragmentShader).toContain('#include <logdepthbuf_pars_fragment>');
    expect(patched.fragmentShader).toContain('#include <logdepthbuf_fragment>');
  });

  it('attenuates a line by how fast it varies across a pixel', () => {
    const source = 'float getGrid(float size, float thickness) { return 1.0 - min(line, 1.0); }';
    const patched = withAnisotropicAttenuation(source);
    expect(patched).not.toBe(source);
    expect(patched).toContain('dFdx(r.x)');
    expect(patched).toContain('1.41421356');
  });

  it('drops the library\u2019s distance fade, and leaves any other source alone', () => {
    expect(withoutDistanceFade('float d = 1.0 - min(dist / fadeDistance, 1.0);')).toBe('float d = 1.0;');
    expect(withoutDistanceFade('nothing to patch')).toBe('nothing to patch');
  });

  it('adapts the library\u2019s own shader where the material compiles it', () => {
    const grid = new WorldGrid();
    const shader = {
      vertexShader: 'void main() {\n}\n',
      fragmentShader:
        'float getGrid(float size, float thickness) { return 1.0 - min(line, 1.0); }\nfloat d = 1.0 - min(dist / fadeDistance, 1.0);\nvoid main() {\n}\n',
    };
    material(grid).onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain('float d = 1.0;');
    expect(shader.fragmentShader).toContain('dFdx(r.x)');
    expect(shader.vertexShader).toContain('#include <logdepthbuf_vertex>');
    grid.dispose();
  });
});
