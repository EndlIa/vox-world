# tests/project.test.ts

Ring: 1 · Layer: tests (node, no GPU) · Depends on: `../src/document/project.js`,
`../src/document/timeline.js`, `../src/voxels/uniform/grid.js`,
`three`, `vitest`

## Responsibility
Pins the project's identity, hierarchy, and representation rules: id allocation and non-reuse,
`reparent` refusal, `remove` child reparenting plus track cleanup, `setPayload` as the only
representation transition, `worldMatrix` composition, the grid-alignment rule — the placement a new
object inherits and the cell it is measured in, the nearest-own-cell rounding, the placement a keyframe
may store, and the local-frame world-matrix snap — and the deterministic mask-color walk. It also pins `snapshot`/`restore`: the copies a snapshot hands out, the instance identity a restore keeps, the counter floor, and the refusals that make a bad file a no-op.

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
  to every other target`, `rounds to the object's own cell, so a subdivided object snaps in its own steps`,
  `creates an object aligned only when the placement is whole in its own grid`, `snaps a world matrix in
  the object's own frame, without touching the argument`
- `nextMaskColor` — `walks the palette deterministically and repeats after a full cycle`, `gives two
  fresh projects the same sequence`
- `snapshot / restore` — `copies records so a later write cannot reach the snapshot`, `restores the loaded
  objects in order and keeps the camera, the settings, and the timeline objects`, `floors the id counter
  above the ids the loaded file carries`, `refuses a duplicate id, an unknown parent, a cycle, and a foreign
  id without writing`

## Internal logic
1. Each test builds a fresh `Project` and creates its hierarchy through `createObject`/
   `createVoxelObject`; forest legality is one reusable check — every `parentId` resolves, exactly one
   parent per object, every object reachable from `roots()` — re-run after every `reparent` outcome.
2. `worldMatrix` is compared against a manually composed `Matrix4` with a non-identity quaternion and a
   scale on both parent and child, so a missing `compose` or a wrong multiply order fails.
3. Id and palette checks compare collected sequences against a second fresh project, never guessed
   literals; object tracks are installed with `ensureTrack`/`addKeyframe` before `remove` drops them.
4. The `setPayload` fixture is one `UniformGrid.create()` — the unit lattice, since `create` takes only
   a subdivision and stores no spacing of its own (README D41) — holding a single occupied cell; the
   consistency test sets a second, freshly created grid over the same object and checks that `size`
   reports the one cell it holds.
5. The alignment cases use literal fractions, not a value a matrix round trip produced, and give the
   child a parent that is both moved and turned, so a snap taken in world coordinates instead of the
   object's own frame cannot pass. The one place a copy is asserted rather than a value is
   `not.toBe(fraction)` on the returned vector; pass-through elsewhere is checked as values.
6. The subdivision cases create the grid they align against (`UniformGrid.create(4)` and `create(2)`) and read the cell from that payload, so a rounding that still assumed `CELL_SIZE` would land on the wrong fractions; the create-time case uses `0.5`, one whole cell of a `create(2)` grid, against `0.25`, which is half of one.

## Invariants
- Ids match `obj-<n>`, are unique across the project's lifetime, and a removed id is never handed out again.
- After any `reparent` outcome the hierarchy is legal, with exactly one parent per object and no cycle.
- `remove` reparents every direct child to the removed node's `parentId`, deletes exactly that object,
  leaves descendants otherwise untouched, and has run `removeTracksFor` for its id while camera tracks
  survive.
- `setPayload` is the only representation transition — `'empty'` to `'uniform'` and back —
  setting `uniform` exactly when the representation says so and leaving `id`, `name`,
  `parentId`, `maskColor`, `transform`, and `visible` unchanged.
- The payload is a `UniformGrid` of the level it was created at: `setPayload` stores the caller's own grid
  object, and `size` is its occupied-cell count — one for the fixture's single cell — never a per-axis length.
- `worldMatrix(id)` equals `M_root · … · M_local` along the parent chain, and the object's own composed
  matrix when it has no parent.
- `alignToGrid` follows the placement rather than a constant: `createObject` returns objects with it set,
  the `createVoxelObject` at `(1, 2, 3)` comes back with it set, and the one at `(0.5, 2, -3)` comes back
  with it clear, so a placement that already sits between cells is never claimed to be on the lattice.
  The cell is the payload grid's own (README D42, D43): against a `create(2)` grid, `0.5` is whole and comes back aligned
  while `0.25` is not and comes back unaligned.
- `alignedPosition` gives the nearest whole cell of the object's own grid per axis — pinned on literal
  fractions, `(1.4, -2.5, 3.5)` becoming `(1, -2, 4)` for an aligned object with no payload grid and
  `(1.5, -2.5, 3.5)` for one whose grid is `create(4)`, rather than on a matrix round trip — and a fresh copy of its
  argument for an unaligned object and for an unknown id, so the caller's vector is neither aliased nor
  mutated.
- `keyframePosition` gives an `'object'` target the same whole cells a transform write would give it while
  it aligns — for a `create(4)` object the fraction `0.3` becomes `0.25`, so a track holds the object's own
  cells — the fraction itself once the flag is off, and hands the camera the fraction it was given: one
  rule for authoring and for transform writes, with the camera outside it.
- `alignWorldMatrix` snaps in the object's own frame: with the parent both moved and turned, dividing the
  parent's world matrix back out of what it returns leaves whole cells, and the matrix that was passed in
  is element-for-element unchanged.
- An object that does not align gets its placement back: for such a root, `alignWorldMatrix` returns a
  matrix whose translation is the object's own, fraction included.
- `nextMaskColor()` is deterministic: two fresh projects give the same sequence, the values inside one
  `PALETTE.length` cycle are distinct, and the walk repeats after a full cycle.
- `snapshot()` is a copy: writing to the project afterwards leaves the taken snapshot unchanged, and the
  payload grid is the one thing shared by reference.
- `restore(...)` replaces membership in the data's order, keeps the `camera`, `settings`, and `timeline`
  objects — and the `timeline.tracks` array — identical, floors the id counter above every loaded id, and
  resumes the palette walk at the cursor the data carried.
- A refused `restore` writes nothing: a duplicate id, an unknown parent, a cycle, and an id that is not
  `obj-<n>` each throw, and each attempt leaves the project field-for-field as `snapshot()` reported it
  before.

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
