# src/document/project.ts

Ring: 1 · Layer: document · Depends on: ../voxels/uniform/grid.js, ../voxels/octree/octree.js, ./timeline.js, three

## Responsibility
Owns the project truth: object records, identity, hierarchy, transforms, representation binding, mask colors, camera and project settings, and the single `Timeline` instance. It is not a voxel container, not the Three.js scene mirror, and not a serializer — payloads are handed in and held by reference.

## Public interface
```ts
type ObjectId = string;                                  // 'obj-<n>', allocated only here
type Transform = { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 };
type Representation = 'empty' | 'uniform' | 'octree';
type SceneObject = {
  id: ObjectId; name: string; parentId: ObjectId | null;
  transform: Transform; representation: Representation;
  uniform?: UniformGrid; octree?: Octree;
  maskColor: HexColor; visible: boolean;
};
type CameraSettings = { fov: number; near: number; far: number; transform: Transform };
type ProjectSettings = { background: HexColor; ambientIntensity: number };

class Project {
  readonly objects: Map<ObjectId, SceneObject>;
  readonly camera: CameraSettings;
  readonly settings: ProjectSettings;
  readonly timeline: Timeline;
  allocateId(): ObjectId;
  createObject(init: { name: string; parentId?: ObjectId | null; representation: 'empty' }): SceneObject;
  createVoxelObject(init: { name: string; parentId?: ObjectId | null; maskColor: HexColor;
    payload: { kind: 'uniform'; grid: UniformGrid } | { kind: 'octree'; octree: Octree };
    position: THREE.Vector3 }): SceneObject;
  setPayload(id: ObjectId, payload: { kind: 'uniform'; grid: UniformGrid } |
    { kind: 'octree'; octree: Octree } | undefined): void;   // the only way representation changes
  get(id: ObjectId): SceneObject | undefined;
  remove(id: ObjectId): void;                 // children are reparented to the removed node's parent
  reparent(id: ObjectId, parentId: ObjectId | null): { ok: true } | { ok: false; error: 'missing' | 'cycle' };
  roots(): SceneObject[];
  childrenOf(id: ObjectId): SceneObject[];
  worldMatrix(id: ObjectId): THREE.Matrix4;
  nextMaskColor(): HexColor;                  // palette walk, deterministic
}
```
`new Project()` takes no arguments: an empty object map, an identity-transform camera, default settings (background, ambient intensity), an empty timeline with `duration: 0`, which the app sets on load.

## Internal logic
1. Fields: `objects`, `camera`, `settings`, `timeline`, a monotonic `nextId` counter, and a `maskCursor` index. `objects` is a `Map`, so iteration order is insertion order — the deterministic order of `roots()` and `childrenOf()`.
2. `allocateId()` returns `` `obj-${this.nextId++}` ``. The counter is never decremented and the map is never consulted, so ids stay unique after `remove`.
3. `createObject` allocates an id, builds an identity transform (`Vector3(0,0,0)`, identity `Quaternion`, `Vector3(1,1,1)`), sets `representation: 'empty'`, takes `maskColor` from `nextMaskColor()`, `visible: true`, and inserts. An unknown `parentId` throws `RangeError` before insertion.
4. `createVoxelObject` does the same but sets `representation` from `payload.kind`, stores the payload in `uniform` or `octree` (the other stays `undefined`), uses the caller's `maskColor`, and writes a translation-only transform: `position` as given, identity quaternion, unit scale. Voxel coordinates therefore stay in the payload's own space; rotation and scale of an imported node are already baked into the payload by `voxelize`.
5. `setPayload(id, payload)` is the only mutator that writes `representation` and the payload fields. A uniform payload sets `uniform`, clears `octree`, and derives `representation: 'uniform'`; an octree payload is the mirror image; `undefined` clears both and returns the object to `representation: 'empty'`. It writes nothing else — `transform`, `name`, `parentId`, `maskColor`, and `visible` are untouched — and it does not mark anything dirty: the caller (import → voxelize attach, editor ops) tells the mirror, per-object `dirty` (D4).
6. `remove(id)` walks the map once and rewrites `parentId` of every direct child to the removed object's `parentId`, deletes the entry, then calls `removeTracksFor(timeline, id)` so no track targets a dead object. Subtree geometry is not touched.
7. `reparent` validates `id` and, when non-null, `parentId` against the map (`'missing'`), then walks the candidate parent's ancestor chain: reaching `id` means the move would close a cycle, so it returns `'cycle'` and leaves `parentId` untouched. Only after that does it assign.
8. `worldMatrix(id)` walks the parent chain to the root, collecting the chain, then folds `Matrix4.compose(position, quaternion, scale)` from the root down (`out.multiply(local)`), yielding `M_root · … · M_parent · M_local`. One `Matrix4` and O(depth) temporaries per call; nothing is cached because transforms are mutable value objects and the mirror owns invalidation (D4).
9. `nextMaskColor()` returns `PALETTE[this.maskCursor++ % PALETTE.length]` from a module-level frozen palette of 12 distinct `0xRRGGBB` values. The walk is a plain increment, so two fresh `Project`s produce the same sequence and colors stay stable for the project's lifetime.

## Invariants
- `objects` keys equal `SceneObject.id`; ids match `obj-<n>`, are unique, and are never reused, even after `remove`.
- The hierarchy is a forest: `parentId` is `null` or an existing id, exactly one parent per object, no cycles at any time.
- `representation` binds exactly one payload: `'empty'` has neither `uniform` nor `octree`; `'uniform'` has `uniform` and no `octree`; `'octree'` the reverse. `setPayload` is the only mutator that changes `representation`, and the invariant holds after every call.
- `setPayload` leaves `transform`, `name`, `parentId`, `maskColor`, and `visible` byte-identical, so attaching a payload to an `'empty'` placeholder never moves, renames, or recolors an object an importer already placed; the caller marks the object dirty for the mirror afterwards (D4).
- `maskColor` is assigned once at creation from the palette walk, is independent of cell colors, and is never derived from object order at export time (D11).
- `timeline` is one instance for the project's lifetime; mutators mutate it in place, so holding `project.timeline` stays valid.
- Every object created here has `visible: true`; `visible` gates rendering only and never changes occupancy.
- Objects, transforms, and payloads are plain records and typed arrays plus Three.js *value* types — no `Mesh`, `Object3D`, or scene reference is stored (D1).
- `worldMatrix(id)` for a root equals its own composed local matrix; for a child it equals the parent chain product.

## Errors
- `reparent` returns `{ ok: false, error: 'missing' }` for an unknown `id` or an unknown non-null `parentId`, and `{ ok: false, error: 'cycle' }` when the candidate parent is the object or a descendant. Both leave state unchanged.
- `createObject`, `createVoxelObject`, `setPayload`, and `worldMatrix` throw `RangeError` on an unknown `parentId`/`id`: callers pass ids obtained from this project, so this is a programmer error, not a user-facing result. `setPayload` validates before writing, so a failed call leaves the payload untouched.
- `remove(unknownId)` is a no-op.
- `createObject` cannot be called with a voxel representation — the parameter type admits only `'empty'`.

## Dependencies
- `../voxels/uniform/grid.js` — `UniformGrid` payload type and `HexColor`.
- `../voxels/octree/octree.js` — `Octree` payload type.
- `./timeline.js` — `Timeline` type and `removeTracksFor` on deletion. `timeline.ts` imports `ObjectId` from here type-only, so the value dependency stays one-way (`document/project → document/timeline`) and no runtime cycle exists.
- `three` — `Vector3`, `Quaternion`, `Matrix4` for transforms; allowed in ring 1 (D1).

## Tests
- `tests/detach.test.ts` — pinned indirectly: a detached object inherits the source's `parentId`, gets a fresh palette color, and a fresh reusable id; `worldMatrix` of a root object equals its translation.
- The import → voxelize flow is the caller of `setPayload` (an `'empty'` placeholder receives its payload); the brief's test list covers it only through the voxelize and detach suites, not by a direct unit test.
- No dedicated `tests/project.test.ts` is listed in the brief; hierarchy and id-reuse coverage is only indirect (see Open questions).

## Open questions
- `remove` on an unknown id is specified here as a no-op; if the editor prefers a hard failure the `OpResult`-producing layer must check existence first. To be confirmed with `editor/ops.ts`.
- The brief's test list has no `tests/project.test.ts`. Id reuse after deletion, `'cycle'` refusal, and child reparenting on `remove` are invariant-level behaviors worth a direct test file; decide whether to add one.
