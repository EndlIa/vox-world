import { Vector3 } from 'three';
import { UniformGrid, unpackKey, type CellKey, type HexColor } from '../uniform/grid.js';
import { resolvePrimitiveColor, type ColorSource } from './colorSampler.js';
import { voxelizeSurface, type TriangleSoup } from './surface.js';

/** One part of a source: a world-space soup and the color source its cells are sampled from. */
export type VoxelizePart = {
  soup: TriangleSoup;
  color: ColorSource;
};

/**
 * One source: the whole of one import in world space, because the caller bakes node transforms
 * (README D21), as the parts it is made of. Every part writes into the **same** payload: placement
 * uses the union AABB of them all and every part is translated by that one origin, while a cell an
 * earlier part claimed keeps its color and a later part skips it, so no two cells of one payload
 * coincide and the result is deterministic in part order.
 */
export type VoxelizeSource = {
  sourceId: string; // caller's own key, e.g. the imported scene; NOT a document ObjectId
  name: string;
  parts: readonly VoxelizePart[];
};

export type VoxelizeRequest = {
  sources: VoxelizeSource[];
  budget: number;
  onProgress?: (ratio: number) => void;
  signal?: AbortSignal;
};

export type VoxelizeOutput = {
  sourceId: string;
  name: string;
  payload: { kind: 'uniform'; grid: UniformGrid };
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

/** Where one source's payload lives: the lattice-aligned origin of its local `(0, 0, 0)`. */
type Origin = readonly [number, number, number];

type PlannedSource = { source: VoxelizeSource; triangles: number; origin: Origin };

function cancelled(): Failure {
  return {
    ok: false,
    error: 'cancelled',
    detail: 'voxelization cancelled; the scene was left untouched',
  };
}

/** Returns the reason the soup cannot be voxelized, or null when it is well formed. */
function soupProblem(soup: TriangleSoup): string | null {
  const { positions, index } = soup;
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

/** Cells the axis spans, counting the cells on both sides of a lattice plane. */
function cellsOnAxis(min: number, max: number): number {
  return Math.floor(max) - Math.floor(min) + 1;
}

/** The union AABB of every part, or null when no part has a triangle to bound. */
function partsBounds(parts: readonly VoxelizePart[]): Aabb | null {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let any = false;
  for (const part of parts) {
    const bounds = soupBounds(part.soup);
    if (bounds === null) continue;
    any = true;
    for (let axis = 0; axis < 3; axis += 1) {
      if (bounds.min[axis]! < min[axis]!) min[axis] = bounds.min[axis]!;
      if (bounds.max[axis]! > max[axis]!) max[axis] = bounds.max[axis]!;
    }
  }
  return any ? { min, max } : null;
}

/**
 * Placement of one source: the origin is the floor of the source's min corner, so every local
 * coordinate is `>= 0` and lands on the lattice, which is the world unit (README D41); the source is
 * refused when the grid it would need is wider than the container (README §12).
 *
 * `bounds` is the union AABB of the source's parts: one payload holds all of them, so the origin and
 * the fit are decided by what the parts cover together, and every part's soup is translated by that
 * one origin.
 */
function placeSource(source: VoxelizeSource, bounds: Aabb | null): Origin | Failure {
  if (bounds === null) return [0, 0, 0];
  const axes = [
    ['X', cellsOnAxis(bounds.min[0], bounds.max[0])],
    ['Y', cellsOnAxis(bounds.min[1], bounds.max[1])],
    ['Z', cellsOnAxis(bounds.min[2], bounds.max[2])],
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
  return [Math.floor(bounds.min[0]), Math.floor(bounds.min[1]), Math.floor(bounds.min[2])];
}

/** A copy of `positions` translated by `-origin`; the caller's array is never touched. */
function translatedPositions(positions: Float32Array, origin: Origin): Float32Array {
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    out[i] = positions[i]! - origin[0];
    out[i + 1] = positions[i + 1]! - origin[1];
    out[i + 2] = positions[i + 2]! - origin[2];
  }
  return out;
}

/**
 * Allocates the payload of one source once its every part passed, and drops the claimed cells with it
 * (README D12).
 *
 * The claimed cells arrive with the color their claimant already resolved, so one cell is written once
 * no matter how many parts reached it: the merge in `voxelize` keeps the first part's color and drops
 * every later claim.
 */
function buildOutput(source: VoxelizeSource, origin: Origin, cells: Map<CellKey, HexColor>): VoxelizeOutput {
  const grid = UniformGrid.create();
  for (const [key, color] of cells) {
    const [x, y, z] = unpackKey(key);
    grid.set(x, y, z, color);
  }
  return { sourceId: source.sourceId, name: source.name, payload: { kind: 'uniform', grid }, origin: new Vector3(origin[0], origin[1], origin[2]) };
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
 * Voxelization pipeline: world-space sources of triangle soups to voxel payloads, one per source, with
 * an aggregate progress ratio, cancellation, and a cell budget shared by every source. The parts of one
 * source share one placement and one cell map, so the payload holds each cell once, colored by the
 * first part that claimed it. Nothing the caller owns is mutated and no project or scene state is
 * touched, so a failure leaves the caller exactly as it was and identical requests produce identical
 * payloads, origins, and stats.
 */
export async function voxelize(request: VoxelizeRequest): Promise<VoxelizeResult> {
  if (!Number.isInteger(request.budget) || request.budget < 0) {
    throw new RangeError(`budget must be a non-negative integer, received ${request.budget}`);
  }

  // Step 1: every part's soup, before anything is allocated.
  const pending: { source: VoxelizeSource; triangles: number }[] = [];
  let totalTriangles = 0;
  for (const source of request.sources) {
    let triangles = 0;
    for (const part of source.parts) {
      const problem = soupProblem(part.soup);
      if (problem !== null) {
        return { ok: false, error: 'unsupported-geometry', detail: `source ${source.sourceId}: ${problem}` };
      }
      triangles += part.soup.index.length / 3;
    }
    totalTriangles += triangles;
    pending.push({ source, triangles });
  }
  if (totalTriangles === 0) {
    return { ok: false, error: 'empty', detail: 'no source has a triangle to voxelize' };
  }

  // Step 2: one placement per source, over the union AABB of its parts; a source that cannot fit the
  // container fails the whole run.
  const planned: PlannedSource[] = [];
  for (const item of pending) {
    const origin = placeSource(item.source, partsBounds(item.source.parts));
    if ('ok' in origin) return origin;
    planned.push({ source: item.source, triangles: item.triangles, origin });
  }

  const report = request.onProgress;
  const signal = request.signal;
  // Read through a function: an abort can arrive from a host callback that runs between two checks,
  // so the flag must be re-read rather than narrowed once at the top of the loop.
  const aborted = (): boolean => signal?.aborted === true;
  const outputs: VoxelizeOutput[] = [];
  let cellsSoFar = 0;
  let processedSources = 0; // triangles of the sources already processed, for the aggregate ratio

  for (const { source, origin, triangles } of planned) {
    if (aborted()) return cancelled();

    // The one payload of this source: every part writes into this map, in part order, and a cell an
    // earlier part already claimed is left alone, so it keeps that part's color and is never written
    // twice. The color is resolved here, on the claim, so the map holds plain `0xRRGGBB` values.
    const cells = new Map<CellKey, HexColor>();
    const vertices: [number, number, number] = [0, 0, 0];
    let processedParts = 0; // triangles of this source's parts already processed

    for (const part of source.parts) {
      if (aborted()) return cancelled();

      // A copy per part: the caller's positions stay untouched, and the index is only ever read.
      const positions = translatedPositions(part.soup.positions, origin);
      const index = part.soup.index;

      for (let start = 0; start < index.length; start += CHUNK * 3) {
        if (aborted()) return cancelled();
        const end = Math.min(start + CHUNK * 3, index.length);
        const base = start / 3;
        const sliceTriangles = (end - start) / 3;
        const outcome = voxelizeSurface({ positions, index: index.subarray(start, end) }, {
          budget: request.budget - cellsSoFar,
          onProgress: (ratio) => {
            // The kernel reports its own slice; the aggregate ratio spans every part of every source.
            report?.((processedSources + processedParts + base + ratio * sliceTriangles) / totalTriangles);
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
          if (cells.has(key)) continue;
          // The triangle index is relative to the slice, so it is rebased onto the part's own index
          // buffer — the buffer the kernel walked and the one the sampler reads its vertices from.
          cells.set(key, resolvePrimitiveColor(part.color, triangleVertices(index, base + triangle, vertices)));
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

      processedParts += index.length / 3;
    }

    outputs.push(buildOutput(source, origin, cells));
    processedSources += triangles;
  }

  let cells = 0;
  for (const output of outputs) {
    cells += output.payload.grid.size;
  }
  report?.(1);
  return { ok: true, outputs, stats: { cells, triangles: totalTriangles } };
}

