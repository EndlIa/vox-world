/**
 * The main control panel: import, edit, camera, and export controls plus the project and session
 * read-out. It renders state and forwards intent through `PanelContext.actions`; it never mutates the
 * project and never imports `app/`.
 *
 * The column is a rail of group buttons and, behind each button, that group's controls in a floating
 * window (`ui/floatingWindow.ts`): one button per group at the top of the column, the group's content on
 * screen only once its button is pressed, and the button marked `on` for exactly as long as its window is
 * open. Several windows can be open at once. There is no status line, no progress row, and no error line
 * below the rail; a failure reaches the console.
 *
 * One rail entry opens no window: `Animation`, which shows and hides the timeline bar along the bottom of the
 * page. That bar belongs to the app and so does the flag, seeded here like the other view flags.
 *
 * The voxelization settings are not here, and neither is any way to reach them: they live in one modal
 * dialog, `ui/voxelizeDialog.ts`, which the app opens when an import arrives. The panel
 * holds no voxelize-related control at all, so the dialog that follows an import is the only way to
 * voxelize.
 */

import { el, fmt } from './dom.js';
import { FloatingWindow } from './floatingWindow.js';
import type { ObjectId, Project, SceneObject } from '../document/project.js';
import type { ProjectionKind } from '../document/camera.js';
import type { ActiveTool, EditResolution, EditorSession, SelectionShape } from '../editor/session.js';
import type { HexColor } from '../voxels/uniform/grid.js';
import type { PrimitiveKind } from '../voxels/uniform/generator.js';

/** One authored camera pose: the carrier's fields, and the value a numeric field writes back. */
export type CameraPose = {
  position: [number, number, number];
  quaternion: [number, number, number, number];
  fov: number;
};

/** What the carrier's controls read: whether it is selected, the gizmo's mode, and the shot being edited. */
export type CameraControlView = {
  selected: boolean;
  mode: 'translate' | 'rotate';
  pose: CameraPose;
  /** The shot's own projection and clip planes, which the projection selector and the two fields edit. */
  projection: ProjectionKind;
  near: number;
  far: number;
  /** Whether a run of the clip is on, so the fields that would disturb it can wait. */
  playing: boolean;
  /** Whether the camera path is drawn, and whether the track holds a path at all (two keyframes or more). */
  pathVisible: boolean;
  pathAvailable: boolean;
};

/**
 * What the `Render` group's export-camera select reads: the takes it offers, and the one an export will render. It is
 * deliberately separate from the editor's preview take, so a frame can be rendered from a plan the author is not
 * looking at.
 */
export type ExportCameraView = {
  takes: { id: string; name: string }[];
  /** The take the export is pinned to, or `''` while it follows the preview take — the state the app starts in. */
  takeId: string;
  /** The take a following export would render, which the follow option names; `''` when the camera holds no take. */
  previewTakeName: string;
};

export type PanelContext = {
  project: Project;
  session: EditorSession;
  /**
   * The app's raw-mesh override, if it exposes one (`SceneMirror.sourceVisible`). When present the
   * `Show raw meshes` checkbox is a view of the app's flag and `refresh()` seeds it; when absent the
   * checkbox is a plain forward-only control and `refresh()` leaves it alone.
   */
  sceneVisible?: () => boolean;
  /**
   * Whether the world grid is drawn, if the app exposes the flag (`WorldGrid`). When present the Grid group's
   * checkbox is a view of it and `refresh()` seeds it; when absent the checkbox is forward-only.
   */
  gridVisible?: () => boolean;
  /**
   * Whether the timeline bar is on screen, if the app exposes the flag. When present the rail's `Animation` button
   * is a toggle over it and `refresh()` seeds its state; when absent that button is disabled. The button opens no
   * window either way.
   */
  timelineVisible?: () => boolean;
  /**
   * Whether there is a step to undo or redo, if the app keeps a history. When present, the Edit group's two buttons
   * are a view of it and `refresh()` disables each one; a context without a history disables both.
   */
  historyState?: () => { canUndo: boolean; canRedo: boolean };
  /**
   * The camera carrier's state, if the app has one. When present the `Camera` group's carrier controls are a view of
   * it — `refresh()` seeds the pose fields and the two label swaps from it — and it is what gates them: a context
   * without a carrier has nothing for them to aim.
   */
  cameraControl?: () => CameraControlView;
  /**
   * The takes the `Render` group's export-camera select offers, and the one an export will render. When present the
   * select is a view of the app's export choice and `refresh()` seeds it; when absent the select lists nothing.
   */
  exportCamera?: () => ExportCameraView;
  actions: {
    pickImportFile(): void;
    saveProject(): void;
    openProject(): void;
    exportMp4(options: {
      width: number;
      height: number;
      fps: number;
      from: number;
      to: number;
      mode: 'beauty' | 'mask';
    }): void;
    createGroup(): void;
    createPrimitive(options: { kind: PrimitiveKind; size: number; height: number; hollow: boolean }): void;
    deleteObject(objectId: ObjectId): void;
    setActiveMaskColor(color: HexColor): void;
    setActiveVisible(visible: boolean): void;
    setActiveAlignToGrid(alignToGrid: boolean): void;
    setActiveSubdivision(subdivision: number): void;
    detachSelection(): void;
    undo(): void;
    redo(): void;
    setSourceVisible(enabled: boolean): void;
    setGridVisible(visible: boolean): void;
    setTimelineVisible(visible: boolean): void;
    renameActive(name: string): void;
    reparentActive(parentId: ObjectId | null): void;
    setCameraFov(fov: number): void;
    setCameraPose(pose: CameraPose): void;
    setExportCamera(takeId: string): void;
    setCameraProjection(projection: ProjectionKind): void;
    setCameraLensParams(params: { near: number; far: number }): void;
    toggleCameraControl(): void;
    toggleGizmoMode(): void;
    cameraToView(): void;
    viewToCamera(): void;
    setCameraPathVisible(visible: boolean): void;
  };
};

const TOOLS: readonly ActiveTool[] = ['select', 'paint', 'add', 'remove'];

/**
 * The subdivision levels the Scene group offers, in display order. They are powers of two because a
 * cell has to stay an exact binary fraction of the world unit; the list is the UI's range, not a rule of the grid.
 */
const SUBDIVISIONS: readonly number[] = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];

/** The shapes the select tool offers; one so far, and the list it will grow into. */
/**
 * What a press can build. A box is the shape a drag extends; a colour group and an island are named by the cell
 * the press lands on and are never dragged, which is why the viewport only arms a drag while this is `box`.
 */
const SELECTION_SHAPES: readonly SelectionShape[] = ['box', 'color', 'island'];

/** The primitives the create row offers, in the order it lists them; `editor/ops.ts` turns one into an object. */
const PRIMITIVE_KINDS: readonly PrimitiveKind[] = ['box', 'sphere', 'isometric', 'terrain'];
/** What a size field starts at, and what a height field starts at: small enough to see whole in the viewport. */
const DEFAULT_PRIMITIVE_SIZE = 4;
const DEFAULT_PRIMITIVE_HEIGHT = 3;

/** Export resolutions offered by the panel; the value doubles as the option label. */
const DEFAULT_EXPORT_RESOLUTION = '1280x720';

const EXPORT_RESOLUTIONS: readonly { value: string; width: number; height: number }[] = [
  { value: '960x540', width: 960, height: 540 },
  { value: '1280x720', width: 1280, height: 720 },
  { value: '1920x1080', width: 1920, height: 1080 },
];

/**
 * Where a group's window opens: just right of the rail overlay (112 px plus its padding), each group's
 * window one step below and to the right of the previous one's, so two windows opened at once never sit
 * exactly on top of each other. A window is moved from there by dragging, and keeps wherever it was left.
 */
const WINDOW_LEFT = 128;
const WINDOW_TOP = 8;
const WINDOW_STAGGER = 28;

/** The SVG namespace, needed only for the trash icon: `el` builds HTML elements. */
const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * A small trash icon — lid, handle, body, two ribs — stroked in `currentColor` so it follows the
 * button it sits in. Drawn rather than typed as a glyph, which would depend on an emoji font.
 */
function trashIcon(): SVGSVGElement {
  const icon = document.createElementNS(SVG_NS, 'svg');
  icon.setAttribute('viewBox', '0 0 12 12');
  icon.setAttribute('width', '12');
  icon.setAttribute('height', '12');
  icon.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M2 3h8M4.5 3V2h3v1M3 3l.6 7h4.8L9 3M5 5v4M7 5v4');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  icon.append(path);
  return icon;
}

/** `#rrggbb` for a color input, built from the unsigned hex number the project stores. */
function hexInputValue(color: HexColor): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function resolutionSuffix(resolution: EditResolution | undefined): string {
  if (resolution === undefined) return '';
  if (resolution.representation === 'uniform' && resolution.cells !== undefined) {
    return ` \u00b7 ${resolution.cells.map((count) => fmt(count, 0)).join('\u00d7')}`;
  }
  return '';
}

export class Panels {
  private readonly context: PanelContext;
  private readonly objectList: HTMLDivElement;
  private readonly createGroupButton: HTMLButtonElement;
  /** The create row's own controls: a shape, the size it is made at, and the two options one shape each carries. */
  private readonly primitiveKindSelect: HTMLSelectElement;
  private readonly primitiveSizeInput: HTMLInputElement;
  private readonly primitiveHeightInput: HTMLInputElement;
  private readonly primitiveHollowInput: HTMLInputElement;
  private readonly createPrimitiveButton: HTMLButtonElement;
  private readonly toolButtons: Map<ActiveTool, HTMLButtonElement>;
  private readonly selectionShapeSelect: HTMLSelectElement;
  /** Not a tool: a command on the region the selection already holds, so it is disabled without one. */
  private readonly detachButton: HTMLButtonElement;
  /** The two document commands beside the tools: a step back, and a step forward. */
  private readonly undoButton: HTMLButtonElement;
  private readonly redoButton: HTMLButtonElement;
  private readonly editColorInput: HTMLInputElement;
  private readonly addHeightInput: HTMLInputElement;
  private readonly maskColorInput: HTMLInputElement;
  private readonly parentSelect: HTMLSelectElement;
  private readonly nameInput: HTMLInputElement;
  private readonly visibleInput: HTMLInputElement;
  private readonly alignToGridInput: HTMLInputElement;
  private readonly subdivisionSelect: HTMLSelectElement;
  private readonly worldGridInput: HTMLInputElement;
  /** The rail's `Edit` button: it also selects the edit mode, so `refresh()` gates it on the active object. */
  private readonly editGroupButton: HTMLButtonElement;
  /** The rail's `Animation` button: it opens no window, it toggles the timeline bar. */
  private readonly animationButton: HTMLButtonElement;
  private readonly sourceVisibleInput: HTMLInputElement;
  private readonly cameraFovInput: HTMLInputElement;
  /** The carrier's numeric grid, in label order: X, Y, Z, QX, QY, QZ, QW. */
  private readonly cameraPoseInputs: HTMLInputElement[];
  private readonly cameraProjectionSelect: HTMLSelectElement;
  private readonly cameraNearInput: HTMLInputElement;
  private readonly cameraFarInput: HTMLInputElement;
  private readonly cameraLensLabel: HTMLSpanElement;
  private readonly cameraSelectButton: HTMLButtonElement;
  private readonly cameraModeButton: HTMLButtonElement;
  private readonly cameraToViewButton: HTMLButtonElement;
  private readonly viewToCameraButton: HTMLButtonElement;
  private readonly cameraPathInput: HTMLInputElement;
  /** The take an export renders: the `Render` group's own choice, independent of the editor's preview take. */
  private readonly exportCameraSelect: HTMLSelectElement;
  private readonly exportResolutionSelect: HTMLSelectElement;
  private readonly exportFpsInput: HTMLInputElement;
  private readonly exportFromInput: HTMLInputElement;
  private readonly exportToInput: HTMLInputElement;
  private readonly exportModeSelect: HTMLSelectElement;
  private readonly exportButton: HTMLButtonElement;
  /** The object whose name the field shows, so that a change of active object re-seeds it. */
  private nameObjectId: ObjectId | null = null;
  private readonly touched: {
    exportFps: boolean;
    exportFrom: boolean;
    exportTo: boolean;
    cameraFov: boolean;
    cameraNear: boolean;
    cameraFar: boolean;
    objectName: boolean;
    gridOffset: boolean;
  } = {
    exportFps: false,
    exportFrom: false,
    exportTo: false,
    cameraFov: false,
    cameraNear: false,
    cameraFar: false,
    objectName: false,
    gridOffset: false,
  };

  constructor(root: HTMLElement, context: PanelContext) {
    this.context = context;

    // Import.
    const importButton = el('button', {
      text: 'Import GLB\u2026',
      on: { click: () => context.actions.pickImportFile() },
    });
    // The raw-mesh override: forward-only when the context exposes no `sceneVisible()`, otherwise a
    // view of the app's flag, seeded by `refresh()`.
    this.sourceVisibleInput = el('input', {
      type: 'checkbox',
      on: { change: () => context.actions.setSourceVisible(this.sourceVisibleInput.checked) },
    });

    // Edit.
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
    // The select tool's own option: what a press selects. It is the tool's parameter, so it sits under the
    // tool row rather than in a group of its own.
    this.selectionShapeSelect = el(
      'select',
      {
        on: {
          change: () => {
            const value = this.selectionShapeSelect.value;
            const shape = SELECTION_SHAPES.find((candidate) => candidate === value);
            if (shape !== undefined) context.session.setSelectionShape(shape);
          },
        },
      },
      SELECTION_SHAPES.map((shape) => el('option', { value: shape, text: shape })),
    );
    // The detach command: it acts on the region the `Select` tool chose, once per press, and leaves no mode
    // behind — a tool would make the next press in the viewport detach whatever it landed on.
    this.detachButton = el('button', {
      text: 'detach',
      on: { click: () => context.actions.detachSelection() },
    });
    this.undoButton = el('button', { text: 'undo', on: { click: () => context.actions.undo() } });
    this.redoButton = el('button', { text: 'redo', on: { click: () => context.actions.redo() } });
    this.editColorInput = el('input', {
      type: 'color',
      on: { input: () => context.session.setEditColor(parseInt(this.editColorInput.value.slice(1), 16)) },
    });
    // The add tool's own option: how many cells deep its drag builds. It is the tool's parameter, so it sits under
    // the tool row like the select tool's shape rather than in a group of its own.
    this.addHeightInput = el('input', {
      type: 'number',
      min: '1',
      step: '1',
      title: 'how many cells deep the add tool builds out of the face it presses',
      on: { input: () => this.writeAddHeight() },
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

    // Export. The camera select is the take an export renders, which is the `Render` group's own choice and not
    // necessarily the take being edited: a frame can render a plan the author is not previewing.
    this.exportCameraSelect = el('select', {
      title: 'the take an export renders',
      on: { change: () => context.actions.setExportCamera(this.exportCameraSelect.value) },
    });
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
    this.exportButton = el('button', { text: 'Render MP4', on: { click: () => this.runExport() } });

    // Scene: the control that adds to the object list, the list that chooses among every object, and the
    // active object's own fields.
    this.createGroupButton = el('button', {
      text: 'Create group',
      on: { click: () => context.actions.createGroup() },
    });
    this.maskColorInput = el('input', { type: 'color', on: { change: () => this.writeMaskColor() } });
    this.parentSelect = el('select', {
      on: {
        change: () =>
          context.actions.reparentActive(this.parentSelect.value === '' ? null : this.parentSelect.value),
      },
    });
    // Renaming fires on `change`, never per keystroke, so a half-typed name cannot reach the document;
    // the `input` handler only stops `refresh()` from overwriting a name the user is still editing.
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
    // Grid alignment: the object's placement stays on the lattice while this is on, so turning
    // it on moves the object now rather than at its next edit. Off, a drag may leave it between cells.
    this.alignToGridInput = el('input', {
      type: 'checkbox',
      on: { change: () => context.actions.setActiveAlignToGrid(this.alignToGridInput.checked) },
    });
    // The active object's own grid level: raising it subdivides the payload without moving it, so the levels
    // below the object's own are shown disabled — that is what says coarsening is not offered.
    this.subdivisionSelect = el(
      'select',
      { on: { change: () => context.actions.setActiveSubdivision(Number(this.subdivisionSelect.value)) } },
      SUBDIVISIONS.map((level) => el('option', { value: String(level), text: String(level) })),
    );
    // The Grid group: one world grid, and one switch over it. It is the viewport's own flag rather than document
    // state, so the app owns it and `refresh()` only reads it back.
    this.worldGridInput = el('input', {
      type: 'checkbox',
      on: { change: () => context.actions.setGridVisible(this.worldGridInput.checked) },
    });
    this.objectList = el('div');
    // The rail: one button per group, in the order the groups are built, and nothing else — no heading and
    // no control lives here. A button toggles its own window and carries `on` exactly while that window is
    // open, so the rail is the only place the column says which groups are on screen. Two buttons are
    // exceptions, each in what it does besides opening a window: `Edit` also selects the edit mode, whose
    // tools it shows, so `refresh()` disables it while no object is active — that mode edits the
    // active object's voxels, and there is nothing to edit until one is chosen; and `Animation` opens no
    // window at all, it shows and hides the timeline bar instead, under the same `on` rule.
    const rail = el('div', { class: 'rail' });
    let index = 0;
    const group = (title: string, content: (Node | string)[], onPress?: () => void): HTMLButtonElement => {
      const button = el('button', {
        text: title,
        on: {
          click: () => {
            onPress?.();
            floating.toggle();
          },
        },
      });
      const floating = new FloatingWindow({
        title,
        left: WINDOW_LEFT + index * WINDOW_STAGGER,
        top: WINDOW_TOP + index * WINDOW_STAGGER,
        onVisibilityChange: (open) => button.classList.toggle('on', open),
      });
      floating.body.append(...content);
      rail.append(button);
      root.append(floating.root);
      index += 1;
      return button;
    };

    group('Import', [
      importButton,
      el('div', { class: 'dim', text: 'or drop a .glb onto the viewport' }),
      this.field('Show raw meshes', this.sourceVisibleInput),
    ]);
    this.editGroupButton = group(
      'Edit',
      [
        toolRow,
        el('div', { class: 'row' }, [this.undoButton, this.redoButton]),
        el('div', { class: 'row' }, [this.detachButton]),
        this.field('Select', this.selectionShapeSelect),
        this.field('Add wall', this.addHeightInput),
        this.field('Color', this.editColorInput),
      ],
      () => context.session.setMode('edit'),
    );
    // Everything that is *about the camera* lives here — the carrier that
    // aims it, and its projection — while the timeline bar keeps the keyframes, which are animation.
    this.cameraSelectButton = el('button', { on: { click: () => context.actions.toggleCameraControl() } });
    this.cameraModeButton = el('button', {
      title: 'switch the gizmo between moving and rotating the carrier',
      on: { click: () => context.actions.toggleGizmoMode() },
    });
    this.cameraToViewButton = el('button', {
      text: 'Camera -> View',
      title: 'aim the output camera at what the viewport shows',
      on: { click: () => context.actions.cameraToView() },
    });
    this.viewToCameraButton = el('button', {
      text: 'View -> Camera',
      title: 'move the viewport to the output camera',
      on: { click: () => context.actions.viewToCamera() },
    });
    this.cameraPathInput = el('input', {
      type: 'checkbox',
      on: { change: () => context.actions.setCameraPathVisible(this.cameraPathInput.checked) },
    });
    this.cameraPoseInputs = ['X', 'Y', 'Z', 'QX', 'QY', 'QZ', 'QW'].map((label) =>
      el('input', {
        type: 'number',
        step: '0.001',
        title: `${label} of the output camera`,
        on: { change: () => this.writeCameraPose() },
      }),
    );
    this.cameraProjectionSelect = el(
      'select',
      {
        title: 'the projection of this shot; a switch is a cut, never an interpolation between kinds',
        on: { change: () => context.actions.setCameraProjection(this.readProjection()) },
      },
      [
        el('option', { value: 'perspective', text: 'perspective' }),
        el('option', { value: 'orthographic', text: 'orthographic' }),
      ],
    );
    this.cameraNearInput = el('input', {
      type: 'number',
      step: '0.1',
      title: 'near clip plane of this shot',
      on: { change: () => this.writeLensParams() },
    });
    this.cameraFarInput = el('input', {
      type: 'number',
      step: '1',
      title: 'far clip plane of this shot',
      on: { change: () => this.writeLensParams() },
    });
    this.cameraLensLabel = el('span', { class: 'dim', text: 'FOV (deg)' });
    group('Camera', [
      el('div', { class: 'row' }, [this.cameraSelectButton, this.cameraModeButton]),
      el('div', { class: 'row' }, [this.cameraToViewButton, this.viewToCameraButton]),
      el('div', { class: 'row' }, [this.cameraProjectionSelect]),
      el('div', { class: 'row' }, [this.field('Near', this.cameraNearInput), this.field('Far', this.cameraFarInput)]),
      this.field('Show camera path', this.cameraPathInput),
      el('div', { class: 'row' }, [
        this.field('X', this.cameraPoseInputs[0]!),
        this.field('Y', this.cameraPoseInputs[1]!),
        this.field('Z', this.cameraPoseInputs[2]!),
      ]),
      el('div', { class: 'row' }, [
        this.field('QX', this.cameraPoseInputs[3]!),
        this.field('QY', this.cameraPoseInputs[4]!),
        this.field('QZ', this.cameraPoseInputs[5]!),
        this.field('QW', this.cameraPoseInputs[6]!),
      ]),
      el('label', undefined, [this.cameraLensLabel, this.cameraFovInput]),
    ]);
    group('Render', [
      this.field('Camera', this.exportCameraSelect),
      this.field('Resolution', this.exportResolutionSelect),
      this.field('FPS', this.exportFpsInput),
      this.field('From (s)', this.exportFromInput),
      this.field('To (s)', this.exportToInput),
      this.field('Mode', this.exportModeSelect),
      this.exportButton,
    ]);
    // The divisor separates the two halves of this group: above it the list that chooses among every
    // object, below it the fields that act on the one the list selected.
    group('Scene', [
      el('div', { class: 'row' }, [this.createGroupButton]),
      this.objectList,
      el('hr'),
      this.field('Mask color', this.maskColorInput),
      this.field('Parent', this.parentSelect),
      this.field('Name', this.nameInput),
      this.field('Visible', this.visibleInput),
      this.field('Grid align', this.alignToGridInput),
      this.field('Subdivision', this.subdivisionSelect),
    ]);

    group('Grid', [this.field('World grid', this.worldGridInput)]);

    // The project file: the whole truth as one JSON document, written and read back by `document/serialize.ts`.
    // The group sits last, so adding it left every other window at the staggered position it had.
    group('Project', [
      el('div', { class: 'row' }, [
        el('button', {
          text: 'Save project\u2026',
          title: 'write the whole project to one JSON file',
          on: { click: () => context.actions.saveProject() },
        }),
        el('button', {
          text: 'Open project\u2026',
          title: 'load a project file, replacing what is open',
          on: { click: () => context.actions.openProject() },
        }),
      ]),
      el('div', { class: 'dim', text: 'or drop a .json onto the viewport' }),
    ]);

    // Creating a shape: the kind decides what the size means — a box and a corner are built from it on every axis, a
    // sphere takes it as a radius, a landscape as its footprint — and the two fields only one kind reads are disabled
    // for the others rather than hidden, so the row does not move as the kind changes.
    this.primitiveKindSelect = el(
      'select',
      {
        on: {
          change: () => {
            const value = this.primitiveKindSelect.value;
            const kind = PRIMITIVE_KINDS.find((candidate) => candidate === value);
            if (kind !== undefined) this.refreshPrimitiveControls(kind);
          },
        },
      },
      PRIMITIVE_KINDS.map((kind) => el('option', { value: kind, text: kind })),
    );
    this.primitiveSizeInput = el('input', { type: 'number', min: '1', step: '1', value: String(DEFAULT_PRIMITIVE_SIZE) });
    this.primitiveHeightInput = el('input', { type: 'number', min: '1', step: '1', value: String(DEFAULT_PRIMITIVE_HEIGHT) });
    this.primitiveHollowInput = el('input', { type: 'checkbox' });
    this.createPrimitiveButton = el('button', {
      text: 'Create',
      title: 'make a shape and put it in the scene as its own object',
      on: {
        click: () =>
          context.actions.createPrimitive({
            kind: this.primitiveKindSelect.value as PrimitiveKind,
            size: Number(this.primitiveSizeInput.value),
            height: Number(this.primitiveHeightInput.value),
            hollow: this.primitiveHollowInput.checked,
          }),
      },
    });
    group('Create', [
      this.field('Shape', this.primitiveKindSelect),
      this.field('Size', this.primitiveSizeInput),
      this.field('Height', this.primitiveHeightInput),
      this.field('Hollow', this.primitiveHollowInput),
      el('div', { class: 'row' }, [this.createPrimitiveButton]),
    ]);

    // The one rail entry that opens nothing: the timeline is a bar along the bottom of the page rather than a
    // floating window, so this button is a plain toggle over the app's flag. It takes no `index`, which is why
    // adding it left the six group windows at the staggered positions they had.
    this.animationButton = el('button', {
      text: 'Animation',
      title: 'show or hide the timeline bar',
      on: {
        click: () => {
          const visible = this.context.timelineVisible?.() !== true;
          this.context.actions.setTimelineVisible(visible);
          this.animationButton.classList.toggle('on', visible);
        },
      },
    });
    rail.append(this.animationButton);

    // The rail is the overlay's whole content: six buttons that open windows, plus the timeline toggle.
    root.append(rail);
    this.refresh();
  }

  /** Only the fields the chosen shape reads stay live: a height is a landscape's, a hollow is a box's. */
  private refreshPrimitiveControls(kind: PrimitiveKind): void {
    this.primitiveHeightInput.disabled = kind !== 'terrain';
    this.primitiveHollowInput.disabled = kind !== 'box';
  }

  refresh(): void {
    const { project, session } = this.context;

    if (!this.touched.exportFps) this.exportFpsInput.value = String(project.timeline.fps);
    if (!this.touched.exportFrom) this.exportFromInput.value = '0';
    // The export range is seconds while the clip is authored in milliseconds.
    if (!this.touched.exportTo) this.exportToInput.value = String(project.timeline.durationMs / 1000);
    // The export-camera select is a view of the app's export take, not of the editor's preview take: `refresh()` seeds
    // it from the takes the app offers so a copy or a delete under it is reflected.
    const exportCamera = this.context.exportCamera?.();
    if (exportCamera !== undefined) {
      // Two states, two options. An export either follows the preview take — the app's default, and what a load
      // returns to — or is pinned to one; a list of takes alone could only show the second, so the state the app
      // starts in would be invisible and unreachable once a take had been picked.
      const follow: HTMLOptionElement[] =
        exportCamera.previewTakeName === ''
          ? []
          : [el('option', { value: '', text: `follow the preview: ${exportCamera.previewTakeName}` })];
      this.exportCameraSelect.replaceChildren(
        ...follow,
        ...exportCamera.takes.map((take) => el('option', { value: take.id, text: take.name })),
      );
      this.exportCameraSelect.value = exportCamera.takeId;
    }

    // The raw-mesh checkbox is a view of the app's flag only while the context exposes one; a context
    // without `sceneVisible()` owns the state itself, so `refresh()` leaves the box alone.
    const sceneVisible = this.context.sceneVisible;
    if (sceneVisible !== undefined) this.sourceVisibleInput.checked = sceneVisible();
    // Same rule for the Grid group: with a source the checkbox is a view of the viewport's own flag.
    const gridVisible = this.context.gridVisible?.();
    if (gridVisible !== undefined) this.worldGridInput.checked = gridVisible;

    const cameraControl = this.context.cameraControl?.();
    if (cameraControl !== undefined) {
      this.cameraSelectButton.textContent = cameraControl.selected ? 'Deselect' : 'Select';
      this.cameraModeButton.textContent = cameraControl.mode === 'rotate' ? '-> Move' : '-> Rotate';
      // A path needs two keyframes to exist at all, so below that the box is unchecked as well as disabled.
      this.cameraPathInput.disabled = !cameraControl.pathAvailable;
      this.cameraPathInput.checked = cameraControl.pathAvailable && cameraControl.pathVisible;
      // The projection, the clip planes, and the lens label follow the shot the fields are editing, which is the
      // active take's segment at the playhead.
      this.cameraProjectionSelect.value = cameraControl.projection;
      this.cameraLensLabel.textContent = cameraControl.projection === 'perspective' ? 'FOV (deg)' : 'View height';
      if (!this.touched.cameraNear) this.cameraNearInput.value = String(cameraControl.near);
      if (!this.touched.cameraFar) this.cameraFarInput.value = String(cameraControl.far);
      // A run owns the shot for its length, so the controls that would reshape it wait.
      this.cameraProjectionSelect.disabled = cameraControl.playing;
      const authored = [...cameraControl.pose.position, ...cameraControl.pose.quaternion, cameraControl.pose.fov];
      // The lens is part of the same state: the shot the carrier draws is the shot the fields show.
      if (!this.touched.cameraFov) this.cameraFovInput.value = String(cameraControl.pose.fov);
      this.cameraPoseInputs.forEach((input, index) => {
        // Seeded like the other view fields, except while it is the field being typed into.
        if (document.activeElement !== input) input.value = fmt(authored[index] ?? 0, 4);
      });
    }
    // The carrier's own controls need a carrier: a context without one has nothing for them to aim, and a
    // rotation mode with no carrier selected has nothing to rotate. The mode button is the carrier's alone —
    // an object's gizmo draws its arrows and rings together, so nothing about an object is gated here, and
    // the object needs no mode the camera's button would have to be reached to set.
    const carrierGated = cameraControl === undefined;
    this.cameraSelectButton.disabled = carrierGated;
    this.cameraModeButton.disabled = carrierGated || !cameraControl?.selected;
    this.cameraToViewButton.disabled = carrierGated;
    this.viewToCameraButton.disabled = carrierGated;

    const timelineVisible = this.context.timelineVisible;
    this.animationButton.disabled = timelineVisible === undefined;
    if (timelineVisible !== undefined) this.animationButton.classList.toggle('on', timelineVisible());

    const active = session.activeObjectId === null ? undefined : project.get(session.activeObjectId);

    this.renderObjectList();
    this.selectionShapeSelect.value = session.selectionShape;
    for (const [tool, button] of this.toolButtons) button.classList.toggle('on', session.activeTool === tool);
    // Detach acts on the selection and on nothing else, so with an empty selection there is nothing for it to
    // do. The tools stay live: a press is what creates the region they work on.
    this.detachButton.disabled = session.selection.kind === 'none';
    // The history is a view like the detach button is: a step exists or it does not, and a context without one has
    // nothing for either button to do.
    const historyState = this.context.historyState?.();
    this.undoButton.disabled = historyState === undefined || !historyState.canUndo;
    this.redoButton.disabled = historyState === undefined || !historyState.canRedo;
    this.refreshPrimitiveControls(this.primitiveKindSelect.value as PrimitiveKind);
    this.editColorInput.value = hexInputValue(session.editColor);
    this.addHeightInput.value = String(session.addHeight);
    this.maskColorInput.disabled = active === undefined;
    if (active !== undefined) this.maskColorInput.value = hexInputValue(active.maskColor);
    this.visibleInput.disabled = active === undefined;
    const resolution = active === undefined ? undefined : session.resolutionOf(active.id);
    this.alignToGridInput.disabled = active === undefined;
    this.subdivisionSelect.disabled = resolution?.subdivision === undefined;
    if (resolution?.subdivision !== undefined) {
      this.subdivisionSelect.value = String(resolution.subdivision);
      for (const option of this.subdivisionSelect.options) {
        option.disabled = Number(option.value) < resolution.subdivision;
      }
    }
    this.editGroupButton.disabled = active === undefined;
    this.nameInput.disabled = active === undefined;
    // The name field shows the active object's name until the user types, and re-seeds whenever the
    // active object changes, so it can never show one object's text while renaming another.
    if (active === undefined) {
      this.nameObjectId = null;
      this.touched.objectName = false;
      this.nameInput.value = '';
    } else {
      this.visibleInput.checked = active.visible;
      this.alignToGridInput.checked = active.alignToGrid;
      if (this.nameObjectId !== active.id) {
        this.nameObjectId = active.id;
        this.touched.objectName = false;
      }
      if (!this.touched.objectName) this.nameInput.value = active.name;
    }
    this.renderParentSelect(active);
  }

  /**
   * Sends the whole pose, because the fields are one state and a change to any component is a change to it. A
   * non-finite component is refused and the fields are re-read from what the camera actually holds.
   */
  private writeCameraPose(): void {
    const [x, y, z, qx, qy, qz, qw] = this.cameraPoseInputs.map((input) => Number(input.value));
    const fov = Number(this.cameraFovInput.value);
    if ([x, y, z, qx, qy, qz, qw, fov].some((value) => value === undefined || !Number.isFinite(value))) {
      this.refresh();
      return;
    }
    this.context.actions.setCameraPose({
      position: [x!, y!, z!],
      quaternion: [qx!, qy!, qz!, qw!],
      fov,
    });
  }

  /** The projection the selector shows, narrowed back to the model's own union. */
  private readProjection(): ProjectionKind {
    return this.cameraProjectionSelect.value === 'orthographic' ? 'orthographic' : 'perspective';
  }

  /**
   * Writes the shot's clip planes. Both fields go together because a camera with `near >= far` renders nothing, so
   * the pair is one decision rather than two; the app refuses an unusable pair and the next `refresh()` re-seeds both.
   */
  private writeLensParams(): void {
    const near = Number.parseFloat(this.cameraNearInput.value);
    const far = Number.parseFloat(this.cameraFarInput.value);
    this.touched.cameraNear = true;
    this.touched.cameraFar = true;
    if (Number.isFinite(near) && Number.isFinite(far)) this.context.actions.setCameraLensParams({ near, far });
  }

  private field(label: string, control: HTMLElement): HTMLLabelElement {
    return el('label', undefined, [el('span', { class: 'dim', text: label }), control]);
  }

  private renderObjectList(): void {
    const { project, session } = this.context;
    const rows: HTMLDivElement[] = [];
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

  /**
   * One object row: the name button, and — on the active row only — the trash that deletes that
   * object. The trash appears where the user clicked, so a delete can only ever hit the object whose
   * row shows the icon, and the row it belongs to is the one that disappears.
   */
  private objectRow(object: SceneObject, depth: number, active: boolean): HTMLDivElement {
    const resolution = this.context.session.resolutionOf(object.id);
    const row = el('div', { class: 'obj-row' });
    row.style.marginLeft = `${depth * 10}px`;

    const select = el('button', {
      text: `${object.name} \u00b7 ${object.representation}${resolutionSuffix(resolution)}`,
      on: {
        click: () => {
          this.context.session.setActiveObject(object.id);
          this.refresh();
        },
      },
    });
    select.classList.toggle('on', active);
    row.append(select);
    if (!active) return row;

    const remove = el('button', {
      class: 'row-del',
      title: `Delete ${object.name}`,
      on: {
        click: () => {
          this.context.actions.deleteObject(object.id);
          this.refresh();
        },
      },
    });
    remove.setAttribute('aria-label', `Delete ${object.name}`);
    remove.append(trashIcon());
    row.append(remove);
    return row;
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

  /**
   * The add wall field: a whole number of cells at least one. Anything else — a blank field, a fraction, a
   * negative — leaves the session's value alone, so the field can be cleared and retyped without the drag
   * losing the height it had.
   */
  private writeAddHeight(): void {
    const height = Number(this.addHeightInput.value);
    if (!Number.isInteger(height) || height < 1) return;
    this.context.session.setAddHeight(height);
  }
}
