# tests/serialize.test.ts

Ring: 1 · Layer: tests (node, no GPU) · Depends on: `../src/document/serialize.js`,
`../src/document/project.js`, `../src/document/timeline.js`, `../src/voxels/uniform/grid.js`,
`three`, `vitest`

## Responsibility
Pins the file boundary of the document: the cell codec in both directions and every way it can be handed
something unusable, the project's round trip through `toJson` → `readJson` → `Project.restore`, and one case
per `ProjectFileError` literal. It does not test the mirror, the load sequence in the composition root, or
the file dialog; those are app-level and verified by running the application.

## Public interface
`describe` / `it` names are this file's observable surface:
- `encodeCells / decodeCells` — `round-trips a unit-lattice grid cell for cell`, `round-trips a subdivided
  grid with its level`, `round-trips an empty grid`, `keeps negative coordinates and both key-space ends`,
  `builds a palette in first-use order and widens the index past 256 colors`, `delta-encodes a
  non-contiguous cell set`, `rejects a key outside the key space`, `rejects a subdivision that is not a
  power of two`, `rejects an index stream shorter than the cell count`, `rejects an index that leaves the
  palette`, `rejects a repeated key`
- `toJson / readJson` — `round-trips a project through restore, keeping keyframe ids and the counters`,
  `reports parse-failed`, `reports unsupported-format`, `reports unsupported-version`, `reports
  bad-structure`, `reports bad-hierarchy for a dangling parent`, `reports bad-hierarchy for a cycle`,
  `reports bad-cell for an unusable payload`, `reports bad-keyframe for a wrong value length`, `reports
  bad-keyframe for a time past the duration`, `reports bad-keyframe for a track on a missing object`,
  `reports budget-exceeded`, `leaves the open project untouched when a file is refused`

## Internal logic
1. Every case builds its own `Project` through `createObject`/`createVoxelObject` and edits its timeline
   through `addKeyframe`/`setDuration`, so a fixture never hand-writes a record the mutators could have
   produced; the round-trip case then writes into a *second* project, because the point is what a fresh
   editor instance reconstructs, not what the writing one still holds.
2. The round trip is asserted field by field against `snapshot()` of the writing project — objects with
   their ids, order, names, hierarchy, transforms, representations, mask colors, `visible` and
   `alignToGrid`; every cell of every payload read back through `getColor`; the camera, the settings, and
   the timeline with keyframe ids and times — rather than against the `JSON` text, so a codec change cannot
   pass by round-tripping its own mistake.
3. Rejection cases are built by mutating a string the writer produced: each parses the text, breaks exactly
   one field, stringifies it again, and asserts the specific error literal and a non-empty `detail` naming
   the offending object, track, or keyframe. The `unsupported-version` case bumps `version`; the
   `budget-exceeded` case lowers nothing but builds a file whose payload counts exceed the budget.
4. The no-write case is the boundary contract: it takes a project with content, snapshots it, feeds a
   deliberately broken file, and asserts the error *and* that a fresh `snapshot()` of the same project is
   field-for-field equal to the one taken before — a reader that wrote into the project on the way out
   cannot pass.
5. Codec cases are read back through `UniformGrid.forEach` and compared as a coordinate-to-color map, so a
   right count with a wrong pairing (key order against color order, or a palette index that shifts by one)
   fails instead of passing on `size` alone.

## Invariants
- Every payload `encodeCells` produces decodes to exactly the grid it came from: same occupied set, same
  color per cell, same `subdivision`.
- `indexWidth` is `1` for a palette of at most 256 colors and `2` beyond it, and the reader honors both
  widths; the fixture that crosses that boundary has more colors than cells at the low end, so an index
  written with the wrong width cannot pass.
- `decodeCells` answers `{ ok: false, detail }` for every corrupt payload the suite feeds it and never
  throws, and never returns a grid holding a cell outside `[KEY_MIN, KEY_MAX]` or a level `create` would
  have refused.
- `readJson` decides its error literal by the first rule violated, and the literal is the one the broken
  field belongs to, not a catch-all.
- A refused file leaves the caller's project unchanged, field for field, including the counters and the
  timeline.
- The round trip preserves identity-bearing values rather than values that merely compare equal: keyframe
  `id`s and their milliseconds, object ids, `maskColor`s, and `alignToGrid`.
- The counters survive: after a restore, the next `allocateId()` and the next `addKeyframe` mint ids that
  the file did not already contain.

## Errors
- The suite asserts the error literal and that `detail` is a non-empty string, never the wording of the
  message, so `detail` can be improved without changing the test.
- `toJson`, `encodeCells`, and `snapshot` are exercised as total: the round-trip fixture covers an empty
  project, an object with no payload, and a payload with no occupied cell.

## Dependencies
`../src/document/serialize.js` for the file boundary; `../src/document/project.js` for `Project` and its
record types; `../src/document/timeline.js` for `addKeyframe`/`setDuration` and the keyframe id contract;
`../src/voxels/uniform/grid.js` for `UniformGrid`, `KEY_MIN`, `KEY_MAX`, and `CELL_SIZE`;
`three` for `Vector3`; `vitest`.

## Tests
This file *is* the test, run by `npm test` in the node environment. It is the only coverage for
`src/document/serialize.ts`; the app-level flow that calls it (save, reload, open, then edit) is verified by
running the application.
