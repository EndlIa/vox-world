import type { ObjectId, Project } from '../document/project.js';
import type { ActiveTool, EditorSession, SelectionShape } from './session.js';
import type { EditHistory } from './history.js';
import { addRegion, detachSelection, paintRegion, removeRegion } from './ops.js';
import type { OpResult } from './ops.js';
import type { PickHit, Picker } from '../three-runtime/picking.js';
import type { Overlay } from '../three-runtime/overlay.js';
import type { HexColor, IntBox3 } from '../voxels/uniform/grid.js';
import { KEY_MAX, KEY_MIN, normalizeBox } from '../voxels/uniform/grid.js';
import { regionBounds } from '../voxels/uniform/region.js';
import type { RegionShape } from '../voxels/uniform/region.js';
import { Matrix3, Matrix4, Plane, Raycaster, Vector2, Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';

export type PointerCallbacks = {
  onSessionChange(): void;
  /**
   * The objects an operation wrote, so the caller can rebuild exactly their derived geometry. A
   * region edit touches one; a detach touches two — the object the region left and the object it became.
   */
  onProjectChange(ids: readonly ObjectId[]): void;
};

/**
 * The tools that drag a box. The `select` tool consumes that box as the selection and writes nothing (see
 * `commit`); the others apply an operation to it. Every one of them reads the same region, in the same cells,
 * from the same gesture. A detach is not one of them: it is a command on the region the selection
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

/**
 * The one drag in flight: one object, its cell size, one anchor cell, one moving corner cell, and the plane the
 * gesture runs in — the face the press landed on, so a pointer that leaves the model still names a cell.
 */
type DragState = {
  pointerId: number;
  objectId: ObjectId;
  cell: number;
  anchorCell: [number, number, number];
  cornerCell: [number, number, number];
  /** The one cell a press steps out of the pressed face, `[0, 0, 0]` for the tools that take the seen cell. */
  outer: [number, number, number];
  /** Whether a tracked move happened: it is what arms the add wall, so a click stays a point edit. */
  dragging: boolean;
  plane: Plane;
  /** The pressed face's normal in the object's own frame, or none when the raycast reported no face. */
  normal: Vector3 | undefined;
  /** The object's world matrix inverted: a world point on that plane turns into a cell with it. */
  toLocal: Matrix4;
};

/** Holds one cell inside the packed key space, the only range a cell may come from at all. */
function holdCell(value: number): number {
  return Math.min(KEY_MAX, Math.max(KEY_MIN, value));
}

/** The cell a local point addresses: min-corner convention, floored after dividing by the cell size. */
function cellOfLocal(pointLocal: Vector3, cell: number): [number, number, number] {
  return [
    holdCell(Math.floor(pointLocal.x / cell)),
    holdCell(Math.floor(pointLocal.y / cell)),
    holdCell(Math.floor(pointLocal.z / cell)),
  ];
}

/**
 * The cell the `add` tool steps out of the pressed face: the face normal's dominant axis, one cell out.
 * Every other tool takes the cell the pick named, so `paint` and `remove` address what
 * the user sees while `add` writes the empty layer in front of it — a press on a face of a solid adds a cell
 * instead of repainting one. A hit whose raycast reported no face has no outward direction to step in, so the
 * offset is `[0, 0, 0]` and the press takes the cell it named.
 */
function outerCell(tool: ActiveTool, normal: Vector3 | undefined): [number, number, number] {
  if (tool !== 'add' || normal === undefined) return [0, 0, 0];
  const axis = Math.abs(normal.x) >= Math.abs(normal.y) && Math.abs(normal.x) >= Math.abs(normal.z) ? 0
    : Math.abs(normal.y) >= Math.abs(normal.z) ? 1
      : 2;
  const step: [number, number, number] = [0, 0, 0];
  step[axis] = normal.getComponent(axis) < 0 ? -1 : 1;
  return step;
}

/**
 * The box a press commits: the cells the pick named, stepped out of the pressed face by `outer`, and — for a
 * tracked drag with `height > 1` — stretched along that same axis to `height` cells.
 * A click (`tracked` false) is one cell whatever the height says, so point editing needs no second mode.
 */
function dragBox(
  anchor: readonly [number, number, number],
  corner: readonly [number, number, number],
  outer: readonly [number, number, number],
  tracked: boolean,
  height: number,
): IntBox3 {
  const step = (cell: readonly [number, number, number]): [number, number, number] => [
    holdCell(cell[0] + outer[0]),
    holdCell(cell[1] + outer[1]),
    holdCell(cell[2] + outer[2]),
  ];
  const box = normalizeBox(step(anchor), step(corner));
  if (!tracked || height <= 1) return box;
  const max: [number, number, number] = [box.max[0], box.max[1], box.max[2]];
  if (outer[0] !== 0) max[0] = holdCell(box.min[0] + height - 1);
  else if (outer[1] !== 0) max[1] = holdCell(box.min[1] + height - 1);
  else if (outer[2] !== 0) max[2] = holdCell(box.min[2] + height - 1);
  return { min: box.min, max };
}

/**
 * The region a press names. A box is the cells the drag draws — one cell until a drag extends it — while a colour
 * takes every cell that carries the picked cell's colour and an island takes everything face-connected to it. Both
 * are named by the picked cell alone and never grow with the pointer, which is why only a box arms a drag.
 */
function pressShape(
  kind: SelectionShape,
  box: IntBox3,
  cell: readonly [number, number, number],
  color: HexColor,
): RegionShape {
  if (kind === 'color') return { kind: 'color', color };
  if (kind === 'island') return { kind: 'island', seed: [cell[0], cell[1], cell[2]] };
  return { kind: 'box', min: box.min, max: box.max };
}

/** Scratch, so a pointer move allocates nothing: the drag's ray, its plane hit, that point in cell space, and the
 *  matrices that turn the pressed face into a world normal. */
const _ray = new Raycaster();
const _planeHit = new Vector3();
const _localHit = new Vector3();
const _normalMatrix = new Matrix3();
const _viewNormal = new Vector3();

/**
 * All pointer handling in the viewport: point pick, box drag, and the commit of the active tool.
 * Every voxel write goes through `./ops.js`; every pick resolves `getCamera()` at call
 * time, so it always uses the app-owned viewport camera — the one navigation moves, never the
 * authored output camera.
 *
 * A press that writes is one history step: the tool captures the region the selection names before the operation
 * runs and hands the capture to the history, which keeps the difference — or nothing, when the operation changed
 * nothing at all, which is how a refused commit leaves no step behind.
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
  private readonly history: EditHistory;
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
    history: EditHistory;
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
    this.history = opts.history;
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
   * yet. The gizmo is the one claim that outranks the tool, and `getGizmoBusy()` is that claim:
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
      // select or edit yet: either way the press only chooses whose gizmo is shown, and it commits no operation.
      this.drag = null;
      this.session.setSelection({ kind: 'none' });
      this.overlay.clear();
      this.callbacks.onSessionChange();
      return;
    }
    // The shape the session is set to is what the press names: the box it draws — one cell until a drag extends
    // it, stepped out of the pressed face when the tool is `add` so its press writes empty space — or the colour
    // or island the picked cell names.
    const outer = outerCell(this.session.activeTool, hit.normal);
    const box = dragBox(hit.cell, hit.cell, outer, false, this.session.addHeight);
    this.session.setSelection({
      kind: 'region',
      objectId: hit.objectId,
      shape: pressShape(this.session.selectionShape, box, hit.cell, hit.color),
    });
    this.armDrag(event.pointerId, hit, outer);
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
      const box = dragBox(drag.anchorCell, drag.cornerCell, drag.outer, drag.dragging, this.session.addHeight);
      this.session.setSelection({
        kind: 'region',
        objectId: drag.objectId,
        shape: { kind: 'box', min: box.min, max: box.max },
      });
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

  /**
   * Arms a box drag only in edit mode, for a box-dragging tool, on a uniform object, and while the session builds
   * boxes: a colour or an island is named by the cell the press landed on, so a drag has nothing to extend.
   */
  private armDrag(pointerId: number, hit: Extract<PickHit, { kind: 'cell' }>, outer: [number, number, number]): void {
    if (this.session.mode !== 'edit' || !BOX_TOOLS[this.session.activeTool]) return;
    if (this.session.selectionShape !== 'box') return;
    // Only a uniform object has cells to address; a group or a fresh import has nothing to drag over.
    const grid = this.project.get(hit.objectId)?.uniform;
    if (grid === undefined) return;
    // The anchor is the cell the instance lookup named, so a press on a face addresses the cell the user sees
    // rather than its neighbour: a face hit reports a point on that face's own plane, and flooring such a point
    // names the cell past the face. `outer` is what `dragBox` steps that box out with for `add`.
    const worldMatrix = this.project.worldMatrix(hit.objectId);
    const worldNormal =
      hit.normal === undefined
        ? this.getCamera().getWorldDirection(_viewNormal).negate().clone()
        : hit.normal.clone().applyMatrix3(_normalMatrix.getNormalMatrix(worldMatrix)).normalize();
    this.drag = {
      pointerId,
      objectId: hit.objectId,
      cell: grid.cellSize,
      anchorCell: [hit.cell[0], hit.cell[1], hit.cell[2]],
      cornerCell: [hit.cell[0], hit.cell[1], hit.cell[2]],
      outer,
      dragging: false,
      plane: new Plane().setFromNormalAndCoplanarPoint(worldNormal, hit.point),
      normal: hit.normal?.clone(),
      toLocal: worldMatrix.invert(),
    };
  }

  /** Live preview only: nothing is written to the container while the button is down. */
  private trackDrag(ndc: Vector2): void {
    const drag = this.drag;
    if (drag === null) return;
    const hit = this.picker.pick(ndc, this.getCamera());
    if (hit !== undefined && hit.kind === 'cell' && hit.objectId === drag.objectId) {
      drag.cornerCell = [hit.cell[0], hit.cell[1], hit.cell[2]];
    } else {
      // Off the model, or over another object: the gesture keeps running in the plane of the face it started on, so a
      // box can be drawn through empty space — which is how `add` grows an object — and it never jumps to another one.
      _ray.setFromCamera(ndc, this.getCamera());
      const world = _ray.ray.intersectPlane(drag.plane, _planeHit);
      if (world !== null) {
        _localHit.copy(world).applyMatrix4(drag.toLocal);
        // That point is on the face's own plane, so flooring it lands in the cell past the face: half a cell back
        // along the normal is the cell the press addressed, and the two axes the drag travels are untouched.
        if (drag.normal !== undefined) _localHit.addScaledVector(drag.normal, -drag.cell / 2);
        drag.cornerCell = cellOfLocal(_localHit, drag.cell);
      }
    }
    // The box the drag has drawn so far: inclusive on both corners, in the anchor object's cells, stepped out of
    // the pressed face when the tool is `add` and stretched to the session's wall height once a move happened.
    drag.dragging = true;
    const box = dragBox(drag.anchorCell, drag.cornerCell, drag.outer, drag.dragging, this.session.addHeight);
    this.overlay.showBox(box, this.project.worldMatrix(drag.objectId), drag.cell);
  }

  /**
   * Runs the detach on the current selection, without a press: the panel's `detach` button is a command on the
   * region the `Select` tool already chose rather than a tool choice, so it commits the same operation a viewport
   * press would and ends the same way — the new object active, the region no longer selected, its box gone
   * It is why that button is disabled while there is no selection.
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
    // The capture is taken before the operation and committed after it: the history reads the region the selection
    // names, the operation writes, and the history keeps the difference for one undo step.
    const capture = this.history.begin([{ objectId: selection.objectId, shape: selection.shape }]);
    // Every region selection names its object; the optional id is what a detach adds, for the object it created.
    const result: OpResult & { objectId?: ObjectId } =
      tool === 'add'
        ? addRegion(this.project, selection.objectId, selection.shape, this.session.editColor)
        : tool === 'paint'
          ? paintRegion(this.project, selection.objectId, selection.shape, this.session.editColor)
          : tool === 'remove'
            ? removeRegion(this.project, selection.objectId, selection.shape)
            : detachSelection(this.project, selection);
    this.history.commit(capture);
    // Both halves of a detach change geometry, and only reporting the object that gained cells would leave the
    // source drawing cells it no longer holds.
    const changed: ObjectId[] = [selection.objectId];
    if (tool === 'detach' && result.objectId !== undefined) changed.push(result.objectId);
    this.settle(result, changed, tool === 'detach');
  }

  private settle(result: OpResult & { objectId?: ObjectId }, changed: readonly ObjectId[], detached: boolean): void {
    if (!result.ok) {
      // The panel has no message area any more, so a refused operation — a budget refusal, a grid
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

  /**
   * Redraws the overlay for the current selection: the frame the committed region spans. A box reports its own
   * extent and a colour group or an island the extent of what it found, so this is a marker around the region
   * rather than the region itself.
   */
  private paintSelection(): void {
    const selection = this.session.selection;
    if (selection.kind === 'none') {
      this.overlay.clear();
      return;
    }
    const object = this.project.get(selection.objectId);
    const grid = object?.uniform;
    if (grid === undefined) {
      this.overlay.clear();
      return;
    }
    const bounds = regionBounds(grid, selection.shape);
    if (bounds === null) {
      this.overlay.clear();
      return;
    }
    this.overlay.showBox(bounds, this.project.worldMatrix(selection.objectId), grid.cellSize);
  }
}
