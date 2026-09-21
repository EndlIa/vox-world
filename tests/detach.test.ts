import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { detachOctreeLeaf, detachUniformBox } from '../src/document/detach.js';
import { Project, type ObjectId, type SceneObject } from '../src/document/project.js';
import { UniformGrid, type IntBox3 } from '../src/voxels/uniform/grid.js';
import { Octree } from '../src/voxels/octree/octree.js';

/** No `Project` allocates this, because allocated ids always match `obj-<n>`. */
const UNKNOWN_ID: ObjectId = 'obj-unknown';
const VOXEL_SIZE = 2;
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
  const grid = UniformGrid.create(VOXEL_SIZE);
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

function octreeFixture() {
  const project = new Project();
  const octree = Octree.create({ rootSize: 4, maxDepth: 3 });
  octree.insertAtDepth([0, 0, 0], 2, { occupied: true, color: 0x3366ff, label: 'hand' });
  octree.insertAtDepth([1, 0, 0], 2, { occupied: true, color: 0x3366ff, label: 'hand' });
  octree.insertAtDepth([0, 1, 0], 2, { occupied: true, color: 0xff8800 });
  octree.insertAtDepth([0, 0, 1], 2, { occupied: true, color: 0x00ff00, label: '' });
  const source = project.createVoxelObject({
    name: 'character',
    maskColor: 0x112233,
    payload: { kind: 'octree', octree },
    position: new Vector3(8, 0, 4),
  });
  return { project, octree, source };
}

/** The world position of a cell center, in the object's own frame. */
function cellCenterWorld(project: Project, object: SceneObject, x: number, y: number, z: number) {
  return new Vector3((x + 0.5) * VOXEL_SIZE, (y + 0.5) * VOXEL_SIZE, (z + 0.5) * VOXEL_SIZE)
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

    expect(grid.voxelSize).toBe(VOXEL_SIZE);
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
      BOX.min[0] * VOXEL_SIZE + 10,
      BOX.min[1] * VOXEL_SIZE,
      BOX.min[2] * VOXEL_SIZE - 3,
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
    const grid = UniformGrid.create(VOXEL_SIZE);
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

    const localMin = new Vector3(
      BOX.min[0] * VOXEL_SIZE,
      BOX.min[1] * VOXEL_SIZE,
      BOX.min[2] * VOXEL_SIZE,
    );
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
    const { project, grid, source } = uniformFixture();
    const octree = Octree.create({ rootSize: 4, maxDepth: 3 });
    octree.insertAtDepth([0, 0, 0], 2, { occupied: true, color: 0x3366ff });
    const octreeObject = project.createVoxelObject({
      name: 'character',
      maskColor: 0x445566,
      payload: { kind: 'octree', octree },
      position: new Vector3(0, 0, 0),
    });

    const missing = detachUniformBox(project, UNKNOWN_ID, BOX);
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error).toBe('missing-object');
      expect(missing.detail.length).toBeGreaterThan(0);
    }

    const wrong = detachUniformBox(project, octreeObject.id, BOX);
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) {
      expect(wrong.error).toBe('wrong-representation');
      expect(wrong.detail).toContain(octreeObject.id);
    }

    const octreeWay = detachOctreeLeaf(project, source.id, '2:00');
    expect(octreeWay.ok).toBe(false);
    if (!octreeWay.ok) expect(octreeWay.error).toBe('wrong-representation');

    expect(grid.size).toBe(4);
    expect(octree.leafCount).toBe(15);
    expect(project.objects.size).toBe(2);
  });
});

describe('detachOctreeLeaf', () => {
  it('creates a one-leaf root box whose rootSize equals the leaf edge', () => {
    const { project, octree, source } = octreeFixture();
    const leafEdge = octree.leafSize(2);
    expect(leafEdge).toBe(4 / 4);
    const result = detachOctreeLeaf(project, source.id, '2:00');
    if (!result.ok) throw new Error(result.detail);
    const detached = project.get(result.objectId);
    const newOctree = detached?.octree;
    if (newOctree === undefined) throw new Error('detached object has no octree payload');

    expect(newOctree.rootSize).toBe(leafEdge);
    expect(newOctree.maxDepth).toBe(octree.maxDepth);
    expect(newOctree.leafCount).toBe(1);
    expect(newOctree.leafBox('0:').size).toBe(leafEdge);
    expect(detached?.representation).toBe('octree');
    expect(detached?.visible).toBe(true);
    expect(detached?.transform.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    expect(detached?.transform.scale.toArray()).toEqual([1, 1, 1]);
  });

  it('carries the source leaf attributes into the new root leaf', () => {
    const { project, octree, source } = octreeFixture();
    const sourceLeafEdge = octree.leafBox('2:00').size;
    const result = detachOctreeLeaf(project, source.id, '2:00');
    if (!result.ok) throw new Error(result.detail);
    const detached = project.get(result.objectId);
    const newOctree = detached?.octree;
    if (newOctree === undefined) throw new Error('detached object has no octree payload');

    expect(newOctree.getLeaf('0:')).toEqual({ occupied: true, color: 0x3366ff, label: 'hand' });
    expect(newOctree.leafSize(0)).toBe(sourceLeafEdge);

    // The attrs were copied: repainting the new root leaf leaves the source siblings as they were.
    expect(newOctree.paintLeaf('0:', 0x000000)).toBe(true);
    expect(newOctree.getLeaf('0:')?.color).toBe(0x000000);
    expect(octree.getLeaf('2:01')).toEqual({ occupied: true, color: 0x3366ff, label: 'hand' });
  });

  it('can be split further after the detach', () => {
    const { project, source } = octreeFixture();
    const result = detachOctreeLeaf(project, source.id, '2:00');
    if (!result.ok) throw new Error(result.detail);
    const detached = project.get(result.objectId);
    const newOctree = detached?.octree;
    if (detached === undefined || newOctree === undefined) throw new Error('missing payload');

    expect(newOctree.split('0:').ok).toBe(true);
    expect(newOctree.leafCount).toBe(8);
    const again = detachOctreeLeaf(project, detached.id, '1:0');
    expect(again.ok).toBe(true);
    if (!again.ok) throw new Error(again.detail);
    const second = project.get(again.objectId);
    expect(second?.octree?.rootSize).toBe(newOctree.rootSize / 2);
    expect(second?.octree?.leafCount).toBe(1);
    expect(second?.octree?.getLeaf('0:')).toEqual({
      occupied: true,
      color: 0x3366ff,
      label: 'hand',
    });
  });

  it('uses the leaf label as the object name', () => {
    const { project, source } = octreeFixture();
    project.createObject({ name: 'character part 1', representation: 'empty' });

    const labelled = detachOctreeLeaf(project, source.id, '2:00');
    if (!labelled.ok) throw new Error(labelled.detail);
    expect(labelled.name).toBe('hand');
    expect(project.get(labelled.objectId)?.name).toBe('hand');

    // An empty label is no label: the object falls back to the source name and the smallest free n.
    const emptyLabel = detachOctreeLeaf(project, source.id, '2:04');
    if (!emptyLabel.ok) throw new Error(emptyLabel.detail);
    expect(emptyLabel.name).toBe('character part 2');

    const labelless = detachOctreeLeaf(project, source.id, '2:02');
    if (!labelless.ok) throw new Error(labelless.detail);
    expect(labelless.name).toBe('character part 3');
  });

  it('removes the source leaf and prunes the branches it empties', () => {
    const { project, octree, source } = octreeFixture();
    const leafCountBefore = octree.leafCount;
    const result = detachOctreeLeaf(project, source.id, '2:00');
    if (!result.ok) throw new Error(result.detail);

    expect(octree.hasLeaf('2:00')).toBe(false);
    expect(octree.leafCount).toBe(leafCountBefore - 1);
    expect(octree.occupiedLeafCount).toBe(3);
    expect(octree.getLeaf('2:01')).toEqual({ occupied: true, color: 0x3366ff, label: 'hand' });
    expect(octree.getLeaf('2:02')).toEqual({ occupied: true, color: 0xff8800 });
    expect(octree.getLeaf('1:1')).toEqual({ occupied: false, color: 0xffffff });
    expect(source.name).toBe('character');
    expect(source.maskColor).toBe(0x112233);
    expect(source.transform.position.toArray()).toEqual([8, 0, 4]);
    expect(source.octree).toBe(octree);

    // Detaching every child of a branch empties it; the root branch collapses back to a root leaf.
    const drained = new Project();
    const drainedOctree = Octree.create({ rootSize: 4, maxDepth: 1 });
    const children = ['1:0', '1:1', '1:2', '1:3', '1:4', '1:5', '1:6', '1:7'];
    const cells: readonly (readonly [number, number, number])[] = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
      [0, 0, 1],
      [1, 0, 1],
      [0, 1, 1],
      [1, 1, 1],
    ];
    cells.forEach((cell, index) => {
      drainedOctree.insertAtDepth(cell, 1, { occupied: true, color: 0x100000 + index });
    });
    const drainedSource = drained.createVoxelObject({
      name: 'subtree',
      maskColor: 0x223344,
      payload: { kind: 'octree', octree: drainedOctree },
      position: new Vector3(0, 0, 0),
    });
    expect(drainedOctree.leafCount).toBe(8);
    for (const childId of children) {
      const detached = detachOctreeLeaf(drained, drainedSource.id, childId);
      expect(detached.ok).toBe(true);
      if (!detached.ok) throw new Error(detached.detail);
      expect(drained.get(detached.objectId)?.octree?.rootSize).toBe(drainedOctree.leafSize(1));
    }
    expect(drainedOctree.leafCount).toBe(1);
    expect(drainedOctree.occupiedLeafCount).toBe(0);
    expect(drainedOctree.hasLeaf('0:')).toBe(true);
    expect(drainedOctree.hasLeaf('1:0')).toBe(false);
    expect(drained.objects.size).toBe(9);
  });

  it('detaches a root leaf by clearing the source root occupancy', () => {
    // A one-leaf octree is its root leaf, and `removeLeaf` never removes the root: the source gives
    // up that leaf's occupancy instead of losing the detach.
    const solo = new Project();
    const soloOctree = Octree.create({ rootSize: 4, maxDepth: 3 });
    soloOctree.setLeaf('0:', { occupied: true, color: 0x445566, label: 'hand' });
    const soloSource = solo.createVoxelObject({
      name: 'solo',
      maskColor: 0x223344,
      payload: { kind: 'octree', octree: soloOctree },
      position: new Vector3(0, 0, 0),
    });

    const result = detachOctreeLeaf(solo, soloSource.id, '0:');
    if (!result.ok) throw new Error(result.detail);
    const detached = solo.get(result.objectId);
    expect(detached?.octree?.getLeaf('0:')).toEqual({
      occupied: true,
      color: 0x445566,
      label: 'hand',
    });
    expect(detached?.octree?.rootSize).toBe(4);
    expect(detached?.octree?.maxDepth).toBe(3);
    expect(detached?.octree?.leafCount).toBe(1);
    expect(detached?.octree?.occupiedLeafCount).toBe(1);
    expect(soloOctree.getLeaf('0:')).toEqual({ occupied: false, color: 0x445566 });
    expect(soloOctree.occupiedLeafCount).toBe(0);
    expect(soloOctree.leafCount).toBe(1);
    expect(soloSource.name).toBe('solo');
    expect(soloSource.maskColor).toBe(0x223344);
    expect(soloSource.transform.position.toArray()).toEqual([0, 0, 0]);
    expect(soloSource.octree).toBe(soloOctree);
    expect(soloSource.representation).toBe('octree');

    // The emptied root leaf is an empty region on a second attempt rather than a failure to throw.
    const again = detachOctreeLeaf(solo, soloSource.id, '0:');
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toBe('empty-region');
  });

  it('fails with not-a-leaf for a branch id', () => {
    const { project, octree, source } = octreeFixture();
    const leafCountBefore = octree.leafCount;

    const branch = detachOctreeLeaf(project, source.id, '1:0');
    expect(branch.ok).toBe(false);
    if (!branch.ok) {
      expect(branch.error).toBe('not-a-leaf');
      expect(branch.detail.length).toBeGreaterThan(0);
      expect(branch.detail).toContain('1:0');
    }

    const absent = detachOctreeLeaf(project, source.id, '3:070');
    expect(absent.ok).toBe(false);
    if (!absent.ok) expect(absent.error).toBe('not-a-leaf');

    const unoccupied = detachOctreeLeaf(project, source.id, '2:05');
    expect(unoccupied.ok).toBe(false);
    if (!unoccupied.ok) {
      expect(unoccupied.error).toBe('empty-region');
      expect(unoccupied.detail.length).toBeGreaterThan(0);
    }

    const missing = detachOctreeLeaf(project, UNKNOWN_ID, '2:00');
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toBe('missing-object');

    expect(octree.leafCount).toBe(leafCountBefore);
    expect(octree.hasLeaf('2:00')).toBe(true);
    expect(project.objects.size).toBe(1);
  });
});
