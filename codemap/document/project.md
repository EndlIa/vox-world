# src/document/project.ts

Ring: 1 · Layer: document · Depends on: ../voxels/uniform/grid.js, ./timeline.js, three

## Responsibility
Owns the project truth: object records, identity, hierarchy, transforms, representation binding, mask colors, camera and project settings, the single `Timeline` instance, and the two minters (`nextId`, `maskCursor`) that keep identity unique. It exposes that truth as plain data (`snapshot`) and takes it back in place (`restore`), so a load never replaces an instance a mirror, a mixer, or the editor already holds. It is not a voxel container and not the Three.js scene mirror; it is not a serializer either — the file format, the cell codec, and the file-facing validation live in `./serialize.js` (README D51) — and payloads are handed in and held by reference.

## Public interface
```ts
type ObjectId = string;                                  // 'obj-<n>', allocated only here
type Transform = { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 };
type Representation = 'empty' | 'uniform';
type SceneObject = {
  id: ObjectId; name: string; parentId: ObjectId | null;
  transform: Transform; representation: Representation;
  uniform?: UniformGrid;
  maskColor: HexColor; visible: boolean;
  alignToGrid: boolean;                       // the placement holds whole cells of its own grid while set; set at creation from that placement (D42)
};
type CameraSettings = { fov: number; near: number; far: number; transform: Transform };
type ProjectSettings = { background: HexColor; ambientIntensity: number };
type ProjectCounters = { nextId: number; maskCursor: number };   // the minters, saved so a restore re-mints nothing
type ProjectData = {                                             // the project as plain data: what a file carries of it
  objects: SceneObject[];                                        // in `objects` insertion order
  camera: CameraSettings;
  settings: ProjectSettings;
  timeline: Timeline;
  counters: ProjectCounters;
};

class Project {
  readonly objects: Map<ObjectId, SceneObject>;
  readonly camera: CameraSettings;
  readonly settings: ProjectSettings;
  readonly timeline: Timeline;
  allocateId(): ObjectId;
  createObject(init: { name: string; parentId?: ObjectId | null; representation: 'empty' }): SceneObject;
  createVoxelObject(init: { name: string; parentId?: ObjectId | null; maskColor: HexColor;
    payload: { kind: 'uniform'; grid: UniformGrid };
    position: THREE.Vector3 }): SceneObject;  // alignToGrid set iff `position` is whole cells of that grid (D42)
  setPayload(id: ObjectId, payload: { kind: 'uniform'; grid: UniformGrid } | undefined): void;   // the only way representation changes
  get(id: ObjectId): SceneObject | undefined;
  remove(id: ObjectId): void;                 // children are reparented to the removed node's parent
  reparent(id: ObjectId, parentId: ObjectId | null): { ok: true } | { ok: false; error: 'missing' | 'cycle' };
  roots(): SceneObject[];
  childrenOf(id: ObjectId): SceneObject[];
  worldMatrix(id: ObjectId): THREE.Matrix4;
  alignedPosition(id: ObjectId, position: THREE.Vector3): THREE.Vector3;   // nearest whole cell of its own grid per axis while the object aligns
  keyframePosition(target: TrackTarget, position: THREE.Vector3): THREE.Vector3;   // the placement a keyframe may store
  alignWorldMatrix(id: ObjectId, matrix: THREE.Matrix4): THREE.Matrix4;    // the same rule in the object's own frame
  nextMaskColor(): HexColor;                  // palette walk, deterministic
  snapshot(): ProjectData;                    // reads; records are copied, payload grids are shared
  restore(data: ProjectData): void;           // the only writer of objects, camera, settings, timeline, and the counters
}
function isObjectId(value: unknown): value is ObjectId;   // the one `obj-<n>` shape, shared with ./serialize.js
```
`new Project()` takes no arguments: an empty object map, an identity-transform camera, default settings (`background: 0x3d4250`, ambient intensity `1`), an empty timeline with `durationMs: 0`, which the app sets on load. The background is the scene's clear color and therefore the color of every exported frame, so its one definition is here rather than in the stylesheet: `index.html` mirrors the same value as `--scene`, which only makes the page behind the canvas match, and the previous project's editor uses the same slate (its `COL_SCENE_BG`, read from its own `--scene`).

## Internal logic
1. Fields: `objects`, `camera`, `settings`, `timeline`, a monotonic `nextId` counter, and a `maskCursor` index. `objects` is a `Map`, so iteration order is insertion order — the deterministic order of `roots()` and `childrenOf()`.
2. `allocateId()` returns `` `obj-${this.nextId++}` ``. The counter is never decremented and the map is never consulted, so ids stay unique after `remove`.
3. `createObject` allocates an id, builds an identity transform (`Vector3(0,0,0)`, identity `Quaternion`, `Vector3(1,1,1)`), sets `representation: 'empty'`, takes `maskColor` from `nextMaskColor()`, `visible: true`, sets `alignToGrid: true` (D42), and inserts. An unknown `parentId` throws `RangeError` before insertion.
4. `createVoxelObject` does the same, with one difference in the flag — it takes `alignToGrid` from the module-private `isOnLattice(position, cell)` instead of a literal, where `cell` is the payload grid's own `cellSize` and the check is that all three components are whole multiples of it (`Number.isInteger(position.x / cell)` and likewise for `y` and `z`) — and otherwise sets `representation` from `payload.kind`, stores `payload.grid` in `uniform`, uses the caller's `maskColor`, and writes a translation-only transform: `position` as given, identity quaternion, unit scale. Voxel coordinates therefore stay in the payload's own space; rotation and scale of an imported node are already baked into the payload by `voxelize`. A voxel object is therefore created aligned when the placement it was handed is already whole cells *of its own grid* and unaligned when it is not, because snapping it would move content a caller placed between cells on purpose — detach's world preservation (D23) is the caller that does.
5. `setPayload(id, payload)` is the only mutator that writes `representation` and the payload field. A payload sets `uniform` and `representation: 'uniform'`; `undefined` clears `uniform` and returns the object to `representation: 'empty'`. It writes nothing else — `transform`, `name`, `parentId`, `maskColor`, `visible`, and `alignToGrid` are untouched — and it does not mark anything dirty: the caller (import → voxelize attach, editor ops) tells the mirror, per-object `dirty` (D4).
6. `remove(id)` walks the map once and rewrites `parentId` of every direct child to the removed object's `parentId`, deletes the entry, then calls `removeTracksFor(timeline, id)` so no track targets a dead object. Subtree geometry is not touched.
7. `reparent` validates `id` and, when non-null, `parentId` against the map (`'missing'`), then walks the candidate parent's ancestor chain: reaching `id` means the move would close a cycle, so it returns `'cycle'` and leaves `parentId` untouched. Only after that does it assign.
8. `worldMatrix(id)` walks the parent chain to the root, collecting the chain, then folds `Matrix4.compose(position, quaternion, scale)` from the root down (`out.multiply(local)`), yielding `M_root · … · M_parent · M_local`. One `Matrix4` and O(depth) temporaries per call; nothing is cached because transforms are mutable value objects and the mirror owns invalidation (D4).
9. `alignedPosition(id, position)` is where the lattice rule lives (D42, D43): for an id that resolves to an object with `alignToGrid` set it reads that object's own cell — `object.uniform?.cellSize ?? CELL_SIZE`, so an aligned object with no payload still snaps to the world unit — and returns `Vector3(Math.round(position.x / cell) * cell, …)` per axis. Rounding to the object's own cell is what puts its voxels on the world grid whatever level its grid carries: a subdivision-1 object lands on whole units, a `create(4)` one on quarter units. An unaligned object and an unknown id get `position.clone()`, so a caller can route every placement write through here without testing the flag itself; the argument is never mutated and the result is always a fresh vector.
10. `keyframePosition(target, position)` is that rule for authoring (D42): an `'object'` target goes through `alignedPosition(target.objectId, position)`, so everything a track holds is whole cells of that object's own grid, while every other target — the camera — gets `position.clone()`, because a viewpoint is not voxel content and a camera confined to whole cells could not frame anything. Snapping the *sampled* pose is not this method's job: the mixer interpolates freely between the placements it is handed.
11. `alignWorldMatrix(id, matrix)` applies the same rounding in the object's own frame, so a gizmo drag previews exactly what its commit will store instead of jumping on release (D42). It returns `matrix` *itself* (no copy) for an unaligned object and for an unknown id, and never mutates that argument. Otherwise it divides the parent's world matrix out — `parent.clone().invert().multiply(matrix)`, or `matrix.clone()` when the object is a root — writes `alignedPosition`'s result into the local matrix' translation, and multiplies the parent back in (`parent.multiply(local)`), so what comes back is a matrix this call made: the fresh parent-chain product for a child, the argument's clone for a root. A whole-cell local placement therefore survives even when a rotated or scaled ancestor maps it to a fractional world one.
12. `nextMaskColor()` returns `PALETTE[this.maskCursor++ % PALETTE.length]` from a module-level frozen palette of 12 distinct `0xRRGGBB` values. The walk is a plain increment, so two fresh `Project`s produce the same sequence and colors stay stable for the project's lifetime.
13. `snapshot()` builds a fresh `ProjectData`: one copied record per object in `objects` iteration order — the three transform parts copied into new `Vector3`/`Quaternion` values, so a later write to the project cannot reach the snapshot — then `camera` and `settings` copied by the same rule, the timeline as one new record with a copied track and keyframe per entry, and `counters` from `nextId` and `maskCursor`. Payload grids are the one thing shared by reference: a grid is read-only where the file is concerned, and copying millions of cells to answer a read is not worth it (README D51).
14. `restore(data)` replaces the truth in place. It validates first — duplicate ids, ids that are not `obj-<n>`, unknown `parentId`s, and cycles all throw `RangeError` before anything is written, exactly like `setPayload` — and then writes: `objects` is cleared and refilled in `data.objects` order, `camera`'s and `settings`' fields are assigned into the existing records, `timeline.durationMs` and `timeline.fps` are assigned while `timeline.tracks` is spliced and refilled from `data.timeline` (so the `Timeline` object and its `tracks` array keep their identity for every holder, README D45), and the counters are written with a floor: `nextId = max(data.counters.nextId, highest loaded suffix + 1)` and `maskCursor = data.counters.maskCursor`. `adoptKeyframeIds(this.timeline)` (timeline.ts) then floors the keyframe minter above every loaded keyframe id, so nothing a restore brought in can be minted twice (README D51).

## Invariants
- `objects` keys equal `SceneObject.id`; ids match `obj-<n>`, are unique, and are never reused, even after `remove`.
- The hierarchy is a forest: `parentId` is `null` or an existing id, exactly one parent per object, no cycles at any time.
- `representation` binds exactly one payload: `'empty'` has no `uniform`; `'uniform'` has one. `setPayload` is the only mutator that changes `representation`, and the invariant holds after every call.
- `setPayload` leaves `transform`, `name`, `parentId`, `maskColor`, `visible`, and `alignToGrid` byte-identical, so attaching a payload to an `'empty'` placeholder never moves, renames, or recolors an object an importer already placed; the caller marks the object dirty for the mirror afterwards (D4).
- `maskColor` is assigned once at creation from the palette walk, is independent of cell colors, and is never derived from object order at export time (D11).
- `timeline` is one instance for the project's lifetime; mutators mutate it in place, so holding `project.timeline` stays valid.
- `restore` keeps instance identity: the `objects` `Map`, `camera`, `settings`, `timeline`, and `timeline.tracks` are the same objects afterwards, so a holder of any of them — the mirror, the mixer, the panels — keeps reading live truth (README D51).
- After `restore` the map holds exactly `data.objects` in that order, every key equals its record's `id`, and the hierarchy is legal; `nextId` is above every loaded id and the keyframe minter above every loaded keyframe id, so no later `allocateId` or `addKeyframe` collides with what the file brought in.
- `snapshot()` reads and never writes: the project is unchanged by it, and a `snapshot()` taken after `restore(snapshot())` equals the first field for field (payload grids compare by identity).
- Neither method is a file path: the format, the cell codec, and the rejection of a bad file live in `./serialize.js`, and `restore` is total over the data a validated file can produce.
- Every object created here has `visible: true`; `visible` gates rendering only and never changes occupancy.
- Objects, transforms, and payloads are plain records and typed arrays plus Three.js *value* types — no `Mesh`, `Object3D`, or scene reference is stored (D1).
- `worldMatrix(id)` for a root equals its own composed local matrix; for a child it equals the parent chain product.
- `alignToGrid` is set at creation from the placement, measured in the object's own cells: `createObject` builds the identity transform and sets it `true`, while `createVoxelObject` sets it exactly when `position` is whole cells *of the grid it is handed* (`0.5` is whole for a `create(2)` grid, `0.25` is not). A voxel object whose placement an operation derived — detach under a turned or off-lattice parent — is therefore created unaligned rather than snapped (D42, D23), and only the editor's `setObjectAlignToGrid` or a direct field write changes the flag afterwards.
- The flag governs the object's own `transform.position` and nothing else: it never gates occupancy, never constrains the camera, and never makes a world coordinate whole under a rotated or scaled ancestor.
- `alignedPosition` never mutates its argument and always returns a fresh `Vector3` — the nearest whole cell of the object's own grid per axis for an aligned object (its `uniform.cellSize`, or `CELL_SIZE` for an aligned object with no grid), a copy of the input for an unaligned object and for an unknown id — and `keyframePosition` has both properties, adding only the camera pass-through, so an object at subdivision `4` rounds to quarters and its tracks hold quarters.
- `alignWorldMatrix` returns its argument *itself* (no copy) for an unaligned object and for an unknown id, and never mutates it; when the object does align, the frame is the object's own — the parent chain is divided out before the rounding and multiplied back after — so a child of a moved or turned parent still gets whole cells stored locally.

## Errors
- `reparent` returns `{ ok: false, error: 'missing' }` for an unknown `id` or an unknown non-null `parentId`, and `{ ok: false, error: 'cycle' }` when the candidate parent is the object or a descendant. Both leave state unchanged.
- `createObject`, `createVoxelObject`, `setPayload`, and `worldMatrix` throw `RangeError` on an unknown `parentId`/`id`: callers pass ids obtained from this project, so this is a programmer error, not a user-facing result. `setPayload` validates before writing, so a failed call leaves the payload untouched.
- `remove(unknownId)` is a no-op.
- `alignedPosition`, `keyframePosition`, and `alignWorldMatrix` are total: an unknown id gets the input back instead of a `RangeError`, so the editor can ask about an id it is about to validate.
- `createObject` cannot be called with a voxel representation — the parameter type admits only `'empty'`.
- `restore` throws `RangeError`, before writing, for a duplicate id, an id that is not `obj-<n>`, an unknown non-null `parentId`, or a `parentId` chain that closes a cycle. A file that could produce any of those is refused by `./serialize.js` first, so reaching the throw is a programmer error; `snapshot` has no failure path.

## Dependencies
- `../voxels/uniform/grid.js` — the `UniformGrid` payload type and `HexColor` are type-only, and `CELL_SIZE` is a value import: it is the fallback cell `alignedPosition` rounds to for an aligned object that has no grid, so the world unit is never re-declared here.
- `./timeline.js` — `Timeline` type, `TrackTarget` (the `keyframePosition` argument), and `removeTracksFor` on deletion. `timeline.ts` imports `ObjectId` from here type-only, so the value dependency stays one-way (`document/project → document/timeline`) and no runtime cycle exists.
- `three` — `Vector3`, `Quaternion`, `Matrix4` for transforms; allowed in ring 1 (D1).

## Tests
- `tests/detach.test.ts` — pinned indirectly: a detached object inherits the source's `parentId`, gets a fresh palette color, and a fresh reusable id; `worldMatrix` of a root object equals its translation.
- The import → voxelize flow is the caller of `setPayload` (an `'empty'` placeholder receives its payload); the transition itself is pinned directly in `tests/project.test.ts`, not by an import-side unit test.
- `tests/project.test.ts` — the direct unit suite: identity and id non-reuse, `reparent` refusal, `remove` with track cleanup, the `setPayload` transition, `worldMatrix` composition, the alignment rule (the create-time flag, own-cell rounding, keyframes, the local-frame snap), the mask-color walk, and `snapshot`/`restore` (record copies, instance identity, the counter floor, and the refusals).

## Open questions
- `remove` on an unknown id is specified here as a no-op; if the editor prefers a hard failure the `OpResult`-producing layer must check existence first. To be confirmed with `editor/ops.ts`.
