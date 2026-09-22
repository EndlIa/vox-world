/**
 * Sparse uniform voxel grid for exactly one object: integer cell coordinates to `HexColor`, plus
 * integer-box region operations with allocation-free packed keys.
 *
 * It holds no transform, identity, or scene state, allocates no Three.js object per cell, and never
 * converts to world space — that is the owning object's transform. Min-corner convention on the world
 * lattice: cell `(x, y, z)` occupies `[x / subdivision, (x + 1) / subdivision]` of a world unit on each
 * axis, so a cell coordinate is a world coordinate times the subdivision the grid carries (README D41, D43).
 */

/** The world unit: the base cell size a grid subdivides, one voxel at `subdivision = 1` (README D41, D43). */
export const CELL_SIZE = 1;

function assertSubdivision(value: number): void {
  if (!isSubdivision(value)) {
    throw new RangeError(`subdivision must be a power of two, got ${value}`);
  }
}

export type CellKey = number;
export type HexColor = number; // 0xRRGGBB, the THREE.Color.getHex()/setHex() exchange form
export type IntBox3 = { min: readonly [number, number, number]; max: readonly [number, number, number] };

/** Inclusive per-axis coordinate range covered by the packed key space. */
export const KEY_MIN = -512;
export const KEY_MAX = 511;
/** Cells per axis in the key space: 1024^3 keys, all exact 32-bit integers. */
const AXIS_SPAN = KEY_MAX - KEY_MIN + 1;

/** True for a legal subdivision: an integer power of two, so a cell is an exact binary fraction (D43). */
export function isSubdivision(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && Number.isInteger(Math.log2(value));
}

function assertAxis(axis: 'x' | 'y' | 'z', value: number): void {
  if (!Number.isInteger(value) || value < KEY_MIN || value > KEY_MAX) {
    throw new RangeError(`${axis} must be an integer in [${KEY_MIN}, ${KEY_MAX}], got ${value}`);
  }
}

/** Packs integer cell coordinates into one integer key. Throws `RangeError` outside `[-512, 511]`. */
export function packKey(x: number, y: number, z: number): CellKey {
  assertAxis('x', x);
  assertAxis('y', y);
  assertAxis('z', z);
  return (x - KEY_MIN) * AXIS_SPAN * AXIS_SPAN + (y - KEY_MIN) * AXIS_SPAN + (z - KEY_MIN);
}

/** Exact inverse of `packKey`; it re-checks nothing, since every key was produced by `packKey`. */
export function unpackKey(key: CellKey): [number, number, number] {
  const z = key % AXIS_SPAN;
  const withoutZ = (key - z) / AXIS_SPAN;
  const y = withoutZ % AXIS_SPAN;
  const x = (withoutZ - y) / AXIS_SPAN;
  return [x + KEY_MIN, y + KEY_MIN, z + KEY_MIN];
}

/** Componentwise min and max of two corners, so `min <= max` on every axis. Commutative. */
export function normalizeBox(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): IntBox3 {
  const min: [number, number, number] = [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.min(a[2], b[2]),
  ];
  const max: [number, number, number] = [
    Math.max(a[0], b[0]),
    Math.max(a[1], b[1]),
    Math.max(a[2], b[2]),
  ];
  return { min, max };
}

/** Inclusive extent product; an inverted box on any axis holds no cell, so the count is `0`. */
export function boxCount(box: IntBox3): number {
  const width = box.max[0] - box.min[0] + 1;
  if (width <= 0) return 0;
  const height = box.max[1] - box.min[1] + 1;
  if (height <= 0) return 0;
  const depth = box.max[2] - box.min[2] + 1;
  if (depth <= 0) return 0;
  return width * height * depth;
}

/** Compares the six corner numbers. */
export function boxEquals(a: IntBox3, b: IntBox3): boolean {
  return (
    a.min[0] === b.min[0] &&
    a.min[1] === b.min[1] &&
    a.min[2] === b.min[2] &&
    a.max[0] === b.max[0] &&
    a.max[1] === b.max[1] &&
    a.max[2] === b.max[2]
  );
}

function containsCell(box: IntBox3, x: number, y: number, z: number): boolean {
  return (
    x >= box.min[0] &&
    x <= box.max[0] &&
    y >= box.min[1] &&
    y <= box.max[1] &&
    z >= box.min[2] &&
    z <= box.max[2]
  );
}

export class UniformGrid {
  /** A grid at `subdivision = 1` is the unit lattice; any other level is a power of two (README D43). */
  static create(subdivision = 1): UniformGrid {
    assertSubdivision(subdivision);
    return new UniformGrid(subdivision);
  }

  /** How many cells one world unit spans: the object's own grid level, fixed for the life of the grid. */
  readonly subdivision: number;

  /** The world size of one cell, derived from the world unit so no length is stored (README D41, D43). */
  get cellSize(): number {
    return CELL_SIZE / this.subdivision;
  }

  /** The occupied set is exactly this key set, so `size === cells.size`. */
  private readonly cells = new Map<CellKey, HexColor>();

  private constructor(subdivision: number) {
    this.subdivision = subdivision;
  }

  get size(): number {
    return this.cells.size;
  }

  has(x: number, y: number, z: number): boolean {
    return this.cells.has(packKey(x, y, z));
  }

  getColor(x: number, y: number, z: number): HexColor | undefined {
    return this.cells.get(packKey(x, y, z));
  }

  /** Overwrite-on-set: an occupied cell changes color and does not grow `size`. */
  set(x: number, y: number, z: number, color: HexColor): void {
    this.cells.set(packKey(x, y, z), color);
  }

  /** Deletes the entry and reports whether the cell was occupied. */
  remove(x: number, y: number, z: number): boolean {
    return this.cells.delete(packKey(x, y, z));
  }

  /** Visits entries in `Map` insertion order, never sorted by coordinate. */
  forEach(cb: (x: number, y: number, z: number, color: HexColor) => void): void {
    for (const [key, color] of this.cells) {
      const [x, y, z] = unpackKey(key);
      cb(x, y, z, color);
    }
  }

  /** Inclusive corners of the occupied set, or `null` when the grid is empty. */
  bounds(): IntBox3 | null {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    for (const key of this.cells.keys()) {
      const [x, y, z] = unpackKey(key);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    if (this.cells.size === 0) return null;
    return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
  }

  /**
   * Writes every cell of the inclusive box, costing `O(boxCount(box))` and returning that count.
   * An inverted box writes nothing and returns `0`.
   */
  fillBox(box: IntBox3, color: HexColor): number {
    let written = 0;
    for (let x = box.min[0]; x <= box.max[0]; x += 1) {
      for (let y = box.min[1]; y <= box.max[1]; y += 1) {
        for (let z = box.min[2]; z <= box.max[2]; z += 1) {
          this.cells.set(packKey(x, y, z), color);
          written += 1;
        }
      }
    }
    return written;
  }

  /** Deletes every occupied cell inside the box, costing `O(size)`, and returns that count. */
  clearBox(box: IntBox3): number {
    let removed = 0;
    for (const key of this.cells.keys()) {
      const [x, y, z] = unpackKey(key);
      if (!containsCell(box, x, y, z)) continue;
      this.cells.delete(key);
      removed += 1;
    }
    return removed;
  }

  /** Recolors only the occupied cells inside the box, costing `O(size)`, and never creates one. */
  paintBox(box: IntBox3, color: HexColor): number {
    let painted = 0;
    for (const key of this.cells.keys()) {
      const [x, y, z] = unpackKey(key);
      if (!containsCell(box, x, y, z)) continue;
      this.cells.set(key, color);
      painted += 1;
    }
    return painted;
  }

  /**
   * A copy of this grid one or more levels finer: every cell becomes a `2^levels` cube of itself, in the same
   * color and at the same world position, because the new grid's subdivision is `2^levels` times this one's and
   * both keep the same placement (README D43). Block replication adds no detail; it makes the cells smaller.
   *
   * Coordinates outside the packed key space throw from `packKey`, so a caller that can be asked for too fine a
   * level checks the result it would need first and refuses with data (see `editor/ops.ts`).
   */
  subdividedBy(levels: number): UniformGrid {
    if (!Number.isInteger(levels) || levels < 1) {
      throw new RangeError(`subdividedBy: levels must be a positive integer, got ${levels}`);
    }
    const factor = 2 ** levels;
    const result = new UniformGrid(this.subdivision * factor);
    for (const [key, color] of this.cells) {
      const [x, y, z] = unpackKey(key);
      const baseX = x * factor;
      const baseY = y * factor;
      const baseZ = z * factor;
      for (let dx = 0; dx < factor; dx += 1) {
        for (let dy = 0; dy < factor; dy += 1) {
          for (let dz = 0; dz < factor; dz += 1) {
            result.set(baseX + dx, baseY + dy, baseZ + dz, color);
          }
        }
      }
    }
    return result;
  }

  /**
   * Snapshot of the occupied cells inside the box, keyed by their original packed keys. The returned
   * map is a copy that later grid writes never touch; with `opts.remove` those cells also leave this
   * grid.
   */
  extractBox(box: IntBox3, opts: { remove: boolean }): Map<CellKey, HexColor> {
    const extracted = new Map<CellKey, HexColor>();
    for (const [key, color] of this.cells) {
      const [x, y, z] = unpackKey(key);
      if (!containsCell(box, x, y, z)) continue;
      extracted.set(key, color);
      if (opts.remove) this.cells.delete(key);
    }
    return extracted;
  }
}
