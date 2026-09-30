import { KEY_MAX, KEY_MIN, UniformGrid } from './grid.js';
import type { HexColor } from './grid.js';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';

/**
 * The primitives the editor can create: a filled or hollow box, a ball, the three faces that meet at the origin, and
 * a noise landscape.
 *
 * A spec names the shape in cells — a primitive is created at the unit lattice, where one cell is one world unit, the
 * same unit an import is measured in — and this file is what turns one into a payload. It holds no project, no
 * placement, no identity, and no budget: the payload is the whole result, and the caller decides where it goes and
 * whether it fits.
 *
 * The behaviour is modelled on the reference editor's generators, adapted to this repository: a terrain here is a
 * solid landscape (each footprint column filled from the ground up) rather than the reference's one-cell sheet, and a
 * sphere is solid rather than a shell between two radii, because a created shape is something to sculpt from.
 */
/** The four kinds a spec can be, which is what a picker offers and what an operation switches on. */
export type PrimitiveKind = 'box' | 'sphere' | 'isometric' | 'terrain';

export type PrimitiveSpec =
  | { kind: 'box'; size: readonly [number, number, number]; hollow: boolean }
  | { kind: 'sphere'; radius: number }
  | { kind: 'isometric'; size: readonly [number, number, number] }
  | { kind: 'terrain'; footprint: readonly [number, number]; height: number; seed: number };

/** The cell a primitive's own space starts at: every shape is built from the origin of its payload. */
const ORIGIN = 0;
/** The noise frequency a terrain samples at, per cell. One constant, so the same seed is the same landscape. */
const TERRAIN_FREQUENCY = 0.17;

/** Raised by every builder for a spec this file cannot draw; the caller validates user input before asking. */
function invalid(detail: string): RangeError {
  return new RangeError(`primitive: ${detail}`);
}

/** The largest per-axis extent the packed key space holds, so a primitive can sit inside it. */
export const MAX_PRIMITIVE_AXIS = KEY_MAX - KEY_MIN + 1;

/** Whole cells at least one, or a `RangeError`: every size a primitive takes is a count of cells. */
function requireCells(value: number, what: string): number {
  if (!Number.isInteger(value) || value < 1) throw invalid(`${what} must be a whole number of cells at least one, got ${value}`);
  if (value > MAX_PRIMITIVE_AXIS) throw invalid(`${what} of ${value} cells does not fit the ${MAX_PRIMITIVE_AXIS}-cell key space`);
  return value;
}

/** A triples of cell counts, each validated. */
function requireSize(size: readonly [number, number, number]): [number, number, number] {
  return [requireCells(size[0], 'a size'), requireCells(size[1], 'a size'), requireCells(size[2], 'a size')];
}

/**
 * An upper bound on the cells a primitive will occupy, for a caller that has to refuse one before it is built: exact
 * for a box and for the isometric corner, the bounding volume for a ball, and the filled footprint for a landscape.
 * A bound is what a budget check wants — refusing too much is recoverable, allocating too much is not.
 */
export function primitiveCellCount(spec: PrimitiveSpec): number {
  switch (spec.kind) {
    case 'box': {
      const [x, y, z] = requireSize(spec.size);
      return spec.hollow ? x * y * z - Math.max(0, x - 2) * Math.max(0, y - 2) * Math.max(0, z - 2) : x * y * z;
    }
    case 'sphere': {
      const radius = requireCells(spec.radius, 'a radius');
      const across = radius * 2 - 1;
      return across * across * across;
    }
    case 'isometric': {
      const [x, y, z] = requireSize(spec.size);
      // The three faces meeting at the origin, counted without double-counting the axes they share.
      return x * y + y * z + z * x - x - y - z + 1;
    }
    case 'terrain': {
      const [x, y] = spec.footprint;
      const width = requireCells(x, 'a footprint');
      const depth = requireCells(y, 'a footprint');
      const height = requireCells(spec.height, 'a height');
      return width * depth * height;
    }
    default:
      return 0;
  }
}

/**
 * The payload a spec asks for, holding its cells in one colour. Coordinates run from the payload's own origin, which
 * is what makes the result placeable at any whole cell of the world lattice.
 */
export function createPrimitive(spec: PrimitiveSpec, color: HexColor): UniformGrid {
  if (!Number.isFinite(color) || color < 0 || color > 0xffffff || !Number.isInteger(color)) {
    throw invalid(`color must be a 0xRRGGBB integer, got ${color}`);
  }
  const grid = UniformGrid.create();
  switch (spec.kind) {
    case 'box': {
      const [x, y, z] = requireSize(spec.size);
      for (let cx = ORIGIN; cx < x; cx += 1) {
        for (let cy = ORIGIN; cy < y; cy += 1) {
          for (let cz = ORIGIN; cz < z; cz += 1) {
            if (spec.hollow && cx > 0 && cy > 0 && cz > 0 && cx < x - 1 && cy < y - 1 && cz < z - 1) continue;
            grid.set(cx, cy, cz, color);
          }
        }
      }
      return grid;
    }
    case 'sphere': {
      const radius = requireCells(spec.radius, 'a radius');
      // A ball that touches its own space: the centre sits half a cell in, and the surface is where the distance from
      // the centre passes the radius, so a radius of one is the single cell at the origin.
      const centre = (radius * 2 - 1) / 2;
      const limit = radius * radius;
      for (let cx = 0; cx < radius * 2 - 1; cx += 1) {
        for (let cy = 0; cy < radius * 2 - 1; cy += 1) {
          for (let cz = 0; cz < radius * 2 - 1; cz += 1) {
            const dx = cx - centre;
            const dy = cy - centre;
            const dz = cz - centre;
            if (dx * dx + dy * dy + dz * dz > limit) continue;
            grid.set(cx, cy, cz, color);
          }
        }
      }
      return grid;
    }
    case 'isometric': {
      const [x, y, z] = requireSize(spec.size);
      // The reference's own shape: the three faces that meet at the origin, which is a corner to build out from.
      for (let cx = 0; cx < x; cx += 1) {
        for (let cy = 0; cy < y; cy += 1) {
          for (let cz = 0; cz < z; cz += 1) {
            if (cx !== 0 && cy !== 0 && cz !== 0) continue;
            grid.set(cx, cy, cz, color);
          }
        }
      }
      return grid;
    }
    case 'terrain': {
      const [width, depth] = spec.footprint;
      const across = requireCells(width, 'a footprint');
      const down = requireCells(depth, 'a footprint');
      const height = requireCells(spec.height, 'a height');
      if (!Number.isInteger(spec.seed)) throw invalid(`a seed must be a whole number, got ${spec.seed}`);
      // The same seed is the same landscape: three's noise is driven by a random function, so it is given a seeded one.
      const noise = new SimplexNoise({ random: mulberry32(spec.seed) });
      for (let cx = 0; cx < across; cx += 1) {
        for (let cy = 0; cy < down; cy += 1) {
          const sampled = noise.noise3d(cx * TERRAIN_FREQUENCY, 0, cy * TERRAIN_FREQUENCY);
          // The noise is -1..1 and the height is a count of cells at least one, so the column is that many cells tall
          // at least: the landscape is solid from its ground up rather than a floating sheet.
          const top = Math.max(0, Math.round(((sampled + 1) / 2) * (height - 1)));
          for (let cz = 0; cz <= top; cz += 1) grid.set(cx, cy, cz, color);
        }
      }
      return grid;
    }
    default:
      throw invalid('unknown kind');
  }
}

/**
 * A small deterministic generator for the noise's own randomness: the same seed asks for the same sequence, which is
 * what makes a terrain reproducible from its spec alone. `mulberry32` is the usual 32-bit mixer for that job.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
