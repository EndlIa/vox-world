import type { ObjectId, Project } from '../document/project.js';
import type { HexColor, IntBox3 } from '../voxels/uniform/grid.js';
import type { LeafId } from '../voxels/octree/leafId.js';

/** The one region an edit addresses: nothing, a uniform cell box, or one octree leaf. */
export type Selection =
  | { kind: 'none' }
  | { kind: 'box'; objectId: ObjectId; box: IntBox3 }
  | { kind: 'leaf'; objectId: ObjectId; leafId: LeafId };

export type ActiveTool = 'select' | 'box' | 'paint' | 'remove' | 'split' | 'merge' | 'detach';

/** What the active object's voxels look like right now, and at which resolution. */
export type EditResolution = {
  representation: 'empty' | 'uniform' | 'octree';
  voxelSize?: number;
  leafSize?: number;
};

const WHITE: HexColor = 0xffffff;
const MAX_HEX_COLOR = 0xffffff;

/**
 * The editing state no other module owns: active object, tool, selection, box height, and the
 * subscriber list. It holds no project data, mutates no voxel container, and performs no edit —
 * the operations live in `./ops.js` and are invoked by the caller. Being DOM- and renderer-free is
 * what lets the HUD and the composition root read it without owning a canvas.
 */
export class EditorSession {
  activeObjectId: ObjectId | null;
  activeTool: ActiveTool;
  selection: Selection;
  /** Fixed-height override for the box drag; any value `<= 1` means "no override". */
  boxHeight: number;
  /** Paint and box color, the appearance channel (never `SceneObject.maskColor`). */
  editColor: HexColor;

  private readonly project: Project;
  private readonly listeners = new Set<() => void>();

  constructor(project: Project) {
    this.project = project;
    this.activeObjectId = null;
    this.activeTool = 'select';
    this.selection = { kind: 'none' };
    this.boxHeight = 1;
    this.editColor = WHITE;
  }

  /**
   * Reads the project on every call, so the reported resolution cannot go stale. `leafSize` is
   * present only while the current selection is a leaf of this object; there is no depth to report
   * before a leaf has been picked.
   */
  resolutionOf(objectId: ObjectId): EditResolution | undefined {
    const object = this.project.get(objectId);
    if (object === undefined) return undefined;
    if (object.representation === 'uniform') {
      const grid = object.uniform;
      if (grid === undefined) return { representation: 'empty' };
      return { representation: 'uniform', voxelSize: grid.voxelSize };
    }
    if (object.representation === 'octree') {
      const octree = object.octree;
      if (octree === undefined) return { representation: 'empty' };
      const selection = this.selection;
      if (selection.kind === 'leaf' && selection.objectId === objectId && octree.hasLeaf(selection.leafId)) {
        return { representation: 'octree', leafSize: octree.leafSize(octree.leafBox(selection.leafId).depth) };
      }
      return { representation: 'octree' };
    }
    return { representation: 'empty' };
  }

  /** A selection names its object, so it never outlives a change of active object. */
  setActiveObject(id: ObjectId | null): void {
    if (id !== null && this.project.get(id) === undefined) {
      throw new RangeError(`unknown object: ${id}`);
    }
    const changed = id !== this.activeObjectId;
    this.activeObjectId = id;
    if (id === null || changed) this.selection = { kind: 'none' };
    this.notify();
  }

  /** Only assigns and notifies: `box`, `paint`, `remove` and `detach` share the box, `split` and `merge` the leaf. */
  setTool(tool: ActiveTool): void {
    this.activeTool = tool;
    this.notify();
  }

  /** Validates before assigning, so an illegal selection leaves the previous one in place. */
  setSelection(selection: Selection): void {
    if (selection.kind !== 'none') {
      const object = this.project.get(selection.objectId);
      if (object === undefined) {
        throw new RangeError(`unknown object: ${selection.objectId}`);
      }
      if (selection.kind === 'box' && object.representation !== 'uniform') {
        throw new RangeError(`object ${selection.objectId} is ${object.representation}, not uniform`);
      }
      if (selection.kind === 'leaf' && object.representation !== 'octree') {
        throw new RangeError(`object ${selection.objectId} is ${object.representation}, not octree`);
      }
    }
    this.selection = selection;
    this.notify();
  }

  /** The color the paint and box tools write at commit time — an appearance value, never an identity. */
  setEditColor(color: HexColor): void {
    if (!Number.isFinite(color) || color < 0 || color > MAX_HEX_COLOR) {
      throw new RangeError(`edit color out of range: ${color}`);
    }
    this.editColor = color;
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    if (typeof listener !== 'function') {
      throw new TypeError('listener must be a function');
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Synchronous; a listener may subscribe or unsubscribe during the fan-out without affecting it. */
  notify(): void {
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}
