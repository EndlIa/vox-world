/**
 * Viewport interaction.
 *
 * Wraps viewport navigation (`OrbitControls`) and the edit gizmo (`TransformControls`) behind one
 * object. It owns interaction state only: it reads no voxel data, writes nothing to the document, and
 * never renders.
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
/** Below this the camera sits on the orbit pivot, where rotation and dolly have no effect at all. */
const MIN_ORBIT_RADIUS = 1e-4;

/** Scratch view direction for `setOrbitTarget`, so retargeting allocates nothing. */
const _viewDirection = new THREE.Vector3();
/** Scratch for the drag mapping: `desired = pivotNow * pivotStart⁻¹ * nodeStart`. */
const _pivotStartInverse = new THREE.Matrix4();
/** Scratch for placing the pivot proxy, so attaching allocates nothing but the one proxy. */
const _pivotOffset = new THREE.Matrix4();

export class ViewportControls {
  readonly orbit: OrbitControls;

  private readonly camera: THREE.PerspectiveCamera;
  private readonly domElement: HTMLElement;
  private gizmo: TransformControls | null = null;
  /**
   * What `TransformControls` really drives: an empty child of the attached node, sitting at the local
   * point the caller asked the gizmo to pivot about. The node itself is never dragged, because a gizmo
   * drawn at a pivot away from the node's origin would otherwise move its own parent while measuring
   * itself against it, and the drag would feed on its own motion.
   */
  private pivot: THREE.Object3D | null = null;
  private attached: THREE.Object3D | null = null;
  /** World matrices at pointer-down — the pivot's and the node's — and the node matrix a drag derives. */
  private readonly pivotStart = new THREE.Matrix4();
  private readonly nodeStart = new THREE.Matrix4();
  private readonly nodeMatrix = new THREE.Matrix4();
  private changeCallback: ((matrix: THREE.Matrix4) => void) | null = null;
  private commitCallback: ((matrix: THREE.Matrix4) => void) | null = null;
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
   * Attaches the edit gizmo to one mirrored object, pivoting about `pivot`, a point in that object's own
   * local space — the content center its caller derives, so the handles sit on what the user edits
   * instead of at the node's origin, which is the payload's min corner (README D25, D37).
   *
   * The gizmo drives a pivot proxy rather than the node, because `TransformControls` draws its handles at
   * the attached object's own origin and writes a drag into that object's own transform: attaching the node
   * would draw the handles at that corner. The proxy is a scene-level object placed at the pivot, and what
   * the callbacks report is the node matrix the drag derives from the proxy's world-space delta — which the
   * caller applies live, so the object follows the pointer instead of jumping on release.
   *
   * The proxy deliberately does *not* hang under the object: a child proxy would be carried along by the
   * very motion the drag asks for, and because `TransformControls` measures its drag against the proxy's
   * parent, the object would run away from the pointer at twice the rate. A scene-level proxy is also what
   * keeps the handles under the pointer while the object moves beneath them.
   *
   * The gizmo is created on first use and reused afterwards; its helper goes into the scene that owns
   * the object, because a helper outside the scene graph would never be drawn.
   */
  attachGizmo(object: THREE.Object3D, mode: 'translate' | 'rotate' | 'scale', pivot: THREE.Vector3): void {
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

    let proxy = this.pivot;
    if (proxy === null) {
      proxy = new THREE.Object3D();
      this.pivot = proxy;
    }
    // The pivot in the object's own frame, as a world matrix: the proxy carries the object's current
    // rotation and scale, so a `local`-space gesture is oriented like the object's own frame is.
    object.updateWorldMatrix(true, false);
    proxy.matrix
      .copy(object.matrixWorld)
      .multiply(_pivotOffset.makeTranslation(pivot.x, pivot.y, pivot.z));
    proxy.matrix.decompose(proxy.position, proxy.quaternion, proxy.scale);
    if (proxy.parent !== root) root.add(proxy);

    this.gizmo.attach(proxy);
    this.gizmo.setMode(mode);
    this.attached = object;

    // The drag's reference frame, so a pointer-up that was not a drag reports the node's own matrix and a
    // commit is always the whole transform the gizmo shows; `handleDraggingChanged` records it again when
    // a drag really starts.
    this.captureDragStart();

    // The gizmo is viewport feedback like the overlay, so it lives on layer 1: the
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

  /** Detaches the gizmo and removes its helper and pivot proxy; a no-op when nothing is attached. */
  detachGizmo(): void {
    if (this.gizmo === null || this.attached === null) return;
    this.gizmo.detach();
    this.gizmo.getHelper().removeFromParent();
    this.pivot?.removeFromParent();
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

  /**
   * Live drag feedback: the node's world matrix the drag currently derives. Display only — the node's own
   * transform is not written until the caller commits that same matrix, and this is the matrix a commit
   * reports.
   */
  onGizmoChange(cb: (matrix: THREE.Matrix4) => void): void {
    this.changeCallback = cb;
  }

  /**
   * Pointer-up: the one moment a gesture is written to the document. The callback receives the node's
   * world matrix the drag derived, which is what the caller commits: the node is not the object the gizmo
   * moved, so the committed matrix cannot be read back out of the scene instead.
   */
  onGizmoCommit(cb: (matrix: THREE.Matrix4) => void): void {
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

  /**
   * Points the viewport at a pose, which is what `View -> Camera` means: the editor then looks at what the output
   * camera sees, so the authored shot can be judged against the scene. The orbit pivot goes to the point the pose
   * looks along, at the distance navigation already orbits from, so the first orbit after the jump behaves like any
   * other. A viewport is an orbit camera, so a bank the pose carries is not representable and `lookAt` drops it.
   */
  setViewFrom(position: THREE.Vector3, quaternion: THREE.Quaternion, target?: THREE.Vector3): void {
    const orbit = this.orbit;
    const radius = Math.max(orbit.object.position.distanceTo(orbit.target), MIN_ORBIT_RADIUS);
    orbit.object.position.copy(position);
    orbit.object.quaternion.copy(quaternion);
    if (target !== undefined) {
      // Restoring a view means restoring exactly where it was aimed, not a point straight ahead of it.
      orbit.target.copy(target);
    } else {
      _viewDirection.set(0, 0, -1).applyQuaternion(quaternion);
      orbit.target.copy(position).addScaledVector(_viewDirection, radius);
    }
    orbit.object.lookAt(orbit.target);
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
      this.pivot?.removeFromParent();
      this.pivot = null;
      this.attached = null;
    }
    this.orbit.removeEventListener('change', this.handleOrbitChange);
    this.orbitCallbacks.clear();
    this.orbit.dispose();
  }

  private readonly handleOrbitChange = (): void => {
    for (const callback of this.orbitCallbacks) callback();
  };

  /**
   * Maps the pivot's world-space delta onto the node: what the pointer did to the pivot, applied to the
   * node matrix the drag started from.
   *
   * `TransformControls` applies a drag from `pointerMove` and dispatches `objectChange` without refreshing
   * the world matrix, so the pivot's is refreshed here — the reported matrix must not lag the drag by a
   * frame. The pivot's own local offset cancels out of the delta, so no mode needs a special case: a
   * gesture moves the node by exactly what the pointer did, and where the pivot sits inside the object
   * changes only where the handles are drawn.
   */
  private readonly handleObjectChange = (): void => {
    const pivot = this.pivot;
    if (this.attached === null || pivot === null) return;
    pivot.updateWorldMatrix(true, false);
    const matrix = this.nodeMatrix
      .copy(pivot.matrixWorld)
      .multiply(_pivotStartInverse.copy(this.pivotStart).invert())
      .multiply(this.nodeStart);
    this.changeCallback?.(matrix.clone());
  };

  private readonly handleDraggingChanged = (event: { value: unknown }): void => {
    const dragging = event.value === true;
    this.orbit.enabled = !dragging;
    if (dragging) this.captureDragStart();
  };

  /** Records what one drag is measured from: the node matrix to derive, and the pivot's world matrix. */
  private captureDragStart(): void {
    const node = this.attached;
    const pivot = this.pivot;
    if (node === null || pivot === null) return;
    node.updateWorldMatrix(true, false);
    pivot.updateWorldMatrix(false, false);
    this.nodeStart.copy(node.matrixWorld);
    this.nodeMatrix.copy(node.matrixWorld);
    this.pivotStart.copy(pivot.matrixWorld);
  }

  private readonly handleMouseUp = (): void => {
    this.commitCallback?.(this.nodeMatrix.clone());
  };
}
