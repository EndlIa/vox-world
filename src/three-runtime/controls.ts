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
 * Navigation follows the viewport camera alone and writes nothing: looking around is the editor's own business, and the
 * authored camera is moved by explicit commands instead (`Camera -> View`, the pose fields, a carrier drag).
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

/** The viewport decoration layer; `overlay.ts` uses the same number. */
const OVERLAY_LAYER = 1;
/** Below this the camera sits on the orbit pivot, where rotation and dolly have no effect at all. */
const MIN_ORBIT_RADIUS = 1e-4;

/**
 * A handle set the gizmo can draw. Three draws exactly one mode per `TransformControls`, so a set is one
 * instance of it, and a subject that wants two at once is given two.
 */
export type GizmoMode = 'translate' | 'rotate';

/**
 * The handle sets in the order they are built — which is also the order their press listeners run in, so it is
 * the order they are considered in when a press finds a handle of both. `translate` comes first because the
 * arrows sit inside the rings: where the two overlap, the inner region behaves as the arrows say.
 */
const GIZMO_MODES: readonly GizmoMode[] = ['translate', 'rotate'];

/**
 * The size each set is drawn at. `TransformControls.size` scales a helper, and two sets draw through the same
 * pivot, so the rings are drawn outside the arrows — but the separation is the *drawing's*, not the picking's:
 * the rotate pickers are tori of radius 0.4–0.6 gizmo units (×1.2 here) while the translate pickers are cones
 * that reach 0.6 units (×0.85 here), so just inside each arrowhead a press still finds a handle of both sets.
 * `handleSetDragging` is what keeps one press to one set there. The two sets also have to read as one object at
 * a glance, which is why the arrows are drawn a little under full size and the rings a little over: the gap
 * between an arrowhead and the ring it points at is what keeps the drawing from looking like two gizmos.
 */
const GIZMO_SIZE: Record<GizmoMode, number> = { translate: 0.85, rotate: 1.2 };

/**
 * The palette the handles are drawn in. The axes keep the hues everyone reads as X, Y, and Z, toned for a dark
 * viewport rather than three's fully saturated red, green, and blue, and the blue is lifted off the accent the
 * app paints a selected object with so a ring over that object is still a handle. The handle under the pointer
 * goes white rather than three's yellow, because yellow is already this app's colour for the selection outline,
 * which says *which subject* the gizmo is on: one colour saying two things reads as neither.
 */
const GIZMO_COLORS = { x: '#ff7b72', y: '#7ee787', z: '#7dd3fc', active: '#ffffff' } as const;

/** Scratch view direction for `setViewFrom`, so restoring a view allocates nothing. */
const _viewDirection = new THREE.Vector3();
/** Scratch for the drag mapping: `desired = pivotNow * pivotStart⁻¹ * nodeStart`. */
const _pivotStartInverse = new THREE.Matrix4();
/** Scratch for placing the pivot proxy, so attaching allocates nothing but the one proxy. */
const _pivotOffset = new THREE.Matrix4();

export class ViewportControls {
  readonly orbit: OrbitControls;

  private readonly camera: THREE.PerspectiveCamera;
  private readonly domElement: HTMLElement;
  /**
   * The handle sets, one `TransformControls` each, created with the controls and inert until attached. One
   * subject is attached at a time and takes the sets it asks for; `GIZMO_MODES` fixes the order they are
   * considered in, which is also the priority a press in an overlap between two of them takes.
   */
  private readonly gizmos: Record<GizmoMode, TransformControls>;
  /**
   * The `dragging-changed` backstop each set carries, held so `dispose` can remove the very listener it added.
   * It is per set because the listener has to know which set it is watching.
   */
  private readonly setDragging: Record<GizmoMode, (event: { value: unknown }) => void>;
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

  constructor(domElement: HTMLElement, camera: THREE.PerspectiveCamera) {
    this.domElement = domElement;
    this.camera = camera;

    // `OrbitControls` captures the camera's `up` as its orbit axis in its own constructor, so the axis is
    // whatever the caller set before this line: this world is Z-up, and `src/app/main.ts` sets
    // `camera.up = (0, 0, 1)` before building these controls. Nothing after this point can change it.
    this.orbit = new OrbitControls(camera, domElement);
    this.orbit.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
    this.orbit.enableDamping = true;

    // One `dragging-changed` backstop per handle set, created before the sets so that it is registered ahead of
    // every other listener on that edge: the app's own handler has to see the losing set already down (see
    // `handleSetDragging`).
    this.setDragging = {
      translate: (event) => this.handleSetDragging(event, 'translate'),
      rotate: (event) => this.handleSetDragging(event, 'rotate'),
    };
    this.gizmos = { translate: this.createHandleSet('translate'), rotate: this.createHandleSet('rotate') };
  }

  /**
   * One handle set: its own `TransformControls`, because three draws one mode per instance. It is inert until
   * something is attached to it, so building both up front costs nothing a session would notice, and it keeps
   * every caller free of "the set may not exist yet" — `attachGizmo` decides which sets a subject gets.
   *
   * The size and colours are the ones `GIZMO_SIZE` and `GIZMO_COLORS` name, and the rest of the listeners are
   * the same three callbacks for every set: a gesture is reported the same way whichever handle it started on.
   * The one exception is the first listener this adds — the `dragging-changed` backstop, which must run before
   * `handleDraggingChanged` so that a set this press does not belong to is already down when the app hears it.
   */
  private createHandleSet(mode: GizmoMode): TransformControls {
    const gizmo = new TransformControls(this.camera, this.domElement);
    gizmo.addEventListener('dragging-changed', this.setDragging[mode]);
    gizmo.addEventListener('objectChange', this.handleObjectChange);
    gizmo.addEventListener('dragging-changed', this.handleDraggingChanged);
    gizmo.addEventListener('mouseUp', this.handleMouseUp);
    gizmo.size = GIZMO_SIZE[mode];
    gizmo.setMode(mode);
    gizmo.setColors(GIZMO_COLORS.x, GIZMO_COLORS.y, GIZMO_COLORS.z, GIZMO_COLORS.active);
    return gizmo;
  }

  /**
   * Attaches the edit gizmo to one mirrored object, in the handle sets `modes` names, pivoting about `pivot` —
   * a point in that object's own local space, the content center its caller derives, so the handles sit on
   * what the user edits instead of at the node's origin, which is the payload's min corner. A caller that
   * wants rotation to be a handle rather than a mode to find asks for both sets. A set that is not asked for
   * this time leaves the scene, because the proxy is shared and a stale set would keep drawing handles for a
   * subject that has none.
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
   * Each set's helper goes into the scene that owns the object, because a helper outside the scene graph would
   * never be drawn.
   */
  attachGizmo(object: THREE.Object3D, modes: readonly GizmoMode[], pivot: THREE.Vector3): void {
    let root: THREE.Object3D = object;
    while (root.parent !== null) root = root.parent;
    if (!(root instanceof THREE.Scene)) {
      throw new TypeError('ViewportControls.attachGizmo: the object is not part of a THREE.Scene');
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

    for (const mode of GIZMO_MODES) {
      const gizmo = this.gizmos[mode];
      if (!modes.includes(mode)) {
        gizmo.detach();
        gizmo.getHelper().removeFromParent();
        continue;
      }
      gizmo.attach(proxy);

      // The gizmo is viewport feedback like the overlay, so it lives on layer 1: the picker's raycaster
      // and the export camera both test layer 0 only, so no handle can be picked or captured. Its own
      // handle raycasting reads the same layer, or the gizmo would stop responding to the pointer.
      const helper = gizmo.getHelper();
      helper.traverse((child) => {
        child.layers.set(OVERLAY_LAYER);
      });
      gizmo.getRaycaster().layers.set(OVERLAY_LAYER);
      root.add(helper);
    }

    this.attached = object;

    // The drag's reference frame, so a pointer-up that was not a drag reports the node's own matrix and a
    // commit is always the whole transform the gizmo shows; `handleDraggingChanged` records it again when
    // a drag really starts.
    this.captureDragStart();
  }

  /** Detaches every handle set and removes their helpers and the pivot proxy; a no-op when nothing is attached. */
  detachGizmo(): void {
    if (this.attached === null) return;
    for (const mode of GIZMO_MODES) {
      const gizmo = this.gizmos[mode];
      gizmo.detach();
      gizmo.getHelper().removeFromParent();
    }
    this.pivot?.removeFromParent();
    this.attached = null;
  }

  /**
   * Whether the gizmo owns the pointer right now: it is dragging, or the pointer rests on one of its
   * handles, which three reports as a non-null `axis`. Any set counts — a subject may carry two.
   *
   * The pointer layer asks this instead of reading `hasPointerCapture`: `TransformControls` captures
   * the pointer on *every* press, hit or miss, so a capture is not a claim on the gesture — only the
   * gizmo's own dragging/hover state is. No gizmo yet, nothing attached, or a disabled gizmo owns
   * nothing, and every press then belongs to the active tool.
   */
  gizmoBusy(): boolean {
    if (this.attached === null) return false;
    for (const mode of GIZMO_MODES) {
      const gizmo = this.gizmos[mode];
      if (gizmo.enabled && (gizmo.dragging || gizmo.axis !== null)) return true;
    }
    return false;
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
    for (const mode of GIZMO_MODES) {
      const gizmo = this.gizmos[mode];
      gizmo.removeEventListener('dragging-changed', this.setDragging[mode]);
      gizmo.removeEventListener('objectChange', this.handleObjectChange);
      gizmo.removeEventListener('dragging-changed', this.handleDraggingChanged);
      gizmo.removeEventListener('mouseUp', this.handleMouseUp);
      gizmo.detach();
      gizmo.getHelper().removeFromParent();
      gizmo.dispose();
    }
    this.pivot?.removeFromParent();
    this.pivot = null;
    this.attached = null;
    this.orbit.dispose();
  }

  /**
   * Keeps one press to one handle set. Two sets can find a handle under the same press: the rotate pickers are
   * tori of radius 0.4–0.6 gizmo units and the translate pickers are cones reaching 0.6, so just inside an
   * arrowhead a press is inside a ring's band too. Each instance raycasts its own pickers and starts its own
   * drag off that press, which would move *and* turn the pivot from one gesture and commit twice, once per set.
   * So the first set to start keeps the gesture and a set that starts while another is already dragging is put
   * straight back down, on its own `dragging-changed` edge and before its drag has produced anything: no
   * `pointerMove` of the loser can apply, and its pointer-up finds `dragging` false and `axis` null, so it
   * dispatches no `mouseUp` and no second document write. The hover goes down with the drag, because a set that
   * may not act must not report a handle either.
   *
   * The winner is therefore the first set whose handles the press finds, which is `GIZMO_MODES` order, because
   * that is the order the sets are built — and thus the order their own press listeners were added in.
   */
  private readonly handleSetDragging = (event: { value: unknown }, mode: GizmoMode): void => {
    if (event.value !== true) return;
    const gizmo = this.gizmos[mode];
    for (const other of GIZMO_MODES) {
      if (other === mode || !this.gizmos[other].dragging) continue;
      gizmo.dragging = false;
      gizmo.axis = null;
      return;
    }
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
