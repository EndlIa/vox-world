# src/three-runtime/picking.ts

Ring: 2 · Layer: three-runtime · Depends on: `./scene.js`, `../document/project.js`, `../voxels/uniform/grid.js`, `three`

## Responsibility
Turns a viewport pointer position into voxel identity by raycasting the mirrored meshes and resolving the hit's `instanceId` through `SceneMirror.lookupOf()`. The camera that rendered the viewport is a parameter, never the mirror's output camera (README D17). It never walks voxel data on the CPU (README D5), never mutates anything, and holds no state beyond a reused `Raycaster`. It also resolves a hit on an imported raw mesh — an object-level hit with no cell or leaf behind it — to the object that mesh was attached to, because a mesh that is the only thing on screen still has to be selectable (README D24).

## Public interface
```ts
type PickHit =
  | { kind: 'leaf'; objectId: ObjectId; leafId: LeafId; depth: number; size: number;
      occupied: boolean; color: HexColor; point: THREE.Vector3 }
  | { kind: 'cell'; objectId: ObjectId; cell: [number, number, number]; color: HexColor;
      point: THREE.Vector3 }
  | { kind: 'object'; objectId: ObjectId; point: THREE.Vector3 };   // imported raw mesh, layer 2
type SurfaceHit = { objectId: ObjectId; pointWorld: THREE.Vector3; pointLocal: THREE.Vector3 };
class Picker {
  constructor(mirror: SceneMirror);
  pick(ndc: THREE.Vector2, camera: THREE.PerspectiveCamera): PickHit | undefined;
  pickSurface(ndc: THREE.Vector2, camera: THREE.PerspectiveCamera): SurfaceHit | undefined;
}
```
`ObjectId` comes from `document/project.js`, `LeafId` from `voxels/octree/leafId.js`, `HexColor` from `voxels/uniform/grid.js` (reached through `scene.js`); none is re-declared here.

## Internal logic
1. `raycaster.setFromCamera(ndc, camera)`, then `intersectObject(mirror.scene, true)`; Three.js refreshes world matrices on the way and returns hits sorted by distance per mesh. The camera is the one that rendered the viewport, so the pointer maps to the view the user sees; the mirror's own `camera` is the output camera and is never read here (README D17).
2. The raycaster tests layers 0 and 2 — voxel content and imported raw meshes — and never layer 1, where the viewport decorations and the transform gizmo live (README D24). Only hits with a resolvable owner count: `hit.object.userData.objectId` (written by `scene.ts`, on the object node, on every bucket mesh, and on every attached source mesh) confirmed with `mirror.objectOf(id)`. Viewport decorations and the gizmo carry no such key and are on layer 1, so neither can be picked.
3. Instance resolution: `instanceId = hit.instanceId + (hit.object.userData.instanceBase ?? 0)`, then the owner's lookup decides the payload kind — `CellLookup` for a uniform object, `LeafLookup` for an octree object. An owner without a lookup is skipped, never reported as an approximate hit; if no candidate resolves, the call returns `undefined`.
4. Cell hit: `cell = lookup.cells[instanceId]`, `color = lookup.colors[instanceId]`, `point = hit.point.clone()`.
5. Leaf hit: the lookup item carries everything — `leafId`, `depth`, `size`, `occupied`, and `color` — taken from the `Octree` when the mirror built the instances, so the HUD values never depend on mesh geometry, material state, or mask mode. `point = hit.point.clone()`.
6. Object hit: a tagged hit with `instanceId === undefined` is an imported raw mesh, because every instance mesh the mirror builds is an `InstancedMesh`. It resolves to `{ kind: 'object', objectId, point: hit.point.clone() }` — the mesh names its object and nothing finer, since it has no cells or leaves to name. The ray is not the only test: `Raycaster` never checks `visible`, so the hit counts only when its whole ancestor chain is visible, or a raw mesh the mirror just hid behind a payload would keep claiming every click on the voxels it produced.
7. `pick` sorts every resolved candidate with the fixed overlap order — deeper leaf `depth` first, then nearer hit distance, then ascending `LeafId` string — and returns the first. A cell hit ranks as depth 0, and two cell hits at equal distance are ordered by ascending `objectId`, then ascending `(x, y, z)`, so the comparator is total, needs no geometry lookup, and the same ray always yields the same hit (README D5). A source-mesh candidate is ordered against a voxel candidate by distance alone, with no depth rule between the two: the raw mesh and the voxels it produced overlap by construction, so only the nearer surface may win the pick, where depth alone would let a deep leaf behind the raw mesh take it.
8. `pickSurface` applies the same order, then returns `pointWorld = winner.point.clone()` and `pointLocal = ownerNode.worldToLocal(winner.point.clone())`. Object-local space is the cell space or the octree root box space, so the box drag does its own integer math there and no voxel is ever traversed here; an object hit returns its raw surface point in the same space, which is what the drag's `objectId` guard then refuses.
9. Allocation: one `Vector3` clone per returned hit, nothing per candidate; the `Raycaster` and its internals are reused across calls.

## Invariants
- The picker never reads `mirror.camera`: it asks the mirror only for `scene`, `objectOf`, and `lookupOf`, and every ray is built from the `camera` argument, so a pick always matches the view the user sees even while the viewport is not following the output camera. The caller passes the camera it rendered the viewport with, with an up-to-date projection matrix.
- No voxel container is read or walked: the only inputs are the mirror's scene, the lookup maps, and the hit. Leaf and cell attributes come from the lookup, never from instance colors or geometry.
- For identical ray and mirror state, `pick` and `pickSurface` return identical results, and `setMaskMode` cannot change a pick.
- A hit never crosses objects: `objectId`, `cell` or `leafId`, `depth`, `size`, and `point` all describe one object's instance, and an `'object'` hit describes one object's raw mesh.
- A hit only ever comes from a visible mesh: the layers test excludes layer-1 decorations, and the source-mesh arm additionally requires the whole ancestor chain to be visible, so a mesh the mirror hid (`setSourceVisible(false)` over a payload) is unreachable by picking.
- With a raw mesh and a voxel instance both under the ray, the nearer hit wins, and the depth rule decides only between two voxel candidates. A raw mesh therefore never hides the voxel surface in front of it, and a voxel never steals a click on the raw surface in front of it.
- `pointLocal` is in the owning object's local space — the same space as its uniform cell coordinates and its octree root box; for an object hit it is that object's raw-mesh space, which a payload shares because the mesh is attached with an identity local transform.
- Neither method mutates the mirror, the scene, or the document; both are safe to call every pointer move.

## Errors
- `RangeError` when `ndc` has a non-finite component; other values are legal, because the pointer may sit outside the canvas.
- `TypeError` when `camera` is not a `THREE.PerspectiveCamera`.
- A miss returns `undefined` — never a fallback object, a zero cell, or a nearest-anything. An empty scene, an `empty` object with no attached raw mesh (it has no mesh at all then), a raw mesh the mirror hid, and a voxel object whose payload has no occupied content (zero instances) all yield `undefined`, so a click there selects and edits nothing.
- `pickSurface` returns `undefined` on a miss; the box drag then has no anchor and the caller aborts the drag rather than inventing one.

## Dependencies
- `three` — `Raycaster`, `Vector2`, `Vector3`, `Object3D`, `InstancedMesh` (types).
- `./scene.js` — `SceneMirror`, `CellLookup`, `LeafLookup`, `LeafLookupItem`.
- `../document/project.js` — `ObjectId` (type only).
- `../voxels/uniform/grid.js` — `HexColor` (type only).
- `../voxels/octree/leafId.js` — `LeafId` (type only).
No outer-ring import: the picker does not know `EditorSession`, any tool, or the UI, and `decodeLeafId` is no longer needed because `depth` comes from the lookup.

## Tests
- `tests/picking.test.ts` (node environment; `Raycaster` against `InstancedMesh` is CPU-side, with the mirror's output camera passed explicitly as the `camera` argument): a ray through a single uniform cell resolves to that cell and its color; a ray through a split octree resolves to the deeper leaf with `depth`, `size`, `occupied`, and `color` equal to the source leaf's attrs; with two overlapping objects the fixed order picks the deeper leaf, then the nearer hit, then the smaller `LeafId`; `pickSurface` returns a world point on the surface and the matching local point; an empty scene, an `empty` object, and a voxel object with no occupied cells all return `undefined`.
- The object arm is checked node-side (a throwaway `vitest` repro against a real `Project`, `SceneMirror`, and `Octree`, no renderer): a ray onto an attached raw mesh returns `{ kind: 'object' }` with the object id and the world hit point; once the object carries an octree payload the hidden raw mesh yields the leaf instead; with `setSourceVisible(true)` the nearer raw surface beats the deeper leaf; the raycaster never reaches layer 1.
