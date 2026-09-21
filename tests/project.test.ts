import { Euler, Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Project, type ObjectId, type SceneObject } from '../src/document/project.js';
import { addKeyframe, findTrack, type TrackTarget } from '../src/document/timeline.js';
import { UniformGrid } from '../src/voxels/uniform/grid.js';
import { Octree } from '../src/voxels/octree/octree.js';

const CAMERA: TrackTarget = { kind: 'camera' };

function objectTarget(objectId: ObjectId): TrackTarget {
  return { kind: 'object', objectId };
}

/**
 * Forest legality: `objects` keys are ids, every `parentId` resolves, exactly one parent per object,
 * and every object is reachable from `roots()` — which a cycle would make impossible.
 */
function expectLegalForest(project: Project): void {
  const objects = [...project.objects.values()];
  for (const object of objects) {
    expect(project.get(object.id)).toBe(object);
    if (object.parentId !== null) expect(project.objects.has(object.parentId)).toBe(true);
  }
  const reachable = new Set<ObjectId>();
  for (const root of project.roots()) {
    expect(root.parentId).toBeNull();
    const stack: SceneObject[] = [root];
    while (stack.length > 0) {
      // The loop condition established that there is at least one entry to take.
      const object = stack.pop()!;
      expect(reachable.has(object.id)).toBe(false);
      reachable.add(object.id);
      for (const child of project.childrenOf(object.id)) stack.push(child);
    }
  }
  expect(reachable.size).toBe(objects.length);
}

/** No `Project` ever allocates this, because allocated ids always match `obj-<n>`. */
const UNKNOWN_ID: ObjectId = 'obj-unknown';

describe('identity', () => {
  it('allocates unique obj-<n> ids and never reuses one after remove', () => {
    const project = new Project();
    const created = [
      project.createObject({ name: 'a', representation: 'empty' }),
      project.createObject({ name: 'b', representation: 'empty' }),
      project.createObject({ name: 'c', representation: 'empty' }),
    ];
    const ids = created.map((object) => object.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^obj-\d+$/);

    for (const id of ids) project.remove(id);
    const later = [
      project.createObject({ name: 'd', representation: 'empty' }),
      project.createObject({ name: 'e', representation: 'empty' }),
    ].map((object) => object.id);
    expect(later.filter((id) => ids.includes(id))).toEqual([]);
    expect(new Set([...ids, ...later]).size).toBe(ids.length + later.length);
    expect(project.objects.size).toBe(2);

    // A second project built the same way produces the same id sequence.
    const twin = new Project();
    const twinIds = [
      twin.createObject({ name: 'a', representation: 'empty' }),
      twin.createObject({ name: 'b', representation: 'empty' }),
      twin.createObject({ name: 'c', representation: 'empty' }),
    ].map((object) => object.id);
    expect(twinIds).toEqual(ids);
  });
});

describe('reparent', () => {
  it('refuses a cycle with cycle', () => {
    const project = new Project();
    const root = project.createObject({ name: 'root', representation: 'empty' });
    const child = project.createObject({
      name: 'child',
      parentId: root.id,
      representation: 'empty',
    });
    const grandchild = project.createObject({
      name: 'grandchild',
      parentId: child.id,
      representation: 'empty',
    });

    expect(project.reparent(root.id, grandchild.id)).toEqual({ ok: false, error: 'cycle' });
    expect(project.reparent(root.id, root.id)).toEqual({ ok: false, error: 'cycle' });
    expect(project.reparent(child.id, child.id)).toEqual({ ok: false, error: 'cycle' });
    expect(project.reparent(child.id, grandchild.id)).toEqual({ ok: false, error: 'cycle' });

    expect(project.get(root.id)?.parentId).toBeNull();
    expect(project.get(child.id)?.parentId).toBe(root.id);
    expect(project.get(grandchild.id)?.parentId).toBe(child.id);
    expectLegalForest(project);
  });

  it('refuses an unknown parent with missing', () => {
    const project = new Project();
    const root = project.createObject({ name: 'root', representation: 'empty' });
    const child = project.createObject({
      name: 'child',
      parentId: root.id,
      representation: 'empty',
    });
    const unknown = UNKNOWN_ID;
    expect(project.reparent(child.id, unknown)).toEqual({ ok: false, error: 'missing' });
    expect(project.reparent(unknown, root.id)).toEqual({ ok: false, error: 'missing' });
    expect(project.reparent(unknown, null)).toEqual({ ok: false, error: 'missing' });
    expect(project.get(child.id)?.parentId).toBe(root.id);
    expect(project.objects.size).toBe(2);
    expectLegalForest(project);
  });

  it('leaves exactly one parent per object and no cycle after every outcome', () => {
    const project = new Project();
    const root = project.createObject({ name: 'root', representation: 'empty' });
    const child = project.createObject({
      name: 'child',
      parentId: root.id,
      representation: 'empty',
    });
    const grandchild = project.createObject({
      name: 'grandchild',
      parentId: child.id,
      representation: 'empty',
    });
    const other = project.createObject({ name: 'other', representation: 'empty' });
    expectLegalForest(project);

    const attempts: readonly (readonly [ObjectId, ObjectId | null])[] = [
      [child.id, other.id],
      [grandchild.id, other.id],
      [other.id, child.id],
      [other.id, null],
      [root.id, child.id],
      [child.id, root.id],
      [grandchild.id, grandchild.id],
      [child.id, UNKNOWN_ID],
    ];
    for (const [id, parentId] of attempts) {
      project.reparent(id, parentId);
      expectLegalForest(project);
    }
    // Every accepted move landed and every refused one changed nothing.
    expect(project.get(child.id)?.parentId).toBe(other.id);
    expect(project.get(grandchild.id)?.parentId).toBe(other.id);
    expect(project.get(root.id)?.parentId).toBe(child.id);
    expect(project.get(other.id)?.parentId).toBeNull();
  });
});

describe('remove', () => {
  it("reparents direct children to the removed node's parent", () => {
    const project = new Project();
    const root = project.createObject({ name: 'root', representation: 'empty' });
    const child = project.createObject({
      name: 'child',
      parentId: root.id,
      representation: 'empty',
    });
    const grandchild = project.createObject({
      name: 'grandchild',
      parentId: child.id,
      representation: 'empty',
    });
    grandchild.transform.position.set(1, 2, 3);
    const target = project.createObject({
      name: 'target',
      parentId: root.id,
      representation: 'empty',
    });

    project.remove(child.id);
    expect(project.get(child.id)).toBeUndefined();
    expect(project.get(grandchild.id)?.parentId).toBe(root.id);
    expect(project.childrenOf(root.id).map((object) => object.id)).toEqual([
      grandchild.id,
      target.id,
    ]);
    expect(project.get(grandchild.id)?.transform.position.toArray()).toEqual([1, 2, 3]);
    expect(project.get(grandchild.id)?.name).toBe('grandchild');
    expectLegalForest(project);
  });

  it("drops that object's timeline tracks while the camera track survives", () => {
    const project = new Project();
    const root = project.createObject({ name: 'root', representation: 'empty' });
    const child = project.createObject({
      name: 'child',
      parentId: root.id,
      representation: 'empty',
    });
    addKeyframe(project.timeline, objectTarget(child.id), 'position', 0, [1, 0, 0]);
    addKeyframe(project.timeline, objectTarget(root.id), 'position', 0, [2, 0, 0]);
    addKeyframe(project.timeline, CAMERA, 'fov', 0, [50]);
    expect(project.timeline.tracks).toHaveLength(3);

    project.remove(child.id);
    expect(findTrack(project.timeline, objectTarget(child.id), 'position')).toBeUndefined();
    expect(findTrack(project.timeline, objectTarget(root.id), 'position')).toBeDefined();
    expect(findTrack(project.timeline, CAMERA, 'fov')?.keyframes).toHaveLength(1);
    expect(project.timeline.tracks).toHaveLength(2);
  });

  it('is a no-op for an unknown id', () => {
    const project = new Project();
    const object = project.createObject({ name: 'a', representation: 'empty' });
    addKeyframe(project.timeline, objectTarget(object.id), 'scale', 0, [1, 1, 1]);
    expect(() => project.remove(UNKNOWN_ID)).not.toThrow();
    expect(project.objects.size).toBe(1);
    expect(project.get(object.id)).toBe(object);
    expect(project.timeline.tracks).toHaveLength(1);
  });
});

describe('setPayload', () => {
  function payloadFixtures() {
    const grid = UniformGrid.create(1);
    grid.set(0, 0, 0, 0xff0000);
    const octree = Octree.create({ rootSize: 4, maxDepth: 2 });
    octree.setLeaf('0:', { occupied: true, color: 0x00ff00 });
    return { grid, octree };
  }

  it('moves empty -> uniform -> empty and empty -> octree -> empty', () => {
    const project = new Project();
    const { grid, octree } = payloadFixtures();
    const object = project.createObject({ name: 'placeholder', representation: 'empty' });
    expect(object.representation).toBe('empty');

    project.setPayload(object.id, { kind: 'uniform', grid });
    expect(object.representation).toBe('uniform');
    expect(object.uniform).toBe(grid);
    expect(object.octree).toBeUndefined();

    project.setPayload(object.id, undefined);
    expect(object.representation).toBe('empty');
    expect(object.uniform).toBeUndefined();
    expect(object.octree).toBeUndefined();

    project.setPayload(object.id, { kind: 'octree', octree });
    expect(object.representation).toBe('octree');
    expect(object.octree).toBe(octree);
    expect(object.uniform).toBeUndefined();

    project.setPayload(object.id, undefined);
    expect(object.representation).toBe('empty');
    expect(object.uniform).toBeUndefined();
    expect(object.octree).toBeUndefined();
    expect(project.objects.get(object.id)).toBe(object);
  });

  it('leaves id, name, parentId, maskColor, transform, and visible untouched', () => {
    const project = new Project();
    const { grid, octree } = payloadFixtures();
    const parent = project.createObject({ name: 'parent', representation: 'empty' });
    const object = project.createObject({
      name: 'placeholder',
      parentId: parent.id,
      representation: 'empty',
    });
    object.transform.position.set(1, 2, 3);
    object.transform.quaternion.setFromEuler(new Euler(0.3, -0.7, 0.2));
    object.transform.scale.set(2, 0.5, 1.5);
    object.visible = false;
    const transform = object.transform;
    const snapshot = {
      id: object.id,
      name: object.name,
      parentId: object.parentId,
      maskColor: object.maskColor,
      visible: object.visible,
      position: object.transform.position.toArray(),
      quaternion: object.transform.quaternion.toArray(),
      scale: object.transform.scale.toArray(),
    };

    project.setPayload(object.id, { kind: 'uniform', grid });
    project.setPayload(object.id, { kind: 'octree', octree });
    project.setPayload(object.id, undefined);

    expect(object.id).toBe(snapshot.id);
    expect(object.name).toBe(snapshot.name);
    expect(object.parentId).toBe(snapshot.parentId);
    expect(object.maskColor).toBe(snapshot.maskColor);
    expect(object.visible).toBe(snapshot.visible);
    expect(object.transform).toBe(transform);
    expect(object.transform.position.toArray()).toEqual(snapshot.position);
    expect(object.transform.quaternion.toArray()).toEqual(snapshot.quaternion);
    expect(object.transform.scale.toArray()).toEqual(snapshot.scale);
    expect(project.get(object.id)).toBe(object);
  });

  it('keeps representation and payload consistent in both directions', () => {
    const project = new Project();
    const { grid, octree } = payloadFixtures();
    const object = project.createVoxelObject({
      name: 'terrain',
      maskColor: 0x112233,
      payload: { kind: 'uniform', grid },
      position: new Vector3(0, 0, 0),
    });
    expect(object.representation).toBe('uniform');
    expect(object.uniform).toBe(grid);
    expect(object.octree).toBeUndefined();

    project.setPayload(object.id, { kind: 'octree', octree });
    expect(object.representation).toBe('octree');
    expect(object.octree).toBe(octree);
    expect(object.uniform).toBeUndefined();
    expect(object.maskColor).toBe(0x112233);

    const otherGrid = UniformGrid.create(2);
    otherGrid.set(-1, 0, 0, 0x0000ff);
    project.setPayload(object.id, { kind: 'uniform', grid: otherGrid });
    expect(object.representation).toBe('uniform');
    expect(object.uniform).toBe(otherGrid);
    expect(object.octree).toBeUndefined();
    expect(object.uniform?.size).toBe(1);
  });
});

describe('worldMatrix', () => {
  function hierarchy() {
    const project = new Project();
    const parent = project.createObject({ name: 'parent', representation: 'empty' });
    const child = project.createObject({
      name: 'child',
      parentId: parent.id,
      representation: 'empty',
    });
    parent.transform.position.set(1, 2, 3);
    parent.transform.quaternion.setFromEuler(new Euler(0.3, -0.7, 0.2));
    parent.transform.scale.set(2, 0.5, 1.5);
    child.transform.position.set(-1, 0.5, 4);
    child.transform.quaternion.setFromEuler(new Euler(-0.2, 0.4, 0.9));
    child.transform.scale.set(0.5, 2, 0.75);
    return { project, parent, child };
  }

  it('composes the parent chain from the root down', () => {
    const { project, parent, child } = hierarchy();
    const expected = new Matrix4()
      .compose(parent.transform.position, parent.transform.quaternion, parent.transform.scale)
      .multiply(
        new Matrix4().compose(child.transform.position, child.transform.quaternion, child.transform.scale),
      );
    expect(project.worldMatrix(child.id).elements).toEqual(expected.elements);
  });

  it("equals the object's own matrix for a root object", () => {
    const { project, parent } = hierarchy();
    expect(project.worldMatrix(parent.id).elements).toEqual(
      new Matrix4()
        .compose(parent.transform.position, parent.transform.quaternion, parent.transform.scale)
        .elements,
    );
  });
});

describe('nextMaskColor', () => {
  it('walks the palette deterministically and repeats after a full cycle', () => {
    const project = new Project();
    const walk: number[] = [];
    for (let i = 0; i < 32; i += 1) walk.push(project.nextMaskColor());

    const period = walk.findIndex((value, index) => index > 0 && value === walk[0]);
    expect(period).toBeGreaterThan(1);
    expect(new Set(walk.slice(0, period)).size).toBe(period);
    for (let i = 0; i < walk.length; i += 1) expect(walk[i]).toBe(walk[i % period]);
    for (const color of walk.slice(0, period)) {
      expect(Number.isInteger(color)).toBe(true);
      expect(color).toBeGreaterThanOrEqual(0);
      expect(color).toBeLessThanOrEqual(0xffffff);
    }
  });

  it('gives two fresh projects the same sequence', () => {
    const first = new Project();
    const second = new Project();
    const firstWalk: number[] = [];
    const secondWalk: number[] = [];
    for (let i = 0; i < 16; i += 1) {
      firstWalk.push(first.nextMaskColor());
      secondWalk.push(second.nextMaskColor());
    }
    expect(firstWalk).toEqual(secondWalk);
    expect(new Set(firstWalk).size).toBeGreaterThan(1);
  });
});
