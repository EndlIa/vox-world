import type { ObjectId, Project } from '../document/project.js';
import type { HexColor, IntBox3 } from '../voxels/uniform/grid.js';

/** The one region an edit addresses: nothing, or a uniform cell box. */
export type Selection =
  | { kind: 'none' }
  | { kind: 'box'; objectId: ObjectId; box: IntBox3 };

export type ActiveTool = 'select' | 'paint' | 'add' | 'remove';

/**
 * What a press in the viewport is for. `object` transforms whole objects through the gizmo, `edit` works on
 * the active object's voxels with the active tool. The two exclude each other — a press either transforms or
 * edits — and the viewport's bottom switch is what sets this.
 */
export type EditorMode = 'object' | 'edit';

/**
 * What a press selects. `box` is the only shape so far, and the only variant `Selection` has: an
 * inclusive cell region, one cell when the press and the release are the same cell.
 */
export type SelectionShape = 'box';

/**
 * What the active object's voxels look like right now: its representation, the subdivision of its own grid,
 * and — for a `uniform` object with occupied cells — how large that content is, per axis, in cells. A cell is
 * `1 / subdivision` of the world unit (README D41, D43), so the cell counts are a size in cells and the
 * subdivision is what says how much world each of them spans.
 */
export type EditResolution = {
  representation: 'empty' | 'uniform';
  /** The grid's own level, reported whenever the object has a grid at all (README D43). */
  subdivision?: number;
  cells?: [number, number, number];
};

const WHITE: HexColor = 0xffffff;
const MAX_HEX_COLOR = 0xffffff;

/**
 * The editing state no other module owns: active object, tool, selection, and the
 * subscriber list. It holds no project data, mutates no voxel container, and performs no edit —
 * the operations live in `./ops.js` and are invoked by the caller. Being DOM- and renderer-free is
 * what lets the HUD and the composition root read it without owning a canvas.
 */
export class EditorSession {
  activeObjectId: ObjectId | null;
  mode: EditorMode;
  activeTool: ActiveTool;
  /** What a press selects while the active tool builds a region (see `SelectionShape`). */
  selectionShape: SelectionShape;
  selection: Selection;
  /** Add and paint color, the appearance channel (never `SceneObject.maskColor`). */
  editColor: HexColor;

  private readonly project: Project;
  private readonly listeners = new Set<() => void>();

  constructor(project: Project) {
    this.project = project;
    this.activeObjectId = null;
    this.mode = 'object';
    this.activeTool = 'select';
    this.selectionShape = 'box';
    this.selection = { kind: 'none' };
    this.editColor = WHITE;
  }

  /** Reads the project on every call, so the reported resolution cannot go stale. */
  resolutionOf(objectId: ObjectId): EditResolution | undefined {
    const object = this.project.get(objectId);
    if (object === undefined) return undefined;
    if (object.representation === 'uniform') {
      const grid = object.uniform;
      if (grid === undefined) return { representation: 'empty' };
      const bounds = grid.bounds();
      // The subdivision is a property of the grid, so it is reported whenever one is attached, occupied or not
      // (README D43); the cell counts need an occupied cell to have a size at all.
      if (bounds === null) return { representation: 'uniform', subdivision: grid.subdivision };
      return {
        representation: 'uniform',
        subdivision: grid.subdivision,
        cells: [
          bounds.max[0] - bounds.min[0] + 1,
          bounds.max[1] - bounds.min[1] + 1,
          bounds.max[2] - bounds.min[2] + 1,
        ],
      };
    }
    return { representation: 'empty' };
  }

  /**
   * A selection names its object, so it never outlives a change of active object. Clearing the active object also
   * leaves the edit mode, because that mode edits one object's voxels and has nothing to do without one; the UI's
   * two ways into it are disabled until an object is chosen again (README D39).
   */
  setActiveObject(id: ObjectId | null): void {
    if (id !== null && this.project.get(id) === undefined) {
      throw new RangeError(`unknown object: ${id}`);
    }
    const changed = id !== this.activeObjectId;
    this.activeObjectId = id;
    if (id === null) this.mode = 'object';
    if (id === null || changed) this.selection = { kind: 'none' };
    this.notify();
  }

  /**
   * Only assigns and notifies, like `setTool`. Entering `object` mode drops the cell selection: a region is what
   * the edit mode works on, and the gizmo mode has no use for one.
   */
  setMode(mode: EditorMode): void {
    this.mode = mode;
    if (mode === 'object') this.selection = { kind: 'none' };
    this.notify();
  }

  /** Only assigns and notifies: `add`, `paint`, `remove` and `detach` share the box region. */
  setTool(tool: ActiveTool): void {
    this.activeTool = tool;
    this.notify();
  }

  /** Only assigns and notifies, like `setTool`: the shapes are a closed union, so nothing is checked here. */
  setSelectionShape(shape: SelectionShape): void {
    this.selectionShape = shape;
    this.notify();
  }

  /** Validates before assigning, so an illegal selection leaves the previous one in place. */
  setSelection(selection: Selection): void {
    if (selection.kind !== 'none') {
      const object = this.project.get(selection.objectId);
      if (object === undefined) {
        throw new RangeError(`unknown object: ${selection.objectId}`);
      }
      if (object.representation !== 'uniform') {
        throw new RangeError(`object ${selection.objectId} is ${object.representation}, not uniform`);
      }
    }
    this.selection = selection;
    this.notify();
  }

  /** The color the add and paint tools write at commit time — an appearance value, never an identity. */
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
