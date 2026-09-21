# src/voxels/voxelize/voxelize.ts

Ring: 0 · Layer: voxels/voxelize · Depends on: `../uniform/grid.js`, `../octree/octree.js`, `./surface.js`, `./colorSampler.js`, `three`

## Responsibility
The voxelization pipeline: turn world-space triangle soups into voxel payloads, one per source, with aggregate
progress, cancellation, and a cell budget. The parts of one source share a placement and a cell map, so a payload
holds each cell once, coloured by the first part that claimed it. It is not the importer, it never touches the
project or the Three.js scene, and it decides no identity — it returns plain data for `editor/ops.ts` to adopt.

## Public interface
```ts
type VoxelizeTarget =
  | { kind: 'uniform'; voxelSize: number }
  | { kind: 'octree'; rootSize: number; maxDepth: number; targetCellSize: number };
type VoxelizePart = {
  soup: TriangleSoup;   // world space: the caller bakes transforms, voxelize never applies one
  color: ColorSource;   // the part's own colour source: factor, texture, UVs, vertex colours, alphaTest
};
type VoxelizeSource = {
  sourceId: string;     // caller's own key, e.g. the imported scene; NOT a document ObjectId
  name: string;
  parts: readonly VoxelizePart[];  // one import's mesh nodes; every part writes into this one payload
};
type VoxelizeRequest = {
  sources: VoxelizeSource[];
  target: VoxelizeTarget;
  budget: number;
  onProgress?: (ratio: number) => void;
  signal?: AbortSignal;
};
type VoxelizeOutput = {
  sourceId: string;
  name: string;
  payload: { kind: 'uniform'; grid: UniformGrid } | { kind: 'octree'; octree: Octree };
  origin: THREE.Vector3;   // world-space position of the payload's local (0, 0, 0)
};
type VoxelizeResult =
  | { ok: true; outputs: VoxelizeOutput[]; stats: { cells: number; triangles: number } }
  | { ok: false; error: 'cancelled' | 'budget-exceeded' | 'empty' | 'unsupported-geometry' | 'exceeds-grid'; detail: string };
const DEFAULT_CELL_BUDGET = 4_000_000;   // the app passes this as `budget`; `editor/ops.ts` imports it for box edits, so an edit cannot disagree with a voxelization
function voxelize(request: VoxelizeRequest): Promise<VoxelizeResult>;
```

## Internal logic
Sources run in ascending `sources` index order and each source's parts in `parts` index order, which is what makes
the run deterministic.
1. Validate `target` and `budget` (`voxelSize > 0`, `rootSize > 0`, `maxDepth >= 1`, `targetCellSize > 0`,
   `budget` a non-negative integer); violations throw, because they come from UI constraints, not imported data.
2. Validate every part's soup (lengths multiples of 3, valid indices, finite positions); a violation ⇒ `'unsupported-geometry'` before any allocation.
3. Every source keeps its slot, so `outputs.length === sources.length` and each sourceId owns exactly one payload;
   `triangles = Σ` over every part of every source, and a total of 0 ⇒ `'empty'`. A source with no parts therefore
   behaves like a source whose soup has no triangles: alone it is what makes the run `'empty'`, and beside a source
   that has geometry it keeps its slot with an empty payload at `(0, 0, 0)`.
4. Per source, one AABB pass over the **union of its parts** fixes placement and resolution: `uniform` → cell size `voxelSize`, `origin = floor(min / voxelSize) * voxelSize` per axis, so cells are `>= 0`;
   `octree` → `d = clamp(ceil(log2(rootSize / targetCellSize)), 1, maxDepth)`, leaf edge `ℓ = rootSize / 2^d`, `origin = min`, root box `[0, rootSize]³`;
   an AABB extent larger than `rootSize` on any axis ⇒ `'exceeds-grid'`. Parts with no triangles are skipped by that
   union, so a source whose parts are all empty is placed like a source without bounds.
5. For each part, translate its soup by that one `-origin` into a copy (caller arrays stay untouched) and call
   `voxelizeSurface(translated, voxelSize | ℓ, { budget: budget - cellsSoFar, onProgress, signal })` in `CHUNK = 512`-triangle slices,
   awaiting a zero-delay macrotask — not a microtask — between slices: that yield keeps progress and cancel responsive on the main thread.
   Every part of a source gets its own translation and its own kernel calls, because the kernel is handed one soup at a time.
6. The source's cell map is shared by all of its parts and is filled as the kernel reports, in part order: a cell
   already in the map is skipped, so the first part that reaches a cell keeps it and no cell is written twice. The
   colour is resolved **on the claim**, through that part's own `ColorSource`: the kernel reports cell colours as
   triangle indices relative to the slice it was handed, the index is rebased onto the part's own index buffer — the
   buffer the kernel walked — and `resolvePrimitiveColor(part.color, vertices)` reads that triangle's three vertices
   out of one tuple reused across the source. The map therefore holds `0xRRGGBB` values, and each cell carries the
   product of its part's base color factor, its base color texture at the triangle's UV centroid, and the triangle's
   first vertex color (`colorSampler.ts`). Octree indices are clamped to `[0, 2^d - 1]` when the payload is built,
   which keeps a triangle exactly on the far face inside the root box.
7. Budget spans sources: every kernel call receives the remaining budget, so the total never passes `budget`; the kernel aborts before its map would (README D12).
   The kernel counts every cell it touches, so a part that re-reaches cells its source already holds spends budget it
   does not write; the merge only adds what the payload gains, and a cell is never added past `budget`.
8. Allocate the payload once its source passed, then release that cell map: `UniformGrid.create(voxelSize)` plus `set(x, y, z, color)` per cell, or
   `Octree.create({ rootSize, maxDepth })` plus `insertAtDepth([x, y, z], d, { occupied: true, color })` per cell; the cells are
   unique, so `insertAtDepth` only allocates, and a run that later fails drops its payloads instead of returning them.
9. `origin` is the payload's world min corner, so local `(0, 0, 0)` sits exactly there; a source that wrote no cells keeps its
   slot with an empty payload, at `(0, 0, 0)` when its parts bound nothing and at its own aligned origin otherwise.
10. `onProgress(processedTriangles / triangles)` across all parts of all sources, non-decreasing and exactly 1 before success (`triangles` is the total over all parts);
    `signal.aborted` at any yield point ⇒ `{ ok: false, error: 'cancelled', detail: 'voxelization cancelled; the scene was left untouched' }`.
11. Success: `{ ok: true, outputs, stats: { cells: Σ cells written, triangles } }`, in `sources` order.

## Invariants
- One payload holds each cell once: a cell two parts reach is written by the first of them and keeps that part's colour,
  so no two cells of one payload can coincide, and the payload is decided by part order (a fact `import.ts` relies on:
  the mesh nodes of a GLB are the parts, in traversal order).
- Each `origin` is its payload's world min corner — the union AABB's, over every part — so uniform coordinates inside a payload are non-negative and every octree root box is `[0, rootSize]³`.
- On success `outputs.length === sources.length` and `outputs[i].sourceId === sources[i].sourceId`; a source id is never split across payloads.
- `stats.cells <= budget` when `ok` is true, and `stats.cells` equals the summed `UniformGrid.size` or octree `occupiedLeafCount` of the outputs.
- `stats.triangles` counts every part's triangles, including the parts whose cells an earlier part had already claimed.
- Nothing caller-owned is mutated, so a request is re-runnable and structured-cloneable, and identical requests give identical payload contents, origins, and stats. The module holds no reference to project or scene state, so every failure leaves the caller untouched: `voxelize` is a pure function of geometry, options, and callbacks (README D9, §7 `VoxelizeJob`), which is what lets it move into a worker unchanged.

## Errors
Returned, never thrown: `'empty'` — no source has a part with a triangle: there is nothing to voxelize. A source that merely yields no cells still produces its empty payload.
- `'unsupported-geometry'` — a malformed soup (lengths, out-of-range index, non-finite coordinate): geometry that cannot be voxelized at all.
- `'exceeds-grid'` — the source does not fit the target grid: a uniform extent whose cells would leave the container key range `[-512, 511]`, or an octree root box smaller than the union AABB of the source. `detail` names the `sourceId`, the axis, and the measured quantity (uniform cells on that axis / octree AABB extent).
- `'budget-exceeded'` — the running total would pass `budget`; `detail` carries the measured count and the limit.
- `'cancelled'` — the signal aborted; `detail` states that the scene was left untouched, and no output is returned.
Thrown: `RangeError` for a non-finite or non-positive `voxelSize`, `rootSize`, or `targetCellSize`, for a non-integer `maxDepth < 1`, or for a `budget` that is not a non-negative integer; soup malformations are returned instead, because they come from imported data.

## Dependencies
- `../uniform/grid.js` — `UniformGrid`, `unpackKey` (cell keys out of the surface map), and the `HexColor`, `CellKey` types.
- `../octree/octree.js` — `Octree` for payload allocation; the registered same-ring edge `voxels/voxelize -> voxels/{uniform,octree}` (README D8).
- `./surface.js` — `TriangleSoup`, `SurfaceCells`, `voxelizeSurface`; `./colorSampler.js` — `ColorSource`, `resolvePrimitiveColor`.
- `three` — `Vector3` for `origin`; a value type, never project data (README D1).
No outer-ring import: nothing here reaches `document`, `three-runtime`, or `editor`.

## Tests
`tests/voxelize.test.ts` pins the depth formula and the leaf size it implies, per-source separation (one output per source, distinct payloads, `sourceId`/`name` copied through), the parts model — the shared cell written once with the first part's colour, the cell only a later part claims taking its colour, the origin at the union AABB of the parts, and a partless source behaving like a triangle-free one — each `origin` being the world min corner, `stats` totals (`UniformGrid.size` / `occupiedLeafCount`), that each cell carries the color resolved from the three vertices of the triangle that claimed it — the soup's index buffer decides which vertex, not the triangle index — `'empty'` for triangles-free soups, `'unsupported-geometry'` for a malformed soup, `'exceeds-grid'` for a mesh that outgrows its target grid, and the `budget-exceeded` and `'cancelled'` aborts returning no outputs.

## Open questions
- `octree.rootSize` is derived by the caller from the source bounds at voxelization time (README §12); this file only requires it to be at least the largest AABB extent of that source and returns `'exceeds-grid'` otherwise. Root growth for a scene that outgrows its box is still open, and `voxelize` never defaults `budget`: the app passes `DEFAULT_CELL_BUDGET`.
- A part that re-reaches cells its source already holds spends budget for cells it does not write, because the kernel is handed the remaining budget and counts every cell it touches in its own map; it cannot see the payload's cells, and teaching it to skip them would change `surface.ts`. The `'budget-exceeded'` limit itself is unaffected: the merge only ever adds the cells the payload gains.
- The octree build clamps a cell on the far face into the root box (`[0, 2^d - 1]`), and `insertAtDepth` overwrites the attrs of a leaf that is already there; two distinct out-of-range cells of two parts can therefore land on one leaf, which then takes the later part's colour. The first-claim rule governs payload cells, and a cell outside the root box is not one; preserving the first part's colour there would need a leaf-id query this module does not have.
