/**
 * The main control panel: import, voxelize, edit, and export controls plus the project and session
 * read-out. It renders state, seeds its voxelize defaults from `PanelContext.defaults()`, and
 * forwards intent through `PanelContext.actions`; it never mutates the project and never imports `app/`.
 *
 * There is no Voxelize button and no scope checkbox (README D26): importing voxelizes the whole
 * imported scene, and the resolution controls re-voxelize it, so a changed setting is itself the
 * request.
 */

import { el, fmt } from './dom.js';
import type { ObjectId, Project, SceneObject } from '../document/project.js';
import type { ActiveTool, EditResolution, EditorSession } from '../editor/session.js';
import type { VoxelizeTarget } from '../voxels/voxelize/voxelize.js';
import type { HexColor } from '../voxels/uniform/grid.js';

export type PanelContext = {
  project: Project;
  session: EditorSession;
  /**
   * The app's raw-mesh override, if it exposes one (`SceneMirror.sourceVisible`). When present the
   * `Show raw meshes` checkbox is a view of the app's flag and `refresh()` seeds it; when absent the
   * checkbox is a plain forward-only control and `refresh()` leaves it alone.
   */
  sceneVisible?: () => boolean;
  defaults(): {
    uniformVoxelSize: number;
    targetCellSize: number;
    octreeMaxDepth: number;
    octreeRootSize: number;
  };
  actions: {
    pickImportFile(): void;
    /**
     * Re-voxelizes the whole retained import at `target`, cancelling any in-flight job (README D26).
     * Every voxelize control calls this, so there is no separate "run" step and no scope choice.
     */
    revoxelize(options: { target: VoxelizeTarget }): void;
    exportMp4(options: {
      width: number;
      height: number;
      fps: number;
      from: number;
      to: number;
      mode: 'beauty' | 'mask';
    }): void;
    createGroup(): void;
    deleteActive(): void;
    setActiveMaskColor(color: HexColor): void;
    setActiveVisible(visible: boolean): void;
    setSourceVisible(enabled: boolean): void;
    renameActive(name: string): void;
    reparentActive(parentId: ObjectId | null): void;
    setLeafLabel(label: string): void;
    setCameraLock(enabled: boolean): void;
    setCameraFov(fov: number): void;
  };
};

const TOOLS: readonly ActiveTool[] = ['select', 'box', 'paint', 'remove', 'split', 'merge', 'detach'];

/** Export resolutions offered by the panel; the value doubles as the option label. */
const DEFAULT_EXPORT_RESOLUTION = '1280x720';

const EXPORT_RESOLUTIONS: readonly { value: string; width: number; height: number }[] = [
  { value: '960x540', width: 960, height: 540 },
  { value: '1280x720', width: 1280, height: 720 },
  { value: '1920x1080', width: 1920, height: 1080 },
];

const ERROR_COLOR = '#ff8a8a';

/** `#rrggbb` for a color input, built from the unsigned hex number the project stores. */
function hexInputValue(color: HexColor): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function resolutionSuffix(resolution: EditResolution | undefined): string {
  if (resolution === undefined) return '';
  if (resolution.representation === 'uniform' && resolution.voxelSize !== undefined) {
    return ` \u00b7 ${fmt(resolution.voxelSize)} m`;
  }
  if (resolution.representation === 'octree' && resolution.leafSize !== undefined) {
    return ` \u00b7 ${fmt(resolution.leafSize)} m`;
  }
  return '';
}

export class Panels {
  private readonly context: PanelContext;
  private readonly representationSelect: HTMLSelectElement;
  private readonly voxelSizeInput: HTMLInputElement;
  private readonly targetCellSizeInput: HTMLInputElement;
  private readonly rootSizeInput: HTMLInputElement;
  private readonly maxDepthInput: HTMLInputElement;
  private readonly statusLabel: HTMLSpanElement;
  private readonly statusRatio: HTMLSpanElement;
  private readonly errorLine: HTMLDivElement;
  private readonly objectList: HTMLDivElement;
  private readonly createGroupButton: HTMLButtonElement;
  private readonly deleteActiveButton: HTMLButtonElement;
  private readonly toolButtons: Map<ActiveTool, HTMLButtonElement>;
  private readonly boxHeightInput: HTMLInputElement;
  private readonly editColorInput: HTMLInputElement;
  private readonly maskColorInput: HTMLInputElement;
  private readonly parentSelect: HTMLSelectElement;
  private readonly leafLabelInput: HTMLInputElement;
  private readonly nameInput: HTMLInputElement;
  private readonly visibleInput: HTMLInputElement;
  private readonly sourceVisibleInput: HTMLInputElement;
  private readonly cameraLockInput: HTMLInputElement;
  private readonly cameraFovInput: HTMLInputElement;
  private readonly exportResolutionSelect: HTMLSelectElement;
  private readonly exportFpsInput: HTMLInputElement;
  private readonly exportFromInput: HTMLInputElement;
  private readonly exportToInput: HTMLInputElement;
  private readonly exportModeSelect: HTMLSelectElement;
  private readonly exportButton: HTMLButtonElement;
  /** The object whose name the field shows, so that a change of active object re-seeds it. */
  private nameObjectId: ObjectId | null = null;
  private readonly touched: {
    voxelSize: boolean;
    targetCellSize: boolean;
    rootSize: boolean;
    maxDepth: boolean;
    exportFps: boolean;
    exportFrom: boolean;
    exportTo: boolean;
    cameraFov: boolean;
    objectName: boolean;
  } = {
    voxelSize: false,
    targetCellSize: false,
    rootSize: false,
    maxDepth: false,
    exportFps: false,
    exportFrom: false,
    exportTo: false,
    cameraFov: false,
    objectName: false,
  };

  constructor(root: HTMLElement, context: PanelContext) {
    this.context = context;

    // Import.
    const importButton = el('button', {
      text: 'Import GLB\u2026',
      on: { click: () => context.actions.pickImportFile() },
    });
    // The raw-mesh override: forward-only when the context exposes no `sceneVisible()`, otherwise a
    // view of the app's flag, seeded by `refresh()` (README D24).
    this.sourceVisibleInput = el('input', {
      type: 'checkbox',
      on: { change: () => context.actions.setSourceVisible(this.sourceVisibleInput.checked) },
    });

    // Voxelize settings (README D26). There is no run button: a committed setting is the request.
    // Each field's `input` event only marks it as touched, so `refresh()` stops re-seeding it, and its
    // `change` event — the browser's committed value, on blur or Enter — calls `revoxelize()`, so a
    // half-typed number never starts a job. That is the same split the `Name` field uses.
    this.representationSelect = el(
      'select',
      {
        on: {
          change: () => {
            // `refresh()` first: it enables the new branch's inputs and seeds the untouched ones from
            // the app defaults, so the target `revoxelize()` derives is the branch the user sees.
            this.refresh();
            this.revoxelize();
          },
        },
      },
      [el('option', { value: 'uniform', text: 'uniform' }), el('option', { value: 'octree', text: 'octree' })],
    );
    this.voxelSizeInput = el('input', {
      type: 'number',
      min: '0.0001',
      step: '0.01',
      on: {
        input: () => {
          this.touched.voxelSize = true;
        },
        change: () => this.revoxelize(),
      },
    });
    this.targetCellSizeInput = el('input', {
      type: 'number',
      min: '0.0001',
      step: '0.01',
      on: {
        input: () => {
          this.touched.targetCellSize = true;
        },
        change: () => this.revoxelize(),
      },
    });
    this.rootSizeInput = el('input', {
      type: 'number',
      min: '0.0001',
      step: '1',
      on: {
        input: () => {
          this.touched.rootSize = true;
        },
        change: () => this.revoxelize(),
      },
    });
    this.maxDepthInput = el('input', {
      type: 'number',
      min: '1',
      max: '24',
      step: '1',
      on: {
        input: () => {
          this.touched.maxDepth = true;
        },
        change: () => this.revoxelize(),
      },
    });

    // Edit.
    this.createGroupButton = el('button', {
      text: 'Create group',
      on: { click: () => context.actions.createGroup() },
    });
    this.deleteActiveButton = el('button', {
      text: 'Delete active',
      on: { click: () => context.actions.deleteActive() },
    });
    this.toolButtons = new Map<ActiveTool, HTMLButtonElement>();
    const toolRow = el('div', { class: 'row' });
    for (const tool of TOOLS) {
      const button = el('button', {
        text: tool,
        on: {
          click: () => {
            context.session.setTool(tool);
            this.refresh();
          },
        },
      });
      this.toolButtons.set(tool, button);
      toolRow.append(button);
    }
    this.boxHeightInput = el('input', {
      type: 'number',
      min: '1',
      step: '1',
      on: { input: () => this.writeBoxHeight() },
    });
    this.editColorInput = el('input', {
      type: 'color',
      on: { input: () => context.session.setEditColor(parseInt(this.editColorInput.value.slice(1), 16)) },
    });
    this.maskColorInput = el('input', { type: 'color', on: { change: () => this.writeMaskColor() } });
    this.parentSelect = el('select', {
      on: {
        change: () =>
          context.actions.reparentActive(this.parentSelect.value === '' ? null : this.parentSelect.value),
      },
    });
    this.leafLabelInput = el('input', {
      type: 'text',
      placeholder: 'leaf label',
      on: { change: () => context.actions.setLeafLabel(this.leafLabelInput.value) },
    });
    // The identity and visibility of the active object. Renaming fires on `change`, never per
    // keystroke, so a half-typed name cannot reach the document; the `input` handler only stops
    // `refresh()` from overwriting a name the user is still editing.
    this.nameInput = el('input', {
      type: 'text',
      placeholder: 'name',
      on: {
        input: () => {
          this.touched.objectName = true;
        },
        change: () => context.actions.renameActive(this.nameInput.value),
      },
    });
    this.visibleInput = el('input', {
      type: 'checkbox',
      on: { change: () => context.actions.setActiveVisible(this.visibleInput.checked) },
    });

    // Camera: hand navigation to the output camera, so the viewport frames what an export captures.
    this.cameraLockInput = el('input', {
      type: 'checkbox',
      on: { change: () => context.actions.setCameraLock(this.cameraLockInput.checked) },
    });
    // The authored vertical FOV of the output camera; a cleared field parses to NaN and the app
    // refuses it, so the project keeps the last valid value.
    this.cameraFovInput = el('input', {
      type: 'number',
      min: '1',
      max: '179',
      step: '1',
      on: {
        input: () => {
          this.touched.cameraFov = true;
          context.actions.setCameraFov(Number.parseFloat(this.cameraFovInput.value));
        },
      },
    });

    // Export.
    this.exportResolutionSelect = el(
      'select',
      undefined,
      EXPORT_RESOLUTIONS.map((preset) => el('option', { value: preset.value, text: preset.value })),
    );
    this.exportResolutionSelect.value = DEFAULT_EXPORT_RESOLUTION;
    this.exportFpsInput = el('input', {
      type: 'number',
      min: '1',
      step: '1',
      on: {
        input: () => {
          this.touched.exportFps = true;
        },
      },
    });
    this.exportFromInput = el('input', {
      type: 'number',
      min: '0',
      step: '0.1',
      on: {
        input: () => {
          this.touched.exportFrom = true;
        },
      },
    });
    this.exportToInput = el('input', {
      type: 'number',
      min: '0',
      step: '0.1',
      on: {
        input: () => {
          this.touched.exportTo = true;
        },
      },
    });
    this.exportModeSelect = el('select', undefined, [
      el('option', { value: 'beauty', text: 'beauty' }),
      el('option', { value: 'mask', text: 'mask' }),
    ]);
    this.exportButton = el('button', { text: 'Export MP4', on: { click: () => this.runExport() } });

    // Objects, status, errors.
    this.objectList = el('div');
    this.statusLabel = el('span', { class: 'dim' });
    this.statusRatio = el('span', { class: 'dim' });
    this.errorLine = el('div');
    this.errorLine.style.color = ERROR_COLOR;

    const importSection = el('section', undefined, [
      el('h2', { text: 'Import' }),
      el('div', undefined, [
        importButton,
        el('div', { class: 'dim', text: 'or drop a .glb onto the viewport' }),
      ]),
      this.field('Show raw meshes', this.sourceVisibleInput),
    ]);
    const voxelizeSection = el('section', undefined, [
      el('h2', { text: 'Voxelize' }),
      el('div', undefined, [
        this.field('Representation', this.representationSelect),
        this.field('Voxel size (m)', this.voxelSizeInput),
        this.field('Cell size (m)', this.targetCellSizeInput),
        this.field('Root size (m)', this.rootSizeInput),
        this.field('Max depth', this.maxDepthInput),
      ]),
    ]);
    const editSection = el('section', undefined, [
      el('h2', { text: 'Edit' }),
      el('div', undefined, [
        el('div', { class: 'row' }, [this.createGroupButton, this.deleteActiveButton]),
        toolRow,
        this.field('Box height', this.boxHeightInput),
        this.field('Edit color', this.editColorInput),
        this.field('Mask color', this.maskColorInput),
        this.field('Parent', this.parentSelect),
        this.field('Leaf label', this.leafLabelInput),
        this.field('Name', this.nameInput),
        this.field('Visible', this.visibleInput),
      ]),
    ]);
    const cameraSection = el('section', undefined, [
      el('h2', { text: 'Camera' }),
      el('div', undefined, [
        this.field('Camera lock (output)', this.cameraLockInput),
        el('div', { class: 'dim', text: 'navigation then drives the output camera' }),
        this.field('FOV (deg)', this.cameraFovInput),
      ]),
    ]);
    const exportSection = el('section', undefined, [
      el('h2', { text: 'Export' }),
      el('div', undefined, [
        this.field('Resolution', this.exportResolutionSelect),
        this.field('FPS', this.exportFpsInput),
        this.field('From (s)', this.exportFromInput),
        this.field('To (s)', this.exportToInput),
        this.field('Mode', this.exportModeSelect),
        this.exportButton,
      ]),
    ]);
    const objectsSection = el('section', undefined, [
      el('h2', { text: 'Objects' }),
      el('div', undefined, [this.objectList]),
    ]);
    const statusRow = el('div', { class: 'row' }, [this.statusLabel, this.statusRatio]);

    root.append(
      importSection,
      voxelizeSection,
      editSection,
      cameraSection,
      exportSection,
      objectsSection,
      statusRow,
      this.errorLine,
    );
    this.refresh();
  }

  /** Writes the job label and the clamped progress percentage into the status line. */
  setProgress(label: string, ratio: number): void {
    const clamped = Math.min(1, Math.max(0, ratio));
    this.statusLabel.textContent = label;
    this.statusRatio.textContent = `${Math.round(clamped * 100)}%`;
  }

  /** Empties both parts of the status line for the next job. */
  clearProgress(): void {
    this.statusLabel.textContent = '';
    this.statusRatio.textContent = '';
  }

  /** Writes an error message into the error line, verbatim. */
  reportError(message: string): void {
    this.errorLine.textContent = message;
  }

  /** Re-reads project and session state and rewrites the whole panel. */
  refresh(): void {
    const { project, session } = this.context;

    const defaults = this.context.defaults();
    if (!this.touched.voxelSize) this.voxelSizeInput.value = String(defaults.uniformVoxelSize);
    if (!this.touched.targetCellSize) this.targetCellSizeInput.value = String(defaults.targetCellSize);
    if (!this.touched.rootSize) this.rootSizeInput.value = String(defaults.octreeRootSize);
    if (!this.touched.maxDepth) this.maxDepthInput.value = String(defaults.octreeMaxDepth);

    if (!this.touched.exportFps) this.exportFpsInput.value = String(project.timeline.fps);
    if (!this.touched.exportFrom) this.exportFromInput.value = '0';
    if (!this.touched.exportTo) this.exportToInput.value = String(project.timeline.duration);
    if (!this.touched.cameraFov) this.cameraFovInput.value = String(project.camera.fov);

    const octree = this.representationSelect.value === 'octree';
    // The raw-mesh checkbox is a view of the app's flag only while the context exposes one; a context
    // without `sceneVisible()` owns the state itself, so `refresh()` leaves the box alone.
    const sceneVisible = this.context.sceneVisible;
    if (sceneVisible !== undefined) this.sourceVisibleInput.checked = sceneVisible();
    this.voxelSizeInput.disabled = octree;
    this.targetCellSizeInput.disabled = !octree;
    this.rootSizeInput.disabled = !octree;
    this.maxDepthInput.disabled = !octree;

    const active = session.activeObjectId === null ? undefined : project.get(session.activeObjectId);

    this.renderObjectList();
    for (const [tool, button] of this.toolButtons) button.classList.toggle('on', session.activeTool === tool);
    this.boxHeightInput.value = String(session.boxHeight);
    this.editColorInput.value = hexInputValue(session.editColor);
    this.maskColorInput.disabled = active === undefined;
    if (active !== undefined) this.maskColorInput.value = hexInputValue(active.maskColor);
    this.deleteActiveButton.disabled = active === undefined;
    this.visibleInput.disabled = active === undefined;
    this.nameInput.disabled = active === undefined;
    // The name field shows the active object's name until the user types, and re-seeds whenever the
    // active object changes, so it can never show one object's text while renaming another.
    if (active === undefined) {
      this.nameObjectId = null;
      this.touched.objectName = false;
      this.nameInput.value = '';
    } else {
      this.visibleInput.checked = active.visible;
      if (this.nameObjectId !== active.id) {
        this.nameObjectId = active.id;
        this.touched.objectName = false;
      }
      if (!this.touched.objectName) this.nameInput.value = active.name;
    }
    this.renderParentSelect(active);
    this.renderLeafLabel(active);
  }

  private field(label: string, control: HTMLElement): HTMLLabelElement {
    return el('label', undefined, [el('span', { class: 'dim', text: label }), control]);
  }

  private renderObjectList(): void {
    const { project, session } = this.context;
    const rows: HTMLButtonElement[] = [];
    const walk = (parentId: ObjectId | null, depth: number): void => {
      const children = parentId === null ? project.roots() : project.childrenOf(parentId);
      for (const object of children) {
        rows.push(this.objectRow(object, depth, session.activeObjectId === object.id));
        walk(object.id, depth + 1);
      }
    };
    walk(null, 0);
    this.objectList.replaceChildren(...rows);
  }

  private objectRow(object: SceneObject, depth: number, active: boolean): HTMLButtonElement {
    const resolution = this.context.session.resolutionOf(object.id);
    const button = el('button', {
      text: `${object.name} \u00b7 ${object.representation}${resolutionSuffix(resolution)}`,
      on: {
        click: () => {
          this.context.session.setActiveObject(object.id);
          this.refresh();
        },
      },
    });
    button.style.display = 'block';
    button.style.width = '100%';
    button.style.textAlign = 'left';
    button.style.marginLeft = `${depth * 10}px`;
    button.classList.toggle('on', active);
    return button;
  }

  private renderParentSelect(active: SceneObject | undefined): void {
    const options: HTMLOptionElement[] = [el('option', { value: '', text: '(root)' })];
    if (active !== undefined) {
      for (const object of this.context.project.objects.values()) {
        if (object.id === active.id) continue;
        options.push(el('option', { value: object.id, text: object.name }));
      }
    }
    this.parentSelect.replaceChildren(...options);
    this.parentSelect.disabled = active === undefined;
    this.parentSelect.value = active?.parentId ?? '';
  }

  private renderLeafLabel(active: SceneObject | undefined): void {
    const selection = this.context.session.selection;
    const leaf = selection.kind === 'leaf' ? active?.octree?.getLeaf(selection.leafId) : undefined;
    this.leafLabelInput.disabled = leaf === undefined;
    this.leafLabelInput.value = leaf?.label ?? '';
  }

  /**
   * Re-voxelizes the retained import at the settings the fields currently show (README D26): the same
   * complete `VoxelizeTarget` the removed button used to build, derived from `readTarget()`. A field
   * that does not parse is not a request, so nothing is forwarded and the app is never asked to run an
   * impossible target; the app decides what to do when there is no import to re-voxelize.
   */
  private revoxelize(): void {
    const target = this.readTarget();
    if (target === undefined) return;
    this.context.actions.revoxelize({ target });
  }

  private readTarget(): VoxelizeTarget | undefined {
    if (this.representationSelect.value === 'octree') {
      const rootSize = Number(this.rootSizeInput.value);
      const maxDepth = Number(this.maxDepthInput.value);
      const targetCellSize = Number(this.targetCellSizeInput.value);
      if (!(rootSize > 0) || !Number.isInteger(maxDepth) || maxDepth < 1 || !(targetCellSize > 0)) {
        return undefined;
      }
      return { kind: 'octree', rootSize, maxDepth, targetCellSize };
    }
    const voxelSize = Number(this.voxelSizeInput.value);
    if (!(voxelSize > 0)) return undefined;
    return { kind: 'uniform', voxelSize };
  }

  private writeBoxHeight(): void {
    const height = Number(this.boxHeightInput.value);
    if (Number.isFinite(height)) this.context.session.boxHeight = height;
  }

  private runExport(): void {
    const resolution = EXPORT_RESOLUTIONS.find((preset) => preset.value === this.exportResolutionSelect.value);
    const fps = Number(this.exportFpsInput.value);
    const from = Number(this.exportFromInput.value);
    const to = Number(this.exportToInput.value);
    if (resolution === undefined || !Number.isFinite(fps) || fps <= 0) return;
    if (!Number.isFinite(from) || !Number.isFinite(to)) return;
    this.context.actions.exportMp4({
      // Encoders reject odd dimensions in some players, so the requested pair is rounded to even.
      width: Math.round(resolution.width / 2) * 2,
      height: Math.round(resolution.height / 2) * 2,
      fps,
      from,
      to,
      mode: this.exportModeSelect.value === 'mask' ? 'mask' : 'beauty',
    });
  }

  private writeMaskColor(): void {
    if (this.context.session.activeObjectId === null) return;
    this.context.actions.setActiveMaskColor(parseInt(this.maskColorInput.value.slice(1), 16));
  }
}
