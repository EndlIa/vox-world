import { describe, expect, it } from 'vitest';
import { createPrimitive, primitiveCellCount } from '../src/voxels/uniform/generator.js';
import type { PrimitiveSpec } from '../src/voxels/uniform/generator.js';
import type { UniformGrid } from '../src/voxels/uniform/grid.js';

const COLOR = 0x3366ff;

/** The height of every column of a landscape's footprint, as one string: two terrains are the same landscape when
 *  their columns match, which is what a seed decides. */
function profile(grid: UniformGrid, across: number): string {
  let heights = '';
  for (let x = 0; x < across; x += 1) {
    for (let y = 0; y < across; y += 1) {
      let top = 0;
      while (grid.has(x, y, top)) top += 1;
      heights += top;
    }
  }
  return heights;
}

describe('box', () => {
  it('fills its whole extent', () => {
    const spec: PrimitiveSpec = { kind: 'box', size: [2, 3, 1], hollow: false };
    const grid = createPrimitive(spec, COLOR);
    expect(grid.size).toBe(6);
    expect(primitiveCellCount(spec)).toBe(6);
    expect(grid.bounds()).toEqual({ min: [0, 0, 0], max: [1, 2, 0] });
    expect(grid.getColor(1, 2, 0)).toBe(COLOR);
  });

  it('leaves out the interior when it is hollow', () => {
    const shell = createPrimitive({ kind: 'box', size: [3, 3, 3], hollow: true }, COLOR);
    expect(shell.size).toBe(26);
    expect(shell.has(1, 1, 1)).toBe(false);
    expect(shell.has(0, 1, 1)).toBe(true);
    // Two cells thick is all surface: hollowing it changes nothing at all.
    expect(createPrimitive({ kind: 'box', size: [2, 2, 2], hollow: true }, COLOR).size).toBe(8);
  });
});

describe('sphere', () => {
  it('is one cell at radius one', () => {
    expect(createPrimitive({ kind: 'sphere', radius: 1 }, COLOR).size).toBe(1);
  });

  it('is a ball at radius two: its centre is inside and its corners are not', () => {
    const ball = createPrimitive({ kind: 'sphere', radius: 2 }, COLOR);
    expect(ball.has(1, 1, 1)).toBe(true);
    expect(ball.has(0, 0, 0)).toBe(false);
    expect(ball.size).toBeGreaterThan(0);
    expect(ball.size).toBeLessThanOrEqual(primitiveCellCount({ kind: 'sphere', radius: 2 }));
    expect(ball.bounds()).toEqual({ min: [0, 0, 0], max: [2, 2, 2] });
  });
});

describe('isometric', () => {
  it('draws the three faces that meet at the origin, and only them', () => {
    const spec: PrimitiveSpec = { kind: 'isometric', size: [3, 3, 3] };
    const corner = createPrimitive(spec, COLOR);
    // 9 cells per face, minus the three 3-cell edges they share, plus the origin they all share.
    expect(corner.size).toBe(19);
    expect(primitiveCellCount(spec)).toBe(19);
    expect(corner.has(0, 0, 0)).toBe(true);
    expect(corner.has(0, 2, 2)).toBe(true);
    expect(corner.has(2, 0, 1)).toBe(true);
    expect(corner.has(1, 1, 1)).toBe(false);
  });
});

describe('terrain', () => {
  const spec: PrimitiveSpec = { kind: 'terrain', footprint: [8, 8], height: 6, seed: 7 };

  it('is the same landscape for the same seed, and a different one for another', () => {
    const first = createPrimitive(spec, COLOR);
    const again = createPrimitive(spec, COLOR);
    const other = createPrimitive({ ...spec, seed: 8 }, COLOR);
    expect(profile(first, 8)).toBe(profile(again, 8));
    expect(profile(first, 8)).not.toBe(profile(other, 8));
  });

  it('fills every column from the ground up, inside the height it was asked for', () => {
    const grid = createPrimitive(spec, COLOR);
    const bounds = grid.bounds();
    expect(bounds?.min[2]).toBe(0);
    expect(bounds?.max[2]).toBeLessThanOrEqual(5);
    for (let x = 0; x < 8; x += 1) {
      for (let y = 0; y < 8; y += 1) {
        let top = 0;
        while (grid.has(x, y, top)) top += 1;
        for (let z = 0; z < 6; z += 1) expect(grid.has(x, y, z)).toBe(z < top);
      }
    }
    expect(primitiveCellCount(spec)).toBe(8 * 8 * 6);
  });
});

describe('specs it cannot draw', () => {
  it('throws for a size of zero, a fractional radius, an axis past the key space, and a height of zero', () => {
    expect(() => createPrimitive({ kind: 'box', size: [0, 1, 1], hollow: false }, COLOR)).toThrow(RangeError);
    expect(() => createPrimitive({ kind: 'sphere', radius: 1.5 }, COLOR)).toThrow(RangeError);
    expect(() => createPrimitive({ kind: 'box', size: [1024, 1, 1], hollow: false }, COLOR)).toThrow(RangeError);
    expect(() => createPrimitive({ kind: 'terrain', footprint: [4, 4], height: 0, seed: 1 }, COLOR)).toThrow(RangeError);
    expect(() => createPrimitive({ kind: 'isometric', size: [2, 2, 2] }, 0x1000000)).toThrow(RangeError);
  });
});
