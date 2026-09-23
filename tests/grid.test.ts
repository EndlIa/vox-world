import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_GRID_MODE, WorldGrid } from '../src/three-runtime/grid.js';

/** A camera at this position, which is all a plane reads from one. */
function cameraAt(x: number, y: number, z: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(x, y, z);
  return camera;
}

/** The planes on screen, by the names the grid gives them: what is visible is what a frame draws. */
function visiblePlanes(grid: WorldGrid): string[] {
  return grid.root.children
    .filter((child) => child.visible)
    .map((child) => child.name)
    .sort();
}

/** The plane of that name, wherever the last `update` put it. */
function planeAt(grid: WorldGrid, name: string): THREE.Mesh {
  const found = grid.root.getObjectByName(name);
  if (!(found instanceof THREE.Mesh)) throw new TypeError(`no plane named ${name}`);
  return found;
}

describe('world grid', () => {
  it('shows one display at a time, and opens on the ground', () => {
    const grid = new WorldGrid();
    expect(DEFAULT_GRID_MODE).toBe('floor');
    expect(visiblePlanes(grid)).toEqual(['world-grid-floor']);
    grid.setMode('volume');
    expect(visiblePlanes(grid)).toEqual([
      'world-grid-volume-ground',
      'world-grid-volume-wall-x',
      'world-grid-volume-wall-z',
    ]);
    grid.setMode('multi');
    expect(visiblePlanes(grid)).toEqual(['world-grid-multi']);
    grid.setMode('off');
    expect(visiblePlanes(grid)).toEqual([]);
    grid.dispose();
  });

  it('shows the work cube as its ground and the two walls that close it', () => {
    const grid = new WorldGrid();
    grid.setMode('volume');
    grid.update(cameraAt(3.4, 2.6, -8.1));
    // The ground stays on the world's own ground and the walls on their own planes, whatever the camera does; only
    // the two coordinates inside a plane follow it.
    expect(planeAt(grid, 'world-grid-volume-ground').position.toArray()).toEqual([3, 0, -8]);
    expect(planeAt(grid, 'world-grid-volume-wall-x').position.toArray()).toEqual([-60, 3, -8]);
    expect(planeAt(grid, 'world-grid-volume-wall-z').position.toArray()).toEqual([3, 3, -60]);
    grid.dispose();
  });

  it('aims the moved plane at an axis and keeps it where it was put', () => {
    const grid = new WorldGrid();
    grid.setMode('multi');
    expect(grid.multiAxis).toBe('x');
    expect(grid.multiOffset).toBe(0);
    grid.setMultiPlane('z', -5);
    expect(grid.multiAxis).toBe('z');
    expect(grid.multiOffset).toBe(-5);
    grid.update(cameraAt(0.4, 9.6, 2.2));
    expect(planeAt(grid, 'world-grid-multi').position.toArray()).toEqual([0, 10, -5]);
    // The facing follows the axis, so the quad's own normal ends up on the axis it was aimed at.
    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(planeAt(grid, 'world-grid-multi').quaternion);
    expect(normal.z).toBeCloseTo(1, 6);
    // A plane between two cells would put its lines between the world's own, so it is refused.
    expect(() => grid.setMultiPlane('x', 0.5)).toThrow(RangeError);
    grid.dispose();
  });
});
