import { describe, expect, it } from 'vitest';
import { KEY_MAX, UniformGrid } from '../src/voxels/uniform/grid.js';
import { clearRegion, fillRegion, paintRegion, regionBounds, regionCount } from '../src/voxels/uniform/region.js';
import type { RegionShape } from '../src/voxels/uniform/region.js';

/** A grid holding the given cells, all in one colour unless the caller says otherwise. */
function gridOf(cells: [number, number, number][], color = 0x112233): UniformGrid {
  const grid = UniformGrid.create();
  for (const [x, y, z] of cells) grid.set(x, y, z, color);
  return grid;
}

describe('region bounds and count', () => {
  it('reports a box by its own extent, even where it holds nothing', () => {
    const grid = gridOf([]);
    const shape: RegionShape = { kind: 'box', min: [2, 1, 0], max: [2, 4, 0] };
    expect(regionCount(grid, shape)).toBe(4);
    expect(regionBounds(grid, shape)).toEqual({ min: [2, 1, 0], max: [2, 4, 0] });
  });

  it('reports a colour nowhere in the grid as no cells at all', () => {
    const grid = gridOf([[0, 0, 0]], 0x0000ff);
    expect(regionCount(grid, { kind: 'color', color: 0xff0000 })).toBe(0);
    expect(regionBounds(grid, { kind: 'color', color: 0xff0000 })).toBeNull();
  });

  it('spans every cell of a colour, however far apart they are', () => {
    const grid = UniformGrid.create();
    grid.set(-3, 0, 0, 0xaa0000);
    grid.set(0, 0, 0, 0x00aa00);
    grid.set(4, 2, 1, 0xaa0000);
    const shape: RegionShape = { kind: 'color', color: 0xaa0000 };
    expect(regionCount(grid, shape)).toBe(2);
    expect(regionBounds(grid, shape)).toEqual({ min: [-3, 0, 0], max: [4, 2, 1] });
  });
});

describe('island region', () => {
  it('reaches face neighbours and stops at a diagonal', () => {
    // A 2x2 wall on the z = 0 plane, plus one cell that only touches it at a corner.
    const grid = gridOf([
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
      [2, 2, 1],
    ]);
    const shape: RegionShape = { kind: 'island', seed: [0, 0, 0] };
    expect(regionCount(grid, shape)).toBe(4);
    expect(regionBounds(grid, shape)).toEqual({ min: [0, 0, 0], max: [1, 1, 0] });
  });

  it('names nothing when the seed cell is empty', () => {
    const grid = gridOf([[0, 0, 0]]);
    const shape: RegionShape = { kind: 'island', seed: [9, 9, 9] };
    expect(regionCount(grid, shape)).toBe(0);
    expect(regionBounds(grid, shape)).toBeNull();
    expect(clearRegion(grid, shape)).toBe(0);
    expect(grid.has(0, 0, 0)).toBe(true);
  });

  it('does not walk past the edge of the key space', () => {
    const grid = gridOf([[KEY_MAX, KEY_MAX, KEY_MAX]]);
    const shape: RegionShape = { kind: 'island', seed: [KEY_MAX, KEY_MAX, KEY_MAX] };
    expect(regionCount(grid, shape)).toBe(1);
    expect(() => clearRegion(grid, shape)).not.toThrow();
    expect(grid.size).toBe(0);
  });

  it('separates two blocks that only touch at a corner', () => {
    const grid = gridOf([
      [0, 0, 0],
      [1, 1, 0],
    ]);
    expect(regionCount(grid, { kind: 'island', seed: [0, 0, 0] })).toBe(1);
    expect(regionCount(grid, { kind: 'island', seed: [1, 1, 0] })).toBe(1);
  });
});

describe('region writes', () => {
  it('clears one colour and leaves the others alone', () => {
    const grid = UniformGrid.create();
    grid.set(0, 0, 0, 0x111111);
    grid.set(1, 0, 0, 0x111111);
    grid.set(2, 0, 0, 0x222222);
    expect(clearRegion(grid, { kind: 'color', color: 0x111111 })).toBe(2);
    expect(grid.size).toBe(1);
    expect(grid.getColor(2, 0, 0)).toBe(0x222222);
  });

  it('paints a box only where cells already are', () => {
    const grid = gridOf([[0, 0, 0]]);
    const shape: RegionShape = { kind: 'box', min: [-1, -1, -1], max: [1, 1, 1] };
    expect(paintRegion(grid, shape, 0xabcdef)).toBe(1);
    expect(grid.getColor(0, 0, 0)).toBe(0xabcdef);
    expect(grid.size).toBe(1);
  });

  it('fills a box with cells it did not have', () => {
    const grid = gridOf([]);
    const shape: RegionShape = { kind: 'box', min: [0, 0, 0], max: [1, 1, 1] };
    expect(fillRegion(grid, shape, 0x445566)).toBe(8);
    expect(grid.size).toBe(8);
    expect(grid.getColor(1, 1, 1)).toBe(0x445566);
  });

  it('recolours an island rather than its neighbours', () => {
    const grid = UniformGrid.create();
    grid.set(0, 0, 0, 0x101010);
    grid.set(1, 0, 0, 0x101010);
    grid.set(5, 0, 0, 0x202020);
    expect(paintRegion(grid, { kind: 'island', seed: [0, 0, 0] }, 0xffffff)).toBe(2);
    expect(grid.getColor(1, 0, 0)).toBe(0xffffff);
    expect(grid.getColor(5, 0, 0)).toBe(0x202020);
  });
});
