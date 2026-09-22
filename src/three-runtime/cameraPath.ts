/**
 * The camera path drawing: a white polyline through the sampled trajectory and one hollow ring per keyframe.
 *
 * It is presentational and runtime-only, like the grid and the overlay: it holds points the app hands it and
 * knows nothing about the document. Its whole subtree is on layer 1, so the picker cannot hit it and no export
 * frame contains it (README D24), and nothing here is named, so the mixer's binding walk never reaches it (D22).
 *
 * The rings are billboards, which three has no built-in mode for: they are turned to face the drawing camera by
 * `faceCamera`, one quaternion copy per frame, and their size is scaled from the viewing distance so a path stays
 * readable in a scene of any scale.
 */

import * as THREE from 'three';

/** The viewport decoration layer (README D24); the grid, overlay, gizmo, and carrier use the same number. */
const OVERLAY_LAYER = 1;
const DECORATION_RENDER_ORDER = 1000;

/** Ring size and ring thickness, in helper units of the scaled marker group. */
const MARKER_RADIUS = 0.9;
const MARKER_INNER_RATIO = 0.62;
const MARKER_SEGMENTS = 24;

/** How much of the viewing distance a marker spans, clamped so it never vanishes or swallows the scene. */
const MARKER_SCALE = 0.02;
const MIN_MARKER_SCALE = 1e-4;
const MAX_MARKER_SCALE = 1e6;

const PATH_COLOR = 0xffffff;

export class CameraPath {
  /** The drawing. Not a document node and not a gizmo target: nothing else's business. */
  readonly root: THREE.Group;

  private readonly line: THREE.Line;
  private readonly lineGeometry: THREE.BufferGeometry;
  private readonly lineMaterial: THREE.LineBasicMaterial;
  private readonly markerGroup: THREE.Group;
  private readonly markerGeometry: THREE.RingGeometry;
  private readonly markerMaterial: THREE.MeshBasicMaterial;
  private readonly markers: THREE.Mesh[] = [];
  private readonly resources: { dispose(): void }[] = [];

  /** Points the line's buffer can hold; grown when a caller hands over a longer path than it has seen. */
  private capacity = 0;

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

    this.markerGroup = new THREE.Group();
    this.markerGeometry = new THREE.RingGeometry(
      MARKER_RADIUS * MARKER_INNER_RATIO,
      MARKER_RADIUS,
      MARKER_SEGMENTS,
    );
    this.markerMaterial = new THREE.MeshBasicMaterial({
      color: PATH_COLOR,
      side: THREE.DoubleSide,
      depthTest: false,
      transparent: true,
    });

    this.root.add(this.line, this.markerGroup);
    // The root takes the layer too, so a later child cannot escape it (README D24).
    this.root.traverse((child) => {
      child.layers.set(OVERLAY_LAYER);
    });
    this.resources.push(this.lineGeometry, this.lineMaterial, this.markerGeometry, this.markerMaterial);
    this.root.visible = false;
    scene.add(this.root);
  }

  /** Replaces the polyline. Two points draw one segment, and fewer than two leaves the line empty. */
  setTrajectory(points: readonly THREE.Vector3[]): void {
    if (points.length === 0) {
      this.lineGeometry.setDrawRange(0, 0);
      return;
    }
    if (points.length > this.capacity) this.grow(points.length);
    const position = this.lineGeometry.getAttribute('position') as THREE.BufferAttribute;
    points.forEach((point, index) => {
      position.setXYZ(index, point.x, point.y, point.z);
    });
    position.needsUpdate = true;
    this.lineGeometry.setDrawRange(0, points.length);
    if (points.length > 0) this.lineGeometry.computeBoundingSphere();
  }

  /** One hollow ring per point, reusing the pool: a marker belongs to a keyframe, so its count follows the track. */
  setMarkers(points: readonly THREE.Vector3[]): void {
    for (let index = 0; index < points.length; index += 1) {
      let marker = this.markers[index];
      if (marker === undefined) {
        marker = new THREE.Mesh(this.markerGeometry, this.markerMaterial);
        marker.frustumCulled = false;
        marker.renderOrder = DECORATION_RENDER_ORDER;
        marker.layers.set(OVERLAY_LAYER);
        this.markers[index] = marker;
        this.markerGroup.add(marker);
      }
      marker.position.copy(points[index]!);
      marker.visible = true;
    }
    for (let index = points.length; index < this.markers.length; index += 1) {
      const marker = this.markers[index];
      if (marker !== undefined) marker.visible = false;
    }
  }

  /**
   * Turns every marker to face the drawing camera. Three has no billboard mode on a mesh, so this is one quaternion
   * copy per marker per frame — the price of a ring that reads as a circle from any angle.
   */
  faceCamera(quaternion: THREE.Quaternion): void {
    for (const marker of this.markers) {
      if (marker.visible) marker.quaternion.copy(quaternion);
    }
  }

  /**
   * Rescales the markers from how far the drawing camera is, so a path reads the same in any scene. Each mesh is
   * scaled on its own rather than through `markerGroup`: a scaled group would scale the markers' world positions
   * with their size, and the rings would drift off the path they belong to.
   */
  setScreenScale(distance: number): void {
    const scale = Math.min(Math.max(distance * MARKER_SCALE, MIN_MARKER_SCALE), MAX_MARKER_SCALE);
    for (const marker of this.markers) marker.scale.setScalar(scale);
  }

  /** Draws the path or takes it off the screen; a hidden path is not seen, picked, or exported either way. */
  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  /** Releases the two geometries, the two materials, every marker, and the root. Idempotent. */
  dispose(): void {
    for (const resource of this.resources) resource.dispose();
    this.resources.length = 0;
    this.markers.length = 0;
    this.root.removeFromParent();
  }

  /** Grows the line's buffer to hold `count` points, which happens only when a longer path arrives. */
  private grow(count: number): void {
    const position = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
    this.lineGeometry.setAttribute('position', position);
    this.capacity = count;
  }
}
