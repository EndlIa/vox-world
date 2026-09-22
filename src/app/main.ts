/**
 * The composition root: the only file allowed to import every module. It creates the project and
 * every long-lived object, wires the import -> voxelize -> edit -> animate -> export flow, and runs
 * the render loop; it owns no algorithm, only calls into inner rings.
 */

import { Mesh, PerspectiveCamera, Vector3, WebGLRenderer } from 'three';
import type { Box3, Object3D } from 'three';
import { Project } from '../document/project.js';
import type { ObjectId } from '../document/project.js';
import { EditorSession } from '../editor/session.js';
import type { EditResolution } from '../editor/session.js';
import {
  applyVoxelizeResult,
  createGroup,
  deleteObject,
  renameObject,
  reparentObject,
  setObjectMaskColor,
  setObjectAlignToGrid,
  setObjectSubdivision,
  setObjectVisible,
  setTransformFromWorldMatrix,
} from '../editor/ops.js';
import { PointerTool } from '../editor/pointer.js';
import type { PointerCallbacks } from '../editor/pointer.js';
import { DEFAULT_CELL_BUDGET, voxelize } from '../voxels/voxelize/voxelize.js';
import type { VoxelizeSource } from '../voxels/voxelize/voxelize.js';
import { UniformGrid } from '../voxels/uniform/grid.js';
import type { HexColor, IntBox3 } from '../voxels/uniform/grid.js';
import { adoptImportedScene, buildVoxelizeSource, importGlb, scaleImportedScene } from '../three-runtime/import.js';
import type { ImportedScene } from '../three-runtime/import.js';
import { SceneMirror } from '../three-runtime/scene.js';
import { Picker } from '../three-runtime/picking.js';
import { ViewportControls } from '../three-runtime/controls.js';
import { Capture } from '../three-runtime/capture.js';
import { Overlay } from '../three-runtime/overlay.js';
import { WorldGrid } from '../three-runtime/grid.js';
import { Playback } from '../animation/playback.js';
import { ExportJob } from '../export/job.js';
import { Panels } from '../ui/panels.js';
import type { PanelContext } from '../ui/panels.js';
import { DEFAULT_VOXELS_ACROSS, VoxelizeDialog } from '../ui/voxelizeDialog.js';
import type { VoxelizeDialogDefaults } from '../ui/voxelizeDialog.js';
import { TimelinePanel } from '../ui/timeline.js';
import type { TimelineContext } from '../ui/timeline.js';
import { Hud } from '../ui/hud.js';
import { ModeBar } from '../ui/modeBar.js';
import type { HudState } from '../ui/hud.js';
import { el } from '../ui/dom.js';
import { pickGlbFile, saveMp4, wireDropTarget } from './files.js';

export type AppContext = {
  project: Project;
  mirror: SceneMirror;
  picker: Picker;
  session: EditorSession;
  playback: Playback;
  controls: ViewportControls;
  pointer: PointerTool;
  capture: Capture;
  overlay: Overlay;
  worldGrid: WorldGrid;
};

type ImportedAssets = {
  scene: ImportedScene;
  /** The one object the import created: every source mesh and the payload of the import live on it. */
  objectId: ObjectId;
  /** One raw mesh per scene node, in node order: created once and re-placed when the scene is rescaled. */
  meshes: Mesh[];
};

const VIEWPORT_FOV = 60;
const VIEWPORT_NEAR = 0.1;
const VIEWPORT_FAR = 5000;
/** Initial capture size; every export resizes the capture to what the panel asked for. */
const DEFAULT_EXPORT_WIDTH = 1280;
const DEFAULT_EXPORT_HEIGHT = 720;
const EXPORT_FILENAME = 'vox-world.mp4';
const DEFAULT_DURATION_SECONDS = 10;
const DEFAULT_FPS = 30;
/** The dialog's extent seed before any import. */
/**
 * The extent the dialog seeds from when there is no import to measure: one default model's worth, in
 * voxels. One voxel is one world unit (README D41), so an extent and a voxel count are the same kind of
 * number, and the dialog's fallback is the count it already opens at.
 */
const DEFAULT_EXTENT = DEFAULT_VOXELS_ACROSS;
const DEMO_CELLS = 4;
const DEMO_COLOR = 0x4da3ff;
const DEMO_TOP_COLOR = 0x9aa2ad;

function elementById(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) throw new TypeError(`index.html has no element #${id}`);
  return element;
}

function canvasById(id: string): HTMLCanvasElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLCanvasElement)) throw new TypeError(`index.html has no <canvas> #${id}`);
  return element;
}

/** The canvas' layout aspect: it drives the viewport camera, and the locked output camera. */
function canvasAspect(canvas: HTMLCanvasElement): number {
  return Math.max(1, canvas.clientWidth) / Math.max(1, canvas.clientHeight);
}

/** Sizes the drawing buffer to the canvas' layout box and keeps the viewport camera's aspect equal. */
function resizeViewport(renderer: WebGLRenderer, canvas: HTMLCanvasElement, camera: PerspectiveCamera): void {
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = canvasAspect(canvas);
  camera.updateProjectionMatrix();
}

/** The demo object: a small uniform cube so the viewport is not empty before the first import. */
function buildDemoGrid(): UniformGrid {
  const grid = UniformGrid.create();
  for (let x = 0; x < DEMO_CELLS; x += 1) {
    for (let y = 0; y < DEMO_CELLS; y += 1) {
      for (let z = 0; z < DEMO_CELLS; z += 1) {
        grid.set(x, y, z, y === DEMO_CELLS - 1 ? DEMO_TOP_COLOR : DEMO_COLOR);
      }
    }
  }
  return grid;
}

/** Width x height x depth and the cell count of an inclusive integer box, for status text. */
function boxText(box: IntBox3): string {
  const width = box.max[0] - box.min[0] + 1;
  const height = box.max[1] - box.min[1] + 1;
  const depth = box.max[2] - box.min[2] + 1;
  return `box ${width}x${height}x${depth} (${width * height * depth} cells)`;
}

export function main(): void {
  // 1. The four page elements, the project, and one demo voxel object.
  const viewport = canvasById('viewport');
  const modebarRoot = elementById('modebar');
  const panelsRoot = elementById('panels');
  const timelineRoot = elementById('timeline');
  const hudRoot = elementById('hud');

  const project = new Project();
  project.timeline.duration = DEFAULT_DURATION_SECONDS;
  project.timeline.fps = DEFAULT_FPS;
  project.createVoxelObject({
    name: 'Demo cube',
    maskColor: project.nextMaskColor(),
    payload: { kind: 'uniform', grid: buildDemoGrid() },
    position: new Vector3(-2, 0, -2),
  });

  // 2. Viewport: renderer, mirror and its output camera, navigation, decorations, capture.
  const viewportCamera = new PerspectiveCamera(VIEWPORT_FOV, 1, VIEWPORT_NEAR, VIEWPORT_FAR);
  // The overlay and the gizmo live on camera layer 1 and the imported raw meshes on layer 2
  // (README D24), so the viewport camera draws both while the raycaster tests layers 0
  // and 2 and the export camera — and the `Capture` that renders through it — stays on layer 0 alone.
  viewportCamera.layers.enable(1);
  viewportCamera.layers.enable(2);
  // The logarithmic depth buffer is what keeps a scene of any size drawable: an imported file is metres
  // per unit as authored, which for a centimetre-authored model is a scene kilometres across, and a linear
  // depth buffer with the near plane at 1e-4 spends its whole precision in the first metres — surfaces far
  // away then fight each other (README D40). It costs the depth test's early-out, which nothing here needs.
  const renderer = new WebGLRenderer({ canvas: viewport, antialias: true, logarithmicDepthBuffer: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  resizeViewport(renderer, viewport, viewportCamera);

  const mirror = new SceneMirror(project, {
    background: project.settings.background,
    ambientIntensity: project.settings.ambientIntensity,
  });
  const controls = new ViewportControls(viewport, viewportCamera);
  const overlay = new Overlay(mirror.scene);
  // The world grid is viewport decoration like the overlay: layer 1, so it is never picked and never
  // reaches a frame, and `frameAll` ignores it.
  const worldGrid = new WorldGrid();
  mirror.scene.add(worldGrid.root);
  const capture = new Capture({ width: DEFAULT_EXPORT_WIDTH, height: DEFAULT_EXPORT_HEIGHT });
  mirror.sync();
  mirror.frameAll(viewportCamera);

  // 3. Editor and animation objects.
  const session = new EditorSession(project);
  const picker = new Picker(mirror);
  const playback = new Playback({ camera: mirror.camera });

  const dirtyIds = new Set<ObjectId>();
  let boundIds: ReadonlySet<ObjectId> = new Set<ObjectId>();
  let bindingsDirty = true;
  /** While set, navigation drives the output camera and the viewport renders through it. */
  let cameraLocked = false;
  let resolutionCache: EditResolution | null = null;
  /** The mirror node the gizmo is attached to, so a rebuilt replacement is noticed (see `syncGizmo`). */
  let gizmoNode: Object3D | undefined;
  /** What the second grid layer was last pointed at, so a repeat call rebuilds nothing (see `refreshObjectGrid`). */
  let objectGridKey = '';
  let lastImport: ImportedAssets | undefined;
  let jobController: AbortController | undefined;
  /** The raw meshes on layer 2, one per imported node: app-owned, kept for teardown (README D24). */
  const sourceMeshes: Mesh[] = [];

  // 4. UI over the actions of step 5; `pickImportFile` stays in app/. The voxelize settings live in the
  // dialog alone (README D26), so it is the fourth UI element, mounted like the panels into `panelsRoot`.
  // The status line starts empty rather than with a placeholder word: an empty status box is not shown at
  // all (`#panels > div:empty` in `index.html`), so the editor opens with the rail and nothing else, and
  // the line appears with the first operation that has something to say.
  const voxelizeDialog = new VoxelizeDialog(panelsRoot, () => defaults());

  const panelContext: PanelContext = {
    project,
    session,
    sceneVisible: () => mirror.sourceVisible,
    gridSettings: () => ({
      base: worldGrid.baseVisible,
      object: worldGrid.objectVisible,
      margin: worldGrid.margin,
    }),
    actions: {
      pickImportFile: openImportDialog,
      exportMp4: runExport,
      createGroup: applyCreateGroup,
      deleteObject: applyDeleteObject,
      detachSelection: applyDetachSelection,
      setActiveMaskColor: applyMaskColor,
      setActiveVisible: applySetActiveVisible,
      setActiveAlignToGrid: applySetActiveAlignToGrid,
      setActiveSubdivision: applySetActiveSubdivision,
      setSourceVisible,
      setBaseGridVisible,
      setObjectGridVisible,
      setGridMargin,
      renameActive: applyRenameActive,
      reparentActive: applyReparent,
      setCameraLock,
      setCameraFov,
    },
  };
  const timelineContext: TimelineContext = {
    project,
    playback,
    session,
    onScrub: (time) => {
      playback.pause();
      playback.setTime(time);
    },
    onEdited: () => {
      playback.rebuild(project);
    },
  };

  const panels = new Panels(panelsRoot, panelContext);
  const timelinePanel = new TimelinePanel(timelineRoot, timelineContext);
  const hud = new Hud(hudRoot);
  // The mode switch is a view of the session like the panels are, so it takes no state of its own.
  const modeBar = new ModeBar(modebarRoot, { session });

  const pointerCallbacks: PointerCallbacks = {
    onSessionChange: sessionChanged,
    onProjectChange: projectChanged,
  };
  const pointer = new PointerTool({
    dom: viewport,
    project,
    session,
    picker,
    overlay,
    getCamera: () => (cameraLocked ? mirror.camera : viewportCamera),
    getGizmoBusy: () => controls.gizmoBusy(),
    callbacks: pointerCallbacks,
  });

  const app: AppContext = { project, mirror, picker, session, playback, controls, pointer, capture, overlay, worldGrid };

  // 5. Flow wiring: the only place the modules meet.
  /**
   * The dialog's seed, derived from the retained import's voxelize bounds: their per-axis extent, which the
   * count is read against to print the model's dimensions (README D29, D41). Before any import the extent
   * falls back to `DEFAULT_EXTENT`, so the dialog is usable with no scene.
   *
   * Those bounds are the nodes that are voxelized, not the nodes that are displayed: a stylized
   * export's outline shells are drawn around the model and a little larger than it, so letting them in
   * would inflate that extent for content they do not cover. A scene of
   * nothing but outlines has no outline-free bounds and falls back to the displayed ones (README D27);
   * framing uses those displayed bounds regardless, because every node is shown.
   */
  function defaults(): VoxelizeDialogDefaults {
    const scene = lastImport?.scene;
    const sizeBounds =
      scene === undefined ? undefined : scene.voxelizeBounds.isEmpty() ? scene.bounds : scene.voxelizeBounds;
    if (sizeBounds === undefined || sizeBounds.isEmpty()) {
      return { extent: { x: DEFAULT_EXTENT, y: DEFAULT_EXTENT, z: DEFAULT_EXTENT } };
    }
    const size = sizeBounds.getSize(new Vector3());
    return { extent: { x: size.x, y: size.y, z: size.z } };
  }

  function openImportDialog(): void {
    void pickGlbFile().then((file) => {
      if (file !== undefined) void importFile(file);
    });
  }

  /**
   * Puts one raw mesh per imported node into the mirror, on layer 2 (README D24), all of them under the
   * import's single object. The mesh is handed its node's own baked world matrix (README D25): the mirror
   * places it by that matrix relative to the object node, so the mesh reproduces the import exactly,
   * before and after a payload makes the object translation-only. That is what lets one object stand for
   * a whole file: the model's placement lives in the mesh matrices, not in the object's transform. The
   * meshes share the imported geometry and materials, are never disposed by the mirror, and stay in
   * `sourceMeshes` so teardown can detach them.
   *
   * `meshes` is filled on the first call for a scene and reused afterwards: confirming the dialog rescales
   * the import to the model's voxel count (README D41) and the same meshes are re-placed by their new node
   * matrices, which the mirror's per-mesh records accept as a refresh rather than a second copy.
   */
  function attachSourceMeshes(scene: ImportedScene, objectId: ObjectId, meshes: Mesh[]): void {
    scene.nodes.forEach((node, index) => {
      const existing = meshes[index];
      const mesh = existing ?? new Mesh(node.geometry, node.sourceMesh.material);
      if (existing === undefined) {
        meshes.push(mesh);
        sourceMeshes.push(mesh);
      }
      mirror.attachSourceObject(objectId, mesh, node.matrixWorld);
    });
  }

  async function importFile(file: File): Promise<void> {
    const data = await file.arrayBuffer();
    const result = await importGlb(data);
    if (!result.ok) {
      reportFailure(result);
      return;
    }
    // One voxel is one world unit (README D41), so the model is scaled onto the lattice before anything
    // sees it: the dialog's count then says how long it is, and both the raw meshes and the payload the
    // job later attaches are placed in the same unit.
    const scene = scaleImportedScene(result.scene, DEFAULT_VOXELS_ACROSS);
    const adopted = adoptImportedScene(project, scene);
    const meshes: Mesh[] = [];
    lastImport = { scene, objectId: adopted.objectId, meshes };
    attachSourceMeshes(scene, adopted.objectId, meshes);
    dirtyIds.add(adopted.objectId);
    bindingsDirty = true;
    // The object has to exist and its bounds have to be measurable before the settings can be asked in
    // context, so the view is fitted here, on the raw meshes (D24): `frameAll` syncs, creates the node,
    // and measures layers 0 and 2. Nothing has voxelized it yet, so it is still `'empty'`.
    mirror.frameAll(viewportCamera);
    commitDirty();
    // The resolution is a per-model decision made when the model arrives (README D26), so the settings
    // dialog comes last: confirming voxelizes this import, cancelling leaves it as the raw model the
    // user is looking at.
    await promptVoxelize(scene, adopted.objectId);
  }

  /**
   * Asks for the voxelization settings of one retained import (README D26) and runs the shared job when
   * the user confirms. The dialog is the only place the count exists, so nothing is derived here: a confirm
   * scales the import to that count — the model's length in voxels — re-places its raw meshes so they stay
   * glued to the content the job voxelizes (README D24, D41), and runs the shared job on the scaled source;
   * a cancel leaves the object `'empty'` with its raw meshes displayed, which is what the user is looking
   * at.
   */
  async function promptVoxelize(scene: ImportedScene, objectId: ObjectId): Promise<void> {
    const outcome = await voxelizeDialog.open({ title: `Voxelize ${scene.name}` });
    if (outcome.kind === 'cancel') {
      return;
    }
    const assets = lastImport;
    const scaled = scaleImportedScene(scene, outcome.cellsAcross);
    if (assets !== undefined && assets.objectId === objectId) {
      assets.scene = scaled;
      attachSourceMeshes(scaled, objectId, assets.meshes);
    }
    await runVoxelizeJob(buildVoxelizeSource(scaled), objectId);
  }

  /**
   * The one voxelization job, run for the import a confirmed settings dialog was about (README D26). It
   * cancels whatever was in flight — a superseded job must not attach its payloads — then voxelizes the
   * source of one import at `target` and attaches its payload to `objectId`, the object
   * `adoptImportedScene` created for that import, through an `attachTo` map built from the source's own
   * id: that is the key every output carries, so the imported object gains the voxels instead of being
   * duplicated next to them. An import with nothing to voxelize — every node an outline shell — has no
   * source and stops after the abort, because there is nothing to attach. Success marks the id dirty,
   * refreshes the panels, and re-frames the viewport; framing belongs here, after the payload: an object
   * that rendered as raw meshes until this call renders as voxels now, and `frameAll` syncs first, so
   * the instance meshes rebuilt for the id just marked dirty are what it measures. Nothing is written while
   * it runs, and a failure reaches `reportFailure` with the `Result` literal and detail (D38).
   */
  async function runVoxelizeJob(source: VoxelizeSource | undefined, objectId: ObjectId): Promise<void> {
    // The abort comes first: it is what keeps a superseded job from attaching its payloads, and an
    // import that has nothing to voxelize still supersedes the job that is running.
    jobController?.abort();
    jobController = undefined;
    if (source === undefined) return;

    const controller = new AbortController();
    jobController = controller;
    const result = await voxelize({
      sources: [source],
      budget: DEFAULT_CELL_BUDGET,
      signal: controller.signal,
    });
    if (jobController === controller) jobController = undefined;
    if (!result.ok) {
      reportFailure(result);
      return;
    }
    const applied = applyVoxelizeResult(project, result, {
      attachTo: new Map([[source.sourceId, objectId]]),
    });
    for (const id of applied.objectIds) dirtyIds.add(id);
    bindingsDirty = true;
    commitDirty();
    mirror.frameAll(viewportCamera);
  }

  /**
   * Reports a failed `Result`. The panel has no message area any more (D37), so the console is the only
   * channel a failure has; the text is the same literal-and-detail pair the UI used to show.
   */
  function reportFailure(result: { error: string; detail: string }): void {
    console.error(`${result.error}: ${result.detail}`);
  }

  async function runExport(options: {
    width: number;
    height: number;
    fps: number;
    from: number;
    to: number;
    mode: 'beauty' | 'mask';
  }): Promise<void> {
    if (jobController !== undefined) return;
    const controller = new AbortController();
    jobController = controller;
    // The gizmo is viewport feedback on camera layer 0; it must not reach an exported frame.
    controls.detachGizmo();
    // The capture renders at the requested resolution; nothing in the viewport marks it.
    capture.resize(options.width, options.height);
    const result = await new ExportJob({ mirror }).run(
      {
        project,
        scene: mirror.scene,
        capture,
        playback,
        output: {
          width: options.width,
          height: options.height,
          fps: options.fps,
          from: options.from,
          to: options.to,
          mode: options.mode,
        },
      },
      controller.signal,
    );
    if (jobController === controller) jobController = undefined;
    syncGizmo();
    if (!result.ok) {
      reportFailure(result);
      return;
    }
    saveMp4(result.blob, EXPORT_FILENAME);
  }

  /**
   * Turns the camera lock on or off. Locked, `ViewportControls` navigates the **output** camera, so
   * what the viewport shows is what an export captures; unlocked,
   * navigation goes back to the app-owned viewport camera (D17). The flag is set before retargeting,
   * so the retarget's own `change` event never writes authored data on the way out of the lock.
   */
  function setCameraLock(enabled: boolean): void {
    cameraLocked = enabled;
    controls.setOrbitTarget(enabled ? mirror.camera : viewportCamera);
  }

  /**
   * Writes the authored vertical FOV and applies it to the output camera at once: the projection
   * matrix is refreshed here because assigning `fov` alone leaves it stale. The locked viewport and
   * the next export then both show the authored value, and a `fov` keyframe records it instead of
   * whatever the camera was constructed with.
   */
  function setCameraFov(fov: number): void {
    if (!Number.isFinite(fov)) return;
    const value = Math.min(179, Math.max(1, fov));
    project.camera.fov = value;
    mirror.camera.fov = value;
    mirror.camera.updateProjectionMatrix();
  }

  function applyCreateGroup(): void {
    const result = createGroup(project, 'Group');
    if (!result.ok) {
      reportFailure(result);
      return;
    }
    session.setActiveObject(result.objectId);
    dirtyIds.add(result.objectId);
    bindingsDirty = true;
    commitDirty();
  }

  /** Deletes one object by id: the row's trash button names it, so the active object need not be it. */
  function applyDeleteObject(objectId: ObjectId): void {
    const result = deleteObject(project, objectId);
    if (!result.ok) {
      reportFailure(result);
      return;
    }
    dirtyIds.delete(objectId);
    if (session.activeObjectId === objectId) session.setActiveObject(null);
    bindingsDirty = true;
    commitDirty();
  }

  function applyMaskColor(color: HexColor): void {
    const objectId = session.activeObjectId;
    if (objectId === null) return;
    const result = setObjectMaskColor(project, objectId, color);
    if (!result.ok) {
      reportFailure(result);
      return;
    }
    dirtyIds.add(objectId);
    commitDirty();
  }

  /**
   * Detaches the selected region into a new object, through the pointer tool so the button and a viewport press
   * commit the same operation and end the same way: the new object active, the region cleared, both objects
   * rebuilt (README D19, D23).
   */
  function applyDetachSelection(): void {
    pointer.detachSelection();
  }

  /** Shows or hides the active object; the mirror applies `object.visible` on its next `sync()`. */
  function applySetActiveVisible(visible: boolean): void {
    const objectId = session.activeObjectId;
    if (objectId === null) return;
    const result = setObjectVisible(project, objectId, visible);
    if (!result.ok) {
      reportFailure(result);
      return;
    }
    dirtyIds.add(objectId);
    commitDirty();
  }

  /**
   * Raises the active object's subdivision through the op: the payload is replaced by block replication, so the
   * object moves nowhere and only its cells get smaller (README D43).
   */
  function applySetActiveSubdivision(subdivision: number): void {
    const objectId = session.activeObjectId;
    if (objectId === null) return;
    const result = setObjectSubdivision(project, objectId, subdivision);
    if (!result.ok) {
      reportFailure(result);
      return;
    }
    dirtyIds.add(objectId);
    commitDirty();
  }

  /** Turns the active object's grid alignment on or off; the op snaps the placement when it turns on. */
  function applySetActiveAlignToGrid(alignToGrid: boolean): void {
    const objectId = session.activeObjectId;
    if (objectId === null) return;
    const result = setObjectAlignToGrid(project, objectId, alignToGrid);
    if (!result.ok) {
      reportFailure(result);
      return;
    }
    dirtyIds.add(objectId);
    commitDirty();
  }

  /**
   * Shows or hides every imported raw mesh at once (README D24). The mirror owns the flag — the panel's
   * checkbox is a view of `mirror.sourceVisible` — and applies it on its next `sync()`. An export is
   * unaffected either way: it renders layer 0 alone.
   */
  function setSourceVisible(enabled: boolean): void {
    mirror.setSourceVisible(enabled);
  }

  /** Renames the active object; the op trims the name and refuses an empty one. */
  function applyRenameActive(name: string): void {
    const objectId = session.activeObjectId;
    if (objectId === null) return;
    const result = renameObject(project, objectId, name);
    if (!result.ok) {
      reportFailure(result);
      return;
    }
    dirtyIds.add(objectId);
    commitDirty();
  }

  function applyReparent(parentId: ObjectId | null): void {
    const objectId = session.activeObjectId;
    if (objectId === null) return;
    const result = reparentObject(project, objectId, parentId);
    if (!result.ok) {
      reportFailure(result);
      return;
    }
    dirtyIds.add(objectId);
    commitDirty();
  }

  /** Marks every id whose payload may have changed dirty, then re-reads both panels. */
  function commitDirty(): void {
    for (const id of dirtyIds) if (project.get(id) !== undefined) mirror.markDirty(id);
    dirtyIds.clear();
    refreshObjectGrid();
    refreshReadouts();
    panels.refresh();
    timelinePanel.refresh();
  }

  function sessionChanged(): void {
    if (session.activeObjectId !== null) dirtyIds.add(session.activeObjectId);
    refreshReadouts();
    syncGizmo();
    refreshObjectGrid();
    modeBar.refresh();
    panels.refresh();
    timelinePanel.refresh();
  }

  /** Grid group: the base layer's own switch. */
  function setBaseGridVisible(visible: boolean): void {
    worldGrid.setBaseVisible(visible);
    panels.refresh();
  }

  /** Grid group: the active object's lattice, on or off. */
  function setObjectGridVisible(visible: boolean): void {
    worldGrid.setObjectVisible(visible);
    refreshObjectGrid();
    panels.refresh();
  }

  /** Grid group: cells of lattice drawn around the active object. A value that is not a cell count is dropped. */
  function setGridMargin(cells: number): void {
    if (!Number.isInteger(cells) || cells < 0) return;
    worldGrid.setMargin(cells);
    refreshObjectGrid();
    panels.refresh();
  }

  /** The objects an operation rewrote: they are the ones whose derived geometry is rebuilt (README D4). */
  function projectChanged(ids: readonly ObjectId[]): void {
    for (const id of ids) dirtyIds.add(id);
    bindingsDirty = true;
    commitDirty();
  }

  /** Recomputes the values the HUD shows from session and project state, never from the loop. */
  function refreshReadouts(): void {
    const objectId = session.activeObjectId;
    resolutionCache = objectId === null ? null : session.resolutionOf(objectId) ?? null;
  }

  /**
   * Points the viewport's second grid layer at the active object: its own lattice, or none. Guarded by a cheap key
   * — the id, the level, the cell count, the margin, and whether the layer is on — because the lattice geometry is
   * rebuilt per call and an edit reaches here on every commit, while `grid.bounds()` scans the occupied cells.
   */
  function refreshObjectGrid(): void {
    const objectId = session.activeObjectId;
    const grid = objectId === null ? undefined : project.get(objectId)?.uniform;
    const key = `${objectId}|${grid?.subdivision ?? 0}|${grid?.size ?? 0}|${worldGrid.margin}|${worldGrid.objectVisible}`;
    if (key === objectGridKey) return;
    objectGridKey = key;
    if (grid === undefined || objectId === null) {
      worldGrid.showObjectLattice(undefined, undefined);
      return;
    }
    worldGrid.showObjectLattice(grid, project.worldMatrix(objectId));
  }

  /**
   * The node the gizmo belongs on right now: the active object's, while object mode is active, and none at all
   * in edit mode or with an empty selection.
   *
   * A rebuild replaces that node (`mirror.rebuild` releases the old one), so the identity is compared
   * against the attached one on every frame and a replacement is what re-attaches the gizmo.
   */
  function gizmoNodeNow(): Object3D | undefined {
    const objectId = session.activeObjectId;
    if (objectId === null || session.mode !== 'object') return undefined;
    return mirror.objectOf(objectId);
  }

  /**
   * Puts the gizmo on the active object, pivoting at the center of its content so the handles sit on what
   * the user edits rather than at the node origin, which is the payload's min corner (`contentCenterOf`,
   * README D37). Called on every session change and whenever the node under the gizmo was replaced.
   */
  function syncGizmo(): void {
    const objectId = session.activeObjectId;
    const node = gizmoNodeNow();
    if (node === undefined || objectId === null) {
      controls.detachGizmo();
      gizmoNode = undefined;
      return;
    }
    controls.attachGizmo(node, 'translate', mirror.contentCenterOf(objectId));
    gizmoNode = node;
  }

  /** Binds the mixer to the mirrored nodes of every current object. */
  function rebuildBindings(): void {
    const bound = new Map<ObjectId, Object3D>();
    for (const id of project.objects.keys()) {
      const node = mirror.objectOf(id);
      if (node !== undefined) bound.set(id, node);
    }
    boundIds = new Set(bound.keys());
    bindingsDirty = false;
    // `Playback.bind` resolves its mixer root from the first bound node, so an empty scene keeps
    // the current binding instead of clearing it.
    if (bound.size === 0) return;
    const time = playback.time;
    playback.bind(bound);
    playback.rebuild(project);
    playback.setTime(time);
  }

  function bindingsCurrent(): boolean {
    if (boundIds.size !== project.objects.size) return false;
    for (const id of project.objects.keys()) if (!boundIds.has(id)) return false;
    return true;
  }

  function objectName(objectId: ObjectId): string {
    return project.get(objectId)?.name ?? objectId;
  }

  /** Reads the session selection as text: the HUD shows this verbatim. */
  function selectionText(): string {
    const selection = session.selection;
    if (selection.kind === 'box') return `${boxText(selection.box)} on ${objectName(selection.objectId)}`;
    return 'none';
  }

  function hudState(): HudState {
    const objectId = session.activeObjectId;
    const object = objectId === null ? undefined : project.get(objectId);
    return {
      activeObjectName: object?.name ?? null,
      representation: object?.representation ?? null,
      editResolution: resolutionCache,
      selectionText: selectionText(),
      frame: Math.round(playback.time * project.timeline.fps),
      fps: project.timeline.fps,
    };
  }

  // 6. Gizmo, camera lock, session, drop target, resize, and the render loop.
  controls.onOrbitChange(() => {
    // Only navigation while the lock is on describes the output camera, and only while the mixer is
    // stopped: a running clip owns the camera, and writing its sampled pose back would drift the
    // authored pose towards the animation on every frame.
    if (cameraLocked && !playback.playing) {
      project.camera.transform.position.copy(mirror.camera.position);
      project.camera.transform.quaternion.copy(mirror.camera.quaternion);
    }
  });
  /**
   * Live drag feedback: the object follows the pointer through the mirror, not the document, so a gesture
   * that is abandoned or cancelled has written nothing. The document write happens once, on commit.
   */
  controls.onGizmoChange((matrix) => {
    const objectId = session.activeObjectId;
    // The preview takes the same aligned matrix the commit will, so a drag steps the object from cell to
    // cell and the release writes the pose already on screen (README D42).
    if (objectId !== null) mirror.previewTransform(objectId, project.alignWorldMatrix(objectId, matrix));
  });
  controls.onGizmoCommit((matrix) => {
    const objectId = session.activeObjectId;
    if (objectId === null || project.get(objectId) === undefined) return;
    // The world matrix the gizmo derived, not the node's own: the gizmo moves a pivot proxy and never the
    // node, and the object's live transform is discarded by the rebuild this write triggers.
    const result = setTransformFromWorldMatrix(project, objectId, matrix);
    if (!result.ok) {
      reportFailure(result);
      return;
    }
    dirtyIds.add(objectId);
    commitDirty();
  });

  const unsubscribeSession = session.subscribe(sessionChanged);
  const detachDrop = wireDropTarget(viewport, (file) => {
    void importFile(file);
  });

  function handleResize(): void {
    resizeViewport(renderer, viewport, viewportCamera);
  }
  window.addEventListener('resize', handleResize);

  let frameHandle = 0;
  let lastTime = performance.now();

  function frame(now: number): void {
    frameHandle = requestAnimationFrame(frame);
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    playback.advance(dt);
    mirror.sync();
    // A dirty object is rebuilt as a new node, which releases the one an attached gizmo drives; comparing
    // identities is what re-attaches it, and it has to happen after `sync()` because that is what replaces
    // the node. Nothing else moves the gizmo: `syncGizmo` on a session change covers the rest.
    if (gizmoNode !== gizmoNodeNow()) syncGizmo();
    if (bindingsDirty) {
      bindingsDirty = false;
      if (!bindingsCurrent()) rebuildBindings();
    }
    controls.update();
    const renderCamera = cameraLocked ? mirror.camera : viewportCamera;
    if (cameraLocked) {
      // The locked output camera draws the viewport too, so it needs the canvas' aspect: an export
      // sets its own aspect for its frames, and a resize would otherwise leave the locked view
      // stretched. Layer 1 stays off it, so no decoration can reach the locked view or an export.
      const aspect = canvasAspect(viewport);
      if (renderCamera.aspect !== aspect) {
        renderCamera.aspect = aspect;
        renderCamera.updateProjectionMatrix();
      }
    }
    renderer.render(mirror.scene, renderCamera);
    timelinePanel.setTime(playback.time);
    hud.update(hudState());
  }

  function dispose(): void {
    if (frameHandle !== 0) {
      cancelAnimationFrame(frameHandle);
      frameHandle = 0;
    }
    detachDrop();
    jobController?.abort();
    jobController = undefined;
    // A prompt still on screen is settled as a cancel, so nothing is left waiting on a modal that is
    // going away with the page.
    voxelizeDialog.dispose();
    window.removeEventListener('resize', handleResize);
    window.removeEventListener('pagehide', dispose);
    unsubscribeSession();
    app.pointer.dispose();
    app.capture.dispose();
    app.overlay.dispose();
    app.worldGrid.dispose();
    // Also drops the orbit-change registration: the callbacks live in the controls.
    app.controls.dispose();
    app.playback.dispose();
    app.mirror.dispose();
    // The raw meshes are the app's, and so are their geometry and materials (the imported scene's):
    // teardown only takes them out of the scene graph the mirror just released.
    for (const mesh of sourceMeshes) mesh.removeFromParent();
    renderer.dispose();
  }

  window.addEventListener('pagehide', dispose);
  rebuildBindings();
  frameHandle = requestAnimationFrame(frame);
}

main();
