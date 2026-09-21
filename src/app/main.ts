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
  setLeafLabel,
  setObjectMaskColor,
  setObjectVisible,
  setTransformFromMatrix,
} from '../editor/ops.js';
import { PointerTool } from '../editor/pointer.js';
import type { PointerCallbacks } from '../editor/pointer.js';
import { DEFAULT_CELL_BUDGET, voxelize } from '../voxels/voxelize/voxelize.js';
import type { VoxelizeSource, VoxelizeTarget } from '../voxels/voxelize/voxelize.js';
import { UniformGrid } from '../voxels/uniform/grid.js';
import type { HexColor, IntBox3 } from '../voxels/uniform/grid.js';
import { adoptImportedScene, buildVoxelizeSources, importGlb } from '../three-runtime/import.js';
import type { ImportedScene } from '../three-runtime/import.js';
import { SceneMirror } from '../three-runtime/scene.js';
import { Picker } from '../three-runtime/picking.js';
import { OutputPreview, ViewportControls } from '../three-runtime/controls.js';
import { Capture } from '../three-runtime/capture.js';
import { Overlay } from '../three-runtime/overlay.js';
import { Playback } from '../animation/playback.js';
import { ExportJob } from '../export/job.js';
import { Panels } from '../ui/panels.js';
import type { PanelContext } from '../ui/panels.js';
import { TimelinePanel } from '../ui/timeline.js';
import type { TimelineContext } from '../ui/timeline.js';
import { Hud } from '../ui/hud.js';
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
};

type ImportedAssets = {
  scene: ImportedScene;
  objectIds: ObjectId[];
  bySourceId: ReadonlyMap<string, ObjectId>;
};

type VoxelizeDefaults = {
  uniformVoxelSize: number;
  targetCellSize: number;
  octreeMaxDepth: number;
  octreeRootSize: number;
};

const VIEWPORT_FOV = 60;
const VIEWPORT_NEAR = 0.1;
const VIEWPORT_FAR = 5000;
/** Initial capture and aspect-guide size; every export resizes the capture to what the panel asked for. */
const DEFAULT_EXPORT_WIDTH = 1280;
const DEFAULT_EXPORT_HEIGHT = 720;
const EXPORT_FILENAME = 'vox-world.mp4';
const DEFAULT_DURATION_SECONDS = 10;
const DEFAULT_FPS = 30;
const DEFAULT_MAX_DEPTH = 10;
const DEFAULT_ROOT_SIZE = 10;
/** Before any import the panel's uniform voxel size is `root / 96` and its cell size `root / 64`. */
const VOXEL_SIZE_DIVISOR = 96;
const CELL_SIZE_DIVISOR = 64;
const DEMO_CELL_SIZE = 0.5;
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
  const grid = UniformGrid.create(DEMO_CELL_SIZE);
  for (let x = 0; x < DEMO_CELLS; x += 1) {
    for (let y = 0; y < DEMO_CELLS; y += 1) {
      for (let z = 0; z < DEMO_CELLS; z += 1) {
        grid.set(x, y, z, y === DEMO_CELLS - 1 ? DEMO_TOP_COLOR : DEMO_COLOR);
      }
    }
  }
  return grid;
}

/** The octree root seed: the largest extent of the imported bounds, or the demo default. */
function boundsRootSize(bounds: Box3): number {
  const size = bounds.getSize(new Vector3());
  const largest = Math.max(size.x, size.y, size.z);
  return largest > 0 ? largest : DEFAULT_ROOT_SIZE;
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
    position: new Vector3(-1, 0, -1),
  });

  // 2. Viewport: renderer, mirror and its output camera, navigation, decorations, capture.
  const viewportCamera = new PerspectiveCamera(VIEWPORT_FOV, 1, VIEWPORT_NEAR, VIEWPORT_FAR);
  // The overlay, the aspect guide, and the gizmo live on camera layer 1 and the imported raw meshes on
  // layer 2 (README D24), so the viewport camera draws all three while the raycaster tests layers 0
  // and 2 and the export camera — and the `Capture` that renders through it — stays on layer 0 alone.
  viewportCamera.layers.enable(1);
  viewportCamera.layers.enable(2);
  const renderer = new WebGLRenderer({ canvas: viewport, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  resizeViewport(renderer, viewport, viewportCamera);

  const mirror = new SceneMirror(project, {
    background: project.settings.background,
    ambientIntensity: project.settings.ambientIntensity,
  });
  const controls = new ViewportControls(viewport, viewportCamera);
  const overlay = new Overlay(mirror.scene);
  const outputPreview = new OutputPreview({ aspect: DEFAULT_EXPORT_WIDTH / DEFAULT_EXPORT_HEIGHT, visible: true });
  mirror.scene.add(outputPreview.guide);
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
  let leafCache: HudState['leaf'] = null;
  let lastImport: ImportedAssets | undefined;
  let jobController: AbortController | undefined;
  /** The raw meshes on layer 2, one per imported node: app-owned, kept for teardown (README D24). */
  const sourceMeshes: Mesh[] = [];

  // 4. UI over the actions of step 5; `pickImportFile` stays in app/.
  const statusLine = el('div', { class: 'dim', text: 'ready' });
  panelsRoot.append(statusLine);

  const panelContext: PanelContext = {
    project,
    session,
    sceneVisible: () => mirror.sourceVisible,
    defaults,
    actions: {
      pickImportFile: openImportDialog,
      revoxelize: applyRevoxelize,
      exportMp4: runExport,
      createGroup: applyCreateGroup,
      deleteActive: applyDeleteActive,
      setActiveMaskColor: applyMaskColor,
      setActiveVisible: applySetActiveVisible,
      setSourceVisible,
      renameActive: applyRenameActive,
      reparentActive: applyReparent,
      setLeafLabel: applyLeafLabel,
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

  const pointerCallbacks: PointerCallbacks = {
    onSessionChange: sessionChanged,
    onProjectChange: projectChanged,
    onStatus: (text) => {
      statusLine.textContent = text;
    },
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

  const app: AppContext = { project, mirror, picker, session, playback, controls, pointer, capture, overlay };

  // 5. Flow wiring: the only place the modules meet.
  /**
   * The panel's voxelize defaults, seeded from the imported voxelize bounds: root size = largest
   * extent, uniform voxel size = `root / 96`, octree target cell size = `root / 64`, `maxDepth = 10`.
   * Before any import the root size falls back to `DEFAULT_ROOT_SIZE`, so the panel is usable with no
   * scene.
   *
   * Those bounds are the nodes that are voxelized, not the nodes that are displayed: a stylized
   * export's outline shells are drawn around the model and a little larger than it, so letting them in
   * would inflate the octree root and the default voxel size for content they do not cover. A scene of
   * nothing but outlines has no outline-free bounds and falls back to the displayed ones (README D27);
   * framing uses those displayed bounds regardless, because every node is shown.
   */
  function defaults(): VoxelizeDefaults {
    const scene = lastImport?.scene;
    const sizeBounds =
      scene === undefined ? undefined : scene.voxelizeBounds.isEmpty() ? scene.bounds : scene.voxelizeBounds;
    const octreeRootSize = sizeBounds === undefined ? DEFAULT_ROOT_SIZE : boundsRootSize(sizeBounds);
    return {
      uniformVoxelSize: octreeRootSize / VOXEL_SIZE_DIVISOR,
      targetCellSize: octreeRootSize / CELL_SIZE_DIVISOR,
      octreeMaxDepth: DEFAULT_MAX_DEPTH,
      octreeRootSize,
    };
  }

  /**
   * The target a fresh import is voxelized at: the uniform default the panel seeds itself with (README
   * D26). `/96` of the imported extent keeps a first import at a sensible cell count rather than a
   * million cells, and every later change of a voxelize control replaces this with the panel's own
   * `VoxelizeTarget` through `revoxelize`.
   */
  function importTarget(): VoxelizeTarget {
    return { kind: 'uniform', voxelSize: defaults().uniformVoxelSize };
  }

  function openImportDialog(): void {
    void pickGlbFile().then((file) => {
      if (file !== undefined) void importFile(file);
    });
  }

  /**
   * Puts one raw mesh per imported node into the mirror, on layer 2 (README D24). The mesh is handed
   * its node's own baked world matrix (README D25): the mirror places it by that matrix relative to
   * whatever its object node is, so the mesh reproduces the import exactly, before and after a payload
   * makes the object translation-only. The meshes share the imported geometry and materials, are never
   * disposed by the mirror, and stay in `sourceMeshes` so teardown can detach them.
   */
  function attachSourceMeshes(scene: ImportedScene, bySourceId: ReadonlyMap<string, ObjectId>): void {
    for (const node of scene.nodes) {
      const objectId = bySourceId.get(node.sourceId);
      if (objectId === undefined) continue;
      const mesh = new Mesh(node.geometry, node.sourceMesh.material);
      sourceMeshes.push(mesh);
      mirror.attachSourceObject(objectId, mesh, node.matrixWorld);
    }
  }

  async function importFile(file: File): Promise<void> {
    panels.clearProgress();
    statusLine.textContent = `importing ${file.name}`;
    const data = await file.arrayBuffer();
    const result = await importGlb(data);
    if (!result.ok) {
      statusLine.textContent = 'import failed';
      panels.reportError(`${result.error}: ${result.detail}`);
      return;
    }
    const adopted = adoptImportedScene(project, result.scene);
    lastImport = { scene: result.scene, objectIds: adopted.objectIds, bySourceId: adopted.bySourceId };
    attachSourceMeshes(result.scene, adopted.bySourceId);
    for (const id of adopted.objectIds) dirtyIds.add(id);
    bindingsDirty = true;
    // The imported nodes have to exist before anything can measure or name them, so sync before the
    // job: this frame shows the raw meshes on layer 2, and the payloads below replace them.
    mirror.sync();
    commitDirty();
    statusLine.textContent = `imported ${result.scene.nodes.length} node(s)`;
    // Importing is the moment the content becomes editable (README D26): the whole imported scene is
    // voxelized right here at the import default, so no click separates the import from voxels.
    await runVoxelizeJob(buildVoxelizeSources(result.scene), importTarget(), adopted.bySourceId);
  }

  /**
   * Re-voxelizes the whole retained import at the settings the panel now holds (README D26). Before any
   * import there is nothing to re-voxelize, so the request is dropped.
   */
  async function applyRevoxelize(options: { target: VoxelizeTarget }): Promise<void> {
    const retained = lastImport;
    if (retained === undefined) return;
    await runVoxelizeJob(buildVoxelizeSources(retained.scene), options.target, retained.bySourceId);
  }

  /**
   * The one voxelization job, shared by the import path and `applyRevoxelize` (README D26). It cancels
   * whatever was in flight — a superseded job must not attach its payloads — then voxelizes `sources` at
   * `target` and attaches every output to the object `bySourceId` names, so an imported placeholder
   * gains voxels instead of being duplicated. Success marks the ids dirty, refreshes the panels, and
   * re-frames the viewport; framing belongs here, after the payloads: an object that rendered as a raw
   * mesh until this call renders as voxels now, and `frameAll` syncs first, so the instance meshes
   * rebuilt for the ids just marked dirty are what it measures. Progress is written while it runs, and a
   * failure reaches the user through `reportError` with the `Result` literal and detail.
   */
  async function runVoxelizeJob(
    sources: VoxelizeSource[],
    target: VoxelizeTarget,
    bySourceId: ReadonlyMap<string, ObjectId>,
  ): Promise<void> {
    jobController?.abort();
    const controller = new AbortController();
    jobController = controller;
    panels.clearProgress();
    const result = await voxelize({
      sources,
      target,
      budget: DEFAULT_CELL_BUDGET,
      onProgress: (ratio) => {
        panels.setProgress('voxelizing', ratio);
      },
      signal: controller.signal,
    });
    if (jobController === controller) jobController = undefined;
    panels.clearProgress();
    if (!result.ok) {
      panels.reportError(`${result.error}: ${result.detail}`);
      return;
    }
    const applied = applyVoxelizeResult(project, result, { attachTo: bySourceId });
    for (const id of applied.objectIds) dirtyIds.add(id);
    bindingsDirty = true;
    commitDirty();
    mirror.frameAll(viewportCamera);
    statusLine.textContent = `voxelized ${result.stats.cells} cell(s) from ${result.stats.triangles} triangle(s)`;
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
    panels.clearProgress();
    // The gizmo is viewport feedback on camera layer 0; it must not reach an exported frame.
    controls.detachGizmo();
    // The capture renders at the requested resolution and the guide marks the same aspect.
    capture.resize(options.width, options.height);
    outputPreview.setAspect(options.width / options.height);
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
      (progress) => {
        panels.setProgress(`frame ${progress.frame}/${progress.total}`, progress.total > 0 ? progress.frame / progress.total : 0);
      },
      controller.signal,
    );
    if (jobController === controller) jobController = undefined;
    syncGizmo();
    panels.clearProgress();
    if (!result.ok) {
      panels.reportError(`${result.error}: ${result.detail}`);
      return;
    }
    saveMp4(result.blob, EXPORT_FILENAME);
    statusLine.textContent = `exported ${result.frames} frame(s) as ${result.codec}`;
  }

  /**
   * Turns the camera lock on or off. Locked, `ViewportControls` navigates the **output** camera, so
   * what the viewport shows is what an export captures, and the guide frame is redundant; unlocked,
   * navigation goes back to the app-owned viewport camera (D17). The flag is set before retargeting,
   * so the retarget's own `change` event never writes authored data on the way out of the lock.
   */
  function setCameraLock(enabled: boolean): void {
    cameraLocked = enabled;
    controls.setOrbitTarget(enabled ? mirror.camera : viewportCamera);
    outputPreview.followOutputCamera(enabled);
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
      panels.reportError(`${result.error}: ${result.detail}`);
      return;
    }
    session.setActiveObject(result.objectId);
    dirtyIds.add(result.objectId);
    bindingsDirty = true;
    commitDirty();
  }

  function applyDeleteActive(): void {
    const objectId = session.activeObjectId;
    if (objectId === null) return;
    const result = deleteObject(project, objectId);
    if (!result.ok) {
      panels.reportError(`${result.error}: ${result.detail}`);
      return;
    }
    dirtyIds.delete(objectId);
    session.setActiveObject(null);
    bindingsDirty = true;
    commitDirty();
  }

  function applyMaskColor(color: HexColor): void {
    const objectId = session.activeObjectId;
    if (objectId === null) return;
    const result = setObjectMaskColor(project, objectId, color);
    if (!result.ok) {
      panels.reportError(`${result.error}: ${result.detail}`);
      return;
    }
    dirtyIds.add(objectId);
    commitDirty();
  }

  /** Shows or hides the active object; the mirror applies `object.visible` on its next `sync()`. */
  function applySetActiveVisible(visible: boolean): void {
    const objectId = session.activeObjectId;
    if (objectId === null) return;
    const result = setObjectVisible(project, objectId, visible);
    if (!result.ok) {
      panels.reportError(`${result.error}: ${result.detail}`);
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
      panels.reportError(`${result.error}: ${result.detail}`);
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
      panels.reportError(`${result.error}: ${result.detail}`);
      return;
    }
    dirtyIds.add(objectId);
    commitDirty();
  }

  function applyLeafLabel(label: string): void {
    const selection = session.selection;
    if (selection.kind !== 'leaf') return;
    const result = setLeafLabel(project, selection.objectId, selection.leafId, label === '' ? undefined : label);
    if (!result.ok) {
      panels.reportError(`${result.error}: ${result.detail}`);
      return;
    }
    dirtyIds.add(selection.objectId);
    commitDirty();
  }

  /** Marks every id whose payload may have changed dirty, then re-reads both panels. */
  function commitDirty(): void {
    for (const id of dirtyIds) if (project.get(id) !== undefined) mirror.markDirty(id);
    dirtyIds.clear();
    refreshReadouts();
    panels.refresh();
    timelinePanel.refresh();
  }

  function sessionChanged(): void {
    if (session.activeObjectId !== null) dirtyIds.add(session.activeObjectId);
    refreshReadouts();
    syncGizmo();
    panels.refresh();
    timelinePanel.refresh();
  }

  function projectChanged(): void {
    bindingsDirty = true;
    commitDirty();
  }

  /** Recomputes the values the HUD shows from session and project state, never from the loop. */
  function refreshReadouts(): void {
    const objectId = session.activeObjectId;
    resolutionCache = objectId === null ? null : session.resolutionOf(objectId) ?? null;
    leafCache = objectId === null ? null : leafState(objectId);
  }

  function leafState(objectId: ObjectId): HudState['leaf'] {
    const selection = session.selection;
    if (selection.kind !== 'leaf' || selection.objectId !== objectId) return null;
    const octree = project.get(objectId)?.octree;
    if (octree === undefined) return null;
    const attrs = octree.getLeaf(selection.leafId);
    if (attrs === undefined) return null;
    const box = octree.leafBox(selection.leafId);
    return {
      leafId: selection.leafId,
      depth: box.depth,
      size: box.size,
      occupied: attrs.occupied,
      color: attrs.color,
    };
  }

  function syncGizmo(): void {
    const objectId = session.activeObjectId;
    const node = objectId === null ? undefined : mirror.objectOf(objectId);
    if (node !== undefined && session.activeTool === 'select') controls.attachGizmo(node, 'translate');
    else controls.detachGizmo();
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
    if (selection.kind === 'leaf') return `leaf ${selection.leafId} on ${objectName(selection.objectId)}`;
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
      leaf: leafCache,
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
  controls.onGizmoChange(() => {
    const objectId = session.activeObjectId;
    if (objectId !== null) statusLine.textContent = `moving ${objectName(objectId)}`;
  });
  controls.onGizmoCommit(() => {
    const objectId = session.activeObjectId;
    const node = objectId === null ? undefined : mirror.objectOf(objectId);
    if (objectId === null || node === undefined) return;
    node.updateMatrixWorld(true);
    const result = setTransformFromMatrix(project, objectId, node.matrixWorld);
    if (!result.ok) {
      panels.reportError(`${result.error}: ${result.detail}`);
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
    if (bindingsDirty) {
      bindingsDirty = false;
      if (!bindingsCurrent()) rebuildBindings();
    }
    controls.update();
    outputPreview.update(viewportCamera);
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
    window.removeEventListener('resize', handleResize);
    window.removeEventListener('pagehide', dispose);
    unsubscribeSession();
    app.pointer.dispose();
    app.capture.dispose();
    app.overlay.dispose();
    // Also drops the orbit-change registration: the callbacks live in the controls.
    app.controls.dispose();
    app.playback.dispose();
    app.mirror.dispose();
    // The raw meshes are the app's, and so are their geometry and materials (the imported scene's):
    // teardown only takes them out of the scene graph the mirror just released.
    for (const mesh of sourceMeshes) mesh.removeFromParent();
    outputPreview.dispose();
    renderer.dispose();
  }

  window.addEventListener('pagehide', dispose);
  rebuildBindings();
  frameHandle = requestAnimationFrame(frame);
}

main();
