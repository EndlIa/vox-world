import type { ObjectId, Project } from '../document/project.js';
import type { ActiveTool, EditorSession } from './session.js';
import { addBox, detachSelection, mergeLeaf, paintBox, paintLeaf, removeBox, removeLeaf, splitLeaf } from './ops.js';
import type { OpResult } from './ops.js';
import type { Picker } from '../three-runtime/picking.js';
import type { Overlay } from '../three-runtime/overlay.js';
import type { IntBox3 } from '../voxels/uniform/grid.js';
import { boxCount, normalizeBox } from '../voxels/uniform/grid.js';
import { Vector2 } from 'three';
import type { PerspectiveCamera, Vector3 } from 'three';

export type PointerCallbacks = {
  onSessionChange(): void;
  onProjectChange(): void;
  onStatus(text: string): void;
};

/** The tools that consume the dragged box; `split` and `merge` consume a picked leaf instead. */
const BOX_TOOLS: ReadonlySet<ActiveTool> = new Set<ActiveTool>(['box', 'paint', 'remove', 'detach']);

/** The one drag in flight: one object, one anchor cell, one moving corner cell. */
type DragState = {
  pointerId: number;
  objectId: ObjectId;
  voxelSize: number;
  anchorCell: [number, number, number];
  cornerCell: [number, number, number];
  dragging: boolean;
};

/** Min-corner convention (README D20): the cell a local point falls in. */
function cellAt(pointLocal: Vector3, voxelSize: number): [number, number, number] {
  return [
    Math.floor(pointLocal.x / voxelSize),
    Math.floor(pointLocal.y / voxelSize),
    Math.floor(pointLocal.z / voxelSize),
  ];
}

function hexColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function describeBox(box: IntBox3): string {
  const width = box.max[0] - box.min[0] + 1;
  const height = box.max[1] - box.min[1] + 1;
  const depth = box.max[2] - box.min[2] + 1;
  return `box ${width}x${height}x${depth} (${boxCount(box)} cells)`;
}

/**
 * All pointer handling in the viewport: point pick, box drag, hover preview, and the commit of the
 * active tool. Every voxel write goes through `./ops.js`; every pick resolves `getCamera()` at call
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
   * box drag. A raw source mesh selects its object and nothing else, because it has no cells or leaves
   * to edit yet (README D24). The gizmo is the one claim that outranks the tool, and `getGizmoBusy()` is that claim:
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
    if (hit.kind === 'object') {
      // A raw source mesh has no voxel identity to select or edit yet: making its object active is the
      // whole press, and it commits no operation because there is nothing to edit (README D24).
      this.drag = null;
      this.session.setSelection({ kind: 'none' });
      this.overlay.clear();
      this.callbacks.onSessionChange();
      return;
    }
    if (hit.kind === 'cell') {
      this.session.setSelection({ kind: 'box', objectId: hit.objectId, box: normalizeBox(hit.cell, hit.cell) });
      this.armDrag(event.pointerId, ndc, hit.objectId);
    } else {
      this.session.setSelection({ kind: 'leaf', objectId: hit.objectId, leafId: hit.leafId });
    }
    this.paintSelection();
    this.callbacks.onSessionChange();
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.disposed) return;
    if (this.drag !== null && this.drag.pointerId === event.pointerId) {
      this.trackDrag(this.toNdc(event));
      return;
    }
    if (event.buttons !== 0) return;
    this.hover(this.toNdc(event));
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.disposed) return;
    const drag = this.drag;
    if (drag !== null && drag.pointerId === event.pointerId) this.drag = null;
    if (!this.pressActive) return;
    this.pressActive = false;
    if (drag !== null) {
      const box = this.boxOf(drag);
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

  /** Arms a box drag only for a box-consuming tool on a uniform object; otherwise the click stands. */
  private armDrag(pointerId: number, ndc: Vector2, objectId: ObjectId): void {
    if (!BOX_TOOLS.has(this.session.activeTool)) return;
    const grid = this.project.get(objectId)?.uniform;
    if (grid === undefined) return;
    const surface = this.picker.pickSurface(ndc, this.getCamera());
    if (surface === undefined || surface.objectId !== objectId) return;
    const anchor = cellAt(surface.pointLocal, grid.voxelSize);
    this.drag = {
      pointerId,
      objectId,
      voxelSize: grid.voxelSize,
      anchorCell: anchor,
      cornerCell: [anchor[0], anchor[1], anchor[2]],
      dragging: false,
    };
  }

  /** Live preview only: nothing is written to the container while the button is down. */
  private trackDrag(ndc: Vector2): void {
    const drag = this.drag;
    if (drag === null) return;
    const surface = this.picker.pickSurface(ndc, this.getCamera());
    if (surface !== undefined && surface.objectId === drag.objectId) {
      drag.cornerCell = cellAt(surface.pointLocal, drag.voxelSize);
      drag.dragging = true;
    }
    const box = this.boxOf(drag);
    this.overlay.showBox(box, drag.voxelSize, this.project.worldMatrix(drag.objectId));
    this.callbacks.onStatus(describeBox(box));
  }

  /**
   * Inclusive box in the anchor object's cells, with the third axis overridden on request (D19).
   * The override applies to a tracked drag only: a press with no move commits the degenerate
   * 1×1×1 box, so a click stays a point edit even while a height is set.
   */
  private boxOf(drag: DragState): IntBox3 {
    const box = normalizeBox(drag.anchorCell, drag.cornerCell);
    const height = this.session.boxHeight;
    if (!drag.dragging || height <= 1) return box;
    const y = drag.anchorCell[1];
    return { min: [box.min[0], y, box.min[2]], max: [box.max[0], y + height - 1, box.max[2]] };
  }

  /** One operation per press, chosen by the active tool over the current selection. */
  private commit(): void {
    const selection = this.session.selection;
    const tool = this.session.activeTool;
    if (selection.kind === 'box') {
      if (tool === 'select') {
        this.paintSelection();
        return;
      }
      if (tool === 'split' || tool === 'merge') {
        this.callbacks.onStatus(`${tool} works on a picked octree leaf; box, paint, remove and detach take a box`);
        return;
      }
      const result =
        tool === 'box'
          ? addBox(this.project, selection.objectId, selection.box, this.session.editColor)
          : tool === 'paint'
            ? paintBox(this.project, selection.objectId, selection.box, this.session.editColor)
            : tool === 'remove'
              ? removeBox(this.project, selection.objectId, selection.box)
              : detachSelection(this.project, selection);
      this.settle(result, tool === 'detach');
      return;
    }
    if (selection.kind === 'leaf') {
      if (tool === 'select') {
        this.paintSelection();
        return;
      }
      if (tool === 'box') {
        this.callbacks.onStatus('box works on a dragged uniform cell box; split, merge, remove and paint take a leaf');
        return;
      }
      const result =
        tool === 'split'
          ? splitLeaf(this.project, selection.objectId, selection.leafId)
          : tool === 'merge'
            ? mergeLeaf(this.project, selection.objectId, selection.leafId)
            : tool === 'remove'
              ? removeLeaf(this.project, selection.objectId, selection.leafId)
              : tool === 'paint'
                ? paintLeaf(this.project, selection.objectId, selection.leafId, this.session.editColor)
                : detachSelection(this.project, selection);
      this.settle(result, tool === 'detach');
    }
  }

  private settle(result: OpResult & { objectId?: ObjectId }, detached: boolean): void {
    if (!result.ok) {
      this.callbacks.onStatus(result.detail);
      return;
    }
    if (result.cells !== 0) this.callbacks.onProjectChange();
    this.callbacks.onStatus(result.detail);
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

  /** Redraws the overlay for the current selection: the committed box, or the picked leaf's bounds. */
  private paintSelection(): void {
    const selection = this.session.selection;
    if (selection.kind === 'none') {
      this.overlay.clear();
      return;
    }
    const object = this.project.get(selection.objectId);
    if (selection.kind === 'box' && object?.uniform !== undefined) {
      this.overlay.showBox(selection.box, object.uniform.voxelSize, this.project.worldMatrix(selection.objectId));
      return;
    }
    if (selection.kind === 'leaf' && object?.octree !== undefined && object.octree.hasLeaf(selection.leafId)) {
      this.overlay.showLeafBounds(
        object.octree.transformLeafToWorld(selection.leafId, this.project.worldMatrix(selection.objectId)),
        object.octree.leafBox(selection.leafId).size,
      );
      return;
    }
    this.overlay.clear();
  }

  /** Hover feedback: the leaf's bounds and values, the cell and its color, or the raw mesh's object. */
  private hover(ndc: Vector2): void {
    const hit = this.picker.pick(ndc, this.getCamera());
    if (hit === undefined) {
      this.overlay.clear();
      return;
    }
    if (hit.kind === 'object') {
      // An imported raw mesh on layer 2 has no cell or leaf to outline; the name is the whole feedback.
      this.overlay.clear();
      this.callbacks.onStatus(`raw mesh ${this.project.get(hit.objectId)?.name ?? hit.objectId}`);
      return;
    }
    if (hit.kind === 'leaf') {
      const octree = this.project.get(hit.objectId)?.octree;
      // A pick can outlive the leaf it names by one mirror sync (a split or remove just committed),
      // and `transformLeafToWorld` refuses an id that no longer names a leaf, so nothing is drawn.
      if (octree === undefined || !octree.hasLeaf(hit.leafId)) {
        this.overlay.clear();
        return;
      }
      this.overlay.showLeafBounds(
        octree.transformLeafToWorld(hit.leafId, this.project.worldMatrix(hit.objectId)),
        hit.size,
        hit.color,
      );
      const occupancy = hit.occupied ? 'occupied' : 'empty';
      this.callbacks.onStatus(
        `leaf ${hit.leafId} depth ${hit.depth} size ${hit.size} m ${occupancy} ${hexColor(hit.color)}`,
      );
      return;
    }
    this.callbacks.onStatus(`cell ${hit.cell[0]}, ${hit.cell[1]}, ${hit.cell[2]} ${hexColor(hit.color)}`);
  }
}
