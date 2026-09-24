/**
 * The box-drag preview frame: the one object it puts in the scene, and the exact placement of its box in the owning
 * object's space — including the rotation-inside-scale case, which is why the frame is a library box composed with a
 * group rather than a single decomposed transform. Node-side and GPU-free: `three` builds and composes geometry without
 * a renderer.
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Overlay } from '../src/three-runtime/overlay.js';
import type { IntBox3 } from '../src/voxels/uniform/grid.js';

/** The viewport decoration layer (README D24). */
const OVERLAY_LAYER = 1;

function helperOf(scene: THREE.Scene): THREE.Box3Helper {
  let found: THREE.Box3Helper | undefined;
  scene.traverse((child) => {
    if (child instanceof THREE.Box3Helper) found = child;
  });
  if (found === undefined) throw new Error('Overlay: no box helper in the scene');
  return found;
}

/** The world-space extent of the drawn frame, which is what a viewport would show. */
function drawnBounds(scene: THREE.Scene): THREE.Box3 {
  scene.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(helperOf(scene));
}

/** The same extent computed from the box the caller asked for, by transforming its eight corners. */
function expectedBounds(boxLocal: IntBox3, matrixWorld: THREE.Matrix4, cell: number): THREE.Box3 {
  const corners: THREE.Vector3[] = [];
  for (const x of [boxLocal.min[0], boxLocal.max[0] + 1]) {
    for (const y of [boxLocal.min[1], boxLocal.max[1] + 1]) {
      for (const z of [boxLocal.min[2], boxLocal.max[2] + 1]) {
        corners.push(new THREE.Vector3(x * cell, y * cell, z * cell).applyMatrix4(matrixWorld));
      }
    }
  }
  return new THREE.Box3().setFromPoints(corners);
}

describe('box preview overlay', () => {
  it('starts hidden and draws one frame on the decoration layer only', () => {
    const scene = new THREE.Scene();
    const overlay = new Overlay(scene);
    const helper = helperOf(scene);
    expect(helper.visible).toBe(true);
    expect(helper.parent?.visible).toBe(false);
    expect(helper.layers.mask).toBe(1 << OVERLAY_LAYER);
    expect(helper.parent?.layers.mask).toBe(1 << OVERLAY_LAYER);
    overlay.dispose();
  });

  it('rejects a non-scene, a non-matrix, a fractional corner, and a non-positive cell', () => {
    const scene = new THREE.Scene();
    const overlay = new Overlay(scene);
    expect(() => new Overlay(new THREE.Object3D() as unknown as THREE.Scene)).toThrow(TypeError);
    expect(() => overlay.showBox({ min: [0, 0, 0], max: [0, 0, 0] }, new THREE.Object3D() as unknown as THREE.Matrix4, 1)).toThrow(TypeError);
    expect(() => overlay.showBox({ min: [0.5, 0, 0], max: [1, 1, 1] }, new THREE.Matrix4(), 1)).toThrow(RangeError);
    expect(() => overlay.showBox({ min: [0, 0, 0], max: [1, 1, 1] }, new THREE.Matrix4(), 0)).toThrow(RangeError);
    overlay.dispose();
  });

  it('draws the inclusive cell box at the owning object cell size, in that object world space', () => {
    const scene = new THREE.Scene();
    const overlay = new Overlay(scene);
    const box: IntBox3 = { min: [1, 2, 3], max: [2, 3, 4] };
    const matrix = new THREE.Matrix4().makeTranslation(10, -4, 2);
    overlay.showBox(box, matrix, 0.5);

    const drawn = drawnBounds(scene);
    const expected = expectedBounds(box, matrix, 0.5);
    expect(drawn.min.toArray()).toEqual(expected.min.toArray());
    expect(drawn.max.toArray()).toEqual(expected.max.toArray());
    // A quarter-cell object: three cells of half a unit, not three world units.
    expect(drawn.max.x - drawn.min.x).toBeCloseTo(1, 6);
    overlay.dispose();
  });

  it('follows a rotated and non-uniformly scaled object without shearing the frame', () => {
    const scene = new THREE.Scene();
    const overlay = new Overlay(scene);
    const box: IntBox3 = { min: [0, 0, 0], max: [1, 1, 1] };
    // A plane turned 60° and stretched unevenly along its own axes: composing the two matrices keeps the box a box,
    // while folding them into one transform and decomposing it back could not.
    const matrix = new THREE.Matrix4()
      .makeTranslation(3, 5, -2)
      .multiply(new THREE.Matrix4().makeRotationY(Math.PI / 3))
      .multiply(new THREE.Matrix4().makeScale(2, 1, 4));

    overlay.showBox(box, matrix, 1);
    const drawn = drawnBounds(scene);
    const expected = expectedBounds(box, matrix, 1);
    expect(drawn.min.x).toBeCloseTo(expected.min.x, 6);
    expect(drawn.max.x).toBeCloseTo(expected.max.x, 6);
    expect(drawn.max.z - drawn.min.z).toBeGreaterThan(0);
    expect(drawn.max.z).toBeCloseTo(expected.max.z, 6);
    overlay.dispose();
  });

  it('replaces the previous frame, colours itself, hides on clear, and releases the scene on dispose', () => {
    const scene = new THREE.Scene();
    const overlay = new Overlay(scene);
    overlay.showBox({ min: [0, 0, 0], max: [3, 3, 3] }, new THREE.Matrix4(), 1);
    const wide = drawnBounds(scene);
    expect(wide.max.x - wide.min.x).toBeCloseTo(4, 6);

    overlay.showBox({ min: [0, 0, 0], max: [0, 0, 0] }, new THREE.Matrix4(), 1, 0xff0000);
    const narrow = drawnBounds(scene);
    expect(narrow.max.x - narrow.min.x).toBeCloseTo(1, 6);
    const material = helperOf(scene).material as THREE.LineBasicMaterial;
    expect(material.color.getHex()).toBe(0xff0000);

    overlay.clear();
    expect(helperOf(scene).parent?.visible).toBe(false);

    overlay.dispose();
    expect(scene.children).toHaveLength(0);
    expect(() => overlay.dispose()).not.toThrow();
  });
});
