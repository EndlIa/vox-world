# src/document/serialize.ts

Ring: 1 · Layer: document · Depends on: ./project.js, ./timeline.js, ../voxels/uniform/grid.js,
../voxels/voxelize/voxelize.js (`DEFAULT_CELL_BUDGET`)

## Responsibility
Turns the project truth into one versioned JSON document and back. It reads a `Project` into the file's
shape, encodes every uniform grid's cells, and validates a file completely — format, version, structure,
hierarchy legality, cell ranges, keyframe widths and times, and the voxel budget — before a caller writes
anything. It owns the file format and the cell codec, and it owns no project state: it creates no `Project`,
never mutates the one it reads, and hands a validated `ProjectData` back for `Project.restore` (README D51).

## Public interface
```ts
const PROJECT_FORMAT = 'vox-world-project';   // the `format` field every file carries
const PROJECT_VERSION = 1;                    // the schema version this reader knows

type ProjectFileError =
  | 'parse-failed'          // not JSON, or the top-level value is not an object
  | 'unsupported-format'    // `format` is missing or names another document
  | 'unsupported-version'   // `version` is not a positive integer, or is not PROJECT_VERSION
  | 'bad-structure'         // a field is missing, of the wrong type, or out of its plain range
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
  subdivision: number;      // the grid's own level (D43)
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
   returns `JSON.stringify(document)`. It never reads derived state, a mirror node, or the session.
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
   file's own statement and is preserved (D42 records what the editor does on the next write).
4. Payloads go to `decodeCells`, which validates before it constructs: `subdivision` is an integer power of
   two `>= 1` (`isSubdivision`), `codec` is one this reader knows, `cellCount` is a non-negative integer,
   `index` holds exactly `cellCount * indexWidth` bytes, every `palette` entry is an integer in
   `[0, 0xffffff]` indexed by nothing that leaves it, and every decoded key unpacks to integer coordinates
   inside `[KEY_MIN, KEY_MAX]` on all three axes. A violation is `{ ok: false, detail }`, which `readJson`
   reports as `bad-cell` naming the object id.
5. The varint keys are deltas: decode cumulatively, require the sequence to be strictly ascending (a
   repeated or descending key is a corrupt payload, not a duplicated cell), and require the count to equal
   `cellCount`. The decoded grid is built with `UniformGrid.create(subdivision)` and one `set` per cell, so
   a grid is only ever handed on in a state two of its own invariants already describe.
6. `decodeCells` builds a fresh grid and touches nothing else, which is what makes the read side
   all-or-nothing: `readJson` collects every object's grid, and only then returns `data`. A file that fails
   at its last object leaves the caller's project exactly as it was, because the caller has not been called
   into yet.
7. Timeline validation: `durationMs` is a non-negative integer, `fps` a positive integer, `tracks` a list of
   entries whose `target` is `{ kind: 'camera' }` or `{ kind: 'object', objectId }` naming a loaded object
   (`bad-keyframe` — a track onto a vanished object would otherwise be a dangling reference the D45 mutators
   cannot repair), whose `channel` is one of the four, and whose `interpolation` is `'step'`, `'linear'`, or
   `'smooth'`. At most one track may exist per `(target, channel)` pair.
8. Keyframe validation: `value.length` equals the channel's size (3 for `position`/`scale`, 4 for
   `quaternion`, 1 for `fov`), every entry is finite, `timeMs` is a whole millisecond inside
   `[0, durationMs]`, the ids are unique across the whole file, and each track's times are strictly
   ascending. A keyframe outside the clip is refused rather than clamped: a load is not an edit, and
   `clampTime`'s rounding is the authoring path's rule, not the reader's.
9. The budget is checked against `DEFAULT_CELL_BUDGET` (the same constant the voxelizer and `editor/ops.ts`
    guard with, so a file cannot carry more content than the editor itself would allow to exist): the running
    total of decoded cells is compared after each object, and `budget-exceeded` names the measured total and
    the limit. The check happens while reading, so an oversized file is refused before the rest of its cells
    are built.
10. `detail` always names what failed in the file's own terms — the object id, the track, the keyframe id,
    the field — because the console report (D38) is the only channel a refused file has.
11. `encodeCells` is total and allocation-proportional: it collects `(key, color)` pairs, sorts by key,
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
  `alignToGrid`; the same camera, settings, and timeline values, with keyframe ids and times intact.
- The reader accepts exactly `version === PROJECT_VERSION`; a higher version is `unsupported-version` and
  never a best-effort parse, so a future file cannot be silently half-understood by today's build.
- Rejection is data: every failure is one of the eight literals with a `detail`, never a throw, and the
  literal is decided by the first violated rule in the order above.
- No field of `ProjectData` aliases file-owned JSON: `objects` and `timeline` are fresh records, so later
  mutation of the parsed document cannot reach a live project.

## Errors
- `parse-failed`, `unsupported-format`, `unsupported-version`, `bad-structure`, `bad-hierarchy`,
  `bad-cell`, `bad-keyframe`, `budget-exceeded` — the union above, each carrying `detail`.
- `toJson` and `encodeCells` have no failure path: a `Project` is structurally legal by construction
  (`UniformGrid.create` validated the subdivision, the key space was enforced by `packKey`, and no object
  holds a cell outside it).
- `decodeCells` reports `{ ok: false, detail }`; it is the only function here that inspects a value that did
  not come from this program.

## Dependencies
- `./project.js` — `Project`, `ProjectData`, `SceneObject`, `CameraSettings`, `ProjectSettings`,
  `ObjectId` types, and `cell`-free constants; `project.ts` does not import this file, so the runtime edge
  is one-way (`serialize -> project`), which is what keeps `Project.restore` the only writer.
- `./timeline.js` — `Timeline`, `Track`, `Interpolation`, `TrackChannel`, and `channelValueSize`, the one
  length table the keyframe check reads instead of re-declaring.
- `../voxels/uniform/grid.js` — `UniformGrid`, `HexColor`, `CellKey`, `packKey`, `KEY_MIN`, `KEY_MAX`,
  `isSubdivision`.
- `../voxels/voxelize/voxelize.js` — `DEFAULT_CELL_BUDGET`, the one budget constant (D12).
- No `three`, no `three-runtime`, no `editor`, no `ui`: it is the file boundary of the document layer and
  nothing above it is reachable from here.

## Tests
`tests/serialize.test.ts`: the codec's round trip on the unit lattice and on a subdivided grid, an empty
grid, negative coordinates, both key-space ends, a palette past 256 colors, the varint deltas of a
non-contiguous cell set, and rejection of an out-of-range key, a bad subdivision, and a truncated index;
the file's round trip through `Project.restore`, including keyframe ids and the counters; and the rejection
matrix — one case per error literal — each asserting that the open project is byte-identical afterwards.
`tests/scene.test.ts` and the app-level flow are not this file's coverage.
