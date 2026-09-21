# src/three-runtime/controls.ts

Ring: 2 · Layer: three-runtime · Depends on: `three`, `three/addons/controls/OrbitControls.js`, `three/addons/controls/TransformControls.js`

## Responsibility
Wraps viewport navigation (`OrbitControls`) and the edit gizmo (`TransformControls`) behind one object, and provides the `OutputPreview` guide frame for the export aspect. It owns interaction state only: it reads no voxel data, writes nothing to the document, and never renders. Navigation follows the viewport camera by default and can be handed to another camera with `setOrbitTarget`; `onOrbitChange` reports every camera move navigation caused, which is how the app learns where the user aimed the output camera. `gizmoBusy()` reports whether the gizmo currently owns the pointer, which is how the pointer layer knows a press belongs to the gizmo and not to it.

## Public interface
```ts
class ViewportControls {
  constructor(domElement: HTMLElement, camera: THREE.PerspectiveCamera);
  readonly orbit: OrbitControls;
  attachGizmo(object: THREE.Object3D, mode: 'translate' | 'rotate' | 'scale'): void;
  detachGizmo(): void;
  gizmoBusy(): boolean;                                // true while the gizmo owns the pointer
  onGizmoChange(cb: (matrix: THREE.Matrix4) => void): void;
  onGizmoCommit(cb: () => void): void;                 // pointer-up: when the edit is written back
  onOrbitChange(cb: () => void): void;                 // user navigation: real camera moves only
  setOrbitTarget(camera: THREE.PerspectiveCamera): void;  // hands navigation to another camera
  update(): void;
  dispose(): void;
}
class OutputPreview {
  constructor(opts: { aspect: number; visible: boolean });
  readonly guide: THREE.LineSegments;                  // export-aspect frame drawn in the viewport
  setAspect(aspect: number): void;
  setVisible(visible: boolean): void;
  update(viewportCamera: THREE.PerspectiveCamera): void;
  followOutputCamera(enabled: boolean): void;          // records the lock and hides the guide
  dispose(): void;
}
```

## Internal logic
1. Constructor: `new OrbitControls(camera, domElement)` with `mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN }`. Wheel zoom keeps working through OrbitControls' own wheel handler, and left-drag stays free for the box tool. Damping is enabled, so `update()` must be called once per frame. The controls navigate the **viewport** camera they were constructed with until `setOrbitTarget` hands them to another one.
2. `attachGizmo(object, mode)` lazily creates one `TransformControls(camera, domElement)`, reuses it afterwards, attaches `object`, sets `mode`, and adds its helper to the scene that owns `object` — the root found by walking `object.parent` upward. A root that is not a `THREE.Scene` throws `TypeError`, because an unattached helper would be invisible.
3. Live drag: the gizmo's `objectChange` event calls the change callback with `object.matrixWorld.clone()`; `dragging-changed` disables `orbit` while the pointer is down and re-enables it on release, so navigation never fights the gizmo.
4. Commit: the gizmo's `mouseUp` event calls the commit callback, which is the only place the document is written. One gesture therefore produces exactly one document write, at pointer-up; a drag that ends where it started still commits, because the mirrored node already holds the dragged transform.
5. `gizmoBusy()` answers whether the gizmo owns the pointer: `true` while `TransformControls.dragging` is set, or while its `axis` is not `null` — the handle the pointer rests on, which three's own `pointerHover` writes on every `pointermove` and clears to `null` when no handle is under the pointer. It is `false` when no gizmo exists yet, when nothing is attached (`detachGizmo` clears `axis` too), and when the gizmo is `enabled === false`. This is the claim test the pointer layer is given, because capture is *not* one: three's `onPointerDown` calls `setPointerCapture` on the shared element on **every** press, hit or miss, so a captured pointer says nothing about which layer owns the gesture (README D24). A press over a handle is already visible here before the press is handled, since `axis` is set by the hover that preceded it.
6. `onOrbitChange(cb)` adds the callback to a set, so every registration is kept and the last one does *not* win, unlike the two gizmo slots. The callbacks fire from `OrbitControls`' own `change` event, which it dispatches only when the camera really moved — position, orientation, target, or zoom beyond its epsilon — so a frame in which nothing moved, including every programmatic `update()` call, calls none of them, and a registered callback is only reached on the next real orbit, pan, or zoom.
7. `setOrbitTarget(camera)` assigns `orbit.object` and calls `update()`: this is what hands navigation to another camera, and the camera is left exactly as it was — the update rebuilds its current offset and looks at a pivot straight ahead. The pivot is only moved when the new camera sits on it, where the orbit radius is zero and neither rotation nor dolly would do anything at all (the output camera starts on the pivot, from the project's default identity camera transform). It then goes to the point that camera already looks at, at the distance the previous camera orbited from, which is the scene scale the user was already navigating at.
8. `onGizmoChange` and `onGizmoCommit` each fill one slot; the last registration wins, since the composition root wires them once at startup. `detachGizmo()` detaches and removes the helper, and is a no-op when nothing is attached.
9. `OutputPreview` construction builds `guide = new THREE.LineSegments(edgeSquare, lineMaterial)` — a flat unit square outline with `frustumCulled = false`, `depthTest = false`, a high `renderOrder`, and `layers.set(1)`. It never obscures geometry, is invisible to the picker (which tests layer 0 only), and never reaches an exported frame.
10. `update(viewportCamera)` places the guide at the camera's near plane, copies the camera's quaternion, and scales it so the outline is exactly the export-aspect rectangle inside the camera's frame. When the two aspects differ, only the longer axis shrinks, so the frame always marks the crop precisely; `setAspect` and `setVisible` only cache values, so a slider drag allocates nothing per frame.
11. `followOutputCamera(true)` records the lock and hides the guide, because the viewport then shows the export framing itself and the guide would be redundant; `followOutputCamera(false)` restores the guide according to the cached `visible` flag. Recording the flag is all this class does about the lock: the composition root enforces it by retargeting navigation with `setOrbitTarget(outputCamera)`, rendering the viewport through that camera, and writing the authored camera pose from `onOrbitChange`. `OutputPreview` owns no camera and copies nothing onto one.
12. `dispose()` detaches the gizmo, removes its helper, removes every listener it added (the orbit `change` listener included), clears the registered orbit callbacks, and disposes both control objects, leaving the `domElement` as it found it.

## Invariants
- Navigation uses the middle and right mouse buttons only; `OrbitControls` never consumes a left-drag.
- Navigation moves exactly one camera: the viewport camera until `setOrbitTarget` names another one, and whatever camera it names afterwards. `ViewportControls` writes nothing into the document and never renders.
- `setOrbitTarget` hands navigation over without moving the camera it is given; only the pivot moves, and only when a zero orbit radius would leave rotation and dolly inert.
- `onOrbitChange` callbacks run only for a camera move `OrbitControls` reports; `update()` in a frame where nothing moved calls none of them, and `dispose()` drops every registration and the listener.
- Exactly one document write per gizmo gesture, on pointer-up; the change callback is display-only.
- Between `objectChange` and commit the mirrored node holds the dragged transform, so the caller must commit (or mark the object dirty) on every pointer-up, otherwise the mirror and the document diverge.
- `guide` is on layer 1, so it is never picked and never captured.
- `gizmoBusy()` is `true` exactly while the gizmo owns the pointer — a drag in progress, or a handle under the pointer — and `false` before `attachGizmo`, after `detachGizmo`, and while the gizmo is disabled. It never reads pointer capture: `TransformControls` captures the pointer on every press regardless of what it hit, so capture cannot separate a gizmo gesture from a tool gesture.
- A left press with `gizmoBusy()` false is the active tool's, so a click on empty space still selects while the gizmo is attached; only a press that starts or continues on a handle is the gizmo's.
- `OutputPreview` owns no camera and no renderer, never renders, and never mutates the viewport camera.
- `update()` before `attachGizmo()` is legal and only advances navigation.

## Errors
- `attachGizmo` throws `TypeError` when the object's root is not a `THREE.Scene`.
- `setAspect` throws `RangeError` for a non-finite or non-positive aspect.
- `detachGizmo()`, `onGizmoChange`, and `onGizmoCommit` before any attachment are no-ops; interactively so, never silently wrong, because no change can be produced without an attached object.
- `gizmoBusy()` throws nothing and is legal at any time, including before any gizmo exists: no gizmo, no attachment, and a disabled gizmo all answer `false`.
- `onOrbitChange` and `setOrbitTarget` throw nothing and are legal at any time; retargeting to the camera already in use costs one `update()` and changes nothing else.

## Dependencies
- `three` — `PerspectiveCamera`, `Object3D`, `Matrix4`, `LineSegments`, `BufferGeometry`, `BufferAttribute`, `LineBasicMaterial`, `MOUSE`.
- `three/addons/controls/OrbitControls.js` — viewport navigation (README §3 addon map).
- `three/addons/controls/TransformControls.js` — the edit gizmo; neither is re-implemented. Its `dragging`, `axis`, and `enabled` state is what `gizmoBusy()` reads.
No outer-ring import: no editor session, no document, no UI.

## Tests
- No vitest file: both classes need a DOM element and pointer events, which the node test environment does not provide. Verified by running the app (README §10): middle/right navigation with left-drag free, one commit per gesture, a guide frame matching the export aspect, and the follow lock — with the lock on, middle/right navigation moves the output camera and a timeline `add` on the camera records the pose it was left at. Gesture ownership is checked in the same walk: with a `select` gizmo attached to the active object, a left click on a voxel must reach the tool and select the leaf or cell under the pointer, while a press that starts on a handle must move the object and change no voxels.
- The commit contract is instead pinned where it is observable: the tool layer that consumes `onGizmoCommit` writes the document once per drag.

## Open questions
- `OutputPreview` receives neither the output camera nor `ViewportControls`, so the follow lock is enforced by the composition root; taking the output camera in the constructor would make the feature self-contained and testable.
- The orbit pivot is one shared value for both cameras, and nothing ever centres it on the scene: the app leaves it at the world origin and `setOrbitTarget` only rescues the zero-radius case. A `setOrbitPivot(point)` member, or a pivot derived from the mirrored bounds, would let a lock in a scene far from the origin orbit that content instead of empty space.
- The brief fixes no overlay layer constant; layer 1 is stated here and in `overlay.md`, and both files must keep it equal.
- The interface exposes no query for "a gizmo is attached" distinct from `gizmoBusy()`; the pointer layer needs only the latter, and reads the document write through the `onGizmoChange`/`onGizmoCommit` slots, so no further gizmo state leaks out.
