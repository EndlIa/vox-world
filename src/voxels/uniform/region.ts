import { KEY_MAX, KEY_MIN, boxCount, normalizeBox, packKey, unpackKey } from './grid.js';
import type { CellKey, HexColor, IntBox3, UniformGrid } from './grid.js';

/**
 * Which cells an edit addresses, decided before any cell is touched: an inclusive integer box, every occupied
 * cell of one colour, or the face-connected island a seed cell belongs to. It is the operand the edit
 * operations take, so naming a region a new way is one variant here plus the branches it needs.
 *
 * A shape is pure input and pure output: it reads no transform, no timeline, and no scene, and every cell in it
 * is one of the owning grid's own integer coordinates — the space the grid's box operations already work in.
 */
export type RegionShape =
  | { kind: 'box'; min: readonly [number, number, number]; max: readonly [number, number, number] }
  | { kind: 'color'; color: HexColor }
  | { kind: 'island'; seed: readonly [number, number, number] };

/**
 * The six face neighbours a flood fill walks. Diagonals are deliberately absent: an island is face-connected,
 * so two blocks that only touch at a corner are two islands.
 */
const NEIGHBOURS: readonly (readonly [number, number, number])[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/** The box a box shape names, ordered and inclusive, exactly as the grid's own box operations take it. */
function boxOf(shape: Extract<RegionShape, { kind: 'box' }>): IntBox3 {
  return normalizeBox(shape.min, shape.max);
}

/**
 * Walks the cells a shape names: every cell of a box, occupied or not and in coordinate order; the grid's own
 * insertion order for a colour; and fill order for an island. A box is the only shape that can name an empty
 * cell, so `color` is absent exactly when the cell a box named is not occupied.
 */
function forEachShapeCell(
  grid: UniformGrid,
  shape: RegionShape,
  visit: (x: number, y: number, z: number, color: HexColor | undefined) => void,
): void {
  if (shape.kind === 'box') {
    const box = boxOf(shape);
    for (let x = box.min[0]; x <= box.max[0]; x += 1) {
      for (let y = box.min[1]; y <= box.max[1]; y += 1) {
        for (let z = box.min[2]; z <= box.max[2]; z += 1) {
          visit(x, y, z, grid.getColor(x, y, z));
        }
      }
    }
    return;
  }
  if (shape.kind === 'color') {
    grid.forEach((x, y, z, color) => {
      if (color === shape.color) visit(x, y, z, color);
    });
    return;
  }
  const [seedX, seedY, seedZ] = shape.seed;
  // An empty seed names no island rather than failing: pointing at nothing is a region of no cells, the same way
  // an inverted box is.
  if (!grid.has(seedX, seedY, seedZ)) return;
  const start = packKey(seedX, seedY, seedZ);
  const seen = new Set<CellKey>([start]);
  const queue: CellKey[] = [start];
  while (queue.length > 0) {
    const key = queue.pop() as CellKey;
    const [x, y, z] = unpackKey(key);
    visit(x, y, z, grid.getColor(x, y, z));
    for (const [dx, dy, dz] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      // A probe outside the packed key space would throw from `packKey`, so the edge is a stop, not a neighbour.
      if (nx < KEY_MIN || nx > KEY_MAX || ny < KEY_MIN || ny > KEY_MAX || nz < KEY_MIN || nz > KEY_MAX) continue;
      const neighbour = packKey(nx, ny, nz);
      if (seen.has(neighbour) || !grid.has(nx, ny, nz)) continue;
      seen.add(neighbour);
      queue.push(neighbour);
    }
  }
}

/** The packed keys of the cells a shape names: what a mutation collects before it starts writing. */
function keysOfShape(grid: UniformGrid, shape: RegionShape): CellKey[] {
  const keys: CellKey[] = [];
  forEachShapeCell(grid, shape, (x, y, z) => {
    keys.push(packKey(x, y, z));
  });
  return keys;
}

/**
 * How many cells a shape names. A box counts its whole extent — the cells a fill would write, occupied or not —
 * while a colour or an island counts the cells it actually reaches, so the count is an upper bound for what a
 * write can add and never a guess.
 */
export function regionCount(grid: UniformGrid, shape: RegionShape): number {
  if (shape.kind === 'box') return boxCount(boxOf(shape));
  let count = 0;
  forEachShapeCell(grid, shape, () => {
    count += 1;
  });
  return count;
}

/**
 * The inclusive corners of the cells a shape names, or `null` when it names none. A box reports its own extent
 * even where it holds no cell, because the extent is what the shape says; the other shapes report the extent of
 * what they found, so an empty island or a colour no cell carries is `null`.
 */
export function regionBounds(grid: UniformGrid, shape: RegionShape): IntBox3 | null {
  if (shape.kind === 'box') return boxOf(shape);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  let found = false;
  forEachShapeCell(grid, shape, (x, y, z) => {
    found = true;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  });
  return found ? { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] } : null;
}

/**
 * Writes every cell a shape names and returns how many it wrote. A box takes the grid's own box fill, so the
 * common path costs what it always did; the other shapes collect their cells first and write after, because
 * walking reads the very map a write mutates.
 */
export function fillRegion(grid: UniformGrid, shape: RegionShape, color: HexColor): number {
  if (shape.kind === 'box') return grid.fillBox(boxOf(shape), color);
  const keys = keysOfShape(grid, shape);
  for (const key of keys) {
    const [x, y, z] = unpackKey(key);
    grid.set(x, y, z, color);
  }
  return keys.length;
}

/** Deletes the occupied cells a shape names and returns how many it removed. */
export function clearRegion(grid: UniformGrid, shape: RegionShape): number {
  if (shape.kind === 'box') return grid.clearBox(boxOf(shape));
  const keys = keysOfShape(grid, shape);
  for (const key of keys) {
    const [x, y, z] = unpackKey(key);
    grid.remove(x, y, z);
  }
  return keys.length;
}

/** Recolors the occupied cells a shape names, never creating one, and returns how many it painted. */
export function paintRegion(grid: UniformGrid, shape: RegionShape, color: HexColor): number {
  if (shape.kind === 'box') return grid.paintBox(boxOf(shape), color);
  const keys = keysOfShape(grid, shape);
  for (const key of keys) {
    const [x, y, z] = unpackKey(key);
    grid.set(x, y, z, color);
  }
  return keys.length;
}
