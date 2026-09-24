# src/three-runtime/controls.ts

Ring: 2 · Layer: three-runtime · Depends on: `three`, `three/addons/controls/OrbitControls.js`, `three/addons/controls/TransformControls.js`

## Responsibility
Wraps viewport navigation (`OrbitControls`) and the edit gizmo (`TransformControls`) behind one object. It owns interaction state only: it reads no voxel data, writes nothing to the document, and never renders. Navigation follows the viewport camera alone; `onOrbitChange` reports every camera move navigation caused, which is how a caller can follow the editor's own view. `gizmoBusy()` reports whether the gizmo currently owns the pointer, which is how the pointer layer knows a press belongs to the gizmo and not to it.

## Public interface
```ts
class ViewportControls {
  constructor(domElement: HTMLElement, camera: THREE.PerspectiveCamera);
  readonly orbit: OrbitControls;
  attachGizmo(object: THREE.Object3D, mode: 'translate' | 'rotate' | 'scale', pivot: THREE.Vector3): void;
  detachGizmo(): void;
  gizmoBusy(): boolean;                                // true while the gizmo owns the pointer
  onGizmoChange(cb: (matrix: THREE.Matrix4) => void): void;   // the node matrix the drag derives
  onGizmoCommit(cb: (matrix: THREE.Matrix4) => void): void;   // pointer-up: the matrix to write back
  onOrbitChange(cb: () => void): void;                 // user navigation: real camera moves only
  setViewFrom(position: THREE.Vector3, quaternion: THREE.Quaternion, target?: THREE.Vector3): void;   // points the viewport at a pose, at the pivot it is given
  update(): void;
  dispose(): void;
}
```

## Internal logic
1. Constructor: `new OrbitControls(camera, domElement)` with `mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN }`. Wheel zoom keeps working through OrbitControls' own wheel handler, and left-drag stays free for the box tool. Damping is enabled, so `update()` must be called once per frame. The controls always navigate the **viewport** camera they were constructed with: navigation is the editor's camera, and a clip or a field is what moves the output camera.
2. `attachGizmo(object, mode, pivot)` lazily creates one `TransformControls(camera, domElement)`, reuses it afterwards, sets `mode`, and adds its helper to the scene that owns `object` — the root found by walking `object.parent` upward. A root that is not a `THREE.Scene` throws `TypeError`, because an unattached helper would be invisible. It also records `object` as the attached node and places the pivot proxy: one reusable empty `Object3D`, added to that **scene root** rather than to the object, at `object.matrixWorld · T(pivot)` — the object's own rotation and scale included, so a `local`-space gesture is oriented like the object. The gizmo is attached to the proxy and never to the node (README D37): `TransformControls` draws its handles at the attached object's own origin and writes a drag into that object's own transform, so attaching the node would draw the handles at the node origin — the payload's min corner (README D25).
   The proxy is deliberately a sibling of the object and not its child: a child proxy would be carried along by the very motion a drag asks for, and because `TransformControls` measures its drag against the attached object's parent, the object would run away from the pointer at twice the rate. A scene-level proxy is also what keeps the handles under the pointer while the object moves beneath them.
3. That mapping is a world-space delta (see 5), so where the pivot sits inside the object changes only where the handles are drawn: a `translate` gesture takes the node exactly where the pointer went, and `rotate`/`scale` would turn and grow it about the content center instead of about the node origin. The attached node's own transform is never written here; the change callback is what carries the matrix out, and the caller applies it.
4. Live drag: the gizmo's `objectChange` event calls the change callback with the matrix the drag asks the node to take, and `dragging-changed` disables `orbit` while the pointer is down and re-enables it on release, so navigation never fights the gizmo. The `true` edge of `dragging-changed` also records the drag's reference frame — the node's world matrix and the proxy's, at the moment the gesture starts — so a drag is measured from where it began, not from the last frame.
5. The reported matrix is `pivotNow · pivotStart⁻¹ · nodeStart`: the delta `pivotNow · pivotStart⁻¹` is what the pointer did to the pivot in world space, composed with the node matrix the drag started from. The pivot's own local offset cancels out of that delta, which is what makes the derivation mode-agnostic — no mode is special-cased, and a node that is rotated or scaled keeps its rotation and scale while its position moves in world space. The pivot's world matrix is refreshed before it is read, because `TransformControls` applies a drag from `pointerMove` and dispatches `objectChange` without refreshing a world matrix itself.
6. Commit: the gizmo's `mouseUp` event calls the commit callback with that same matrix, and that is the one moment the caller writes the document. The matrix is handed over rather than read back out of the node, because the node is not what the gizmo moved; and the caller applies the same matrix to the scene during the drag, so the release only moves the write from the mirror to the document and nothing on screen moves. A drag that ends where it started still commits, with the matrix the node already had. The reference frame starts at the node's own world matrix, so a pointer-up that is not a drag reports the node unchanged rather than a stale gesture.
7. `gizmoBusy()` answers whether the gizmo owns the pointer: `true` while `TransformControls.dragging` is set, or while its `axis` is not `null` — the handle the pointer rests on, which three's own `pointerHover` writes on every `pointermove` and clears to `null` when no handle is under the pointer. It is `false` when no gizmo exists yet, when nothing is attached (`detachGizmo` clears `axis` too), and when the gizmo is `enabled === false`. This is the claim test the pointer layer is given, because capture is *not* one: three's `onPointerDown` calls `setPointerCapture` on the shared element on **every** press, hit or miss, so a captured pointer says nothing about which layer owns the gesture (README D24). A press over a handle is already visible here before the press is handled, since `axis` is set by the hover that preceded it.
8. `onOrbitChange(cb)` adds the callback to a set, so every registration is kept and the last one does *not* win, unlike the two gizmo slots. The callbacks fire from `OrbitControls`' own `change` event, which it dispatches only when the camera really moved — position, orientation, target, or zoom beyond its epsilon — so a frame in which nothing moved, including every programmatic `update()` call, calls none of them, and a registered callback is only reached on the next real orbit, pan, or zoom.
10. `setViewFrom(position, quaternion, target?)` points the viewport at a pose, which is what the app's `View -> Camera` means (README D46) and what its paused-frame handoff uses (README D48): it copies the pose onto `orbit.object` — the camera navigation drives — takes the radius navigation already orbits from (`max(orbit.object.position.distanceTo(orbit.target), MIN_ORBIT_RADIUS)`, so a viewport sitting on its own pivot still gets a usable one), puts `orbit.target` where the view is aimed, calls `orbit.object.lookAt(orbit.target)`, and then `orbit.update()`. Without a `target` the pivot is derived from the pose — the point it looks along, `position + forward · radius` (forward being `(0, 0, -1)` rotated by the quaternion) — and with one the pivot is that point verbatim, because restoring a view means restoring exactly where it was aimed rather than a point straight ahead of it (README D48). The `lookAt` is what makes the result an orbit pose rather than an arbitrary one — a bank the pose carries is not representable, so it is dropped — and `update()` rebuilds the offset and zoom state orbits and dollies work from, so the first orbit after the jump behaves like any other. It is the only path in this file that sets a camera pose directly rather than through user input, and it writes no project state, no document, and no flag; the pose and the target it is handed are plain vectors the caller owns, so it reads no document state either.
11. `onGizmoChange` and `onGizmoCommit` each fill one slot; the last registration wins, since the composition root wires them once at startup. `detachGizmo()` detaches and removes the helper, and is a no-op when nothing is attached.
12. `dispose()` detaches the gizmo, removes its helper, removes every listener it added (the orbit `change` listener included), clears the registered orbit callbacks, and disposes both control objects, leaving the `domElement` as it found it.

## Invariants
- Navigation uses the middle and right mouse buttons only; `OrbitControls` never consumes a left-drag.
- Navigation moves exactly one camera, the viewport camera it was constructed with. `ViewportControls` writes nothing into the document and never renders.
- `setViewFrom` keeps the viewport an orbit camera rather than an arbitrary one: it moves the camera onto the pose and puts the pivot where the pose is aimed — derived from the pose when no `target` is given, and taken verbatim when one is, because a restore has to land on exactly the aim it left (README D48) — so a bank the pose carries is dropped (it cannot be expressed) and the first orbit after the jump starts where the jump left off, at the radius the navigation already used. It reads and writes nothing the app owns: no document, no project, no flag, and the pose and target it is handed are the caller's own vectors (README D46, D48).
- `onOrbitChange` callbacks run only for a camera move `OrbitControls` reports; `update()` in a frame where nothing moved calls none of them, and `dispose()` drops every registration and the listener.
- Exactly one document write per gizmo gesture, on pointer-up. The change callback fires many times per gesture and
  writes no document: it is the live path, and the commit is the same matrix once the pointer is up.
- The gizmo is attached to the pivot proxy and the node is never dragged by it: the change callback carries the matrix the
  gesture asks for and the commit callback carries the same one, so a caller may apply it live, ignore it entirely, or
  apply it only on release, and in every case one gesture ends with either the whole transform or nothing.
- The proxy is a child of the scene, at the pivot, and of nothing else: `attachGizmo` re-places it, `detachGizmo` takes
  it out of the graph, and no attachment leaves more than one. Nothing is ever added under the attached object, which is
  what keeps the handles under the pointer while that object moves.
- A drag is measured from the reference frame the `dragging-changed` edge recorded: the reported matrix is
  `pivotNow · pivotStart⁻¹ · nodeStart`, which contains the whole gesture, and never an accumulation of per-move deltas.
- The pivot is presentation only: it decides where the handles are drawn and what a `rotate`/`scale` gesture turns about,
  and `translate` takes the node wherever the pointer went whatever the pivot is. Because the delta cancels the pivot
  out, a drag can never be amplified by the pivot being far from the node origin.
- `gizmoBusy()` is `true` exactly while the gizmo owns the pointer — a drag in progress, or a handle under the pointer — and `false` before `attachGizmo`, after `detachGizmo`, and while the gizmo is disabled. It never reads pointer capture: `TransformControls` captures the pointer on every press regardless of what it hit, so capture cannot separate a gizmo gesture from a tool gesture.
- A left press with `gizmoBusy()` false is the active tool's, so a click on empty space still selects while the gizmo is attached; only a press that starts or continues on a handle is the gizmo's.
- `update()` before `attachGizmo()` is legal and only advances navigation.

## Errors
- `attachGizmo` throws `TypeError` when the object's root is not a `THREE.Scene`.
- `attachGizmo` takes the pivot verbatim: it is a local-space point, neither validated nor clamped, so a caller that hands
  over a non-finite one gets handles it cannot reach. What it is given in practice comes from content bounds, which are
  finite or the origin.
- `detachGizmo()`, `onGizmoChange`, and `onGizmoCommit` before any attachment are no-ops; interactively so, never silently wrong, because no change can be produced without an attached object.
- `gizmoBusy()` throws nothing and is legal at any time, including before any gizmo exists: no gizmo, no attachment, and a disabled gizmo all answer `false`.
- `onOrbitChange` and `setViewFrom` throw nothing and are legal at any time; `setViewFrom` takes the pose it is given verbatim, deriving the pivot from it and the radius itself — or taking the `target` verbatim when one is handed in.

## Dependencies
- `three` — `PerspectiveCamera`, `Object3D`, `Vector3`, `Matrix4`, `MOUSE`.
- `three/addons/controls/OrbitControls.js` — viewport navigation (README §3 addon map).
- `three/addons/controls/TransformControls.js` — the edit gizmo; neither is re-implemented. Its `dragging`, `axis`, and `enabled` state is what `gizmoBusy()` reads.
No outer-ring import: no editor session, no document, no UI.

## Tests
- No vitest file: both classes need a DOM element and pointer events, which the node test environment does not provide. Verified by running the app (README §10): middle/right navigation with left-drag free, one commit per gesture, and the follow lock — with the lock on, middle/right navigation moves the output camera and a timeline `add` on the camera records the pose it was left at. Gesture ownership is checked in the same walk: with a `select` gizmo attached to the active object, a left click on a voxel must reach the tool and select the cell under the pointer, while a press that starts on a handle must move the object and change no voxels.
- The commit contract is instead pinned where it is observable: the tool layer that consumes `onGizmoCommit` writes the
  document once per drag.
- `setViewFrom` has no vitest coverage either, for the same DOM reason; it is verified in the app walk (README D46): pressing `View -> Camera` must put the viewport on the authored pose and write nothing — the `Camera` group's numeric fields and an exported frame are unchanged — and a middle-drag afterwards must orbit that shot rather than jump, with an authored bank arriving dropped because an orbit camera cannot represent it. The optional `target` is walked by the follow flow (README D48): the view a pause hands over, and the view a non-looping end puts back, must be aimed exactly where the run started aiming, with the document untouched.
- The pivot, the mapping, and the live path were verified by running the app on the boot demo cube (README D37), measured
  on screenshots: with a content-center pivot the handles are drawn over the middle of the cube — the Z handle hidden
  inside it — while the same build handed a zero pivot draws them at the payload's min corner, which is the old
  behaviour; while the button is still down, the cube has already moved and sits exactly where it lands after the
  release, which is what rules out the running-away-at-twice-the-rate failure a child proxy would produce; dragging the X
  handle 120 px right commits `-1.000` → `-0.207` on `position.x` with `y` and `z` untouched, as a timeline `position`
  keyframe readout shows; and the handles move with the cube across that commit, which is the rebuild re-attachment of
  `main`'s loop rather than a frozen helper.

## Open questions
- The orbit pivot is one shared value and nothing ever centres it on the scene: the app leaves it at the world origin, and `View -> Camera` moves it to the point the pose looks along. A `setOrbitPivot(point)` member, or a pivot derived from the mirrored bounds, would let navigation in a scene far from the origin orbit that content instead of empty space.
- The brief fixes no overlay layer constant; layer 1 is stated here and in `overlay.md`, and both files must keep it equal.
- The interface exposes no query for "a gizmo is attached" distinct from `gizmoBusy()`; the pointer layer needs only the latter, and reads the document write through the `onGizmoChange`/`onGizmoCommit` slots, so no further gizmo state leaks out.
