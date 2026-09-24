/**
 * The camera path drawing: a white polyline through the sampled trajectory and one hollow ring per keyframe.
 *
 * It is presentational and runtime-only, like the grid and the overlay: it holds points the app hands it and knows
 * nothing about the document. Its whole subtree is on layer 1, so the picker cannot hit it and no export frame
 * contains it (README D24), and nothing here is named, so the mixer's binding walk never reaches it (D22).
 *
 * Both halves are three's own. The polyline is a `Line` over a buffer that grows on demand, and the rings are one
 * `Points` set whose material is a ring built once into a small `DataTexture` — so a marker faces the drawing camera
 * by construction, with no per-marker mesh, no quaternion copied per frame, and one draw call instead of one per
 * keyframe. The ring's size is the viewing distance times `MARKER_SCALE`, the share of the distance the old
 * per-marker scale added up to, which is what keeps a path readable in a scene of any scale.
 */

import * as THREE from 'three';

/** The viewport decoration layer (README D24); the grid, overlay, gizmo, and carrier use the same number. */
const OVERLAY_LAYER = 1;
const DECORATION_RENDER_ORDER = 1000;

/** Ring band as a share of the ring's outer radius, and the side of the texture the ring is drawn into. */
const MARKER_INNER_RATIO = 0.62;
const MARKER_TEXTURE_SIZE = 64;

/**
 * The ring's diameter as a share of the viewing distance — the 1.8 helper units of ring the old per-marker scale
 * carried (`MARKER_RADIUS` 0.9 × 2 × 0.02) — clamped so a corner distance never vanishes or swallows the scene.
 */
const MARKER_SCALE = 0.036;
const MIN_MARKER_SCALE = 1.8e-4;
const MAX_MARKER_SCALE = 1.8e6;

const PATH_COLOR = 0xffffff;

/**
 * One white ring, drawn into a `DataTexture`: the marker's whole appearance, so a ring reads as a ring at any
 * distance without a mesh, a billboard, or a texture file. Each edge of the band is feathered by a texel and the
 * texture is filtered linearly, which is what keeps a 64-texel ring from reading as a staircase. Built from data
 * rather than from a canvas, so it needs no DOM.
 */
function ringTexture(): THREE.DataTexture {
  const size = MARKER_TEXTURE_SIZE;
  const data = new Uint8Array(size * size * 4);
  const center = size / 2;
  const inner = center * MARKER_INNER_RATIO;
  const outer = center - 1;
  const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x + 0.5 - center, y + 0.5 - center);
      const alpha = clamp01(distance - (inner - 0.5)) * clamp01(outer + 0.5 - distance);
      const offset = (y * size + x) * 4;
      data[offset] = 0xff;
      data[offset + 1] = 0xff;
      data[offset + 2] = 0xff;
      data[offset + 3] = Math.round(alpha * 0xff);
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  // A `DataTexture` does not flag itself for upload, so a material given one draws nothing until this is set.
  texture.needsUpdate = true;
  return texture;
}

export class CameraPath {
  /** The drawing. Not a document node and not a gizmo target: nothing else's business. */
  readonly root: THREE.Group;

  private readonly line: THREE.Line;
  private readonly lineGeometry: THREE.BufferGeometry;
  private readonly lineMaterial: THREE.LineBasicMaterial;
  private readonly markers: THREE.Points;
  private readonly markerGeometry: THREE.BufferGeometry;
  private readonly markerMaterial: THREE.PointsMaterial;
  private readonly markerTexture: THREE.DataTexture;
  private readonly resources: { dispose(): void }[] = [];

  /** Points each buffer can hold; grown when a caller hands over a longer path than it has seen. */
  private lineCapacity = 0;
  private markerCapacity = 0;

  constructor(scene: THREE.Scene) {
    if (!(scene instanceof THREE.Scene)) {
      throw new TypeError('CameraPath: the constructor argument must be a THREE.Scene');
    }

    this.root = new THREE.Group();

    this.lineGeometry = new THREE.BufferGeometry();
    this.lineMaterial = new THREE.LineBasicMaterial({ color: PATH_COLOR, depthTest: false, transparent: true });
    this.line = new THREE.Line(this.lineGeometry, this.lineMaterial);
    this.line.frustumCulled = false;
    this.line.renderOrder = DECORATION_RENDER_ORDER;

    this.markerTexture = ringTexture();
    this.markerGeometry = new THREE.BufferGeometry();
    this.markerMaterial = new THREE.PointsMaterial({
      color: PATH_COLOR,
      map: this.markerTexture,
      size: 0,
      sizeAttenuation: true,
      depthTest: false,
      transparent: true,
    });
    this.markers = new THREE.Points(this.markerGeometry, this.markerMaterial);
    this.markers.frustumCulled = false;
    this.markers.renderOrder = DECORATION_RENDER_ORDER;

    this.root.add(this.line, this.markers);
    // The root takes the layer too, so a later child cannot escape it (README D24).
    this.root.traverse((child) => {
      child.layers.set(OVERLAY_LAYER);
    });
    this.resources.push(
      this.lineGeometry,
      this.lineMaterial,
      this.markerGeometry,
      this.markerMaterial,
      this.markerTexture,
    );
    this.root.visible = false;
    scene.add(this.root);
  }

  /** Replaces the polyline. Two points draw one segment, and fewer than two leaves the line empty. */
  setTrajectory(points: readonly THREE.Vector3[]): void {
    // An empty list is the common "nothing to draw" state, and it must not dereference a buffer that may not exist
    // yet: a path that has never been drawn has none.
    if (points.length === 0) {
      this.lineGeometry.setDrawRange(0, 0);
      return;
    }
    if (points.length > this.lineCapacity) {
      this.lineGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(points.length * 3), 3));
      this.lineCapacity = points.length;
    }
    const position = this.lineGeometry.getAttribute('position') as THREE.BufferAttribute;
    points.forEach((point, index) => {
      position.setXYZ(index, point.x, point.y, point.z);
    });
    position.needsUpdate = true;
    this.lineGeometry.setDrawRange(0, points.length);
    this.lineGeometry.computeBoundingSphere();
  }

  /** One ring per point: a marker belongs to a keyframe, so its count follows the track exactly. */
  setMarkers(points: readonly THREE.Vector3[]): void {
    // As above: hiding the markers touches the buffer only when there is something to write.
    if (points.length === 0) {
      this.markerGeometry.setDrawRange(0, 0);
      return;
    }
    if (points.length > this.markerCapacity) {
      this.markerGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(points.length * 3), 3));
      this.markerCapacity = points.length;
    }
    const position = this.markerGeometry.getAttribute('position') as THREE.BufferAttribute;
    points.forEach((point, index) => {
      position.setXYZ(index, point.x, point.y, point.z);
    });
    position.needsUpdate = true;
    this.markerGeometry.setDrawRange(0, points.length);
    this.markerGeometry.computeBoundingSphere();
  }

  /**
   * Resizes the rings from how far the drawing camera is, so a path reads the same in any scene. One scalar for the
   * whole set: a point sprite's size is its material's, so nothing here walks the markers, and their positions are
   * never touched by a resize.
   */
  setScreenScale(distance: number): void {
    this.markerMaterial.size = Math.min(Math.max(distance * MARKER_SCALE, MIN_MARKER_SCALE), MAX_MARKER_SCALE);
  }

  /** Draws the path or takes it off the screen; a hidden path is not seen, picked, or exported either way. */
  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  /** Releases the two geometries, the two materials, the ring texture, and the root. Idempotent. */
  dispose(): void {
    for (const resource of this.resources) resource.dispose();
    this.resources.length = 0;
    this.root.removeFromParent();
  }
}
