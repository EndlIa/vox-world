/**
 * The camera path drawing: the layer it lives on, the polyline it buffers, the one marker set behind its rings, the
 * separation between a marker's position and its size, and the ring its points are drawn with. Node-side and
 * GPU-free: `three` builds geometry and texture data without a renderer.
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CameraPath } from '../src/three-runtime/cameraPath.js';

/** The viewport decoration layer (README D24). */
const OVERLAY_LAYER = 1;

function polyline(path: CameraPath): THREE.Line {
  let found: THREE.Line | undefined;
  path.root.traverse((child) => {
    if (child instanceof THREE.Line) found = child;
  });
  if (found === undefined) throw new Error('CameraPath: no polyline');
  return found;
}

function markerSet(path: CameraPath): THREE.Points {
  let found: THREE.Points | undefined;
  path.root.traverse((child) => {
    if (child instanceof THREE.Points) found = child;
  });
  if (found === undefined) throw new Error('CameraPath: no marker set');
  return found;
}

function markerMaterial(path: CameraPath): THREE.PointsMaterial {
  const material = markerSet(path).material;
  if (!(material instanceof THREE.PointsMaterial)) throw new Error('CameraPath: the markers are not points');
  return material;
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
    // The root, the polyline, and the marker set: a childless walk would pass this vacuously.
    expect(inspected).toBe(3);
    path.dispose();
  });

  it('rejects anything that is not a scene, so the drawing can never be orphaned', () => {
    expect(() => new CameraPath(new THREE.Object3D() as unknown as THREE.Scene)).toThrow(TypeError);
  });

  it('buffers the polyline it is given, grows for a longer one, and empties for none', () => {
    const path = new CameraPath(new THREE.Scene());
    path.setTrajectory([]);
    expect(polyline(path).geometry.drawRange.count).toBe(0);

    const points = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 2, 3),
      new THREE.Vector3(4, 5, 6),
    ];
    path.setTrajectory(points);
    const geometry = polyline(path).geometry;
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

  it('draws exactly one marker per point handed over, in one set', () => {
    const path = new CameraPath(new THREE.Scene());
    const three = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(2, 0, 0), new THREE.Vector3(3, 0, 0)];
    path.setMarkers(three);
    const geometry = markerSet(path).geometry;
    expect(geometry.drawRange.count).toBe(3);
    const position = geometry.getAttribute('position');
    expect([position.getX(1), position.getY(1), position.getZ(1)]).toEqual([2, 0, 0]);

    // A shorter list stops drawing the surplus: the count is the track's, with nothing rebuilt for it.
    path.setMarkers(three.slice(0, 1));
    expect(geometry.drawRange.count).toBe(1);

    // A longer one grows the buffer and draws every point of it.
    path.setMarkers([...three, new THREE.Vector3(4, 0, 0)]);
    expect(geometry.drawRange.count).toBe(4);
    expect(geometry.getAttribute('position').getX(3)).toBe(4);

    path.setMarkers([]);
    expect(geometry.drawRange.count).toBe(0);
    path.dispose();
  });

  it('draws each marker as a white ring whose middle is hollow', () => {
    const path = new CameraPath(new THREE.Scene());
    const map = markerMaterial(path).map;
    if (!(map instanceof THREE.DataTexture)) throw new Error('CameraPath: the ring is not a data texture');
    // A texture that is never flagged for upload draws nothing at all, and a fresh `DataTexture` does not flag itself.
    expect(map.version).toBeGreaterThan(0);
    const { data, width, height } = map.image;
    if (data === null) throw new Error('CameraPath: the ring texture has no data');

    let opaque = 0;
    let clear = 0;
    for (let index = 0; index < data.length; index += 4) {
      expect(data[index]).toBe(0xff);
      expect(data[index + 1]).toBe(0xff);
      expect(data[index + 2]).toBe(0xff);
      if (data[index + 3] === 0xff) opaque += 1;
      if (data[index + 3] === 0) clear += 1;
    }
    // A band of opaque texels inside a clear ground, so a marker reads as a ring rather than a disc or a square.
    expect(opaque).toBeGreaterThan(0);
    expect(clear).toBeGreaterThan(0);
    const centre = ((height / 2) * width + width / 2) * 4 + 3;
    expect(data[centre]).toBe(0);
    // The first texel is a corner, outside the ring's outer radius.
    expect(data[3]).toBe(0);
    path.dispose();
  });

  it('sizes the rings from the viewing distance without moving one off the path', () => {
    const path = new CameraPath(new THREE.Scene());
    path.setMarkers([new THREE.Vector3(5, 6, 7)]);
    path.setScreenScale(10);
    const small = markerMaterial(path).size;
    expect(small).toBeGreaterThan(0);
    path.setScreenScale(20);
    expect(markerMaterial(path).size).toBeCloseTo(small * 2, 6);
    // The ring is drawn where the path runs, at every size: the size is the material's, never the points'.
    const position = markerSet(path).geometry.getAttribute('position');
    expect([position.getX(0), position.getY(0), position.getZ(0)]).toEqual([5, 6, 7]);
    path.dispose();
  });

  it('releases everything on dispose, twice without complaint', () => {
    const scene = new THREE.Scene();
    const path = new CameraPath(scene);
    path.setMarkers([new THREE.Vector3(1, 1, 1)]);
    path.dispose();
    expect(path.root.parent).toBeNull();
    expect(() => path.dispose()).not.toThrow();
  });
});
