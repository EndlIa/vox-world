import { Euler, Matrix4 } from 'three';
import { describe, expect, it } from 'vitest';
import { Project, type ObjectId } from '../src/document/project.js';
import { setObjectAlignToGrid, setTransformFromWorldMatrix } from '../src/editor/ops.js';

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
