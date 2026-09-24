import { Euler, Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Project, type ObjectId, type SceneObject } from '../src/document/project.js';
import { addKeyframe, findTrack, type TrackTarget } from '../src/document/timeline.js';
import { UniformGrid } from '../src/voxels/uniform/grid.js';

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
  function payloadFixture(): UniformGrid {
    const grid = UniformGrid.create();
    grid.set(0, 0, 0, 0xff0000);
    return grid;
  }

  it('moves empty -> uniform -> empty', () => {
    const project = new Project();
    const grid = payloadFixture();
    const object = project.createObject({ name: 'placeholder', representation: 'empty' });
    expect(object.representation).toBe('empty');

    project.setPayload(object.id, { kind: 'uniform', grid });
    expect(object.representation).toBe('uniform');
    expect(object.uniform).toBe(grid);

    project.setPayload(object.id, undefined);
    expect(object.representation).toBe('empty');
    expect(object.uniform).toBeUndefined();
    expect(project.objects.get(object.id)).toBe(object);
  });

  it('leaves id, name, parentId, maskColor, transform, and visible untouched', () => {
    const project = new Project();
    const grid = payloadFixture();
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

  it('keeps representation and payload consistent', () => {
    const project = new Project();
    const grid = payloadFixture();
    const object = project.createVoxelObject({
      name: 'terrain',
      maskColor: 0x112233,
      payload: { kind: 'uniform', grid },
      position: new Vector3(0, 0, 0),
    });
    expect(object.representation).toBe('uniform');
    expect(object.uniform).toBe(grid);

    const otherGrid = UniformGrid.create();
    otherGrid.set(-1, 0, 0, 0x0000ff);
    project.setPayload(object.id, { kind: 'uniform', grid: otherGrid });
    expect(object.representation).toBe('uniform');
    expect(object.uniform).toBe(otherGrid);
    expect(object.uniform?.size).toBe(1);
    expect(object.maskColor).toBe(0x112233);
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

describe('grid alignment', () => {
  it('starts every object it creates aligned', () => {
    const project = new Project();
    const group = project.createObject({ name: 'group', representation: 'empty' });
    const voxel = project.createVoxelObject({
      name: 'voxel',
      maskColor: 0x112233,
      payload: { kind: 'uniform', grid: UniformGrid.create() },
      position: new Vector3(1, 2, 3),
    });
    expect(group.alignToGrid).toBe(true);
    expect(voxel.alignToGrid).toBe(true);

    // A placement an operation derived is left where it is, and the flag is what follows it: content that
    // arrived between cells is not snapped into them, it is simply not claimed to be on the lattice.
    const offLattice = project.createVoxelObject({
      name: 'off-lattice',
      maskColor: 0x445566,
      payload: { kind: 'uniform', grid: UniformGrid.create() },
      position: new Vector3(0.5, 2, -3),
    });
    expect(offLattice.alignToGrid).toBe(false);
  });

  it('rounds a placement to the nearest cell while the object aligns', () => {
    const project = new Project();
    const aligned = project.createObject({ name: 'aligned', representation: 'empty' });
    const free = project.createObject({ name: 'free', representation: 'empty' });
    free.alignToGrid = false;
    const fraction = new Vector3(1.4, -2.5, 3.5);

    expect(project.alignedPosition(aligned.id, fraction).toArray()).toEqual([1, -2, 4]);
    const untouched = project.alignedPosition(free.id, fraction);
    expect(untouched.toArray()).toEqual([1.4, -2.5, 3.5]);
    expect(untouched).not.toBe(fraction);
    expect(project.alignedPosition(UNKNOWN_ID, fraction).toArray()).toEqual([1.4, -2.5, 3.5]);
  });

  it('gives a keyframe whole cells for an aligned object, and the placement itself to every other target', () => {
    const project = new Project();
    const object = project.createObject({ name: 'object', representation: 'empty' });
    const fraction = new Vector3(2.4, -1.6, 0.6);

    expect(project.keyframePosition(objectTarget(object.id), fraction).toArray()).toEqual([2, -2, 1]);
    object.alignToGrid = false;
    expect(project.keyframePosition(objectTarget(object.id), fraction).toArray()).toEqual([2.4, -1.6, 0.6]);
    expect(project.keyframePosition(CAMERA, fraction).toArray()).toEqual([2.4, -1.6, 0.6]);
  });

  it("rounds to the object's own cell, so a subdivided object snaps in its own steps", () => {
    const project = new Project();
    const fine = project.createVoxelObject({
      name: 'fine',
      maskColor: 0x112233,
      payload: { kind: 'uniform', grid: UniformGrid.create(4) },
      position: new Vector3(0, 0, 0),
    });
    const cells = project.alignedPosition(fine.id, new Vector3(1.4, -2.5, 3.5));
    expect(cells.toArray()).toEqual([1.5, -2.5, 3.5]);
    // A keyframe reads the same rule, so a track of a subdivided object holds its own whole cells.
    expect(project.keyframePosition(objectTarget(fine.id), new Vector3(0.3, 0, 0)).toArray()).toEqual([0.25, 0, 0]);
  });

  it('creates an object aligned only when the placement is whole in its own grid', () => {
    const project = new Project();
    const onTheLattice = project.createVoxelObject({
      name: 'on',
      maskColor: 0x112233,
      payload: { kind: 'uniform', grid: UniformGrid.create(2) },
      position: new Vector3(0.5, 0, 0),
    });
    const betweenCells = project.createVoxelObject({
      name: 'between',
      maskColor: 0x445566,
      payload: { kind: 'uniform', grid: UniformGrid.create(2) },
      position: new Vector3(0.25, 0, 0),
    });
    expect(onTheLattice.alignToGrid).toBe(true);
    expect(betweenCells.alignToGrid).toBe(false);
  });

  it("snaps a world matrix in the object's own frame, without touching the argument", () => {
    const project = new Project();
    const parent = project.createObject({ name: 'parent', representation: 'empty' });
    parent.transform.position.set(4, 0, -2);
    parent.transform.quaternion.setFromEuler(new Euler(0.3, -0.7, 0.2));
    const child = project.createObject({ name: 'child', parentId: parent.id, representation: 'empty' });
    // Away from the half cell: at exactly 0.5 the parent round trip's last bits decide which way the
    // nearest cell falls, which is the one placement the rule cannot promise a direction for.
    child.transform.position.set(2.4, -1.6, 0.6);

    const world = project.worldMatrix(child.id);
    const before = world.elements.slice();
    const aligned = project.alignWorldMatrix(child.id, world);

    // The frame is the child's own: dividing the parent back out has to leave whole cells behind, whatever
    // the parent's rotation does to the world-space placement.
    const local = project.worldMatrix(parent.id).invert().multiply(aligned);
    expect(local.elements.slice(12, 15).map((value) => Math.round(value))).toEqual([2, -2, 1]);
    expect(world.elements).toEqual(before);

    const free = project.createObject({ name: 'free', representation: 'empty' });
    free.alignToGrid = false;
    free.transform.position.set(0.25, 0.25, 0.25);
    expect(project.alignWorldMatrix(free.id, project.worldMatrix(free.id)).elements.slice(12, 15)).toEqual([
      0.25, 0.25, 0.25,
    ]);
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

describe('snapshot / restore', () => {
  it('copies records so a later write cannot reach the snapshot', () => {
    const project = new Project();
    const grid = UniformGrid.create(2);
    grid.set(0, 0, 0, 0x112233);
    const car = project.createVoxelObject({
      name: 'car',
      maskColor: 0x445566,
      payload: { kind: 'uniform', grid },
      position: new Vector3(1, 0, 0),
    });
    const data = project.snapshot();

    car.transform.position.set(9, 9, 9);
    car.name = 'renamed';
    project.timeline.durationMs = 5000;

    const copied = data.objects[0];
    expect(copied?.name).toBe('car');
    expect(copied?.transform.position.toArray()).toEqual([1, 0, 0]);
    expect(data.timeline.durationMs).toBe(0);
    // The payload is the one thing shared: a grid is read-only where the file is concerned (README D51).
    expect(copied?.uniform).toBe(grid);
  });

  it('restores the loaded objects in order and keeps the camera, the settings, and the timeline objects', () => {
    const source = new Project();
    const group = source.createObject({ name: 'group', representation: 'empty' });
    const grid = UniformGrid.create(4);
    grid.set(-1, 0, 2, 0x00ff00);
    source.createVoxelObject({
      name: 'part',
      parentId: group.id,
      maskColor: 0x123456,
      payload: { kind: 'uniform', grid },
      position: new Vector3(2, 0, 0),
    });
    source.camera.fov = 60;
    source.camera.transform.position.set(1, 2, 3);
    source.settings.background = 0x101010;
    source.settings.ambientIntensity = 0.5;
    source.timeline.durationMs = 4000;
    source.timeline.fps = 24;
    addKeyframe(source.timeline, objectTarget(group.id), 'position', 1000, [1, 2, 3]);

    const target = new Project();
    target.createObject({ name: 'stale', representation: 'empty' });
    const camera = target.camera;
    const settings = target.settings;
    const timeline = target.timeline;
    const tracks = timeline.tracks;
    const idsWritten = [...source.objects.keys()];

    target.restore(source.snapshot());

    expect([...target.objects.keys()]).toEqual(idsWritten);
    const part = target.objects.get(idsWritten[1] ?? '');
    expect(part?.name).toBe('part');
    expect(part?.parentId).toBe(group.id);
    expect(part?.maskColor).toBe(0x123456);
    expect(part?.representation).toBe('uniform');
    expect(part?.uniform?.subdivision).toBe(4);
    expect(part?.uniform?.getColor(-1, 0, 2)).toBe(0x00ff00);
    expect(target.objects.get(idsWritten[0] ?? '')?.representation).toBe('empty');
    // Instance identity: a load is invisible to the mirror, the mixer, and the panels, which hold these.
    expect(target.camera).toBe(camera);
    expect(target.settings).toBe(settings);
    expect(target.timeline).toBe(timeline);
    expect(target.timeline.tracks).toBe(tracks);
    expect(camera.fov).toBe(60);
    expect(camera.transform.position.toArray()).toEqual([1, 2, 3]);
    expect(settings.background).toBe(0x101010);
    expect(settings.ambientIntensity).toBe(0.5);
    expect(timeline.durationMs).toBe(4000);
    expect(timeline.fps).toBe(24);
    const keyframe = findTrack(timeline, objectTarget(group.id), 'position')?.keyframes[0];
    expect(keyframe?.timeMs).toBe(1000);
    expect(keyframe?.value).toEqual([1, 2, 3]);
    expect(keyframe?.id).toBe(source.timeline.tracks[0]?.keyframes[0]?.id);
  });

  it('floors the id counter above the ids the loaded file carries', () => {
    const source = new Project();
    source.createObject({ name: 'a', representation: 'empty' });
    source.createObject({ name: 'b', representation: 'empty' });
    const data = source.snapshot();
    // A file whose counter claims the next id is free although `obj-0` and `obj-1` are already taken: trusting
    // it would overwrite a loaded object on the next creation.
    data.counters.nextId = 0;

    const target = new Project();
    target.restore(data);
    // The palette walk resumes where the file left it, so mask colors stay stable across a load (D11): the two
    // loaded objects already consumed the first two entries.
    const fresh = new Project();
    fresh.nextMaskColor();
    fresh.nextMaskColor();
    expect(target.nextMaskColor()).toBe(fresh.nextMaskColor());

    const minted = target.createObject({ name: 'c', representation: 'empty' });

    expect(minted.id).toBe('obj-2');
    expect([...target.objects.keys()]).toEqual(['obj-0', 'obj-1', 'obj-2']);
  });

  it('refuses a duplicate id, an unknown parent, a cycle, and a foreign id without writing', () => {
    const project = new Project();
    const only = project.createObject({ name: 'only', representation: 'empty' });
    const before = project.snapshot();

    const duplicate = project.snapshot();
    duplicate.objects.push({ ...only });
    const missing = project.snapshot();
    missing.objects.push({ ...only, id: 'obj-7', parentId: 'obj-99' });
    const cycle = project.snapshot();
    cycle.objects.push({ ...only, id: 'obj-8', parentId: 'obj-9' });
    cycle.objects.push({ ...only, id: 'obj-9', parentId: 'obj-8' });
    const foreign = project.snapshot();
    foreign.objects.push({ ...only, id: 'thing' });

    for (const data of [duplicate, missing, cycle, foreign]) {
      expect(() => project.restore(data)).toThrow(RangeError);
      expect(project.snapshot()).toEqual(before);
    }
  });
});
