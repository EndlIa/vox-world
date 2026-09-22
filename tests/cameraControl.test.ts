/**
 * The camera carrier's drawing: what it puts in the scene, what its frustum is derived from, and the two
 * separations a drag depends on — the pose node never carries the screen-size scale, and the scale never touches
 * the pose. Node-side and GPU-free: `three` builds geometry and uniforms without a renderer.
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CameraControl } from '../src/three-runtime/cameraControl.js';

/** The viewport decoration layer (README D24). */
const OVERLAY_LAYER = 1;

/** The pieces of the drawing, found by what they are rather than by the order they were added in. */
function parts(control: CameraControl) {
  const lines: THREE.LineSegments[] = [];
  const meshes: THREE.Mesh[] = [];
  control.node.traverse((child) => {
    if (child instanceof THREE.LineSegments) lines.push(child);
    if (child instanceof THREE.Mesh) meshes.push(child);
  });
  // The body is the fixed 12-edge box and the frustum is the rebuilt 8-segment frame, so the vertex counts
  // separate them without the class having to expose either.
  const body = lines.find((line) => line.geometry.getAttribute('position').count === 24);
  const frustum = lines.find((line) => line.geometry.getAttribute('position').count === 16);
  const up = meshes[0];
  if (body === undefined || frustum === undefined || up === undefined) {
    throw new Error('CameraControl: the drawing is incomplete');
  }
  return { body, frustum, up };
}

function farCorners(frustum: THREE.LineSegments): { x: number; y: number }[] {
  const position = frustum.geometry.getAttribute('position');
  const corners: { x: number; y: number }[] = [];
  for (let index = 0; index < position.count; index += 1) {
    const z = position.getZ(index);
    if (z === 0) continue;
    corners.push({ x: position.getX(index), y: position.getY(index) });
  }
  return corners;
}

describe('camera carrier', () => {
  it('adds its node to the scene on the decoration layer, unnamed and hidden', () => {
    const scene = new THREE.Scene();
    const control = new CameraControl(scene);
    expect(control.node.parent).toBe(scene);
    expect(control.node.name).toBe('');
    expect(control.node.visible).toBe(false);
    let inspected = 0;
    control.node.traverse((child) => {
      expect(child.layers.mask).toBe(1 << OVERLAY_LAYER);
      inspected += 1;
    });
    // The node, the helper group, and the three pieces: a childless walk would pass this vacuously.
    expect(inspected).toBe(5);
    control.dispose();
  });

  it('rejects anything that is not a scene, so the drawing can never be orphaned', () => {
    expect(() => new CameraControl(new THREE.Object3D() as unknown as THREE.Scene)).toThrow(TypeError);
  });

  it('derives the frustum from the vertical field of view and the viewport aspect', () => {
    const control = new CameraControl(new THREE.Scene());
    const { frustum } = parts(control);
    control.setPose(new THREE.Vector3(), new THREE.Quaternion(), 90, 1);
    for (const corner of farCorners(frustum)) {
      expect(Math.abs(corner.y)).toBeCloseTo(1, 6);
      expect(Math.abs(corner.x)).toBeCloseTo(1, 6);
    }
    // The same field of view in a wider viewport widens the frame and leaves its height alone.
    control.setPose(new THREE.Vector3(), new THREE.Quaternion(), 90, 2);
    for (const corner of farCorners(frustum)) {
      expect(Math.abs(corner.x)).toBeCloseTo(2, 6);
      expect(Math.abs(corner.y)).toBeCloseTo(1, 6);
    }
    control.dispose();
  });

  it('carries the pose on the node and the screen-size scale on the helper, never both on one', () => {
    const control = new CameraControl(new THREE.Scene());
    const position = new THREE.Vector3(3, 4, 5);
    control.setPose(position, new THREE.Quaternion(), 60, 1);
    const helper = control.node.children[0];
    if (helper === undefined) throw new Error('CameraControl: no helper');
    expect(control.node.position.toArray()).toEqual([3, 4, 5]);
    expect(control.node.scale.toArray()).toEqual([1, 1, 1]);

    control.setScreenScale(10);
    const fromTen = helper.scale.x;
    control.setScreenScale(20);
    expect(helper.scale.x).toBeCloseTo(fromTen * 2, 6);
    expect(control.node.position.toArray()).toEqual([3, 4, 5]);
    expect(control.node.scale.toArray()).toEqual([1, 1, 1]);

    // A pose update after a rescale leaves the drawing's size alone.
    control.setPose(new THREE.Vector3(6, 0, 0), new THREE.Quaternion(), 45, 1);
    expect(helper.scale.x).toBeCloseTo(fromTen * 2, 6);
    expect(control.node.position.x).toBe(6);
    control.dispose();
  });

  it('marks up above the far frame, so a banked pose reads as banked', () => {
    const control = new CameraControl(new THREE.Scene());
    const { frustum, up } = parts(control);
    control.setPose(new THREE.Vector3(), new THREE.Quaternion(), 60, 1);
    const top = Math.max(...farCorners(frustum).map((corner) => corner.y));
    const position = up.geometry.getAttribute('position');
    for (let index = 0; index < position.count; index += 1) {
      expect(position.getY(index)).toBeGreaterThan(top);
      expect(position.getZ(index)).toBeLessThan(0);
    }
    control.dispose();
  });

  it('recolours on selection and releases the node on dispose, twice without complaint', () => {
    const scene = new THREE.Scene();
    const control = new CameraControl(scene);
    const { body, frustum, up } = parts(control);
    const idle = (body.material as THREE.LineBasicMaterial).color.getHex();
    control.setSelected(true);
    const selected = (body.material as THREE.LineBasicMaterial).color.getHex();
    expect((frustum.material as THREE.LineBasicMaterial).color.getHex()).toBe(selected);
    expect((up.material as THREE.MeshBasicMaterial).color.getHex()).toBe(selected);
    expect(selected).not.toBe(idle);
    control.setSelected(false);
    expect((body.material as THREE.LineBasicMaterial).color.getHex()).toBe(idle);

    control.dispose();
    expect(control.node.parent).toBeNull();
    expect(() => control.dispose()).not.toThrow();
  });
});
