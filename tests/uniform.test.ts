import { beforeEach, describe, expect, it } from 'vitest';
import {
  CELL_SIZE,
  UniformGrid,
  boxCount,
  boxEquals,
  isSubdivision,
  normalizeBox,
  packKey,
  unpackKey,
} from '../src/voxels/uniform/grid.js';
import type { IntBox3 } from '../src/voxels/uniform/grid.js';

describe('packKey / unpackKey', () => {
  it('round-trips coordinates inside [-512, 511]', () => {
    const triples: [number, number, number][] = [
      [-512, -512, -512],
      [511, 511, 511],
      [0, 0, 0],
      [-512, 0, 511],
      [511, -512, 0],
      [0, 511, -512],
      [17, -34, 56],
    ];
    for (const [x, y, z] of triples) {
      expect(unpackKey(packKey(x, y, z))).toEqual([x, y, z]);
    }
    const keys = new Set(triples.map(([x, y, z]) => packKey(x, y, z)));
    expect(keys.size).toBe(triples.length);
  });

  it('throws RangeError outside it', () => {
    expect(() => packKey(-513, 0, 0)).toThrow(RangeError);
    expect(() => packKey(512, 0, 0)).toThrow(RangeError);
    expect(() => packKey(0, -513, 0)).toThrow(RangeError);
    expect(() => packKey(0, 512, 0)).toThrow(RangeError);
    expect(() => packKey(0, 0, -513)).toThrow(RangeError);
    expect(() => packKey(0, 0, 512)).toThrow(RangeError);
    expect(() => packKey(0.5, 0, 0)).toThrow(RangeError);
  });
});

describe('box helpers', () => {
  it('normalizes swapped corners', () => {
    const forward = normalizeBox([-1, 4, 0], [3, 1, 2]);
    const reversed = normalizeBox([3, 1, 2], [-1, 4, 0]);
    expect(forward).toEqual({ min: [-1, 1, 0], max: [3, 4, 2] });
    expect(boxEquals(forward, reversed)).toBe(true);
    expect(forward.min[0]).toBeLessThanOrEqual(forward.max[0]);
    expect(forward.min[1]).toBeLessThanOrEqual(forward.max[1]);
    expect(forward.min[2]).toBeLessThanOrEqual(forward.max[2]);
  });

  it('counts a box volume', () => {
    expect(boxCount(normalizeBox([0, 0, 0], [3, 3, 3]))).toBe(64);
    expect(boxCount(normalizeBox([1, 2, 3], [1, 2, 3]))).toBe(1);
    expect(boxCount(normalizeBox([0, 0, 0], [1, 0, 0]))).toBe(2);
    const inverted: IntBox3 = { min: [1, 1, 1], max: [0, 1, 1] };
    expect(boxCount(inverted)).toBe(0);
  });

  it('compares boxes by corners', () => {
    const box = normalizeBox([0, 0, 0], [1, 1, 1]);
    expect(boxEquals(box, normalizeBox([0, 0, 0], [1, 1, 1]))).toBe(true);
    expect(boxEquals(box, normalizeBox([0, 0, 0], [2, 1, 1]))).toBe(false);
    expect(boxEquals(box, normalizeBox([-1, 0, 0], [1, 1, 1]))).toBe(false);
    expect(boxEquals(box, { min: box.min, max: [1, 1, 1] })).toBe(true);
  });
});

describe('UniformGrid cells', () => {
  let grid: UniformGrid;

  beforeEach(() => {
    grid = UniformGrid.create();
  });

  it('reports size, presence, and color', () => {
    expect(grid.size).toBe(0);
    expect(grid.has(1, 2, 3)).toBe(false);
    expect(grid.getColor(1, 2, 3)).toBeUndefined();
    grid.set(1, 2, 3, 0xff0000);
    expect(grid.size).toBe(1);
    expect(grid.has(1, 2, 3)).toBe(true);
    expect(grid.getColor(1, 2, 3)).toBe(0xff0000);
    expect(grid.has(1, 2, 4)).toBe(false);
    let visited = 0;
    grid.forEach((x, y, z, color) => {
      visited += 1;
      expect([x, y, z, color]).toEqual([1, 2, 3, 0xff0000]);
    });
    expect(visited).toBe(grid.size);
  });

  it('overwrites an occupied cell\u2019s color', () => {
    grid.set(1, 1, 1, 0x00ff00);
    grid.set(1, 1, 1, 0x0000ff);
    expect(grid.size).toBe(1);
    expect(grid.getColor(1, 1, 1)).toBe(0x0000ff);
  });

  it('returns presence from remove', () => {
    grid.set(2, 2, 2, 0x123456);
    expect(grid.remove(2, 2, 2)).toBe(true);
    expect(grid.size).toBe(0);
    expect(grid.has(2, 2, 2)).toBe(false);
    expect(grid.remove(2, 2, 2)).toBe(false);
  });
});

describe('UniformGrid regions', () => {
  let grid: UniformGrid;

  beforeEach(() => {
    grid = UniformGrid.create();
  });

  it('fills and counts writes', () => {
    const box = normalizeBox([0, 0, 0], [1, 1, 1]);
    expect(grid.fillBox(box, 0x00ff00)).toBe(8);
    expect(boxCount(box)).toBe(8);
    expect(grid.size).toBe(8);
    expect(grid.fillBox(box, 0x0000ff)).toBe(8);
    expect(grid.size).toBe(8);
    expect(grid.getColor(1, 1, 1)).toBe(0x0000ff);
    expect(grid.getColor(0, 0, 0)).toBe(0x0000ff);
    const inverted: IntBox3 = { min: [3, 3, 3], max: [2, 2, 2] };
    expect(grid.fillBox(inverted, 0xff0000)).toBe(0);
    expect(grid.size).toBe(8);
  });

  it('clears and counts removals', () => {
    grid.set(0, 0, 0, 0x111111);
    grid.set(1, 0, 0, 0x222222);
    grid.set(0, 1, 0, 0x333333);
    grid.set(3, 3, 3, 0x444444);
    const box = normalizeBox([0, 0, 0], [1, 1, 1]);
    expect(grid.clearBox(box)).toBe(3);
    expect(grid.size).toBe(1);
    expect(grid.has(0, 0, 0)).toBe(false);
    expect(grid.has(3, 3, 3)).toBe(true);
    expect(grid.clearBox(box)).toBe(0);
    expect(grid.size).toBe(1);
  });

  it('paints only occupied cells', () => {
    grid.set(0, 0, 0, 0x101010);
    grid.set(2, 2, 2, 0x202020);
    const box = normalizeBox([0, 0, 0], [2, 2, 2]);
    const painted = grid.paintBox(box, 0xff00ff);
    expect(painted).toBe(2);
    expect(painted).toBeLessThanOrEqual(boxCount(box));
    expect(grid.size).toBe(2);
    expect(grid.getColor(0, 0, 0)).toBe(0xff00ff);
    expect(grid.getColor(2, 2, 2)).toBe(0xff00ff);
    expect(grid.has(1, 1, 1)).toBe(false);
    expect(grid.paintBox(normalizeBox([3, 3, 3], [3, 3, 3]), 0x000000)).toBe(0);
  });

  it('bounds the occupied set and returns null when empty', () => {
    expect(grid.bounds()).toBeNull();
    grid.set(1, 1, 2, 0xffffff);
    grid.set(3, 2, 3, 0xffffff);
    grid.set(2, 3, 1, 0xffffff);
    expect(grid.bounds()).toEqual({ min: [1, 1, 1], max: [3, 3, 3] });
    grid.fillBox(normalizeBox([0, 0, 0], [3, 3, 3]), 0x010203);
    expect(grid.bounds()).toEqual({ min: [0, 0, 0], max: [3, 3, 3] });
    grid.clearBox(normalizeBox([0, 0, 0], [3, 3, 3]));
    expect(grid.bounds()).toBeNull();
  });
});

describe('extractBox', () => {
  let grid: UniformGrid;

  beforeEach(() => {
    grid = UniformGrid.create();
    grid.set(0, 0, 0, 0xaa0000);
    grid.set(1, 0, 0, 0x00aa00);
    grid.set(2, 0, 0, 0x0000aa);
  });

  it('extracts without changing the grid', () => {
    const box = normalizeBox([0, 0, 0], [1, 0, 0]);
    const extracted = grid.extractBox(box, { remove: false });
    expect(extracted.size).toBe(2);
    expect([...extracted.keys()].map((key) => unpackKey(key))).toEqual([
      [0, 0, 0],
      [1, 0, 0],
    ]);
    expect(extracted.get(packKey(0, 0, 0))).toBe(0xaa0000);
    expect(extracted.get(packKey(1, 0, 0))).toBe(0x00aa00);
    expect(extracted.has(packKey(2, 0, 0))).toBe(false);
    expect(grid.size).toBe(3);
    for (const [key, color] of extracted) {
      const [x, y, z] = unpackKey(key);
      expect(grid.getColor(x, y, z)).toBe(color);
    }
    grid.set(0, 0, 0, 0xffffff);
    expect(extracted.get(packKey(0, 0, 0))).toBe(0xaa0000);
  });

  it('extracts and removes the cells', () => {
    const box = normalizeBox([0, 0, 0], [1, 0, 0]);
    const extracted = grid.extractBox(box, { remove: true });
    expect([...extracted.keys()].map((key) => unpackKey(key))).toEqual([
      [0, 0, 0],
      [1, 0, 0],
    ]);
    expect(grid.size).toBe(1);
    expect(grid.has(0, 0, 0)).toBe(false);
    expect(grid.has(1, 0, 0)).toBe(false);
    expect(grid.getColor(2, 0, 0)).toBe(0x0000aa);
    expect(grid.bounds()).toEqual({ min: [2, 0, 0], max: [2, 0, 0] });
  });
});

describe('subdivision', () => {
  it('is one cell per world unit by default, and a power of two otherwise', () => {
    const unit = UniformGrid.create();
    expect(unit.subdivision).toBe(1);
    expect(unit.cellSize).toBe(CELL_SIZE);

    const fine = UniformGrid.create(4);
    expect(fine.subdivision).toBe(4);
    expect(fine.cellSize).toBe(0.25);
  });

  it('refuses a level that is not a positive power of two', () => {
    for (const level of [0, -2, 3, 1.5, Number.NaN]) {
      expect(() => UniformGrid.create(level)).toThrow(RangeError);
      expect(isSubdivision(level)).toBe(false);
    }
    for (const level of [1, 2, 512]) expect(isSubdivision(level)).toBe(true);
  });

  it('replaces each cell with a block of itself, colors and all', () => {
    const grid = UniformGrid.create();
    grid.set(0, 0, 0, 0xff0000);
    grid.set(-1, 0, 2, 0x00ff00);

    const fine = grid.subdividedBy(1);
    expect(fine.subdivision).toBe(2);
    expect(fine.cellSize).toBe(0.5);
    expect(fine.size).toBe(16);
    // The block is the cell: (0, 0, 0) spans (0..1)^3, and the negative cell keeps its own color and frame.
    expect(fine.bounds()).toEqual({ min: [-2, 0, 0], max: [1, 1, 5] });
    expect(fine.getColor(1, 1, 1)).toBe(0xff0000);
    expect(fine.getColor(1, 0, 0)).toBe(0xff0000);
    expect(fine.getColor(-2, 0, 4)).toBe(0x00ff00);
    expect(fine.getColor(-1, 1, 5)).toBe(0x00ff00);
    // Nothing outside the blocks: the red cell's block stops at x = 1, so x = 2 is empty.
    expect(fine.getColor(2, 0, 0)).toBeUndefined();
    // The source is untouched: refinement never writes back.
    expect(grid.subdivision).toBe(1);
    expect(grid.size).toBe(2);
  });

  it('can be applied twice for four levels, and refuses a non-positive level count', () => {
    const grid = UniformGrid.create();
    grid.set(3, 0, 0, 0x3366ff);
    const twice = grid.subdividedBy(1).subdividedBy(1);
    expect(twice.subdivision).toBe(4);
    expect(twice.size).toBe(64);
    expect(twice.bounds()).toEqual({ min: [12, 0, 0], max: [15, 3, 3] });
    expect(() => grid.subdividedBy(0)).toThrow(RangeError);
  });
});
