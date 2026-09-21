/**
 * Viewport interaction.
 *
 * Wraps viewport navigation (`OrbitControls`) and the edit gizmo (`TransformControls`) behind one
 * object, and provides the `OutputPreview` guide frame for the export aspect. It owns interaction
 * state only: it reads no voxel data, writes nothing to the document, and never renders.
 *
 * Navigation answers to the middle and right mouse buttons, so a left drag stays free for the box
 * tool, and the gizmo reports a drag and its commit separately so one gesture writes the document
 * exactly once.
 *
 * Navigation follows the viewport camera by default; `setOrbitTarget` hands it to another camera
 * (the output camera, while the app's camera lock is on) and `onOrbitChange` reports every camera
 * move navigation caused, which is how the app learns where the user aimed the output camera.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

/** The viewport decoration layer (README D24); `overlay.ts` uses the same number. */
const OVERLAY_LAYER = 1;
const GUIDE_RENDER_ORDER = 999;
/** The guide sits a hair past the near plane, so it is never near-clipped and never behind geometry. */
const GUIDE_NEAR_FACTOR = 1.0001;
/** Below this the camera sits on the orbit pivot, where rotation and dolly have no effect at all. */
const MIN_ORBIT_RADIUS = 1e-4;

/** Scratch forward vector, so `OutputPreview.update` allocates nothing per frame. */
const _forward = new THREE.Vector3();
/** Scratch view direction for `setOrbitTarget`, so retargeting allocates nothing either. */
const _viewDirection = new THREE.Vector3();

export class ViewportControls {
  readonly orbit: OrbitControls;

  private readonly camera: THREE.PerspectiveCamera;
  private readonly domElement: HTMLElement;
  private gizmo: TransformControls | null = null;
  private attached: THREE.Object3D | null = null;
  private changeCallback: ((matrix: THREE.Matrix4) => void) | null = null;
  private commitCallback: (() => void) | null = null;
  private readonly orbitCallbacks = new Set<() => void>();

  constructor(domElement: HTMLElement, camera: THREE.PerspectiveCamera) {
    this.domElement = domElement;
    this.camera = camera;

    this.orbit = new OrbitControls(camera, domElement);
    this.orbit.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
    this.orbit.enableDamping = true;
    this.orbit.addEventListener('change', this.handleOrbitChange);
  }

  /**
   * Attaches the edit gizmo to one mirrored object.
   *
   * The gizmo is created on first use and reused afterwards; its helper goes into the scene that owns
   * the object, because a helper outside the scene graph would never be drawn.
   */
  attachGizmo(object: THREE.Object3D, mode: 'translate' | 'rotate' | 'scale'): void {
    let root: THREE.Object3D = object;
    while (root.parent !== null) root = root.parent;
    if (!(root instanceof THREE.Scene)) {
      throw new TypeError('ViewportControls.attachGizmo: the object is not part of a THREE.Scene');
    }

    if (this.gizmo === null) {
      const gizmo = new TransformControls(this.camera, this.domElement);
      gizmo.addEventListener('objectChange', this.handleObjectChange);
      gizmo.addEventListener('dragging-changed', this.handleDraggingChanged);
      gizmo.addEventListener('mouseUp', this.handleMouseUp);
      this.gizmo = gizmo;
    }

    this.gizmo.attach(object);
    this.gizmo.setMode(mode);
    this.attached = object;

    // The gizmo is viewport feedback like the overlay and the guide, so it lives on layer 1: the
    // picker's raycaster and the export camera both test layer 0 only, so no handle can be picked or
    // captured (README D24). Its own handle raycasting reads the same layer, or the gizmo would stop
    // responding to the pointer.
    const helper = this.gizmo.getHelper();
    helper.traverse((child) => {
      child.layers.set(OVERLAY_LAYER);
    });
    this.gizmo.getRaycaster().layers.set(OVERLAY_LAYER);
    root.add(helper);
  }

  /** Detaches the gizmo and removes its helper; a no-op when nothing is attached. */
  detachGizmo(): void {
    if (this.gizmo === null || this.attached === null) return;
    this.gizmo.detach();
    this.gizmo.getHelper().removeFromParent();
    this.attached = null;
  }

  /**
   * Whether the gizmo owns the pointer right now: it is dragging, or the pointer rests on one of its
   * handles, which three reports as a non-null `axis`.
   *
   * The pointer layer asks this instead of reading `hasPointerCapture`: `TransformControls` captures
   * the pointer on *every* press, hit or miss, so a capture is not a claim on the gesture — only the
   * gizmo's own dragging/hover state is. No gizmo yet, nothing attached, or a disabled gizmo owns
   * nothing, and every press then belongs to the active tool.
   */
  gizmoBusy(): boolean {
    const gizmo = this.gizmo;
    if (gizmo === null || this.attached === null || !gizmo.enabled) return false;
    return gizmo.dragging || gizmo.axis !== null;
  }

  /** Live drag feedback: the attached node's current world matrix. Display only. */
  onGizmoChange(cb: (matrix: THREE.Matrix4) => void): void {
    this.changeCallback = cb;
  }

  /** Pointer-up: the one moment a gesture is written to the document. */
  onGizmoCommit(cb: () => void): void {
    this.commitCallback = cb;
  }

  /**
   * Registers one navigation callback. Every registration is kept — the last one does not win, unlike
   * the gizmo slots — and `dispose()` drops them all.
   *
   * The callback fires on `OrbitControls`' own `change` event, which the controls dispatch only when
   * the camera actually moved, so the per-frame `update()` calls that damping requires never fire it
   * on their own; it stays silent for a frame in which nothing was orbited, panned, or zoomed.
   */
  onOrbitChange(cb: () => void): void {
    this.orbitCallbacks.add(cb);
  }

  /**
   * Hands navigation to another camera, so the composition root can point it at the output camera
   * while the camera lock is on. The orbit pivot stays where it is, except when the new camera sits
   * on it: a zero orbit radius can neither rotate nor dolly, and the output camera starts at the
   * pivot, so the pivot then moves to the point that camera already looks at, at the distance the
   * previous camera orbited from. That changes neither position nor orientation — `update()` rebuilds
   * the same offset and looks at a point straight ahead — and it leaves the user able to aim the
   * output camera.
   */
  setOrbitTarget(camera: THREE.PerspectiveCamera): void {
    const orbit = this.orbit;
    const radius = orbit.object.position.distanceTo(orbit.target);
    orbit.object = camera;
    if (radius > MIN_ORBIT_RADIUS && camera.position.distanceTo(orbit.target) <= MIN_ORBIT_RADIUS) {
      orbit.target.copy(camera.position).addScaledVector(camera.getWorldDirection(_viewDirection), radius);
    }
    orbit.update();
  }

  /** Advances navigation; damping requires one call per rendered frame. */
  update(): void {
    this.orbit.update();
  }

  dispose(): void {
    const gizmo = this.gizmo;
    if (gizmo !== null) {
      gizmo.removeEventListener('objectChange', this.handleObjectChange);
      gizmo.removeEventListener('dragging-changed', this.handleDraggingChanged);
      gizmo.removeEventListener('mouseUp', this.handleMouseUp);
      gizmo.detach();
      gizmo.getHelper().removeFromParent();
      gizmo.dispose();
      this.gizmo = null;
      this.attached = null;
    }
    this.orbit.removeEventListener('change', this.handleOrbitChange);
    this.orbitCallbacks.clear();
    this.orbit.dispose();
  }

  private readonly handleOrbitChange = (): void => {
    for (const callback of this.orbitCallbacks) callback();
  };

  private readonly handleObjectChange = (): void => {
    const object = this.attached;
    if (object === null) return;
    // TransformControls applies a drag from `pointerMove` and dispatches `objectChange` without
    // refreshing the world matrix, so refresh it here: the clone must not lag the drag by a frame.
    object.updateWorldMatrix(true, false);
    this.changeCallback?.(object.matrixWorld.clone());
  };

  private readonly handleDraggingChanged = (event: { value: unknown }): void => {
    this.orbit.enabled = event.value !== true;
  };

  private readonly handleMouseUp = (): void => {
    this.commitCallback?.();
  };
}

export class OutputPreview {
  readonly guide: THREE.LineSegments;

  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.LineBasicMaterial;
  private aspect: number;
  private visible: boolean;
  private following = false;

  constructor(opts: { aspect: number; visible: boolean }) {
    requireAspect(opts.aspect);
    this.aspect = opts.aspect;
    this.visible = opts.visible;

    const square = new Float32Array([
      -0.5, -0.5, 0, 0.5, -0.5, 0,
      0.5, -0.5, 0, 0.5, 0.5, 0,
      0.5, 0.5, 0, -0.5, 0.5, 0,
      -0.5, 0.5, 0, -0.5, -0.5, 0,
    ]);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(square, 3));
    this.material = new THREE.LineBasicMaterial({ depthTest: false });
    this.guide = new THREE.LineSegments(this.geometry, this.material);
    this.guide.frustumCulled = false;
    this.guide.renderOrder = GUIDE_RENDER_ORDER;
    this.guide.layers.set(OVERLAY_LAYER);
    this.guide.visible = opts.visible;
  }

  setAspect(aspect: number): void {
    requireAspect(aspect);
    this.aspect = aspect;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.guide.visible = visible && !this.following;
  }

  /**
   * Places the guide on the viewport camera's near plane and scales it to the export-aspect
   * rectangle inscribed in the camera's frame. Only the axis that would overflow shrinks, so the two
   * frames share an edge and the guide marks the crop exactly. Cached values are the only state, so a
   * slider drag allocates nothing here.
   */
  update(viewportCamera: THREE.PerspectiveCamera): void {
    if (!this.guide.visible) return;

    const viewportAspect =
      Number.isFinite(viewportCamera.aspect) && viewportCamera.aspect > 0 ? viewportCamera.aspect : this.aspect;
    const distance = viewportCamera.near * GUIDE_NEAR_FACTOR;
    const halfHeight = distance * Math.tan((viewportCamera.fov * THREE.MathUtils.DEG2RAD) / 2);
    const halfWidth = halfHeight * viewportAspect;

    // Inscribed in the viewport frame: the export frame is width-limited when it is relatively
    // wider, height-limited otherwise, so only the overflowing axis shrinks.
    const guideHalfHeight = this.aspect >= viewportAspect ? halfWidth / this.aspect : halfHeight;
    const guideHalfWidth = guideHalfHeight * this.aspect;

    this.guide.quaternion.copy(viewportCamera.quaternion);
    this.guide.position
      .copy(viewportCamera.position)
      .addScaledVector(_forward.set(0, 0, -1).applyQuaternion(viewportCamera.quaternion), distance);
    this.guide.scale.set(guideHalfWidth * 2, guideHalfHeight * 2, 1);
  }

  /**
   * Records the follow lock. The viewport then shows the export framing itself and the guide would be
   * redundant, so it is hidden until the lock is released; the composition root owns copying the
   * output camera's transform onto the viewport camera and disabling navigation.
   */
  followOutputCamera(enabled: boolean): void {
    this.following = enabled;
    this.guide.visible = !enabled && this.visible;
  }

  dispose(): void {
    this.guide.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}

function requireAspect(aspect: number): void {
  if (!Number.isFinite(aspect) || aspect <= 0) {
    throw new RangeError(`OutputPreview: aspect must be a finite positive number, got ${aspect}`);
  }
}
