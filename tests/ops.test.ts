import { Euler, Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Project, type ObjectId } from '../src/document/project.js';
import { setObjectAlignToGrid, setObjectSubdivision, setTransformFromWorldMatrix } from '../src/editor/ops.js';
import { UniformGrid } from '../src/voxels/uniform/grid.js';

/** A project shaped like the editor's: one group, and one object under a moved and turned parent. */
function scene(): { project: Project; parentId: ObjectId; childId: ObjectId } {
  const project = new Project();
  const parent = project.createObject({ name: 'parent', representation: 'empty' });
  parent.transform.position.set(-3, 1, 2);
  parent.transform.quaternion.setFromEuler(new Euler(0.4, -0.9, 0.3));
  const child = project.createObject({ name: 'child', parentId: parent.id, representation: 'empty' });
  return { project, parentId: parent.id, childId: child.id };
}

describe('grid alignment', () => {
  it('pulls the object onto the nearest cell as the flag turns on, and writes only the flag as it turns off', () => {
    const { project, childId } = scene();
    const child = project.get(childId)!;
    child.transform.position.set(1.4, 0, -2.6);

    expect(setObjectAlignToGrid(project, childId, true).ok).toBe(true);
    expect(child.transform.position.toArray()).toEqual([1, 0, -3]);

    child.transform.position.set(0.5, 0.5, 0.5);
    expect(setObjectAlignToGrid(project, childId, false).ok).toBe(true);
    expect(child.alignToGrid).toBe(false);
    expect(child.transform.position.toArray()).toEqual([0.5, 0.5, 0.5]);
  });

  it('stores the whole cells a drag previewed for the same matrix', () => {
    const { project, childId } = scene();
    const dragged = new Matrix4().makeTranslation(2.37, -1.62, 0.28);

    const previewed = project.alignWorldMatrix(childId, dragged);
    const result = setTransformFromWorldMatrix(project, childId, dragged);
    expect(result.ok).toBe(true);

    // What the object now holds, seen from the parent's frame, is the placement the preview put on screen.
    const child = project.get(childId)!;
    const stored = new Matrix4().compose(
      child.transform.position,
      child.transform.quaternion,
      child.transform.scale,
    );
    const local = project.worldMatrix(project.get(childId)!.parentId!).invert().multiply(previewed);
    expect(stored.elements[12]).toBeCloseTo(local.elements[12]!, 9);
    expect(stored.elements[13]).toBeCloseTo(local.elements[13]!, 9);
    expect(stored.elements[14]).toBeCloseTo(local.elements[14]!, 9);
    for (const value of child.transform.position.toArray()) expect(Number.isInteger(value)).toBe(true);
  });

  it('stores a placement between cells while the flag is off', () => {
    const { project, childId } = scene();
    project.get(childId)!.alignToGrid = false;
    const dragged = new Matrix4().makeTranslation(2.37, -1.62, 0.28);

    expect(setTransformFromWorldMatrix(project, childId, dragged).ok).toBe(true);
    const world = project.worldMatrix(childId).elements;
    expect(world[12]).toBeCloseTo(2.37, 9);
    expect(world[13]).toBeCloseTo(-1.62, 9);
    expect(world[14]).toBeCloseTo(0.28, 9);
  });
});

describe('subdivision', () => {
  /** A 2x2x2 cube at subdivision 1, placed on the lattice so alignment survives a subdivision. */
  function cube(): { project: Project; objectId: ObjectId } {
    const project = new Project();
    const grid = UniformGrid.create();
    for (let x = 0; x < 2; x += 1) {
      for (let y = 0; y < 2; y += 1) {
        for (let z = 0; z < 2; z += 1) grid.set(x, y, z, 0x3366ff);
      }
    }
    const object = project.createVoxelObject({
      name: 'cube',
      maskColor: 0x112233,
      payload: { kind: 'uniform', grid },
      position: new Vector3(1, 2, 3),
    });
    return { project, objectId: object.id };
  }

  it('replaces every cell with a block of itself, without moving the object', () => {
    const { project, objectId } = cube();
    const before = project.get(objectId)!;

    expect(setObjectSubdivision(project, objectId, 2).ok).toBe(true);
    const grid = project.get(objectId)!.uniform!;
    expect(grid.subdivision).toBe(2);
    expect(grid.cellSize).toBe(0.5);
    expect(grid.size).toBe(64);
    // The blocks are the old cells: one color, and the 2x2x2 cube now spans 0..3 on every axis, so the old
    // (0, 0, 0) covers (0..1)^3 and the old (1, 0, 0) starts at (2, 0, 0).
    expect(grid.bounds()).toEqual({ min: [0, 0, 0], max: [3, 3, 3] });
    expect(grid.getColor(1, 1, 1)).toBe(0x3366ff);
    expect(grid.getColor(1, 0, 0)).toBe(0x3366ff);
    expect(grid.getColor(2, 0, 0)).toBe(0x3366ff);
    // Placement and alignment are untouched, so nothing about the object's world pose changed.
    expect(before.transform.position.toArray()).toEqual([1, 2, 3]);
    expect(before.alignToGrid).toBe(true);
    expect(project.alignedPosition(objectId, before.transform.position).toArray()).toEqual([1, 2, 3]);
  });

  it('treats the level it already holds as done and refuses to go back down', () => {
    const { project, objectId } = cube();
    expect(setObjectSubdivision(project, objectId, 1).ok).toBe(true);
    expect(project.get(objectId)!.uniform!.size).toBe(8);

    expect(setObjectSubdivision(project, objectId, 2).ok).toBe(true);
    const coarser = setObjectSubdivision(project, objectId, 1);
    expect(coarser.ok).toBe(false);
    if (coarser.ok) return;
    expect(coarser.error).toBe('unsupported-subdivision');
    expect(project.get(objectId)!.uniform!.subdivision).toBe(2);
  });

  it('refuses a level whose blocks would leave the packed key space', () => {
    const project = new Project();
    const grid = UniformGrid.create();
    grid.set(300, 0, 0, 0x3366ff);
    const object = project.createVoxelObject({
      name: 'far',
      maskColor: 0x112233,
      payload: { kind: 'uniform', grid },
      position: new Vector3(0, 0, 0),
    });

    const result = setObjectSubdivision(project, object.id, 2);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('exceeds-grid');
    expect(project.get(object.id)!.uniform!.subdivision).toBe(1);
  });

  it('refuses an object with no grid, and a level that is not a power of two', () => {
    const project = new Project();
    const group = project.createObject({ name: 'group', representation: 'empty' });
    const result = setObjectSubdivision(project, group.id, 2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('wrong-representation');

    const { objectId } = cube();
    expect(() => setObjectSubdivision(project, objectId, 3)).toThrow(RangeError);
  });
});
