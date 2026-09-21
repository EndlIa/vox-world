/**
 * The textual identity of an octree leaf: encode, decode, and navigate the root-to-leaf path of
 * octant indices.
 *
 * The format is `"<depth>:<digit>..."` — the decimal depth, a colon, then exactly `depth` decimal
 * digits in `0..7`, each the octant taken at that level. The root leaf is `"0:"`. This module is the
 * one place where the format is defined; every other module treats ids as opaque strings.
 */

export type LeafId = string;

export const OCTANT_COUNT = 8;

/**
 * The eight octants of a coordinate triple: the parity of each axis, so it is correct for the
 * negative uniform coordinates as well as the non-negative octree ones.
 */
export function octantOf(x: number, y: number, z: number): number {
  return (x & 1) | ((y & 1) << 1) | ((z & 1) << 2);
}

/** Validates a path and renders it as `"<depth>:<digits>"`; it never normalizes or pads. */
export function encodeLeafId(depth: number, path: readonly number[]): LeafId {
  if (!Number.isInteger(depth) || depth < 0) {
    throw new RangeError(`depth must be a non-negative integer, got ${depth}`);
  }
  if (path.length !== depth) {
    throw new RangeError(`path length ${path.length} does not match depth ${depth}`);
  }
  for (const digit of path) {
    if (!Number.isInteger(digit) || digit < 0 || digit >= OCTANT_COUNT) {
      throw new RangeError(`octant digit must be an integer in [0, ${OCTANT_COUNT - 1}], got ${digit}`);
    }
  }
  return `${depth}:${path.join('')}`;
}

function malformedId(id: LeafId): TypeError {
  return new TypeError(`malformed leaf id "${id}"`);
}

/** Splits on the first colon, parses the depth, and requires exactly `depth` digits in `0..7`. */
export function decodeLeafId(id: LeafId): { depth: number; path: number[] } {
  const colon = id.indexOf(':');
  if (colon < 0) throw malformedId(id);
  const depthText = id.slice(0, colon);
  const digits = id.slice(colon + 1);
  if (depthText.length === 0) throw malformedId(id);
  for (const char of depthText) {
    if (char < '0' || char > '9') throw malformedId(id);
  }
  const depth = Number(depthText);
  if (digits.length !== depth) throw malformedId(id);
  const path: number[] = new Array<number>(depth);
  for (let level = 0; level < depth; level += 1) {
    const digit = digits.charCodeAt(level) - 48;
    if (digit < 0 || digit >= OCTANT_COUNT) throw malformedId(id);
    path[level] = digit;
  }
  return { depth, path };
}

/** Drops the last digit and decrements the depth; `null` for the root leaf. */
export function parentLeafId(id: LeafId): LeafId | null {
  const { depth, path } = decodeLeafId(id);
  if (depth === 0) return null;
  return encodeLeafId(depth - 1, path.slice(0, depth - 1));
}

/** The eight ids `"<depth+1>:<digits><k>"` for `k` in `0..7`, in octant order. */
export function childLeafIds(id: LeafId): LeafId[] {
  const { depth, path } = decodeLeafId(id);
  const children: LeafId[] = [];
  for (let octant = 0; octant < OCTANT_COUNT; octant += 1) {
    children.push(encodeLeafId(depth + 1, [...path, octant]));
  }
  return children;
}
