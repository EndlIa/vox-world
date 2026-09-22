import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Matrix4, Vector3 } from 'three';
import { DEFAULT_GRID_MARGIN, WorldGrid } from '../src/three-runtime/grid.js';
import { UniformGrid } from '../src/voxels/uniform/grid.js';

/** A 4 x 4 x 4 block of cells from the origin, at the subdivision asked for. */
function block(subdivision: number): UniformGrid {
  const grid = UniformGrid.create(subdivision);
  for (let x = 0; x < 4; x += 1) {
    for (let y = 0; y < 4; y += 1) {
      for (let z = 0; z < 4; z += 1) grid.set(x, y, z, 0x3366ff);
    }
  }
  return grid;
}

function layer(grid: WorldGrid, name: string): THREE.Group {
  const found = grid.root.getObjectByName(name);
  if (!(found instanceof THREE.Group)) throw new TypeError(`no ${name} layer`);
  return found;
}

/** The base layer's two line sets, by the render order that decides which is drawn last. */
function baseLineSets(grid: WorldGrid): { faint: THREE.LineSegments; bright: THREE.LineSegments } {
  const sets = layer(grid, 'world-grid-base').children.filter(
    (child): child is THREE.LineSegments => child instanceof THREE.LineSegments,
  );
  const sorted = [...sets].sort((a, b) => a.renderOrder - b.renderOrder);
  if (sorted.length !== 2) throw new TypeError(`expected two base line sets, got ${sorted.length}`);
  return { faint: sorted[0]!, bright: sorted[1]! };
}

/** The active object's single lattice line set. */
function latticeLines(grid: WorldGrid): THREE.LineSegments {
  const found = layer(grid, 'world-grid-lattice').children.find(
    (child): child is THREE.LineSegments => child instanceof THREE.LineSegments,
  );
  if (found === undefined) throw new TypeError('the lattice layer holds no line set');
  return found;
}

function vertices(lines: THREE.LineSegments): number[] {
  const attribute = lines.geometry.getAttribute('position');
  return Array.from(attribute.array as ArrayLike<number>);
}

/** The distinct values a line set draws at, sorted: one per line, so a spacing is readable from it. */
function coordinates(lines: THREE.LineSegments, axis: 0 | 2): number[] {
  const values = new Set<number>();
  const array = vertices(lines);
  for (let index = 0; index < array.length; index += 3) values.add(array[index + axis]!);
  return [...values].sort((a, b) => a - b);
}

describe('world grid', () => {
  it('draws a base plane at the world unit with a brighter line every tenth', () => {
    const world = new WorldGrid();
    const { faint, bright } = baseLineSets(world);
    // 200 units: one line per unit on the faint set, one every ten on the bright one, both spanning the plane.
    expect(coordinates(faint, 0)).toEqual([...Array(201).keys()].map((index) => index - 100));
    expect(coordinates(bright, 0)).toEqual([...Array(21).keys()].map((index) => (index - 10) * 10));
    expect(vertices(faint)[1]).toBe(0);
    world.dispose();
  });

  it("draws the active object's lattice at its own cell size, on the plane of its lowest cell", () => {
    const world = new WorldGrid();
    world.showObjectLattice(block(2), new Matrix4().makeTranslation(5, 0, 0));
    const lattice = latticeLines(world);
    // Cells 0..3 at subdivision 2, plus the default margin of cells either side: x from -8 to 12 cells, 0.5 units
    // each, so the lines sit at -4 .. 6 in half units.
    expect(coordinates(lattice, 0)).toEqual([...Array(21).keys()].map((index) => (index - 8) * 0.5));
    expect(vertices(lattice)[1]).toBe(0);
    // The layer carries the object's placement rather than baking it in, so a moved object moves its grid.
    expect(new Vector3().setFromMatrixPosition(lattice.matrix).toArray()).toEqual([5, 0, 0]);
    expect(layer(world, 'world-grid-lattice').visible).toBe(true);
    world.dispose();
  });

  it('cuts the base plane away where the lattice is drawn, and leaves it alone everywhere else', () => {
    const world = new WorldGrid();
    const { faint } = baseLineSets(world);
    const wholePlane = coordinates(faint, 0).length;
    world.showObjectLattice(block(2), new Matrix4());
    const after = vertices(faint);
    // Nothing of the base survives inside the lattice's footprint (-4 .. 6 on both axes): every vertex either
    // sits outside it on x, or outside it on z, or is the cut edge itself.
    for (let index = 0; index < after.length; index += 3) {
      const x = after[index]!;
      const z = after[index + 2]!;
      const insideX = x > -4 && x < 6;
      const insideZ = z > -4 && z < 6;
      expect(insideX && insideZ).toBe(false);
    }
    // The plane is still a plane: the cut takes material out of lines, so the lines it still draws are the same
    // ones, all the way to the edges.
    expect(coordinates(faint, 0)).toHaveLength(wholePlane);
    expect(coordinates(faint, 0)).toContain(-100);
    expect(coordinates(faint, 0)).toContain(100);
    world.dispose();
  });

  it('follows the two switches and the margin', () => {
    const world = new WorldGrid();
    const grid = block(1);
    world.showObjectLattice(grid, new Matrix4());

    world.setMargin(0);
    expect(coordinates(latticeLines(world), 0)).toEqual([0, 1, 2, 3, 4]);
    expect(DEFAULT_GRID_MARGIN).toBe(8);

    world.setObjectVisible(false);
    expect(layer(world, 'world-grid-lattice').visible).toBe(false);
    world.setBaseVisible(false);
    expect(layer(world, 'world-grid-base').visible).toBe(false);
    world.setBaseVisible(true);
    world.setObjectVisible(true);
    expect(layer(world, 'world-grid-lattice').visible).toBe(true);

    // Clearing the lattice restores the whole base plane and hides the layer.
    world.showObjectLattice(undefined, undefined);
    expect(layer(world, 'world-grid-lattice').visible).toBe(false);
    // 201 lines per direction, two segments each, two vertices, three floats: the whole plane is back.
    expect(vertices(baseLineSets(world).faint).length).toBe(201 * 2 * 2 * 3);
    expect(() => world.setMargin(-1)).toThrow(RangeError);
    world.dispose();
  });
});
