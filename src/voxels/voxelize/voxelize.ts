import { Vector3 } from 'three';
import { Octree } from '../octree/octree.js';
import { UniformGrid, unpackKey, type CellKey } from '../uniform/grid.js';
import { resolvePrimitiveColor, type ColorSource } from './colorSampler.js';
import { voxelizeSurface, type TriangleSoup } from './surface.js';

/** Target representation and its resolution parameters. */
export type VoxelizeTarget =
  | { kind: 'uniform'; voxelSize: number }
  | { kind: 'octree'; rootSize: number; maxDepth: number; targetCellSize: number };

/** One source node: already in world space, because the caller bakes node transforms (README D21). */
export type VoxelizeSource = {
  sourceId: string; // caller's own key, e.g. the GLB node uuid; NOT a document ObjectId
  name: string;
  soup: TriangleSoup;
  color: ColorSource;
};

export type VoxelizeRequest = {
  sources: VoxelizeSource[];
  target: VoxelizeTarget;
  budget: number;
  onProgress?: (ratio: number) => void;
  signal?: AbortSignal;
};

export type VoxelizeOutput = {
  sourceId: string;
  name: string;
  payload: { kind: 'uniform'; grid: UniformGrid } | { kind: 'octree'; octree: Octree };
  origin: Vector3; // world-space position of the payload's local (0, 0, 0)
};

export type VoxelizeResult =
  | { ok: true; outputs: VoxelizeOutput[]; stats: { cells: number; triangles: number } }
  | {
      ok: false;
      error: 'cancelled' | 'budget-exceeded' | 'empty' | 'unsupported-geometry' | 'exceeds-grid';
      detail: string;
    };

/** The app passes this as `budget`; `editor/ops.ts` imports it so an edit and a voxelization agree. */
export const DEFAULT_CELL_BUDGET = 4_000_000;

/** Triangles between two host yields and two progress reports; README §11. */
const CHUNK = 512;

/**
 * Cells one payload may hold on a single axis. The container keys run over `[-512, 511]`, and a
 * payload's coordinates are aligned to its own origin, so they start at 0 and 512 per axis fit.
 */
const MAX_CELLS_PER_AXIS = 512;

type Failure = Extract<VoxelizeResult, { ok: false }>;

type Aabb = { min: [number, number, number]; max: [number, number, number] };

/** Where one source's payload lives: aligned origin, cell size, and the octree depth it uses. */
type Placement =
  | { kind: 'uniform'; cellSize: number; origin: readonly [number, number, number] }
  | {
      kind: 'octree';
      cellSize: number;
      origin: readonly [number, number, number];
      depth: number;
      rootSize: number;
      maxDepth: number;
    };

type PlannedSource = { source: VoxelizeSource; placement: Placement; triangles: number };

function cancelled(): Failure {
  return {
    ok: false,
    error: 'cancelled',
    detail: 'voxelization cancelled; the scene was left untouched',
  };
}

function validateTarget(target: VoxelizeTarget): void {
  if (target.kind === 'uniform') {
    if (!Number.isFinite(target.voxelSize) || target.voxelSize <= 0) {
      throw new RangeError(`voxelSize must be a finite positive number, received ${target.voxelSize}`);
    }
    return;
  }
  if (!Number.isFinite(target.rootSize) || target.rootSize <= 0) {
    throw new RangeError(`rootSize must be a finite positive number, received ${target.rootSize}`);
  }
  if (!Number.isInteger(target.maxDepth) || target.maxDepth < 1) {
    throw new RangeError(`maxDepth must be an integer of at least 1, received ${target.maxDepth}`);
  }
  if (!Number.isFinite(target.targetCellSize) || target.targetCellSize <= 0) {
    throw new RangeError(`targetCellSize must be a finite positive number, received ${target.targetCellSize}`);
  }
}

/** Returns the reason the soup cannot be voxelized, or null when it is well formed. */
function soupProblem(source: VoxelizeSource): string | null {
  const { positions, index } = source.soup;
  if (positions.length % 3 !== 0) {
    return `positions length ${positions.length} is not a multiple of 3`;
  }
  if (index.length % 3 !== 0) {
    return `index length ${index.length} is not a multiple of 3`;
  }
  const vertexCount = positions.length / 3;
  for (let i = 0; i < index.length; i++) {
    const vertex = index[i]!;
    if (vertex >= vertexCount) {
      return `index entry ${i} references vertex ${vertex} of ${vertexCount} vertices`;
    }
  }
  for (let i = 0; i < positions.length; i++) {
    if (!Number.isFinite(positions[i]!)) return `position component ${i} is not finite`;
  }
  return null;
}

/** Bounds of the vertices the index actually references, or null when there is no triangle. */
function soupBounds(soup: TriangleSoup): Aabb | null {
  const { positions, index } = soup;
  if (index.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < index.length; i++) {
    const base = index[i]! * 3;
    const x = positions[base]!;
    const y = positions[base + 1]!;
    const z = positions[base + 2]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

/** Cells the axis spans at `voxelSize`, counting the cells on both sides of a lattice plane. */
function cellsOnAxis(min: number, max: number, voxelSize: number): number {
  return Math.floor(max / voxelSize) - Math.floor(min / voxelSize) + 1;
}

/**
 * Placement of one source: uniform floors the origin to `voxelSize` so every local coordinate is
 * `>= 0`; octree keeps the AABB minimum as the origin of the root box `[0, rootSize]³` and takes
 * its depth from the target cell size, clamped to `[1, maxDepth]` (README §12).
 */
function placeSource(source: VoxelizeSource, target: VoxelizeTarget, bounds: Aabb | null): Placement | Failure {
  if (target.kind === 'uniform') {
    const { voxelSize } = target;
    if (bounds === null) return { kind: 'uniform', cellSize: voxelSize, origin: [0, 0, 0] };
    const axes = [
      ['X', cellsOnAxis(bounds.min[0], bounds.max[0], voxelSize)],
      ['Y', cellsOnAxis(bounds.min[1], bounds.max[1], voxelSize)],
      ['Z', cellsOnAxis(bounds.min[2], bounds.max[2], voxelSize)],
    ] as const;
    for (const [axis, cells] of axes) {
      if (cells > MAX_CELLS_PER_AXIS) {
        return {
          ok: false,
          error: 'exceeds-grid',
          detail:
            `source ${source.sourceId} needs ${cells} cells on the ${axis} axis,` +
            ` past the container limit of ${MAX_CELLS_PER_AXIS} cells per axis`,
        };
      }
    }
    return {
      kind: 'uniform',
      cellSize: voxelSize,
      origin: [
        Math.floor(bounds.min[0] / voxelSize) * voxelSize,
        Math.floor(bounds.min[1] / voxelSize) * voxelSize,
        Math.floor(bounds.min[2] / voxelSize) * voxelSize,
      ],
    };
  }

  const { rootSize, maxDepth, targetCellSize } = target;
  const depth = Math.min(Math.max(Math.ceil(Math.log2(rootSize / targetCellSize)), 1), maxDepth);
  const cellSize = rootSize / 2 ** depth;
  if (bounds === null) {
    return { kind: 'octree', cellSize, origin: [0, 0, 0], depth, rootSize, maxDepth };
  }
  const axes = [
    ['X', bounds.max[0] - bounds.min[0]],
    ['Y', bounds.max[1] - bounds.min[1]],
    ['Z', bounds.max[2] - bounds.min[2]],
  ] as const;
  for (const [axis, extent] of axes) {
    if (extent > rootSize) {
      return {
        ok: false,
        error: 'exceeds-grid',
        detail:
          `source ${source.sourceId} has an AABB extent of ${extent} on the ${axis} axis,` +
          ` larger than its octree root box of ${rootSize}`,
      };
    }
  }
  return {
    kind: 'octree',
    cellSize,
    origin: [bounds.min[0], bounds.min[1], bounds.min[2]],
    depth,
    rootSize,
    maxDepth,
  };
}

/** A copy of `positions` translated by `-origin`; the caller's array is never touched. */
function translatedPositions(positions: Float32Array, origin: readonly [number, number, number]): Float32Array {
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    out[i] = positions[i]! - origin[0];
    out[i + 1] = positions[i + 1]! - origin[1];
    out[i + 2] = positions[i + 2]! - origin[2];
  }
  return out;
}

/**
 * Allocates the payload once its source passed, and drops the cell map with it (README D12).
 *
 * The cell map holds triangle indices while the sampler colors a triangle from its three vertices, so
 * the soup's own index buffer — the buffer the kernel walked — is read here too. One tuple is reused
 * across the source because the sampler reads it synchronously and never keeps it.
 */
function buildOutput(source: VoxelizeSource, placement: Placement, claimed: Map<CellKey, number>): VoxelizeOutput {
  const origin = new Vector3(placement.origin[0], placement.origin[1], placement.origin[2]);
  const index = source.soup.index;
  const vertices: [number, number, number] = [0, 0, 0];

  if (placement.kind === 'uniform') {
    const grid = UniformGrid.create(placement.cellSize);
    for (const [key, triangle] of claimed) {
      const [x, y, z] = unpackKey(key);
      grid.set(x, y, z, resolvePrimitiveColor(source.color, triangleVertices(index, triangle, vertices)));
    }
    return { sourceId: source.sourceId, name: source.name, payload: { kind: 'uniform', grid }, origin };
  }

  const octree = Octree.create({ rootSize: placement.rootSize, maxDepth: placement.maxDepth });
  const lastIndex = 2 ** placement.depth - 1;
  for (const [key, triangle] of claimed) {
    const [x, y, z] = unpackKey(key);
    // Clamping keeps a triangle exactly on the far face inside the root box `[0, rootSize]³`.
    octree.insertAtDepth(
      [Math.min(Math.max(x, 0), lastIndex), Math.min(Math.max(y, 0), lastIndex), Math.min(Math.max(z, 0), lastIndex)],
      placement.depth,
      { occupied: true, color: resolvePrimitiveColor(source.color, triangleVertices(index, triangle, vertices)) },
    );
  }
  return { sourceId: source.sourceId, name: source.name, payload: { kind: 'octree', octree }, origin };
}

/**
 * The three vertex indices of one soup triangle, written into `out`. The surface kernel reports cell
 * colors as triangle indices, the sampler wants the vertices of that triangle, and the index buffer
 * the caller supplied is what both agree on.
 */
function triangleVertices(index: Uint32Array, triangle: number, out: [number, number, number]): [number, number, number] {
  const base = triangle * 3;
  out[0] = index[base]!;
  out[1] = index[base + 1]!;
  out[2] = index[base + 2]!;
  return out;
}

/**
 * Voxelization pipeline: world-space triangle soups to voxel payloads, one per source, with an
 * aggregate progress ratio, cancellation, and a cell budget shared by every source. Nothing the
 * caller owns is mutated and no project or scene state is touched, so a failure leaves the caller
 * exactly as it was and identical requests produce identical payloads, origins, and stats.
 */
export async function voxelize(request: VoxelizeRequest): Promise<VoxelizeResult> {
  validateTarget(request.target);
  if (!Number.isInteger(request.budget) || request.budget < 0) {
    throw new RangeError(`budget must be a non-negative integer, received ${request.budget}`);
  }

  // Step 1: every soup, before anything is allocated.
  const pending: { source: VoxelizeSource; triangles: number }[] = [];
  let totalTriangles = 0;
  for (const source of request.sources) {
    const problem = soupProblem(source);
    if (problem !== null) {
      return { ok: false, error: 'unsupported-geometry', detail: `source ${source.sourceId}: ${problem}` };
    }
    const triangles = source.soup.index.length / 3;
    totalTriangles += triangles;
    pending.push({ source, triangles });
  }
  if (totalTriangles === 0) {
    return { ok: false, error: 'empty', detail: 'no source has a triangle to voxelize' };
  }

  // Step 2: one placement per source; a mesh that cannot fit its target grid fails the whole run.
  const planned: PlannedSource[] = [];
  for (const item of pending) {
    const placement = placeSource(item.source, request.target, soupBounds(item.source.soup));
    if ('ok' in placement) return placement;
    planned.push({ source: item.source, triangles: item.triangles, placement });
  }

  const report = request.onProgress;
  const signal = request.signal;
  // Read through a function: an abort can arrive from a host callback that runs between two checks,
  // so the flag must be re-read rather than narrowed once at the top of the loop.
  const aborted = (): boolean => signal?.aborted === true;
  const outputs: VoxelizeOutput[] = [];
  let cellsSoFar = 0;
  let processedSources = 0; // triangles of the sources already processed, for the aggregate ratio

  for (const { source, placement, triangles } of planned) {
    if (aborted()) return cancelled();

    // A copy: the caller's positions stay untouched, and the index is only ever read.
    const positions = translatedPositions(source.soup.positions, placement.origin);
    const index = source.soup.index;
    const claimed = new Map<CellKey, number>();

    for (let start = 0; start < index.length; start += CHUNK * 3) {
      if (aborted()) return cancelled();
      const end = Math.min(start + CHUNK * 3, index.length);
      const base = start / 3;
      const sliceTriangles = (end - start) / 3;
      const outcome = voxelizeSurface({ positions, index: index.subarray(start, end) }, placement.cellSize, {
        budget: request.budget - cellsSoFar,
        onProgress: (ratio) => {
          // The kernel reports its own slice; the aggregate ratio spans every source.
          report?.((processedSources + base + ratio * sliceTriangles) / totalTriangles);
        },
        ...(signal !== undefined ? { signal } : {}),
      });
      if ('error' in outcome) {
        if (outcome.error === 'cancelled') return cancelled();
        // The kernel stopped on the write that would have passed the limit, so the run reached
        // `budget` cells and the failed write would have made one more.
        return {
          ok: false,
          error: 'budget-exceeded',
          detail: `cell budget exceeded: ${request.budget + 1} cells at the limit of ${request.budget}`,
        };
      }

      let added = 0;
      for (const [key, triangle] of outcome.cells) {
        if (claimed.has(key)) continue;
        claimed.set(key, base + triangle);
        added++;
      }
      cellsSoFar += added;

      if (end < index.length) {
        // A zero-delay macrotask, not a microtask: it lets the host paint progress and deliver an abort.
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        });
      }
    }

    outputs.push(buildOutput(source, placement, claimed));
    processedSources += triangles;
  }

  let cells = 0;
  for (const output of outputs) {
    const { payload } = output;
    cells += payload.kind === 'uniform' ? payload.grid.size : payload.octree.occupiedLeafCount;
  }
  report?.(1);
  return { ok: true, outputs, stats: { cells, triangles: totalTriangles } };
}

