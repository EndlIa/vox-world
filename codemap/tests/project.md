# tests/project.test.ts

Ring: 1 · Layer: tests (node, no GPU) · Depends on: `../src/document/project.js`,
`../src/document/timeline.js`, `../src/voxels/uniform/grid.js`, `../src/voxels/octree/octree.js`,
`three`, `vitest`

## Responsibility
Pins the project's identity, hierarchy, and representation rules: id allocation and non-reuse,
`reparent` refusal, `remove` child reparenting plus track cleanup, `setPayload` as the only
representation transition, `worldMatrix` composition, and the deterministic mask-color walk.

## Public interface
`describe` / `it` names are this file's observable surface:
- `identity` — `allocates unique obj-<n> ids and never reuses one after remove`
- `reparent` — `refuses a cycle with cycle`, `refuses an unknown parent with missing`, `leaves exactly
  one parent per object and no cycle after every outcome`
- `remove` — `reparents direct children to the removed node's parent`, `drops that object's timeline
  tracks while the camera track survives`, `is a no-op for an unknown id`
- `setPayload` — `moves empty -> uniform -> empty and empty -> octree -> empty`, `leaves id, name,
  parentId, maskColor, transform, and visible untouched`, `keeps representation and payload consistent
  in both directions`
- `worldMatrix` — `composes the parent chain from the root down`, `equals the object's own matrix for a
  root object`
- `nextMaskColor` — `walks the palette deterministically and repeats after a full cycle`, `gives two
  fresh projects the same sequence`

## Internal logic
1. Each test builds a fresh `Project` and creates its hierarchy through `createObject`/
   `createVoxelObject`; forest legality is one reusable check — every `parentId` resolves, exactly one
   parent per object, every object reachable from `roots()` — re-run after every `reparent` outcome.
2. `worldMatrix` is compared against a manually composed `Matrix4` with a non-identity quaternion and a
   scale on both parent and child, so a missing `compose` or a wrong multiply order fails.
3. Id and palette checks compare collected sequences against a second fresh project, never guessed
   literals; object tracks are installed with `ensureTrack`/`addKeyframe` before `remove` drops them.

## Invariants
- Ids match `obj-<n>`, are unique across the project's lifetime, and a removed id is never handed out again.
- After any `reparent` outcome the hierarchy is legal, with exactly one parent per object and no cycle.
- `remove` reparents every direct child to the removed node's `parentId`, deletes exactly that object,
  leaves descendants otherwise untouched, and has run `removeTracksFor` for its id while camera tracks
  survive.
- `setPayload` is the only representation transition — `'empty'` to `'uniform'` or `'octree'` and back —
  setting `uniform`/`octree` exactly when the representation says so and leaving `id`, `name`,
  `parentId`, `maskColor`, `transform`, and `visible` unchanged.
- `worldMatrix(id)` equals `M_root · … · M_local` along the parent chain, and the object's own composed
  matrix when it has no parent.
- `nextMaskColor()` is deterministic: two fresh projects give the same sequence, the values inside one
  `PALETTE.length` cycle are distinct, and the walk repeats after a full cycle.

## Errors
- `reparent` returns `{ ok: false, error: 'missing' }` for an unknown id or non-null parent and
  `{ ok: false, error: 'cycle' }` when the candidate parent is the object itself or a descendant; both
  leave state and the tree unchanged.
- `remove(unknownId)` is a no-op rather than a throw, no failure returns a partially applied result,
  and `setPayload` with an unknown id is left unpinned because the brief fixes no behavior for it.

## Dependencies
`../src/document/project.js` for `Project` and its record types; `../src/document/timeline.js` for
`ensureTrack`/`addKeyframe`; `../src/voxels/uniform/grid.js` and `../src/voxels/octree/octree.js` for
payload fixtures; `three` for `Matrix4`, `Vector3`, and `Quaternion`; `vitest`.

## Tests
This file *is* the test, run by `npm test` in the node environment. It is the only direct unit coverage
for `src/document/project.ts`; `tests/detach.test.ts` reaches its hierarchy behavior only indirectly.

## Open questions
- `document/project.md` predates the brief's `setPayload` addition and lists no `tests/project.test.ts`;
  that contract needs the matching patch, and it is owned by another contract.
