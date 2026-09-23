/**
 * The camera carrier's drawing: what it puts in the scene, what its frustum is derived from, the two separations a
 * drag depends on — the pose node never carries the screen-size scale, and the scale never touches the pose — and the
 * fact that the drawing is three's `CameraHelper` on a display projection of the carrier's own. Node-side and
 * GPU-free: `three` builds geometry and uniforms without a renderer.
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CameraControl } from '../src/three-runtime/cameraControl.js';

/** The viewport decoration layer (README D24). */
const OVERLAY_LAYER = 1;

function cameraHelper(control: CameraControl): THREE.CameraHelper {
  let found: THREE.CameraHelper | undefined;
  control.node.traverse((child) => {
    if (child instanceof THREE.CameraHelper) found = child;
  });
  if (found === undefined) throw new Error('CameraControl: no camera helper');
  return found;
}

/** The scaled child of the pose node: everything the distance is allowed to touch. */
function helperGroup(control: CameraControl): THREE.Object3D {
  const group = control.node.children[0];
  if (group === undefined) throw new Error('CameraControl: no helper group');
  return group;
}

/** One corner of a frustum plane, read through the helper's own point map. */
function corner(control: CameraControl, name: string): THREE.Vector3 {
  const helper = cameraHelper(control);
  const index = helper.pointMap[name]?.[0];
  if (index === undefined) throw new Error(`CameraControl: the helper has no point ${name}`);
  return new THREE.Vector3().fromBufferAttribute(
    helper.geometry.getAttribute('position') as THREE.BufferAttribute,
    index,
  );
}

/** One vertex of the drawn colour, which `setColors` writes into the geometry rather than a material. */
function colorAt(control: CameraControl, index: number): [number, number, number] {
  const color = cameraHelper(control).geometry.getAttribute('color');
  return [color.getX(index), color.getY(index), color.getZ(index)];
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
    // The node, the scaled helper group, and the helper itself: a childless walk would pass this vacuously.
    expect(inspected).toBe(3);
    control.dispose();
  });

  it('rejects anything that is not a scene, so the drawing can never be orphaned', () => {
    expect(() => new CameraControl(new THREE.Object3D() as unknown as THREE.Scene)).toThrow(TypeError);
  });

  it('derives the frustum from the vertical field of view and the viewport aspect', () => {
    const control = new CameraControl(new THREE.Scene());
    control.setPose(new THREE.Vector3(), new THREE.Quaternion(), 90, 1);
    for (const name of ['n1', 'n2', 'n3', 'n4']) {
      const point = corner(control, name);
      expect(Math.abs(point.y)).toBeCloseTo(1, 6);
      expect(Math.abs(point.x)).toBeCloseTo(1, 6);
    }

    // The same field of view in a wider viewport widens the frame and leaves its height alone.
    control.setPose(new THREE.Vector3(), new THREE.Quaternion(), 90, 2);
    for (const name of ['n1', 'n2', 'n3', 'n4']) {
      const point = corner(control, name);
      expect(Math.abs(point.x)).toBeCloseTo(2, 6);
      expect(Math.abs(point.y)).toBeCloseTo(1, 6);
    }

    // The far plane is the same frame one display plane further out: the library's own depth cue.
    const near = corner(control, 'n4');
    const far = corner(control, 'f4');
    expect(far.z).toBeCloseTo(near.z * 2, 6);
    expect(Math.abs(far.x)).toBeCloseTo(Math.abs(near.x) * 2, 6);
    control.dispose();
  });

  it('carries the pose on the node and the screen-size scale on the helper, never both on one', () => {
    const control = new CameraControl(new THREE.Scene());
    const position = new THREE.Vector3(3, 4, 5);
    control.setPose(position, new THREE.Quaternion(), 60, 1);
    const helper = helperGroup(control);
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

  it('marks up above the marker frame, so a banked pose reads as banked', () => {
    const control = new CameraControl(new THREE.Scene());
    control.setPose(new THREE.Vector3(), new THREE.Quaternion(), 60, 1);
    const top = Math.max(corner(control, 'n1').y, corner(control, 'n3').y);
    for (const name of ['u1', 'u2', 'u3']) {
      const point = corner(control, name);
      expect(point.y).toBeGreaterThan(top);
      expect(point.z).toBeLessThan(0);
    }
    control.dispose();
  });

  it('paints every part one colour on selection and releases the node on dispose, twice without complaint', () => {
    const scene = new THREE.Scene();
    const control = new CameraControl(scene);
    const idle = colorAt(control, 0);
    const uniform = (expected: [number, number, number]): void => {
      const count = cameraHelper(control).geometry.getAttribute('color').count;
      for (let index = 0; index < count; index += 1) {
        expect(colorAt(control, index)).toEqual(expected);
      }
    };
    // One flat colour, not the library's five-part default scheme.
    uniform(idle);

    control.setSelected(true);
    const selected = colorAt(control, 0);
    expect(selected).not.toEqual(idle);
    uniform(selected);

    control.setSelected(false);
    uniform(idle);

    control.dispose();
    expect(control.node.parent).toBeNull();
    expect(() => control.dispose()).not.toThrow();
  });
});
