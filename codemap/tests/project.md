# tests/project.test.ts

Ring: 1 · Layer: tests (node, no GPU) · Depends on: `../src/document/project.js`,
`../src/document/timeline.js`, `../src/voxels/uniform/grid.js`,
`three`, `vitest`

## Responsibility
Pins the project's identity, hierarchy, and representation rules: id allocation and non-reuse,
`reparent` refusal, `remove` child reparenting plus track cleanup, `setPayload` as the only
representation transition, `worldMatrix` composition, the grid-alignment rule — the placement a new
object inherits, the nearest-cell rounding, the placement a keyframe may store, and the local-frame
world-matrix snap — and the deterministic mask-color walk.

## Public interface
`describe` / `it` names are this file's observable surface:
- `identity` — `allocates unique obj-<n> ids and never reuses one after remove`
- `reparent` — `refuses a cycle with cycle`, `refuses an unknown parent with missing`, `leaves exactly
  one parent per object and no cycle after every outcome`
- `remove` — `reparents direct children to the removed node's parent`, `drops that object's timeline
  tracks while the camera track survives`, `is a no-op for an unknown id`
- `setPayload` — `moves empty -> uniform -> empty`, `leaves id, name,
  parentId, maskColor, transform, and visible untouched`, `keeps representation and payload consistent`
- `worldMatrix` — `composes the parent chain from the root down`, `equals the object's own matrix for a
  root object`
- `grid alignment` — `starts every object it creates aligned`, `rounds a placement to the nearest cell
  while the object aligns`, `gives a keyframe whole cells for an aligned object, and the placement itself
  to every other target`, `snaps a world matrix in the object's own frame, without touching the argument`
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
4. The `setPayload` fixture is one `UniformGrid.create()` — no size argument, because a grid is unit
   cells and stores no spacing (README D41) — holding a single occupied cell; the consistency test
   sets a second, freshly created grid over the same object and checks that `size` reports the one
   cell it holds.
5. The alignment cases use literal fractions, not a value a matrix round trip produced, and give the
   child a parent that is both moved and turned, so a snap taken in world coordinates instead of the
   object's own frame cannot pass. The one place a copy is asserted rather than a value is
   `not.toBe(fraction)` on the returned vector; pass-through elsewhere is checked as values.

## Invariants
- Ids match `obj-<n>`, are unique across the project's lifetime, and a removed id is never handed out again.
- After any `reparent` outcome the hierarchy is legal, with exactly one parent per object and no cycle.
- `remove` reparents every direct child to the removed node's `parentId`, deletes exactly that object,
  leaves descendants otherwise untouched, and has run `removeTracksFor` for its id while camera tracks
  survive.
- `setPayload` is the only representation transition — `'empty'` to `'uniform'` and back —
  setting `uniform` exactly when the representation says so and leaving `id`, `name`,
  `parentId`, `maskColor`, `transform`, and `visible` unchanged.
- The payload is a `UniformGrid` of unit cells: `setPayload` stores the caller's own grid object, and
  `size` is its occupied-cell count — one for the fixture's single cell — never a per-axis length.
- `worldMatrix(id)` equals `M_root · … · M_local` along the parent chain, and the object's own composed
  matrix when it has no parent.
- `alignToGrid` follows the placement rather than a constant: `createObject` returns objects with it set,
  the `createVoxelObject` at `(1, 2, 3)` comes back with it set, and the one at `(0.5, 2, -3)` comes back
  with it clear, so a placement that already sits between cells is never claimed to be on the lattice.
- `alignedPosition` gives the nearest cell per axis for an aligned object — pinned on literal fractions,
  `(1.4, -2.5, 3.5)` becoming `(1, -2, 4)`, rather than on a matrix round trip — and a fresh copy of its
  argument for an unaligned object and for an unknown id, so the caller's vector is neither aliased nor
  mutated.
- `keyframePosition` gives an `'object'` target the same whole cells a transform write would give it while
  it aligns, the fraction itself once the flag is off, and hands the camera the fraction it was given: one
  rule for authoring and for transform writes, with the camera outside it.
- `alignWorldMatrix` snaps in the object's own frame: with the parent both moved and turned, dividing the
  parent's world matrix back out of what it returns leaves whole cells, and the matrix that was passed in
  is element-for-element unchanged.
- An object that does not align gets its placement back: for such a root, `alignWorldMatrix` returns a
  matrix whose translation is the object's own, fraction included.
- `nextMaskColor()` is deterministic: two fresh projects give the same sequence, the values inside one
  `PALETTE.length` cycle are distinct, and the walk repeats after a full cycle.

## Errors
- `reparent` returns `{ ok: false, error: 'missing' }` for an unknown id or non-null parent and
  `{ ok: false, error: 'cycle' }` when the candidate parent is the object itself or a descendant; both
  leave state and the tree unchanged.
- `remove(unknownId)` is a no-op rather than a throw, no failure returns a partially applied result,
  and `setPayload` with an unknown id is left unpinned because the brief fixes no behavior for it.
- The alignment rule is total: an unknown id is answered with the placement it was given, which the suite
  pins as a pass-through rather than as a rejection.

## Dependencies
`../src/document/project.js` for `Project` and its record types; `../src/document/timeline.js` for
`addKeyframe`/`findTrack` and `TrackTarget`; `../src/voxels/uniform/grid.js` for the payload fixture; `three` for `Matrix4`, `Vector3`, and `Euler`; `vitest`.

## Tests
This file *is* the test, run by `npm test` in the node environment. It is the only direct unit coverage
for `src/document/project.ts`; `tests/detach.test.ts` reaches its hierarchy behavior only indirectly.

## Open questions
- `document/project.md` predates the brief's `setPayload` addition and lists no `tests/project.test.ts`;
  that contract needs the matching patch, and it is owned by another contract.
