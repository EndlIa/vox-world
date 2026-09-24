/**
 * The camera control: the runtime-only stand-in the author aims the output camera with.
 *
 * It draws that camera with three's own `CameraHelper` — the library's frustum wireframe, whose triangle above the
 * near frame is what marks which way is up — inside a scaled child of the pose node. That node is what the edit
 * gizmo moves while the carrier is selected. Nothing here is document data: `app/main.ts` gives it the output
 * camera's pose and writes a drag or a field back into `project.camera` (README D46), so the carrier is a handle on
 * the authored camera, not a second camera.
 *
 * `CameraHelper` derives its frame from a `Camera`'s projection, so the carrier owns a display-only
 * `PerspectiveCamera`: it is never added to a scene, never rendered, and never read for a matrix — only for the two
 * display planes and the projection below. Those planes are constants rather than the authored camera's own near
 * and far, which a kilometre-scale world (README D40) would turn into a frustum spanning the whole scene.
 *
 * Everything it draws is on layer 1, which is what keeps it out of the picker's raycast and out of every export
 * frame (README D24), and the node carries no name, so the mixer's binding walk can never reach it (D22).
 *
 * The helper is a child of the node rather than the node itself: the node has to stay a pure pose for the gizmo's matrix
 * arithmetic, while the drawing keeps a size of its own. That size is fixed — `CARRIER_SCALE` helper units of one world
 * unit each — so the carrier is a scene-sized object: a view that pulls back shrinks it on screen along with everything
 * else, instead of inflating it into a huge wireframe (README D46).
 */

import * as THREE from 'three';

/** The viewport decoration layer (README D24); `overlay.ts`, `controls.ts`, and `grid.ts` use the same number. */
const OVERLAY_LAYER = 1;
const DECORATION_RENDER_ORDER = 1000;

/**
 * The two planes the display projection is built for, in helper units. The near one carries the marker frame and
 * the up triangle, so it is where the carrier reads its pose from; the far one draws a second frame behind it,
 * which is the depth cue the library's frustum comes with.
 */
const FRUSTUM_NEAR = 1;
const FRUSTUM_FAR = 2;

/**
 * The drawing's scale, in helper units of one world unit each: the near frame the pose is read from is one cell of the
 * lattice across and the far one is two. It is a fixed world size, not a screen size, so the carrier behaves like
 * anything else in the scene — the further the view pulls back, the smaller it gets (README D46).
 */
const CARRIER_SCALE = 1;

const IDLE_COLOR = 0x9aa2ad;
const SELECTED_COLOR = 0x4da3ff;

/** The two palette colors as `Color` instances: `setColors` reads components, never a hex number. */
const IDLE = new THREE.Color(IDLE_COLOR);
const SELECTED = new THREE.Color(SELECTED_COLOR);

export class CameraControl {
  /** The pose node: the gizmo's target, and nothing else's business. */
  readonly node: THREE.Object3D;

  /** The scaled drawing. Not the node, so a drag can never fight the screen-size rescale. */
  private readonly helper: THREE.Group;
  /** The display projection the frustum is built for: no scene, no renderer, no matrix anyone reads. */
  private readonly projection: THREE.PerspectiveCamera;
  private readonly frustum: THREE.CameraHelper;
  private readonly material: THREE.LineBasicMaterial;

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
    this.helper.scale.setScalar(CARRIER_SCALE);
    this.node.add(this.helper);

    // The helper builds its geometry in the camera's own space and places it with the camera's world matrix, which
    // is only right for a scene child. Here the node owns the pose and this group owns the size, so the helper is
    // given a local matrix of its own — the identity, never recomputed — and the pose reaches it from its parents.
    // It also carries the library's default colour scheme until the idle colour is applied below. Its material comes
    // from the library with a generic `Material` type, so it is narrowed once.
    this.projection = new THREE.PerspectiveCamera(50, 1, FRUSTUM_NEAR, FRUSTUM_FAR);
    this.frustum = new THREE.CameraHelper(this.projection);
    this.frustum.matrix = new THREE.Matrix4();
    this.frustum.matrixAutoUpdate = false;
    this.frustum.frustumCulled = false;
    this.frustum.renderOrder = DECORATION_RENDER_ORDER;
    this.material = this.frustum.material as THREE.LineBasicMaterial;
    this.material.depthTest = false;
    this.material.transparent = true;
    this.helper.add(this.frustum);

    // The node takes the layer too, not only what it draws: the whole carrier is then on one layer for the picker,
    // the export camera, and anything else that selects by layer, including children a later change adds.
    this.node.traverse((child) => {
      child.layers.set(OVERLAY_LAYER);
    });
    this.applyColor(false);
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
    this.projection.fov = fovDegrees;
    this.projection.aspect = aspect;
    this.projection.updateProjectionMatrix();
    this.frustum.update();
  }

  /** Draws the carrier or takes it off the screen; a hidden carrier cannot be seen, selected, or exported. */
  setVisible(visible: boolean): void {
    this.node.visible = visible;
  }

  /** Colours the drawing: the accent while the carrier is selected, the dim grey while it is not. */
  setSelected(selected: boolean): void {
    if (selected === this.selected) return;
    this.selected = selected;
    this.applyColor(selected);
  }

  /** Releases the frustum's geometry and material and the node. Idempotent. */
  dispose(): void {
    this.frustum.dispose();
    this.node.removeFromParent();
  }

  /**
   * Paints every part of the frustum one color. The helper draws the frame, the cone to its near plane, the up
   * marker, the axis and the two crosses with five separate colors, so all five are set to the carrier's own.
   */
  private applyColor(selected: boolean): void {
    const color = selected ? SELECTED : IDLE;
    this.frustum.setColors(color, color, color, color, color);
  }
}
