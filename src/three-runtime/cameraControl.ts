/**
 * The camera control: the runtime-only stand-in the author aims the output camera with.
 *
 * It draws that camera as a body, a frustum wireframe derived from the vertical FOV and the viewport's aspect,
 * and a triangle that marks which way is up, and its node is what the edit gizmo moves while the carrier is
 * selected. Nothing here is document data: `app/main.ts` gives it the output camera's pose and writes a drag or a
 * field back into `project.camera` (README D46), so the carrier is a handle on the authored camera, not a second
 * camera.
 *
 * Everything it draws is on layer 1, which is what keeps it out of the picker's raycast and out of every export
 * frame (README D24), and the node carries no name, so the mixer's binding walk can never reach it (D22).
 *
 * The helper is a scaled child of the node rather than the node itself: the node has to stay a pure pose for the
 * gizmo's matrix arithmetic, and an authored scene can be kilometres across, so the drawing is rescaled every
 * frame from how far away the camera that draws it is.
 */

import * as THREE from 'three';

/** The viewport decoration layer (README D24); `overlay.ts`, `controls.ts`, and `grid.ts` use the same number. */
const OVERLAY_LAYER = 1;
const DECORATION_RENDER_ORDER = 1000;

/** The camera body's half-size, the frustum's depth, and the up triangle's measurements, in helper units. */
const BODY_HALF = 0.06;
const FRUSTUM_DEPTH = 1;
const UP_MARKER_HEIGHT = 0.1;

/** How much of the drawing size comes from the viewing distance, clamped so a corner never grows absurd. */
const SCREEN_SCALE = 0.16;
const MIN_SCREEN_SCALE = 1e-3;
const MAX_SCREEN_SCALE = 1e7;

const IDLE_COLOR = 0x9aa2ad;
const SELECTED_COLOR = 0x4da3ff;

/** The 12 edges of the unit camera body, as 24 vertices of a `LineSegments`. Read-only. */
const BODY_EDGES = new Float32Array([
  -BODY_HALF, -BODY_HALF, -BODY_HALF, BODY_HALF, -BODY_HALF, -BODY_HALF,
  -BODY_HALF, -BODY_HALF, BODY_HALF, BODY_HALF, -BODY_HALF, BODY_HALF,
  -BODY_HALF, BODY_HALF, -BODY_HALF, BODY_HALF, BODY_HALF, -BODY_HALF,
  -BODY_HALF, BODY_HALF, BODY_HALF, BODY_HALF, BODY_HALF, BODY_HALF,

  -BODY_HALF, -BODY_HALF, -BODY_HALF, -BODY_HALF, BODY_HALF, -BODY_HALF,
  -BODY_HALF, -BODY_HALF, BODY_HALF, -BODY_HALF, BODY_HALF, BODY_HALF,
  BODY_HALF, -BODY_HALF, -BODY_HALF, BODY_HALF, BODY_HALF, -BODY_HALF,
  BODY_HALF, -BODY_HALF, BODY_HALF, BODY_HALF, BODY_HALF, BODY_HALF,

  -BODY_HALF, -BODY_HALF, -BODY_HALF, -BODY_HALF, -BODY_HALF, BODY_HALF,
  BODY_HALF, -BODY_HALF, -BODY_HALF, BODY_HALF, -BODY_HALF, BODY_HALF,
  -BODY_HALF, BODY_HALF, -BODY_HALF, -BODY_HALF, BODY_HALF, BODY_HALF,
  BODY_HALF, BODY_HALF, -BODY_HALF, BODY_HALF, BODY_HALF, BODY_HALF,
]);

export class CameraControl {
  /** The pose node: the gizmo's target, and nothing else's business. */
  readonly node: THREE.Object3D;

  /** The scaled drawing. Not the node, so a drag can never fight the screen-size rescale. */
  private readonly helper: THREE.Group;
  private readonly bodyMaterial: THREE.LineBasicMaterial;
  private readonly frustumGeometry: THREE.BufferGeometry;
  private readonly frustumMaterial: THREE.LineBasicMaterial;
  private readonly upGeometry: THREE.BufferGeometry;
  private readonly upMaterial: THREE.MeshBasicMaterial;
  private readonly resources: { dispose(): void }[] = [];

  /** The projection the current frustum was built for, so a pose update that changes neither rebuilds nothing. */
  private builtFov = 0;
  private builtAspect = 0;
  private selected = false;

  constructor(scene: THREE.Scene) {
    if (!(scene instanceof THREE.Scene)) {
      throw new TypeError('CameraControl: the constructor argument must be a THREE.Scene');
    }

    this.node = new THREE.Object3D();
    this.helper = new THREE.Group();
    this.node.add(this.helper);

    // The up marker is a triangle in the helper's own XY plane, so it follows the pose's roll: it marks the
    // camera's up, which is what makes a banked pose readable.
    this.upGeometry = new THREE.BufferGeometry();
    this.upGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0]), 3),
    );
    this.upMaterial = new THREE.MeshBasicMaterial({
      color: IDLE_COLOR,
      side: THREE.DoubleSide,
      depthTest: false,
      transparent: true,
    });
    const up = new THREE.Mesh(this.upGeometry, this.upMaterial);
    up.frustumCulled = false;
    up.renderOrder = DECORATION_RENDER_ORDER;

    this.bodyMaterial = new THREE.LineBasicMaterial({ color: IDLE_COLOR, depthTest: false, transparent: true });
    const bodyGeometry = new THREE.BufferGeometry();
    bodyGeometry.setAttribute('position', new THREE.BufferAttribute(BODY_EDGES, 3));
    const body = new THREE.LineSegments(bodyGeometry, this.bodyMaterial);
    body.frustumCulled = false;
    body.renderOrder = DECORATION_RENDER_ORDER;

    this.frustumGeometry = new THREE.BufferGeometry();
    // Eight segments: four from the apex to the far rectangle's corners, and the rectangle's own four edges.
    this.frustumGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 2 * 3), 3));
    this.frustumMaterial = new THREE.LineBasicMaterial({ color: IDLE_COLOR, depthTest: false, transparent: true });
    const frustum = new THREE.LineSegments(this.frustumGeometry, this.frustumMaterial);
    frustum.frustumCulled = false;
    frustum.renderOrder = DECORATION_RENDER_ORDER;

    this.helper.add(up, body, frustum);
    // The node takes the layer too, not only what it draws: the whole carrier is then on one layer for the picker,
    // the export camera, and anything else that selects by layer, including children a later change adds.
    this.node.traverse((child) => {
      child.layers.set(OVERLAY_LAYER);
    });
    this.resources.push(bodyGeometry, this.upGeometry, this.frustumGeometry, this.bodyMaterial, this.frustumMaterial, this.upMaterial);
    this.node.visible = false;
    scene.add(this.node);
  }

  /**
   * Adopts a camera pose and the projection to draw around it. `fovDegrees` is the vertical field of view, the
   * number an authored `fov` keyframe holds, and `aspect` is the aspect of the viewport the drawing leads.
   */
  setPose(position: THREE.Vector3, quaternion: THREE.Quaternion, fovDegrees: number, aspect: number): void {
    this.node.position.copy(position);
    this.node.quaternion.copy(quaternion);
    if (fovDegrees === this.builtFov && aspect === this.builtAspect) return;
    this.builtFov = fovDegrees;
    this.builtAspect = aspect;
    this.rebuildFrustum(fovDegrees, aspect);
  }

  /** Draws the carrier or takes it off the screen; a hidden carrier cannot be seen, selected, or exported. */
  setVisible(visible: boolean): void {
    this.node.visible = visible;
  }

  /** Colours the drawing: the accent while the carrier is selected, the dim grey while it is not. */
  setSelected(selected: boolean): void {
    if (selected === this.selected) return;
    this.selected = selected;
    const color = selected ? SELECTED_COLOR : IDLE_COLOR;
    this.bodyMaterial.color.setHex(color);
    this.frustumMaterial.color.setHex(color);
    this.upMaterial.color.setHex(color);
  }

  /**
   * Rescales the drawing from how far the camera that draws it is: an authored scene can be metres or kilometres
   * across, and the carrier has to read the same in both. The node's own transform is untouched.
   */
  setScreenScale(distance: number): void {
    const scale = Math.min(Math.max(distance * SCREEN_SCALE, MIN_SCREEN_SCALE), MAX_SCREEN_SCALE);
    this.helper.scale.setScalar(scale);
  }

  /** Releases the geometries, materials, and the node. Idempotent. */
  dispose(): void {
    for (const resource of this.resources) resource.dispose();
    this.resources.length = 0;
    this.node.removeFromParent();
  }

  /**
   * Rewrites the frustum and the up marker for a projection: the far rectangle's half-height is the depth times
   * the half-angle's tangent, its half-width follows the aspect, and the apex sits at the pose itself, which is
   * where a camera's frustum starts.
   */
  private rebuildFrustum(fovDegrees: number, aspect: number): void {
    const halfHeight = Math.tan(THREE.MathUtils.degToRad(fovDegrees) / 2) * FRUSTUM_DEPTH;
    const halfWidth = halfHeight * aspect;
    const corners: [number, number][] = [
      [-halfWidth, halfHeight],
      [halfWidth, halfHeight],
      [halfWidth, -halfHeight],
      [-halfWidth, -halfHeight],
    ];
    const positions = this.frustumGeometry.getAttribute('position') as THREE.BufferAttribute;
    let vertex = 0;
    const push = (x: number, y: number, z: number): void => {
      positions.setXYZ(vertex, x, y, z);
      vertex += 1;
    };
    for (const [x, y] of corners) {
      push(0, 0, 0);
      push(x, y, -FRUSTUM_DEPTH);
    }
    for (let index = 0; index < corners.length; index += 1) {
      const [x, y] = corners[index]!;
      const [nextX, nextY] = corners[(index + 1) % corners.length]!;
      push(x, y, -FRUSTUM_DEPTH);
      push(nextX, nextY, -FRUSTUM_DEPTH);
    }
    positions.needsUpdate = true;
    this.frustumGeometry.computeBoundingSphere();

    // The up marker rides above the far rectangle's top edge, pointing away from the frustum.
    const base = halfHeight + UP_MARKER_HEIGHT;
    const up = this.upGeometry.getAttribute('position') as THREE.BufferAttribute;
    up.setXYZ(0, 0, base + UP_MARKER_HEIGHT, -FRUSTUM_DEPTH);
    up.setXYZ(1, -UP_MARKER_HEIGHT * 0.7, base, -FRUSTUM_DEPTH);
    up.setXYZ(2, UP_MARKER_HEIGHT * 0.7, base, -FRUSTUM_DEPTH);
    up.needsUpdate = true;
    this.upGeometry.computeBoundingSphere();
  }
}
