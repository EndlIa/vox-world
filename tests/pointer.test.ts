import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { Project } from '../src/document/project.js';
import { EditorSession } from '../src/editor/session.js';
import { PointerTool } from '../src/editor/pointer.js';
import type { PickHit } from '../src/three-runtime/picking.js';
import { UniformGrid } from '../src/voxels/uniform/grid.js';

/**
 * The drag is driven the way the browser drives it: the tool's own listeners are called with pointer events, the
 * picker answers with hits this file chooses, and the outcome is read off the document and the session. That is
 * what pins the two things a cell-to-world mapping can get wrong — which cell a face hit names, and what a box does
 * when the pointer leaves the model (README D19, D20, D41, D43).
 */

/** Every listener the tool registers, on the element and on `window`, so a test can drive them. */
const listeners = new Map<string, (event: unknown) => void>();

(globalThis as unknown as { window: unknown }).window = {
  addEventListener: (type: string, handler: (event: unknown) => void) => listeners.set(type, handler),
  removeEventListener: () => undefined,
};

/** The viewport element: 100 x 100 px at the origin, so NDC and client pixels map one for one in the middle. */
const element = {
  addEventListener: (type: string, handler: (event: unknown) => void) => listeners.set(type, handler),
  removeEventListener: () => undefined,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
} as unknown as HTMLElement;

function fixture() {
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
    position: new Vector3(0, 0, 0),
  });
  const session = new EditorSession(project);
  session.setMode('edit');
  session.setActiveObject(object.id);

  let hit: PickHit | undefined;
  const camera = new PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.updateMatrixWorld();
  const pointer = new PointerTool({
    dom: element,
    project,
    session,
    picker: { pick: () => hit } as never,
    overlay: { clear: () => undefined, showBox: () => undefined } as never,
    getCamera: () => camera,
    getGizmoBusy: () => false,
    callbacks: { onSessionChange: () => undefined, onProjectChange: () => undefined },
  });
  /** A pointer event at one NDC position on the 100 x 100 element. */
  const event = (type: string, ndcX: number) => ({
    type,
    button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
    pointerId: 7,
    clientX: 50 + ndcX * 50,
    clientY: 50,
  });
  return {
    project,
    session,
    objectId: object.id,
    pointer,
    setHit: (next: PickHit | undefined) => {
      hit = next;
    },
    down: (ndcX: number) => listeners.get('pointerdown')!(event('pointerdown', ndcX)),
    move: (ndcX: number) => listeners.get('pointermove')!(event('pointermove', ndcX)),
    up: (ndcX: number) => listeners.get('pointerup')!(event('pointerup', ndcX)),
  };
}

/** A hit on cell `cell` reported at the centre of the object's `+z` face, the way a raycast reports a face. */
function faceHit(cell: [number, number, number]): PickHit {
  return {
    kind: 'cell',
    objectId: 'obj-0',
    cell,
    color: 0x3366ff,
    // A cell spans `[i, i + 1]`, so a hit on its `+z` face lands exactly on that plane.
    point: new Vector3(cell[0] + 0.5, cell[1] + 0.5, cell[2] + 1),
    normal: new Vector3(0, 0, 1),
  };
}

describe('box drag', () => {
  it('takes the cells the picker named, on both corners', () => {
    const scene = fixture();
    scene.session.setTool('select');
    scene.setHit(faceHit([1, 1, 1]));
    scene.down(0);
    scene.setHit(faceHit([1, 1, 0]));
    scene.move(0);
    scene.up(0);

    // Both corners are the cells the hits reported: a face's own plane is never floored into the next cell, which
    // is what used to make a drag across a far face address cells the cube does not have.
    expect(scene.session.selection).toEqual({
      kind: 'box',
      objectId: scene.objectId,
      box: { min: [1, 1, 0], max: [1, 1, 1] },
    });
    scene.pointer.dispose();
  });

  it('carries the box through empty space when the pointer leaves the model', () => {
    const scene = fixture();
    scene.session.setTool('add');
    scene.session.setEditColor(0xff0000);
    // A press on the cell at the origin, then a move that hits nothing: the gesture continues in the pressed face's
    // plane, so the box reaches cells the object does not have yet.
    scene.setHit(faceHit([0, 0, 0]));
    scene.down(0);
    scene.setHit(undefined);
    scene.move(0.5);
    scene.up(0.5);

    const grid = scene.project.get(scene.objectId)!.uniform!;
    // The far corner is the cell the ray's plane hit landed in, one cell past the 2 x 2 x 2 block, and the two axes
    // the drag did not travel stay on the pressed cell rather than drifting one past the face.
    expect(grid.getColor(2, 0, 0)).toBe(0xff0000);
    expect(grid.getColor(1, 0, 0)).toBe(0xff0000);
    // Cells of the block that the box did not cover keep their own color, so the box stayed one cell deep on the two
    // axes the drag did not travel.
    expect(grid.getColor(1, 1, 0)).toBe(0x3366ff);
    expect(grid.getColor(1, 0, 1)).toBe(0x3366ff);
    // Exactly one cell was created, the far corner past the block's face.
    expect(grid.size).toBe(9);
    scene.pointer.dispose();
  });
});
