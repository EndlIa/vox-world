# src/three-runtime/picking.ts

Ring: 2 · Layer: three-runtime · Depends on: `./scene.js`, `../document/project.js`, `../voxels/uniform/grid.js`, `three`

## Responsibility
Turns a viewport pointer position into voxel identity by raycasting the mirrored meshes and resolving the hit's `instanceId` through `SceneMirror.lookupOf()`. The camera that rendered the viewport is a parameter, never the mirror's output camera (README D17). It never walks voxel data on the CPU (README D5), never mutates anything, and holds no state beyond a reused `Raycaster`. It also resolves a hit on an imported raw mesh — an object-level hit with no cell behind it — to the object that mesh was attached to, because a mesh that is the only thing on screen still has to be selectable (README D24). A hit carries the face it landed on as well as the point, so the two things a box drag needs — the cell and the face's normal — come off that one `pick`: there is no surface-only pick any more, because the drag addresses the cell the instance lookup named, while flooring a surface point named the cell past the face (see `editor/pointer.ts`).

## Public interface
```ts
type PickHit =
  | { kind: 'cell'; objectId: ObjectId; cell: [number, number, number]; color: HexColor;
      point: THREE.Vector3; normal: THREE.Vector3 | undefined }
  | { kind: 'object'; objectId: ObjectId; point: THREE.Vector3;
      normal: THREE.Vector3 | undefined };   // imported raw mesh, layer 2
class Picker {
  constructor(mirror: SceneMirror);
  pick(ndc: THREE.Vector2, camera: THREE.PerspectiveCamera): PickHit | undefined;
}
```
`ObjectId` comes from `document/project.js`, `HexColor` from `voxels/uniform/grid.js` (reached through `scene.js`); none is re-declared here. `normal` is the face the raycast hit, copied, in the object's own frame — `undefined` when the raycast reported no face for that hit.

## Internal logic
1. `raycaster.setFromCamera(ndc, camera)`, then `intersectObject(mirror.scene, true)`; Three.js refreshes world matrices on the way and returns hits sorted by distance per mesh. The camera is the one that rendered the viewport, so the pointer maps to the view the user sees; the mirror's own `camera` is the output camera and is never read here (README D17).
2. The raycaster tests layers 0 and 2 — voxel content and imported raw meshes — and never layer 1, where the viewport decorations and the transform gizmo live (README D24). Only hits with a resolvable owner count: `hit.object.userData.objectId` (written by `scene.ts`, on the object node, on every instance mesh, and on every attached source mesh) confirmed with `mirror.objectOf(id)`. Viewport decorations and the gizmo carry no such key and are on layer 1, so neither can be picked.
3. Instance resolution: `instanceId = hit.instanceId + (hit.object.userData.instanceBase ?? 0)`, then the owner's `CellLookup` resolves the hit. An owner without a lookup is skipped, never reported as an approximate hit; if no candidate resolves, the call returns `undefined`.
4. Cell hit: `cell = lookup.cells[instanceId]`, `color = lookup.colors[instanceId]`, `point = hit.point.clone()`, `normal = faceNormalOf(hit)`.
5. Object hit: a tagged hit with `instanceId === undefined` is an imported raw mesh, because every instance mesh the mirror builds is an `InstancedMesh`. It resolves to `{ kind: 'object', objectId, point: hit.point.clone(), normal: faceNormalOf(hit) }` — the mesh names its object and nothing finer, since it has no cells to name. The ray is not the only test: `Raycaster` never checks `visible`, so the hit counts only when its whole ancestor chain is visible, or a raw mesh the mirror just hid behind a payload would keep claiming every click on the voxels it produced.
6. `faceNormalOf(hit)` is the hit's own face normal, copied: `hit.face.normal.clone()`, or `undefined` when `hit.face` is absent. The raycast reports that normal in the frame the hit mesh is drawn in — the object's own frame, for a mirrored instance and for an attached source mesh alike — so a caller turns it into a world direction with the object's normal matrix rather than asking for another raycast.
7. `pick` sorts every resolved candidate with the fixed overlap order — the nearer hit first, then ascending `objectId`, then ascending `(x, y, z)`, — and returns the first, so the comparator is total, needs no geometry lookup, and the same ray always yields the same hit (README D5). A source-mesh candidate is ordered against a voxel candidate by distance alone: the raw mesh and the voxels it produced overlap by construction, so only the nearer surface may win the pick, and a voxel instance behind the raw mesh must not take it.
8. Allocation: `faceNormalOf` clones one `Vector3` per candidate that reports a face, and `pick` clones the winner's `point` and `normal` into its result; the `Raycaster` and its internals are reused across calls.

## Invariants
- The picker never reads `mirror.camera`: it asks the mirror only for `scene`, `objectOf`, and `lookupOf`, and every ray is built from the `camera` argument, so a pick always matches the view the user sees even while the viewport is not following the output camera. The caller passes the camera it rendered the viewport with, with an up-to-date projection matrix.
- No voxel container is read or walked: the only inputs are the mirror's scene, the lookup map, and the hit. Cell attributes come from the lookup, never from instance colors or geometry.
- `pick` is deterministic and mask-independent: for an identical ray and mirror state it returns the same hit, and `setMaskMode` cannot change a pick.
- A hit never crosses objects: `objectId`, `cell`, `point`, and `normal` all describe one object's instance, and an `'object'` hit describes one object's raw mesh.
- A hit only ever comes from a visible mesh: the layers test excludes layer-1 decorations, and the source-mesh arm additionally requires the whole ancestor chain to be visible, so a mesh the mirror hid (`setSourceVisible(false)` over a payload) is unreachable by picking.
- With a raw mesh and a voxel instance both under the ray, the nearer hit wins. A raw mesh therefore never hides the voxel surface in front of it, and a voxel never steals a click on the raw surface in front of it.
- A hit's `normal` is the face the raycast reported, copied and untransformed, in the object's own frame; it is `undefined` exactly when no face was reported — never a zero vector standing in for one — so a hit names the face it landed on without a second raycast.
- `pick` mutates neither the mirror, the scene, nor the document; it is safe to call on every pointer move.

## Errors
- `RangeError` when `ndc` has a non-finite component; other values are legal, because the pointer may sit outside the canvas.
- `TypeError` when `camera` is not a `THREE.PerspectiveCamera`.
- A miss returns `undefined` — never a fallback object, a zero cell, or a nearest-anything. An empty scene, an `empty` object with no attached raw mesh (it has no mesh at all then), a raw mesh the mirror hid, and a voxel object whose payload has no occupied content (zero instances) all yield `undefined`, so a click there selects and edits nothing.
- A hit with no face is not an error: its `normal` is `undefined`, and the box drag falls back to the camera's view direction to build its plane (see `editor/pointer.ts`).

## Dependencies
- `three` — `Raycaster`, `Vector2`, `Vector3`, `Object3D`, `InstancedMesh` (types), and `Intersection`/`Face` for `faceNormalOf`.
- `./scene.js` — `SceneMirror` and the `CellLookup` its `lookupOf` returns.
- `../document/project.js` — `ObjectId` (type only).
- `../voxels/uniform/grid.js` — `HexColor` (type only).
No outer-ring import: the picker does not know `EditorSession`, any tool, or the UI.

## Tests
- No `tests/*.test.ts` covers this file. The resolution rules were checked node-side with a throwaway `vitest` repro against a real `Project` and `SceneMirror`, no renderer and the mirror's output camera passed explicitly as the `camera` argument: a ray through a single uniform cell resolves to that cell and its color; with two overlapping uniform objects the fixed order picks the nearer hit, then the smaller `objectId`; an empty scene, an `empty` object, and a voxel object with no occupied cells all return `undefined`.
- The object arm is the same kind of check: a ray onto an attached raw mesh returns `{ kind: 'object' }` with the object id and the world hit point; once the object carries a uniform payload the hidden raw mesh yields the cell instead; with `setSourceVisible(true)` the nearer raw surface beats the voxel behind it; the raycaster never reaches layer 1. The one thing only a viewport can show — a click landing on the voxel surface in front of the raw mesh — is verified by running the application (README §10).
