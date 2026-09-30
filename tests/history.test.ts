import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { Project } from '../src/document/project.js';
import { EditHistory } from '../src/editor/history.js';
import { addRegion, deleteObject, paintRegion, removeRegion, renameObject } from '../src/editor/ops.js';
import { UniformGrid } from '../src/voxels/uniform/grid.js';
import type { RegionShape } from '../src/voxels/uniform/region.js';

/** A project with one voxel object holding the given cells, and a history over it. */
function fixture(cells: [number, number, number][], depth?: number) {
  const project = new Project();
  const grid = UniformGrid.create();
  for (const [x, y, z] of cells) grid.set(x, y, z, 0x3366ff);
  const object = project.createVoxelObject({
    name: 'cube',
    maskColor: 0x112233,
    payload: { kind: 'uniform', grid },
    position: new Vector3(0, 0, 0),
  });
  const history = new EditHistory(project, depth === undefined ? undefined : { depth });
  return { project, grid, objectId: object.id, history };
}

const COLUMN: [number, number, number][] = [
  [0, 0, 0],
  [1, 0, 0],
];

const oneAbove: RegionShape = { kind: 'box', min: [0, 0, 1], max: [0, 0, 1] };
const twoAbove: RegionShape = { kind: 'box', min: [0, 0, 2], max: [0, 0, 2] };

describe('cell edits', () => {
  it('takes a write back and puts it again', () => {
    const scene = fixture(COLUMN);
    const capture = scene.history.begin([{ objectId: scene.objectId, shape: oneAbove }]);
    addRegion(scene.project, scene.objectId, oneAbove, 0xff0000);
    expect(scene.history.commit(capture)).toEqual([scene.objectId]);
    expect(scene.grid.getColor(0, 0, 1)).toBe(0xff0000);

    expect(scene.history.canUndo).toBe(true);
    scene.history.undo();
    expect(scene.grid.getColor(0, 0, 1)).toBeUndefined();
    expect(scene.grid.getColor(0, 0, 0)).toBe(0x3366ff);
    expect(scene.grid.size).toBe(2);

    scene.history.redo();
    expect(scene.grid.getColor(0, 0, 1)).toBe(0xff0000);
    expect(scene.grid.size).toBe(3);
  });

  it('restores every cell of an island in one step', () => {
    const scene = fixture(COLUMN);
    const shape: RegionShape = { kind: 'island', seed: [0, 0, 0] };
    const capture = scene.history.begin([{ objectId: scene.objectId, shape }]);
    expect(removeRegion(scene.project, scene.objectId, shape).ok).toBe(true);
    scene.history.commit(capture);
    expect(scene.grid.size).toBe(0);

    scene.history.undo();
    expect(scene.grid.size).toBe(2);
    expect(scene.grid.getColor(1, 0, 0)).toBe(0x3366ff);
  });

  it('records nothing when the operation changed no cell', () => {
    const scene = fixture(COLUMN);
    const shape: RegionShape = { kind: 'box', min: [9, 9, 9], max: [9, 9, 9] };
    const capture = scene.history.begin([{ objectId: scene.objectId, shape }]);
    // A paint never creates a cell, so a box over empty space changes nothing at all — and the history decides that
    // for itself rather than trusting the caller.
    paintRegion(scene.project, scene.objectId, shape, 0xff0000);
    expect(scene.history.commit(capture)).toBeNull();
    expect(scene.history.canUndo).toBe(false);
  });
});

describe('object edits', () => {
  it('puts a renamed object back', () => {
    const scene = fixture(COLUMN);
    const capture = scene.history.begin();
    renameObject(scene.project, scene.objectId, 'renamed');
    expect(scene.history.commit(capture)).toEqual([scene.objectId]);
    expect(scene.project.get(scene.objectId)?.name).toBe('renamed');

    scene.history.undo();
    expect(scene.project.get(scene.objectId)?.name).toBe('cube');
    scene.history.redo();
    expect(scene.project.get(scene.objectId)?.name).toBe('renamed');
  });

  it('brings a deleted object back with the payload it still pointed at', () => {
    const scene = fixture(COLUMN);
    const capture = scene.history.begin();
    deleteObject(scene.project, scene.objectId);
    scene.history.commit(capture);
    expect(scene.project.get(scene.objectId)).toBeUndefined();

    scene.history.undo();
    const restored = scene.project.get(scene.objectId);
    expect(restored?.name).toBe('cube');
    expect(restored?.uniform).toBe(scene.grid);
    expect(restored?.uniform?.size).toBe(2);

    scene.history.redo();
    expect(scene.project.get(scene.objectId)).toBeUndefined();
  });

  it('leaves the camera and the timeline alone', () => {
    const scene = fixture(COLUMN);
    // Both halves of the scope: a shot and a duration that a step must not rewind.
    const take = scene.project.camera.takes[0] as { name: string };
    take.name = 'shot B';
    scene.project.timeline.durationMs = 5000;
    const timeline = JSON.stringify(scene.project.snapshot().timeline);

    const capture = scene.history.begin([{ objectId: scene.objectId, shape: oneAbove }]);
    addRegion(scene.project, scene.objectId, oneAbove, 0xff0000);
    scene.history.commit(capture);
    scene.history.undo();

    expect(scene.project.camera.takes[0]?.name).toBe('shot B');
    expect(JSON.stringify(scene.project.snapshot().timeline)).toBe(timeline);
    expect(scene.grid.getColor(0, 0, 1)).toBeUndefined();
  });
});

describe('the stack', () => {
  it('drops the oldest gesture past its depth', () => {
    const scene = fixture(COLUMN, 1);
    for (const shape of [oneAbove, twoAbove]) {
      const capture = scene.history.begin([{ objectId: scene.objectId, shape }]);
      addRegion(scene.project, scene.objectId, shape, 0xff0000);
      scene.history.commit(capture);
    }

    expect(scene.history.undo()).not.toBeNull();
    expect(scene.grid.getColor(0, 0, 2)).toBeUndefined();
    expect(scene.grid.getColor(0, 0, 1)).toBe(0xff0000);
    // The first gesture went with the depth, so nothing stands behind the one that is left.
    expect(scene.history.canUndo).toBe(false);
  });

  it('replaces the redo branch with the next gesture', () => {
    const scene = fixture(COLUMN);
    for (const shape of [oneAbove, twoAbove]) {
      const capture = scene.history.begin([{ objectId: scene.objectId, shape }]);
      addRegion(scene.project, scene.objectId, shape, 0xff0000);
      scene.history.commit(capture);
    }
    scene.history.undo();
    expect(scene.history.canRedo).toBe(true);

    const capture = scene.history.begin([{ objectId: scene.objectId, shape: oneAbove }]);
    addRegion(scene.project, scene.objectId, oneAbove, 0x00ff00);
    scene.history.commit(capture);
    expect(scene.history.canRedo).toBe(false);
    expect(scene.grid.getColor(0, 0, 1)).toBe(0x00ff00);
  });

  it('forgets everything on reset, as a load does', () => {
    const scene = fixture(COLUMN);
    const capture = scene.history.begin([{ objectId: scene.objectId, shape: oneAbove }]);
    addRegion(scene.project, scene.objectId, oneAbove, 0xff0000);
    scene.history.commit(capture);
    scene.history.reset();

    expect(scene.history.canUndo).toBe(false);
    expect(scene.history.canRedo).toBe(false);
    expect(scene.history.undo()).toBeNull();
  });
});
