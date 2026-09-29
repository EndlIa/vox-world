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
  withGroundPlaneInXY,
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
    // Shown from construction: the app's checkbox is a view of this flag.
    expect(grid.visible).toBe(true);
    grid.dispose();
  });

  it('draws the world unit with a brighter line every twenty cells, in white', () => {
    const grid = new WorldGrid();
    expect(uniform(grid, 'cellSize')).toBe(GRID_CELL_SIZE);
    expect(uniform(grid, 'sectionSize')).toBe(GRID_SECTION_SIZE);
    // A coarser level every twenty cells, not every ten.
    expect(GRID_SECTION_SIZE).toBe(20);
    expect((uniform(grid, 'cellColor') as THREE.Color).getHex()).toBe(0xffffff);
    expect((uniform(grid, 'sectionColor') as THREE.Color).getHex()).toBe(0xffffff);
    grid.dispose();
  });

  it('lies in the world\u2019s ground plane rather than standing up as a wall', () => {
    const grid = new WorldGrid();
    // The library is built for a Y-up world: its vertex program swizzles the quad into a local `xz` plane
    // (`localPosition = position.xzy`) and its line function measures `xz`. This world's ground is `xy`, so the patch
    // moves both ends, and the mesh carries no rotation of its own on top of that — a turn here would stand the grid
    // up as a wall, and the app would then draw it edge-on to the camera.
    expect(material(grid).vertexShader).toContain('position.xzy');
    expect(material(grid).fragmentShader).toContain('localPosition.xz');
    const patched = withGroundPlaneInXY(material(grid).vertexShader, material(grid).fragmentShader);
    expect(patched.vertexShader).not.toContain('position.xzy');
    expect(patched.vertexShader).toContain('localPosition = position;');
    expect(patched.fragmentShader).not.toContain('localPosition.xz');
    expect(patched.fragmentShader).toContain('localPosition.xy');
    expect(plane(grid).quaternion.toArray()).toEqual([0, 0, 0, 1]);
    grid.dispose();
  });

  it('follows the camera on whole cells and keeps its height on the world\u2019s ground', () => {
    const grid = new WorldGrid();
    grid.update(cameraAt(3.4, 12.6, -8.1));
    expect(plane(grid).position.toArray()).toEqual([3, 13, 0]);
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

  it('moves the library\u2019s ground plane out of its `xz` and into `xy`, and leaves any other source alone', () => {
    const vertex = '  localPosition = position.xzy;\n';
    const fragment = 'vec2 r = localPosition.xz / size;\n';
    const patched = withGroundPlaneInXY(vertex, fragment);
    expect(patched.vertexShader).toBe('  localPosition = position;\n');
    expect(patched.fragmentShader).toBe('vec2 r = localPosition.xy / size;\n');
    // A source carrying neither line comes back as it went in.
    const source = { vertexShader: 'void main() {\n}\n', fragmentShader: 'void main() {\n}\n' };
    expect(withGroundPlaneInXY(source.vertexShader, source.fragmentShader)).toEqual(source);
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
      vertexShader: 'localPosition = position.xzy;\nvoid main() {\n}\n',
      fragmentShader:
        'float getGrid(float size, float thickness) {\n  vec2 r = localPosition.xz / size;\n  return 1.0 - min(line, 1.0);\n}\nfloat d = 1.0 - min(dist / fadeDistance, 1.0);\nvoid main() {\n}\n',
    };
    material(grid).onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain('float d = 1.0;');
    expect(shader.fragmentShader).toContain('dFdx(r.x)');
    expect(shader.vertexShader).toContain('#include <logdepthbuf_vertex>');
    // The ground moves from the library's `xz` plane to this world's `xy` one, on both ends of the shader.
    expect(shader.vertexShader).toContain('localPosition = position;');
    expect(shader.vertexShader).not.toContain('position.xzy');
    expect(shader.fragmentShader).toContain('localPosition.xy');
    expect(shader.fragmentShader).not.toContain('localPosition.xz');
    grid.dispose();
  });
});
