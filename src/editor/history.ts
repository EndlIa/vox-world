import type { ObjectId, Project, SceneObject } from '../document/project.js';
import type { CellKey, HexColor } from '../voxels/uniform/grid.js';
import { packKey, unpackKey } from '../voxels/uniform/grid.js';
import { visitRegion } from '../voxels/uniform/region.js';
import type { RegionShape } from '../voxels/uniform/region.js';

/** A region a gesture is about to change: the container it names cells in, and the shape it names them with. */
export type RegionCapture = { objectId: ObjectId; shape: RegionShape };

/** One cell a gesture changed, with the colour it held before and after; absent means the cell was not occupied. */
export type CellChange = { key: CellKey; before: HexColor | undefined; after: HexColor | undefined };

/** The cell changes one object's writes made, in the order the walk met them. */
export type CellGroup = { objectId: ObjectId; changes: CellChange[] };

/**
 * Everything one completed gesture changed. The object sets are whole records — plain data, with payload grids shared
 * by reference — so restoring one puts the scene's structure back, including an object a gesture deleted and the
 * payload it still points at. The cell changes are the writes inside the regions the gesture named, which is the one
 * part a record set cannot describe: a grid is mutated in place, so a record that shares it shares its new cells.
 */
export type Edit = {
  objects: { before: SceneObject[]; after: SceneObject[] };
  cells: CellGroup[];
};

/** What `begin` read, handed back to `commit`: every record, and the cells each named region holds right now. */
export type Capture = {
  objects: SceneObject[];
  cells: { objectId: ObjectId; before: Map<CellKey, HexColor | undefined> }[];
};

/** The number of gestures kept by default; the oldest is dropped once the stack is longer. */
export const DEFAULT_HISTORY_DEPTH = 50;

/** Two records differ when any field the document holds differs; the payload is compared by identity. */
function recordsDiffer(left: SceneObject, right: SceneObject): boolean {
  return (
    left.name !== right.name ||
    left.parentId !== right.parentId ||
    left.representation !== right.representation ||
    left.maskColor !== right.maskColor ||
    left.visible !== right.visible ||
    left.alignToGrid !== right.alignToGrid ||
    left.uniform !== right.uniform ||
    left.transform.position.x !== right.transform.position.x ||
    left.transform.position.y !== right.transform.position.y ||
    left.transform.position.z !== right.transform.position.z ||
    left.transform.quaternion.x !== right.transform.quaternion.x ||
    left.transform.quaternion.y !== right.transform.quaternion.y ||
    left.transform.quaternion.z !== right.transform.quaternion.z ||
    left.transform.quaternion.w !== right.transform.quaternion.w ||
    left.transform.scale.x !== right.transform.scale.x ||
    left.transform.scale.y !== right.transform.scale.y ||
    left.transform.scale.z !== right.transform.scale.z
  );
}

/** The ids whose record differs between two sets, in the order the left set holds them, plus the ones only it lacks. */
function changedIds(left: readonly SceneObject[], right: readonly SceneObject[]): ObjectId[] {
  const rightById = new Map(right.map((record) => [record.id, record]));
  const leftById = new Map(left.map((record) => [record.id, record]));
  const ids: ObjectId[] = [];
  for (const [id, record] of leftById) {
    const current = rightById.get(id);
    if (current === undefined || recordsDiffer(record, current)) ids.push(id);
  }
  for (const [id] of rightById) {
    if (!leftById.has(id)) ids.push(id);
  }
  return ids;
}

/** The objects one step touched: the records that differ, plus every object a cell write landed in. */
function touched(edit: Edit): ObjectId[] {
  const ids = changedIds(edit.objects.before, edit.objects.after);
  for (const group of edit.cells) {
    if (!ids.includes(group.objectId)) ids.push(group.objectId);
  }
  return ids;
}

/**
 * The undo stack of one editing session: what each completed gesture changed, and where the session stands in it.
 *
 * It owns no project state and renders nothing — it reads the document through `Project.snapshot`, writes it back
 * through `Project.restore`, and reports which objects a step touched so the caller can rebuild exactly those. The
 * camera and the timeline are deliberately outside its scope: a step restores the object set and the named cells and
 * leaves both as they are, so undoing an edit never rewinds a shot or a keyframe.
 *
 * It keeps no replayable log of its own beyond the cells a gesture named. Recovering an object's old *structure* is
 * one record set instead, which is why a gesture that replaced a payload — a subdivision, a detach, an import —
 * undoes by restoring the record that still points at the previous payload rather than by reversing the change.
 */
export class EditHistory {
  private readonly project: Project;
  private readonly depth: number;
  private readonly stack: Edit[] = [];
  private cursor = -1;

  constructor(project: Project, opts?: { depth?: number }) {
    const depth = opts?.depth ?? DEFAULT_HISTORY_DEPTH;
    if (!Number.isInteger(depth) || depth < 1) {
      throw new RangeError(`history depth must be a whole number of gestures at least one, got ${depth}`);
    }
    this.project = project;
    this.depth = depth;
  }

  /**
   * Reads the state a gesture is about to change: every object record, and the cells of each region it names. A region
   * on an object with no grid — a group, a fresh import — captures no cells, exactly as a write to it would find none.
   */
  begin(regions: readonly RegionCapture[] = []): Capture {
    const cells: Capture['cells'] = [];
    for (const region of regions) {
      const grid = this.project.get(region.objectId)?.uniform;
      if (grid === undefined) continue;
      const before = new Map<CellKey, HexColor | undefined>();
      visitRegion(grid, region.shape, (x, y, z, color) => {
        before.set(packKey(x, y, z), color);
      });
      cells.push({ objectId: region.objectId, before });
    }
    return { objects: this.project.snapshot().objects, cells };
  }

  /**
   * Records what the gesture changed, or nothing when the document came out the same — a refused operation, a paint
   * over empty space — so a caller never has to judge whether a step is worth keeping. A recorded step replaces the
   * redo branch and returns the objects it touched; nothing recorded returns `null`.
   */
  commit(capture: Capture): readonly ObjectId[] | null {
    const after = this.project.snapshot().objects;
    const cells: CellGroup[] = [];
    for (const region of capture.cells) {
      const grid = this.project.get(region.objectId)?.uniform;
      const changes: CellChange[] = [];
      for (const [key, before] of region.before) {
        const [x, y, z] = unpackKey(key);
        const now = grid?.getColor(x, y, z);
        // A cell that changed because its whole payload was replaced still counts: the record set describes which
        // payload an object holds, and the cell change describes what that payload holds.
        if (now !== before) changes.push({ key, before, after: now });
      }
      if (changes.length > 0) cells.push({ objectId: region.objectId, changes });
    }
    const edit: Edit = { objects: { before: capture.objects, after }, cells };
    if (changedIds(edit.objects.before, edit.objects.after).length === 0 && cells.length === 0) return null;

    this.stack.splice(this.cursor + 1);
    this.stack.push(edit);
    if (this.stack.length > this.depth) this.stack.splice(0, this.stack.length - this.depth);
    this.cursor = this.stack.length - 1;
    return touched(edit);
  }

  /** Puts the document back one gesture and returns the objects to rebuild, or `null` when there is nothing to undo. */
  undo(): readonly ObjectId[] | null {
    const edit = this.stack[this.cursor];
    if (edit === undefined) return null;
    this.apply(edit.objects.before, edit.cells, 'before');
    this.cursor -= 1;
    return touched(edit);
  }

  /** Re-applies the gesture an `undo` took back, or `null` when there is nothing to redo. */
  redo(): readonly ObjectId[] | null {
    const edit = this.stack[this.cursor + 1];
    if (edit === undefined) return null;
    this.apply(edit.objects.after, edit.cells, 'after');
    this.cursor += 1;
    return touched(edit);
  }

  get canUndo(): boolean {
    return this.cursor >= 0;
  }

  get canRedo(): boolean {
    return this.cursor + 1 < this.stack.length;
  }

  /** Forgets every recorded gesture, for a document that was just loaded or created: there is nothing behind it. */
  reset(): void {
    this.stack.length = 0;
    this.cursor = -1;
  }

  /**
   * Writes one side of an edit back. The object set goes first, because it is what decides which payload a cell write
   * lands in: a step that replaced or re-attached a payload restores that payload here, and only then are the cells
   * written into whatever the object holds now.
   */
  private apply(records: readonly SceneObject[], cells: readonly CellGroup[], side: 'before' | 'after'): void {
    const current = this.project.snapshot();
    this.project.restore({
      objects: records.slice(),
      camera: current.camera,
      settings: current.settings,
      timeline: current.timeline,
      counters: current.counters,
    });
    for (const group of cells) {
      const grid = this.project.get(group.objectId)?.uniform;
      if (grid === undefined) continue;
      for (const change of group.changes) {
        const [x, y, z] = unpackKey(change.key);
        const color = change[side];
        if (color === undefined) grid.remove(x, y, z);
        else grid.set(x, y, z, color);
      }
    }
  }
}
