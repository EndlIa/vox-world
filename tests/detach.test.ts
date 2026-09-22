import { Euler, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { detachUniformBox } from '../src/document/detach.js';
import { Project, type ObjectId, type SceneObject } from '../src/document/project.js';
import { CELL_SIZE, UniformGrid, type IntBox3 } from '../src/voxels/uniform/grid.js';

/** No `Project` allocates this, because allocated ids always match `obj-<n>`. */
const UNKNOWN_ID: ObjectId = 'obj-unknown';
/** Inclusive box over cells `(-2, -1, 0)`..`(-1, 0, 0)`, three of which are occupied. */
const BOX: IntBox3 = { min: [-2, -1, 0], max: [-1, 0, 0] };

/**
 * The palette walk is deterministic, so a fresh project advanced to the same cursor reports the
 * color a detach takes next.
 */
function maskColorAt(cursor: number): number {
  const probe = new Project();
  for (let i = 0; i < cursor; i += 1) probe.nextMaskColor();
  return probe.nextMaskColor();
}

function uniformFixture() {
  const project = new Project();
  const grid = UniformGrid.create();
  grid.set(-2, -1, 0, 0xff0000);
  grid.set(-1, -1, 0, 0x00ff00);
  grid.set(-2, 0, 0, 0x0000ff);
  grid.set(5, 5, 5, 0xffffff);
  const source = project.createVoxelObject({
    name: 'terrain',
    maskColor: 0x112233,
    payload: { kind: 'uniform', grid },
    position: new Vector3(10, 0, -3),
  });
  return { project, grid, source };
}

/**
 * The world position of a cell center, in the object's own frame: cell `i` spans `[i, i + 1]` cells and a cell is
 * `CELL_SIZE / subdivision` world units (D41, D43), so its center is half a cell past its index.
 */
function cellCenterWorld(project: Project, object: SceneObject, x: number, y: number, z: number) {
  const cell = object.uniform?.cellSize ?? CELL_SIZE;
  return new Vector3((x + 0.5) * cell, (y + 0.5) * cell, (z + 0.5) * cell)
    .applyMatrix4(project.worldMatrix(object.id));
}

describe('detachUniformBox', () => {
  it('re-indexes the cells so the region min corner is the new local origin', () => {
    const { project, source } = uniformFixture();
    const result = detachUniformBox(project, source.id, BOX);
    if (!result.ok) throw new Error(result.detail);
    const detached = project.get(result.objectId);
    const grid = detached?.uniform;
    if (grid === undefined) throw new Error('detached object has no uniform payload');

    expect(grid.size).toBe(3);
    expect(grid.bounds()).toEqual({ min: [0, 0, 0], max: [1, 1, 0] });
    expect(grid.getColor(0, 0, 0)).toBe(0xff0000);
    expect(grid.getColor(1, 0, 0)).toBe(0x00ff00);
    expect(grid.getColor(0, 1, 0)).toBe(0x0000ff);
    expect(grid.getColor(1, 1, 0)).toBeUndefined();
  });

  it('sets a translation-only transform equal to the region world min corner', () => {
    const { project, source } = uniformFixture();
    const result = detachUniformBox(project, source.id, BOX);
    if (!result.ok) throw new Error(result.detail);
    const detached = project.get(result.objectId);
    if (detached === undefined) throw new Error('detached object is missing');

    expect(detached.transform.position.toArray()).toEqual([
      BOX.min[0] + 10,
      BOX.min[1],
      BOX.min[2] - 3,
    ]);
    expect(detached.transform.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    expect(detached.transform.scale.toArray()).toEqual([1, 1, 1]);
    expect(detached.representation).toBe('uniform');
    expect(detached.visible).toBe(true);
  });

  it('preserves the world position of every extracted cell', () => {
    const { project, source } = uniformFixture();
    const cells: readonly (readonly [number, number, number])[] = [
      [-2, -1, 0],
      [-1, -1, 0],
      [-2, 0, 0],
    ];
    const before = cells.map(([x, y, z]) => cellCenterWorld(project, source, x, y, z));
    const result = detachUniformBox(project, source.id, BOX);
    if (!result.ok) throw new Error(result.detail);
    const detached = project.get(result.objectId);
    if (detached === undefined) throw new Error('detached object is missing');

    cells.forEach(([x, y, z], index) => {
      const after = cellCenterWorld(
        project,
        detached,
        x - BOX.min[0],
        y - BOX.min[1],
        z - BOX.min[2],
      );
      expect(after.toArray()).toEqual(before[index]?.toArray());
    });
  });

  it("leaves the flag off when the parent it inherits is turned, instead of snapping the region", () => {
    const { project, source } = uniformFixture();
    const parent = project.createObject({ name: 'turn', representation: 'empty' });
    parent.transform.quaternion.setFromEuler(new Euler(0.4, -0.9, 0.3));
    expect(project.reparent(source.id, parent.id).ok).toBe(true);
    parent.transform.position.set(0.25, 0, 0);

    const result = detachUniformBox(project, source.id, BOX);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const part = project.get(result.objectId)!;
    // The region stays exactly where D23 put it, between cells, so the object is not claimed to be on the
    // lattice — and it was not moved onto it either.
    expect(part.alignToGrid).toBe(false);
    const expected = cellCenterWorld(project, source, -2, -1, 0);
    const actual = cellCenterWorld(project, part, 0, 0, 0);
    expect(actual.x).toBeCloseTo(expected.x, 9);
    expect(actual.y).toBeCloseTo(expected.y, 9);
    expect(actual.z).toBeCloseTo(expected.z, 9);
  });

  it("gives the new object the source's subdivision, with the region still in place", () => {
    const { project, grid, source } = uniformFixture();
    const fine = project.createVoxelObject({
      name: 'fine',
      maskColor: 0x445566,
      payload: { kind: 'uniform', grid: grid.subdividedBy(1) },
      position: new Vector3(10, 0, -3),
    });
    const box: IntBox3 = { min: [-4, -2, 0], max: [-3, -1, 1] };

    const result = detachUniformBox(project, fine.id, box);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const part = project.get(result.objectId)!;
    expect(part.uniform?.subdivision).toBe(2);
    // The same cells of the finer grid sit where they were: cell (-4, -2, 0) is now the part's (0, 0, 0).
    const expected = cellCenterWorld(project, fine, -4, -2, 0);
    const actual = cellCenterWorld(project, part, 0, 0, 0);
    expect(actual.x).toBeCloseTo(expected.x, 9);
    expect(actual.y).toBeCloseTo(expected.y, 9);
    expect(actual.z).toBeCloseTo(expected.z, 9);
  });

  it('removes the extracted cells and leaves the rest intact', () => {
    const { project, grid, source } = uniformFixture();
    const result = detachUniformBox(project, source.id, BOX);
    if (!result.ok) throw new Error(result.detail);

    expect(grid.size).toBe(1);
    expect(grid.has(-2, -1, 0)).toBe(false);
    expect(grid.has(-1, -1, 0)).toBe(false);
    expect(grid.has(-2, 0, 0)).toBe(false);
    expect(grid.getColor(5, 5, 5)).toBe(0xffffff);
    expect(source.id).toBe('obj-0');
    expect(source.name).toBe('terrain');
    expect(source.maskColor).toBe(0x112233);
    expect(source.representation).toBe('uniform');
    expect(source.transform.position.toArray()).toEqual([10, 0, -3]);
    expect(source.transform.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    expect(source.transform.scale.toArray()).toEqual([1, 1, 1]);
    expect(project.get(result.objectId)).not.toBe(source);
  });

  it('names the object "<source name> part <n>" and parents it to the source parent', () => {
    const project = new Project();
    const parent = project.createObject({ name: 'island', representation: 'empty' });
    parent.transform.position.set(1, 1, 1);
    const grid = UniformGrid.create();
    grid.set(-2, -1, 0, 0xff0000);
    grid.set(0, 0, 0, 0x00ff00);
    const source = project.createVoxelObject({
      name: 'terrain',
      parentId: parent.id,
      maskColor: 0x112233,
      payload: { kind: 'uniform', grid },
      position: new Vector3(10, 0, -3),
    });
    project.createObject({ name: 'terrain part 1', representation: 'empty' });
    // The palette cursor moved for `island` and again for `terrain part 1`, so the detach takes the third.
    const expectedMaskColor = maskColorAt(2);

    const result = detachUniformBox(project, source.id, BOX);
    if (!result.ok) throw new Error(result.detail);
    expect(result.name).toBe('terrain part 2');
    const detached = project.get(result.objectId);
    if (detached === undefined) throw new Error('detached object is missing');
    expect(detached.name).toBe(result.name);
    expect(detached.parentId).toBe(parent.id);
    expect(detached.maskColor).toBe(expectedMaskColor);

    const localMin = new Vector3(BOX.min[0], BOX.min[1], BOX.min[2]);
    const detachedMinWorld = new Vector3(0, 0, 0).applyMatrix4(project.worldMatrix(detached.id));
    expect(detachedMinWorld.toArray()).toEqual(
      localMin.applyMatrix4(project.worldMatrix(source.id)).toArray(),
    );
  });

  it('fails with empty-region and changes nothing', () => {
    const { project, grid, source } = uniformFixture();
    const emptyBox: IntBox3 = { min: [1, 1, 1], max: [2, 2, 2] };
    const result = detachUniformBox(project, source.id, emptyBox);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('empty-region');
      expect(result.detail.length).toBeGreaterThan(0);
      expect(result.detail).toContain(source.id);
    }
    expect(project.objects.size).toBe(1);
    expect(grid.size).toBe(4);

    // A twin built the same way shows that the failed call burned no id.
    const twin = uniformFixture();
    const twinResult = detachUniformBox(twin.project, twin.source.id, BOX);
    const accepted = detachUniformBox(project, source.id, BOX);
    if (!twinResult.ok || !accepted.ok) throw new Error('expected both detaches to succeed');
    expect(accepted.objectId).toBe(twinResult.objectId);
  });

  it('fails with missing-object or wrong-representation', () => {
    const { project, grid } = uniformFixture();
    const placeholder = project.createObject({ name: 'character', representation: 'empty' });

    const missing = detachUniformBox(project, UNKNOWN_ID, BOX);
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error).toBe('missing-object');
      expect(missing.detail.length).toBeGreaterThan(0);
    }

    const wrong = detachUniformBox(project, placeholder.id, BOX);
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) {
      expect(wrong.error).toBe('wrong-representation');
      expect(wrong.detail).toContain(placeholder.id);
    }

    expect(grid.size).toBe(4);
    expect(project.objects.size).toBe(2);
  });
});
