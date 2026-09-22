import type { ObjectId, Project } from '../document/project.js';
import type { ActiveTool, EditorSession } from './session.js';
import { addBox, detachSelection, paintBox, removeBox } from './ops.js';
import type { OpResult } from './ops.js';
import type { Picker } from '../three-runtime/picking.js';
import type { Overlay } from '../three-runtime/overlay.js';
import type { IntBox3 } from '../voxels/uniform/grid.js';
import { normalizeBox } from '../voxels/uniform/grid.js';
import { Vector2 } from 'three';
import type { PerspectiveCamera, Vector3 } from 'three';

export type PointerCallbacks = {
  onSessionChange(): void;
  /**
   * The objects an operation wrote, so the caller can rebuild exactly their derived geometry (README D4). A
   * region edit touches one; a detach touches two — the object the region left and the object it became.
   */
  onProjectChange(ids: readonly ObjectId[]): void;
};

/**
 * The tools that drag a box. The `select` tool consumes that box as the selection and writes nothing (see
 * `commit`); the others apply an operation to it. Every one of them reads the same region, in the same cells,
 * from the same gesture (README D19). A detach is not one of them: it is a command on the region the selection
 * already holds (`detachSelection`), so it can never be left armed for the next press.
 */
const BOX_TOOLS: Record<ActiveTool, boolean> = {
  select: true,
  paint: true,
  add: true,
  remove: true,
};

/** What a commit acts with: one of the session's tools, or the detach the panel commands directly. */
type CommitVerb = ActiveTool | 'detach';

/** The one drag in flight: one object, its occupied cells, one anchor cell, one moving corner cell. */
type DragState = {
  pointerId: number;
  objectId: ObjectId;
  bounds: IntBox3;
  anchorCell: [number, number, number];
  cornerCell: [number, number, number];
};

/**
 * Min-corner convention (README D20): the cell a local point falls in, held inside the object's own occupancy.
 *
 * A cell is the world unit (README D41), so a point's cell is its floor and nothing is scaled. The holding is
 * what makes a face hit mean one thing rather than two: a ray that hits a face reports a point exactly on that
 * face's plane, so on the far side of the box the floor lands one cell past the payload — a drag across that
 * face would address cells the object does not have, and every tool would then read an empty region there while
 * the same gesture on the near side addressed real cells. Clamping puts both on the outermost cell it does have.
 */
function cellAt(pointLocal: Vector3, bounds: IntBox3): [number, number, number] {
  const inside = (value: number, min: number, max: number): number =>
    value < min ? min : value > max ? max : value;
  return [
    inside(Math.floor(pointLocal.x), bounds.min[0], bounds.max[0]),
    inside(Math.floor(pointLocal.y), bounds.min[1], bounds.max[1]),
    inside(Math.floor(pointLocal.z), bounds.min[2], bounds.max[2]),
  ];
}


/**
 * All pointer handling in the viewport: point pick, box drag, and the commit of the active tool.
 * Every voxel write goes through `./ops.js`; every pick resolves `getCamera()` at call
 * time, so it always uses the camera that rendered the frame the user is looking at — the app-owned
 * viewport camera, or `SceneMirror.camera` while the camera lock is on (README D17).
 */
export class PointerTool {
  private readonly dom: HTMLElement;
  private readonly project: Project;
  private readonly session: EditorSession;
  private readonly picker: Picker;
  private readonly overlay: Overlay;
  private readonly getCamera: () => PerspectiveCamera;
  private readonly getGizmoBusy: () => boolean;
  private readonly callbacks: PointerCallbacks;
  private readonly ndc = new Vector2();
  private drag: DragState | null = null;
  /** True between an accepted left press and its pointer-up: at most one commit per press. */
  private pressActive = false;
  private disposed = false;

  constructor(opts: {
    dom: HTMLElement;
    project: Project;
    session: EditorSession;
    picker: Picker;
    overlay: Overlay;
    getCamera: () => PerspectiveCamera;
    getGizmoBusy: () => boolean;
    callbacks: PointerCallbacks;
  }) {
    this.dom = opts.dom;
    this.project = opts.project;
    this.session = opts.session;
    this.picker = opts.picker;
    this.overlay = opts.overlay;
    this.getCamera = opts.getCamera;
    this.getGizmoBusy = opts.getGizmoBusy;
    this.callbacks = opts.callbacks;
    this.dom.addEventListener('pointerdown', this.onPointerDown);
    this.dom.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerCancel);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.dom.removeEventListener('pointerdown', this.onPointerDown);
    this.dom.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerCancel);
    this.overlay.clear();
    this.drag = null;
    this.pressActive = false;
  }

  /**
   * A left press the gizmo is not using selects what it hit and, for a box-consuming tool, arms the
   * box drag. A raw source mesh selects its object and nothing else, because it has no cells to edit
   * yet (README D24). The gizmo is the one claim that outranks the tool, and `getGizmoBusy()` is that claim:
   * `TransformControls` calls `setPointerCapture` on this shared element on *every* press, whether or
   * not a handle was hit, so neither a capture nor `defaultPrevented` marks a press as the gizmo's —
   * only its own dragging/hover state does. Buttons 1 and 2 stay navigation and touch nothing here.
   */
  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.disposed || event.button !== 0) return;
    if (this.getGizmoBusy()) return;
    this.pressActive = true;
    const ndc = this.toNdc(event);
    const hit = this.picker.pick(ndc, this.getCamera());
    if (hit === undefined) {
      this.drag = null;
      this.session.setSelection({ kind: 'none' });
      this.overlay.clear();
      this.callbacks.onSessionChange();
      return;
    }
    this.session.setActiveObject(hit.objectId);
    if (this.session.mode === 'object' || hit.kind === 'object') {
      // Object mode transforms whole objects through the gizmo, and a raw source mesh has no voxel identity to
      // select or edit yet: either way the press only chooses whose gizmo is shown, and it commits no operation
      // (README D24, D39).
      this.drag = null;
      this.session.setSelection({ kind: 'none' });
      this.overlay.clear();
      this.callbacks.onSessionChange();
      return;
    }
    // The shape the select tool is set to is what the press selects; the region is one cell until a drag
    // extends it.
    this.session.setSelection({
      kind: this.session.selectionShape,
      objectId: hit.objectId,
      box: normalizeBox(hit.cell, hit.cell),
    });
    this.armDrag(event.pointerId, ndc, hit.objectId);
    this.paintSelection();
    this.callbacks.onSessionChange();
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.disposed) return;
    if (this.drag !== null && this.drag.pointerId === event.pointerId) this.trackDrag(this.toNdc(event));
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.disposed) return;
    const drag = this.drag;
    if (drag !== null && drag.pointerId === event.pointerId) this.drag = null;
    if (!this.pressActive) return;
    this.pressActive = false;
    if (drag !== null) {
      const box = normalizeBox(drag.anchorCell, drag.cornerCell);
      this.session.setSelection({ kind: 'box', objectId: drag.objectId, box });
    }
    this.commit();
  };

  private readonly onPointerCancel = (event: PointerEvent): void => {
    if (this.disposed) return;
    if (this.drag !== null && this.drag.pointerId === event.pointerId) this.drag = null;
    this.pressActive = false;
  };

  /** NDC from the canvas rectangle, so picking matches what the canvas shows at any CSS size. */
  private toNdc(event: PointerEvent): Vector2 {
    const rect = this.dom.getBoundingClientRect();
    this.ndc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -(((event.clientY - rect.top) / rect.height) * 2 - 1),
    );
    return this.ndc;
  }

  /** Arms a box drag only in edit mode, for a box-dragging tool, on a uniform object; otherwise the click stands. */
  private armDrag(pointerId: number, ndc: Vector2, objectId: ObjectId): void {
    if (this.session.mode !== 'edit' || !BOX_TOOLS[this.session.activeTool]) return;
    // Only a uniform object has cells to address; a group or a fresh import has nothing to drag over, and an
    // object with no occupied cell has no cell to address at all.
    const bounds = this.project.get(objectId)?.uniform?.bounds();
    if (bounds === undefined || bounds === null) return;
    const surface = this.picker.pickSurface(ndc, this.getCamera());
    if (surface === undefined || surface.objectId !== objectId) return;
    const anchor = cellAt(surface.pointLocal, bounds);
    this.drag = {
      pointerId,
      objectId,
      bounds,
      anchorCell: anchor,
      cornerCell: [anchor[0], anchor[1], anchor[2]],
    };
  }

  /** Live preview only: nothing is written to the container while the button is down. */
  private trackDrag(ndc: Vector2): void {
    const drag = this.drag;
    if (drag === null) return;
    const surface = this.picker.pickSurface(ndc, this.getCamera());
    if (surface !== undefined && surface.objectId === drag.objectId) {
      drag.cornerCell = cellAt(surface.pointLocal, drag.bounds);
    }
    // The box the drag has drawn so far: inclusive on both corners, in the anchor object's cells (D19).
    const box = normalizeBox(drag.anchorCell, drag.cornerCell);
    this.overlay.showBox(box, this.project.worldMatrix(drag.objectId));
  }

  /**
   * Runs the detach on the current selection, without a press: the panel's `detach` button is a command on the
   * region the `Select` tool already chose rather than a tool choice, so it commits the same operation a viewport
   * press would and ends the same way — the new object active, the region no longer selected, its box gone
   * (README D19, D23). It is why that button is disabled while there is no selection.
   */
  detachSelection(): void {
    this.commit('detach');
  }

  /** One operation per press, chosen by the active tool over the current selection. */
  private commit(tool: CommitVerb = this.session.activeTool): void {
    const selection = this.session.selection;
    // Object mode writes no voxels at all: its presses only chose whose gizmo to show (see `onPointerDown`).
    if (this.session.mode !== 'edit') return;
    if (selection.kind === 'none') return;
    if (tool === 'select') {
      this.paintSelection();
      return;
    }
    // `objectId` is optional on the union: only a detach carries one, and it is checked below.
    const result: OpResult & { objectId?: ObjectId } =
      tool === 'add'
        ? addBox(this.project, selection.objectId, selection.box, this.session.editColor)
        : tool === 'paint'
          ? paintBox(this.project, selection.objectId, selection.box, this.session.editColor)
          : tool === 'remove'
            ? removeBox(this.project, selection.objectId, selection.box)
            : detachSelection(this.project, selection);
    // Both halves of a detach change geometry, and only reporting the object that gained cells would leave the
    // source drawing cells it no longer holds (README D4, D23).
    const changed: ObjectId[] = [selection.objectId];
    if (tool === 'detach' && result.objectId !== undefined) changed.push(result.objectId);
    this.settle(result, changed, tool === 'detach');
  }

  private settle(result: OpResult & { objectId?: ObjectId }, changed: readonly ObjectId[], detached: boolean): void {
    if (!result.ok) {
      // The panel has no message area any more (D38), so a refused operation — a budget refusal, a grid
      // refusal — goes to the console instead of nowhere.
      console.error(`${result.error}: ${result.detail}`);
      return;
    }
    if (result.cells !== 0) this.callbacks.onProjectChange(changed);
    if (!detached) {
      this.overlay.clear();
      this.paintSelection();
      return;
    }
    const detachedId = result.objectId;
    if (detachedId !== undefined) {
      this.session.setActiveObject(detachedId);
      this.session.setSelection({ kind: 'none' });
      this.callbacks.onSessionChange();
    }
    this.overlay.clear();
  }

  /** Redraws the overlay for the current selection: the committed box. */
  private paintSelection(): void {
    const selection = this.session.selection;
    if (selection.kind === 'none') {
      this.overlay.clear();
      return;
    }
    const object = this.project.get(selection.objectId);
    if (object?.uniform !== undefined) {
      this.overlay.showBox(selection.box, this.project.worldMatrix(selection.objectId));
      return;
    }
    this.overlay.clear();
  }
}
