import type { CellKey } from '../uniform/grid.js';

/** One indexed triangle soup, already expressed in the target space. */
export type TriangleSoup = { positions: Float32Array; index: Uint32Array };

/** Claimed cells mapped to the first triangle index that claimed each one. */
export type SurfaceCells = { cells: Map<CellKey, number>; triangleCount: number };

/** Options of one surface pass. The kernel is synchronous: it yields to nobody. */
type SurfaceOptions = {
  budget: number;
  onProgress?: (ratio: number) => void;
  signal?: AbortSignal;
};

/** What a pass reports instead of cells; both mean the caller must drop the whole run. */
type SurfaceFailure = { error: 'budget-exceeded' | 'cancelled'; detail: string };

/** Triangles between two progress reports; the repository chunking convention (README §11). */
const CHUNK = 512;

/** Values per axis in the container's key layout, which `grid.unpackKey` inverts. */
const KEY_SPAN = 1024;

/**
 * Packs aligned cell coordinates into the container's key layout —
 * `(x + 512) * 1024² + (y + 512) * 1024 + (z + 512)`, exactly what `grid.packKey` builds and
 * `grid.unpackKey` takes apart. The arithmetic is repeated instead of called because `packKey`
 * also enforces the container's own storage range `[-512, 511]`, while an octree's aligned leaf
 * indices legitimately run up to `2^maxDepth` (1024 at the documented `maxDepth` of 10); every
 * coordinate reaching this kernel is non-negative and already aligned.
 */
function cellKey(x: number, y: number, z: number): CellKey {
  return (x + 512) * KEY_SPAN * KEY_SPAN + (y + 512) * KEY_SPAN + (z + 512);
}

/**
 * Scratch for the candidate test: the current triangle's three vertices in the candidate cell's
 * frame (`[v0x, v0y, v0z, v1x, …, v2z]`) plus that cell's half extent in slot 9. Reused, so a pass
 * allocates nothing per candidate cell.
 */
const probe = new Float64Array(10);

/**
 * Separating-axis test between the triangle in `probe` and the cell cube of half extent `probe[9]`,
 * projected on `(ax, ay, az)`. True proves the two are apart. A degenerate axis projects
 * everything to zero and can never separate, so a zero-area triangle's missing normal and an edge
 * parallel to a box axis both fall through.
 *
 * The reads are safe: `probe` holds all nine coordinates and the half extent before any call.
 */
function separatedBy(ax: number, ay: number, az: number): boolean {
  if (ax === 0 && ay === 0 && az === 0) return false;
  const p0 = ax * probe[0]! + ay * probe[1]! + az * probe[2]!;
  const p1 = ax * probe[3]! + ay * probe[4]! + az * probe[5]!;
  const p2 = ax * probe[6]! + ay * probe[7]! + az * probe[8]!;
  const min = p0 < p1 ? (p0 < p2 ? p0 : p2) : p1 < p2 ? p1 : p2;
  const max = p0 > p1 ? (p0 > p2 ? p0 : p2) : p1 > p2 ? p1 : p2;
  const radius = probe[9]! * (Math.abs(ax) + Math.abs(ay) + Math.abs(az));
  return min > radius || max < -radius;
}

/**
 * Conservative surface voxelization: every grid cell whose cube the soup really touches, mapped to
 * the first triangle that claimed it. Candidates come from the per-triangle voxel-space AABB and a
 * candidate is kept only when the 13-axis separating test proves triangle and cell cube are not
 * apart, so a cell the surface merely passes near is never kept. A face lying exactly on a lattice
 * plane therefore claims the cell on each side of it that its AABB reaches.
 *
 * Cell indices are neither clamped nor aligned here: `voxelize.ts` aligns the soup so the payload
 * container's coordinate range holds (README D20).
 */
export function voxelizeSurface(
  soup: TriangleSoup,
  voxelSize: number,
  opts: SurfaceOptions,
): SurfaceCells | SurfaceFailure {
  if (!Number.isFinite(voxelSize) || voxelSize <= 0) {
    throw new RangeError(`voxelSize must be a finite positive number, received ${voxelSize}`);
  }
  const budget = opts.budget;
  if (!Number.isInteger(budget) || budget < 0) {
    throw new RangeError(`budget must be a non-negative integer, received ${budget}`);
  }

  const { positions, index } = soup;
  if (positions.length % 3 !== 0) {
    throw new TypeError(`positions length ${positions.length} is not a multiple of 3`);
  }
  if (index.length % 3 !== 0) {
    throw new TypeError(`index length ${index.length} is not a multiple of 3`);
  }

  const triangleCount = index.length / 3;
  if (triangleCount === 0) return { cells: new Map(), triangleCount: 0 };

  const vertexCount = positions.length / 3;
  const half = voxelSize / 2;
  const cells = new Map<CellKey, number>();
  const report = opts.onProgress;
  const signal = opts.signal;

  for (let t = 0; t < triangleCount; t++) {
    const slot = t * 3;
    // Safe: `t` runs over `triangleCount`, so every read below is inside `index`.
    const i0 = index[slot]!;
    const i1 = index[slot + 1]!;
    const i2 = index[slot + 2]!;
    if (i0 >= vertexCount) throw new RangeError(`triangle ${t} references vertex ${i0} of ${vertexCount}`);
    if (i1 >= vertexCount) throw new RangeError(`triangle ${t} references vertex ${i1} of ${vertexCount}`);
    if (i2 >= vertexCount) throw new RangeError(`triangle ${t} references vertex ${i2} of ${vertexCount}`);

    const a = i0 * 3;
    const b = i1 * 3;
    const c = i2 * 3;
    const v0x = positions[a]!;
    const v0y = positions[a + 1]!;
    const v0z = positions[a + 2]!;
    const v1x = positions[b]!;
    const v1y = positions[b + 1]!;
    const v1z = positions[b + 2]!;
    const v2x = positions[c]!;
    const v2y = positions[c + 1]!;
    const v2z = positions[c + 2]!;

    // Edges and normal are differences, so every candidate cell of this triangle shares them.
    const e0x = v1x - v0x;
    const e0y = v1y - v0y;
    const e0z = v1z - v0z;
    const e1x = v2x - v1x;
    const e1y = v2y - v1y;
    const e1z = v2z - v1z;
    const e2x = v0x - v2x;
    const e2y = v0y - v2y;
    const e2z = v0z - v2z;
    const nx = e0y * e1z - e0z * e1y;
    const ny = e0z * e1x - e0x * e1z;
    const nz = e0x * e1y - e0y * e1x;

    const minX = Math.floor(Math.min(v0x, v1x, v2x) / voxelSize);
    const maxX = Math.floor(Math.max(v0x, v1x, v2x) / voxelSize);
    const minY = Math.floor(Math.min(v0y, v1y, v2y) / voxelSize);
    const maxY = Math.floor(Math.max(v0y, v1y, v2y) / voxelSize);
    const minZ = Math.floor(Math.min(v0z, v1z, v2z) / voxelSize);
    const maxZ = Math.floor(Math.max(v0z, v1z, v2z) / voxelSize);

    // Deterministic candidate order: z, then y, then x.
    for (let z = minZ; z <= maxZ; z++) {
      const cz = (z + 0.5) * voxelSize;
      for (let y = minY; y <= maxY; y++) {
        const cy = (y + 0.5) * voxelSize;
        for (let x = minX; x <= maxX; x++) {
          const key = cellKey(x, y, z);
          // First claim wins: a claimed cell keeps its lower triangle index.
          if (cells.has(key)) continue;

          const cx = (x + 0.5) * voxelSize;
          probe[0] = v0x - cx;
          probe[1] = v0y - cy;
          probe[2] = v0z - cz;
          probe[3] = v1x - cx;
          probe[4] = v1y - cy;
          probe[5] = v1z - cz;
          probe[6] = v2x - cx;
          probe[7] = v2y - cy;
          probe[8] = v2z - cz;
          probe[9] = half;

          // 3 box normals, the triangle plane, and the 9 edge x box-axis cross products.
          if (separatedBy(1, 0, 0)) continue;
          if (separatedBy(0, 1, 0)) continue;
          if (separatedBy(0, 0, 1)) continue;
          if (separatedBy(nx, ny, nz)) continue;
          if (separatedBy(0, e0z, -e0y)) continue;
          if (separatedBy(-e0z, 0, e0x)) continue;
          if (separatedBy(e0y, -e0x, 0)) continue;
          if (separatedBy(0, e1z, -e1y)) continue;
          if (separatedBy(-e1z, 0, e1x)) continue;
          if (separatedBy(e1y, -e1x, 0)) continue;
          if (separatedBy(0, e2z, -e2y)) continue;
          if (separatedBy(-e2z, 0, e2x)) continue;
          if (separatedBy(e2y, -e2x, 0)) continue;

          // Checked before the write, so the map never grows past the budget (README D12).
          if (cells.size + 1 > budget) {
            return {
              error: 'budget-exceeded',
              detail: `cell budget exceeded: ${cells.size + 1} cells at the limit of ${budget}`,
            };
          }
          cells.set(key, t);
        }
      }
    }

    const processed = t + 1;
    if (processed % CHUNK === 0) {
      report?.(processed / triangleCount);
      if (signal?.aborted === true) {
        return {
          error: 'cancelled',
          detail: `cancelled after ${processed} of ${triangleCount} triangles`,
        };
      }
    }
  }

  return { cells, triangleCount };
}

