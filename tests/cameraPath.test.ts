/**
 * The camera path drawing: the layer it lives on, the polyline it buffers, the ring pool behind its markers, and the
 * separation between a marker's position and its size. Node-side and GPU-free.
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CameraPath } from '../src/three-runtime/cameraPath.js';

/** The viewport decoration layer (README D24). */
const OVERLAY_LAYER = 1;

function markers(path: CameraPath): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  path.root.traverse((child) => {
    if (child instanceof THREE.Mesh) found.push(child);
  });
  return found;
}

function line(path: CameraPath): THREE.Line {
  let found: THREE.Line | undefined;
  path.root.traverse((child) => {
    if (child instanceof THREE.Line) found = child;
  });
  if (found === undefined) throw new Error('CameraPath: no polyline');
  return found;
}

describe('camera path drawing', () => {
  it('adds an unnamed group to the scene, hidden, with every child on the decoration layer', () => {
    const scene = new THREE.Scene();
    const path = new CameraPath(scene);
    expect(path.root.parent).toBe(scene);
    expect(path.root.name).toBe('');
    expect(path.root.visible).toBe(false);
    let inspected = 0;
    path.root.traverse((child) => {
      expect(child.layers.mask).toBe(1 << OVERLAY_LAYER);
      inspected += 1;
    });
    // The root, the polyline, and the marker group: a childless walk would pass this vacuously.
    expect(inspected).toBe(3);
    path.dispose();
  });

  it('rejects anything that is not a scene, so the drawing can never be orphaned', () => {
    expect(() => new CameraPath(new THREE.Object3D() as unknown as THREE.Scene)).toThrow(TypeError);
  });

  it('buffers the polyline it is given, grows for a longer one, and empties for none', () => {
    const path = new CameraPath(new THREE.Scene());
    path.setTrajectory([]);
    expect(line(path).geometry.drawRange.count).toBe(0);

    const points = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 2, 3),
      new THREE.Vector3(4, 5, 6),
    ];
    path.setTrajectory(points);
    const geometry = line(path).geometry;
    expect(geometry.drawRange.count).toBe(3);
    const position = geometry.getAttribute('position');
    expect([position.getX(1), position.getY(1), position.getZ(1)]).toEqual([1, 2, 3]);

    // A longer path reallocates the buffer; the short one afterwards only narrows the draw range.
    path.setTrajectory([...points, new THREE.Vector3(7, 8, 9)]);
    expect(geometry.drawRange.count).toBe(4);
    expect(geometry.getAttribute('position').getX(3)).toBe(7);
    path.setTrajectory(points);
    expect(geometry.drawRange.count).toBe(3);
    path.dispose();
  });

  it('keeps one ring per marker, reuses the pool, and hides the surplus', () => {
    const path = new CameraPath(new THREE.Scene());
    const three = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(2, 0, 0), new THREE.Vector3(3, 0, 0)];
    path.setMarkers(three);
    expect(markers(path)).toHaveLength(3);
    expect(markers(path).map((marker) => marker.visible)).toEqual([true, true, true]);
    expect(markers(path).map((marker) => marker.position.x)).toEqual([1, 2, 3]);

    path.setMarkers(three.slice(0, 1));
    expect(markers(path)).toHaveLength(3);
    expect(markers(path).map((marker) => marker.visible)).toEqual([true, false, false]);

    // Coming back to three markers reuses the same meshes rather than growing the pool.
    path.setMarkers(three);
    expect(markers(path)).toHaveLength(3);
    expect(markers(path).map((marker) => marker.visible)).toEqual([true, true, true]);
    path.dispose();
  });

  it('rescales the rings without moving them off the path', () => {
    const path = new CameraPath(new THREE.Scene());
    path.setMarkers([new THREE.Vector3(5, 6, 7)]);
    const marker = markers(path)[0]!;
    path.setScreenScale(10);
    const small = marker.scale.x;
    expect(small).toBeGreaterThan(0);
    path.setScreenScale(20);
    expect(marker.scale.x).toBeCloseTo(small * 2, 6);
    // The ring is drawn where the path runs, at every size: a scale applied to the marker group would move it.
    expect(marker.position.toArray()).toEqual([5, 6, 7]);
    path.dispose();
  });

  it('turns the rings to face the camera and releases everything on dispose, twice without complaint', () => {
    const scene = new THREE.Scene();
    const path = new CameraPath(scene);
    path.setMarkers([new THREE.Vector3(1, 1, 1)]);
    const marker = markers(path)[0]!;
    const facing = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 0.4, 0.5));
    path.faceCamera(facing);
    expect(marker.quaternion.angleTo(facing)).toBeCloseTo(0, 6);

    path.dispose();
    expect(path.root.parent).toBeNull();
    expect(() => path.dispose()).not.toThrow();
  });
});
