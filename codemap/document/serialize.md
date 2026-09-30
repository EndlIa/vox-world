# src/document/serialize.ts

Ring: 1 · Layer: document · Depends on: ./project.js, ./camera.js, ./timeline.js, ../voxels/uniform/grid.js,
../voxels/voxelize/voxelize.js (`DEFAULT_CELL_BUDGET`)

## Responsibility
Turns the project truth into one versioned JSON document and back. It reads a `Project` into the file's
shape, encodes every uniform grid's cells, and validates a file completely — format, version, structure,
hierarchy legality, the camera's takes and their tiling, cell ranges, keyframe widths and times, and the
voxel budget — before a caller writes anything. It owns the file format and the cell codec, and it owns no
project state: it creates no `Project`, never mutates the one it reads, and hands a validated `ProjectData`
back for `Project.restore`.

## Public interface
```ts
const PROJECT_FORMAT = 'vox-world-project';   // the `format` field every file carries
const PROJECT_VERSION = 1;                    // the schema version this reader knows

type ProjectFileError =
  | 'parse-failed'          // not JSON, or the top-level value is not an object
  | 'unsupported-format'    // `format` is missing or names another document
  | 'unsupported-version'   // `version` is not a positive integer, or is not PROJECT_VERSION
  | 'bad-structure'         // a field is missing, of the wrong type, or out of its plain range — a camera that does not tile included
  | 'bad-hierarchy'         // an object id is duplicated, or a parentId dangles or closes a cycle
  | 'bad-cell'              // a cell payload's subdivision, key range, palette, or index is unusable
  | 'bad-keyframe'          // a track or keyframe violates its channel, time, or ordering rule
  | 'budget-exceeded';      // the file's total occupied cells exceed DEFAULT_CELL_BUDGET

type ProjectFileResult =
  | { ok: true; data: ProjectData }
  | { ok: false; error: ProjectFileError; detail: string };

function toJson(project: Project): string;
function readJson(text: string): ProjectFileResult;
function encodeCells(grid: UniformGrid): CellPayload;
function decodeCells(payload: unknown): { ok: true; grid: UniformGrid } | { ok: false; detail: string };
```

`CellPayload` is the file's cell record, named by `codec` so a second encoding can be added without
changing `version`:
```ts
type CellPayload = {
  subdivision: number;      // the grid's own level
  codec: 'varint-keys-palette';
  cellCount: number;        // occupied cells; the decoded counts must agree with it
  keys: string;             // base64: ascending packed cell keys, consecutive differences as varints
  palette: number[];        // 0xRRGGBB, in first-use order over that same ascending cell order
  indexWidth: 1 | 2;        // 1 when the palette holds at most 256 colors, else 2
  index: string;            // base64: cellCount palette indices, little-endian at indexWidth bytes each
};
```

## Internal logic
1. `toJson` assembles the document — `format`, `version`, `counters`, `settings`, `camera`, `objects`,
   `timeline` — from `project.snapshot()`, encoding each `uniform` object's grid with `encodeCells`, and
   returns `JSON.stringify(document)`. The camera is written whole, because the document owns it whole:
   `activeTakeId` plus one entry per take, each with its segments in order and each segment's range,
   `enter`, projection, clip planes, and keys. It never reads derived state, a mirror node, or the session.
2. `readJson` is `JSON.parse` in a `try`, then: the top-level value must be a non-null non-array object
   (`parse-failed`); `format` must equal `PROJECT_FORMAT` (`unsupported-format`); `version` must be the
   integer `PROJECT_VERSION` (`unsupported-version` — a newer file is refused, never guessed at). From
   there every field is narrowed by hand: no field is trusted because another field was.
3. Objects are validated as a list: every entry is an object with a string `id` matching `obj-<n>`, a string
   `name`, a `parentId` that is `null` or the id of another entry, a `transform` whose three parts are
   finite-number triples (position/scale 3, quaternion 4), a `representation` of `'empty'` or `'uniform'`,
   an integer `maskColor` inside `[0, 0xffffff]`, and boolean `visible`/`alignToGrid`. A `'uniform'` entry
   must carry a payload and an `'empty'` one must not; a duplicate id, a dangling `parentId`, a cycle, or a
   self-parent is `bad-hierarchy`. Nothing is repaired: `alignToGrid` against a fractional position is the
   file's own statement and is preserved.
4. The camera is validated as one chain, on the file's own terms — a load is not an edit, so nothing is
   clamped into shape. Each take needs a fresh non-empty id, a string name, and at least one segment; a
   segment needs a fresh id, a name, a range that does not run backwards (an empty range is the shot a
   project with no clip holds), an `enter` of `start`/`continuous`/`cut`, a `projection` of
   `perspective`/`orthographic`, a positive `near` below a larger `far`, and at least one key. The segments
   are sorted by `startMs` and each has to start exactly where the one before it ends: a gap or an overlap
   would make the resolution order, not the data, decide which shot is on screen. A key needs a fresh id, a
   finite time inside its own segment's range and strictly after the one before it, a finite `position[3]`
   and `quaternion[4]`, and a positive `lens`. Ids are unique across the whole camera: segment and key ids
   are checked globally, not per take. `activeTakeId` must name one of the takes. Every violation here is
   `bad-structure`, because the camera keeps the file's own terms rather than a literal of its own.
5. Payloads go to `decodeCells`, which validates before it constructs: `subdivision` is an integer power of
   two `>= 1` (`isSubdivision`), `codec` is one this reader knows, `cellCount` is a non-negative integer,
   `index` holds exactly `cellCount * indexWidth` bytes, every `palette` entry is an integer in
   `[0, 0xffffff]` indexed by nothing that leaves it, and every decoded key unpacks to integer coordinates
   inside `[KEY_MIN, KEY_MAX]` on all three axes. A violation is `{ ok: false, detail }`, which `readJson`
   reports as `bad-cell` naming the object id.
6. The varint keys are deltas: decode cumulatively, require the sequence to be strictly ascending (a
   repeated or descending key is a corrupt payload, not a duplicated cell), and require the count to equal
   `cellCount`. The decoded grid is built with `UniformGrid.create(subdivision)` and one `set` per cell, so
   a grid is only ever handed on in a state two of its own invariants already describe.
7. `decodeCells` builds a fresh grid and touches nothing else, which is what makes the read side
   all-or-nothing: `readJson` collects every object's grid, and only then returns `data`. A file that fails
   at its last object leaves the caller's project exactly as it was, because the caller has not been called
   into yet.
8. Timeline validation: `durationMs` is a non-negative integer, `fps` a positive integer, `tracks` a list of
   entries whose `target` is `{ kind: 'object', objectId }` naming a loaded object
   (`bad-keyframe` — a track onto a vanished object would otherwise be a dangling reference the timeline mutators
   cannot repair), whose `channel` is one of the three, and whose `interpolation` is `'step'`, `'linear'`, or
   `'smooth'`. At most one track may exist per `(target, channel)` pair.
9. Keyframe validation: `value.length` equals the channel's size (3 for `position`/`scale`, 4 for
   `quaternion`), every entry is finite, `timeMs` is a finite time inside
   `[0, durationMs]`, the ids are unique across the whole file, and each track's times are strictly
   ascending. A keyframe outside the clip is refused rather than clamped: a load is not an edit, and
   the authoring path's own clamping is the editor's rule, not the reader's.
10. The budget is checked against `DEFAULT_CELL_BUDGET` (the same constant the voxelizer and `editor/ops.ts`
    guard with, so a file cannot carry more content than the editor itself would allow to exist): the running
    total of decoded cells is compared after each object, and `budget-exceeded` names the measured total and
    the limit. The check happens while reading, so an oversized file is refused before the rest of its cells
    are built.
11. `detail` always names what failed in the file's own terms — the object id, the track, the keyframe id,
    the field — because the console report is the only channel a refused file has.
12. `encodeCells` is total and allocation-proportional: it collects `(key, color)` pairs, sorts by key,
    builds the palette in first-use order over that sorted sequence, emits varints of consecutive key
    differences, widens `indexWidth` to 2 past 256 colors, and base64-encodes the two byte streams.
    Base64 is `btoa`/`atob` over 32 KiB chunks of `String.fromCharCode`, so it needs no `Buffer` and
    survives a multi-megabyte stream without blowing the argument limit.

## Invariants
- The file is one JSON document with `format` and `version`; every other field is data. Nothing derived
  (mesh, instance buffer, lookup, node, clip, mixer, drawing, panel state) is written, and nothing
  session-scoped is read.
- A payload's decoded cell set equals the grid it was encoded from, cell for cell, key and color: the sort
  that pairs each key with its own color, the palette's first-use order, and the index stream's width are
  the three places that could silently mismatch.
- `indexWidth` is exactly `1` for a palette of at most 256 colors and `2` otherwise, both directions
  honored by the reader; a fixed width corrupts content the wrong side of that boundary.
- `decodeCells` never throws for a value that could come from a file, and never returns a grid that
  violates `UniformGrid`'s own invariants: the key space, the subdivision rule, and the index length are
  checked before construction.
- `readJson` writes nothing anywhere: it returns `ProjectData` or a `ProjectFileResult` failure, so a bad
  file cannot half-load a project. All-or-nothing is a property of the boundary, not of the caller.
- `toJson(project)` then `readJson` then `Project.restore` reproduces the project's truth: objects with the
  same ids, order, names, hierarchy, transforms, representations, payload cells, mask colors, `visible` and
  `alignToGrid`; the same camera — takes, segments, keys, and `activeTakeId`, with every id and time intact —
  settings, and timeline values, with keyframe ids and times intact.
- A camera the reader returns tiles: each take's segments start exactly where the one before ends, every
  segment holds at least one key inside its own range, `activeTakeId` names one of the takes, and no id is
  minted twice anywhere in the camera. A file that would break any of those is refused, never repaired.
- The reader accepts exactly `version === PROJECT_VERSION`; a higher version is `unsupported-version` and
  never a best-effort parse, so a future file cannot be silently half-understood by today's build.
- Rejection is data: every failure is one of the eight literals with a `detail`, never a throw, and the
  literal is decided by the first violated rule in the order above.
- No field of `ProjectData` aliases file-owned JSON: `objects` and `timeline` are fresh records, so later
  mutation of the parsed document cannot reach a live project.

## Errors
- `parse-failed`, `unsupported-format`, `unsupported-version`, `bad-structure`, `bad-hierarchy`,
  `bad-cell`, `bad-keyframe`, `budget-exceeded` — the union above, each carrying `detail`.
- Every camera failure is `bad-structure` — a take that does not tile, a key outside its own segment, a
  non-positive lens, a clip-plane pair that is not a usable range, an `activeTakeId` naming nothing — because the camera's
  rules are structural ones the file's own terms decide, and it has no literal of its own.
- `toJson` and `encodeCells` have no failure path: a `Project` is structurally legal by construction
  (`UniformGrid.create` validated the subdivision, the key space was enforced by `packKey`, and no object
  holds a cell outside it).
- `decodeCells` reports `{ ok: false, detail }`; it is the only function here that inspects a value that did
  not come from this program.

## Dependencies
- `./project.js` — `Project`, `ProjectData`, `SceneObject`, `ProjectSettings`,
  `ObjectId` types, and `cell`-free constants; `project.ts` does not import this file, so the runtime edge
  is one-way (`serialize -> project`), which is what keeps `Project.restore` the only writer.
- `./camera.js` — `Camera`, `CameraKey`, `CameraSegment`, `CameraTake` types, the shape the document's
  `camera` field is read into and written from. Type-only: the reader builds the records itself, so no
  camera mutator is imported and the runtime edge is one-way (`serialize -> camera`).
- `./timeline.js` — `Timeline`, `Track`, `Interpolation`, `TrackChannel`, and `channelValueSize`, the one
  length table the keyframe check reads instead of re-declaring.
- `../voxels/uniform/grid.js` — `UniformGrid`, `HexColor`, `CellKey`, `packKey`, `KEY_MIN`, `KEY_MAX`,
  `isSubdivision`.
- `../voxels/voxelize/voxelize.js` — `DEFAULT_CELL_BUDGET`, the one budget constant.
- No `three`, no `three-runtime`, no `editor`, no `ui`: it is the file boundary of the document layer and
  nothing above it is reachable from here.

## Tests
`tests/serialize.test.ts`: the codec's round trip on the unit lattice and on a subdivided grid, an empty
grid, negative coordinates, both key-space ends, a palette past 256 colors, the varint deltas of a
non-contiguous cell set, and rejection of an out-of-range key, a bad subdivision, and a truncated index;
the file's round trip through `Project.restore`, including keyframe ids and the counters; the camera's own
round trip — takes, segments, and keys, with an exact cut surviving as two sides that resolve to different
states either side of it; and the rejection matrix — one case per error literal — each asserting that the
open project is byte-identical afterwards.
`tests/scene.test.ts` and the app-level flow are not this file's coverage.
