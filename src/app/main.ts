/**
 * The composition root: the only file allowed to import every module. It creates the project and
 * every long-lived object, wires the import -> voxelize -> edit -> animate -> export flow, and runs
 * the render loop; it owns no algorithm, only calls into inner rings.
 */

import { Matrix4, Mesh, PerspectiveCamera, Quaternion, Vector3, WebGLRenderer } from 'three';
import type { Box3, Object3D } from 'three';
import { Project } from '../document/project.js';
import {
  DEFAULT_FOV,
  activeTake,
  addTake,
  moveKey,
  removeKey,
  removeTake,
  resolveCameraAt,
  segmentAt,
  setActiveTake,
  setSegmentLensParams,
  setSegmentProjection,
  splitSegment,
  takeById,
  upsertKey,
  type ProjectionKind,
  type ResolvedCamera,
} from '../document/camera.js';
import type { ObjectId, ProjectData } from '../document/project.js';
import { readJson, toJson } from '../document/serialize.js';
import { animatedChannels, overwriteKeyframesAt, type TrackTarget } from '../document/timeline.js';
import { EditorSession } from '../editor/session.js';
import type { EditResolution } from '../editor/session.js';
import {
  applyVoxelizeResult,
  createGroup,
  createPrimitive,
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
import { EditHistory } from '../editor/history.js';
import type { PrimitiveKind, PrimitiveSpec } from '../voxels/uniform/generator.js';
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
import type { GizmoMode } from '../three-runtime/controls.js';
import { Capture } from '../three-runtime/capture.js';
import { Overlay } from '../three-runtime/overlay.js';
import { WorldGrid } from '../three-runtime/grid.js';
import { CameraControl } from '../three-runtime/cameraControl.js';
import { CameraPath } from '../three-runtime/cameraPath.js';
import { cameraKeyframePositions, sampleCameraTrajectory } from '../animation/trajectory.js';
import { Playback } from '../animation/playback.js';
import { ExportJob } from '../export/job.js';
import type { ExportResult } from '../export/job.js';
import { Panels } from '../ui/panels.js';
import type { CameraPose, PanelContext } from '../ui/panels.js';
import { DEFAULT_VOXELS_ACROSS, VoxelizeDialog } from '../ui/voxelizeDialog.js';
import type { VoxelizeDialogDefaults } from '../ui/voxelizeDialog.js';
import { TimelinePanel } from '../ui/timeline.js';
import type { TimelineContext } from '../ui/timeline.js';
import { Hud } from '../ui/hud.js';
import { ModeBar } from '../ui/modeBar.js';
import type { HudState } from '../ui/hud.js';
import { el } from '../ui/dom.js';
import { pickGlbFile, pickProjectFile, saveJson, saveMp4, wireDropTarget } from './files.js';

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
  cameraControl: CameraControl;
  cameraPath: CameraPath;
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
/**
 * Where the viewport camera is aimed before its first fit, in world units: from the front-right and above. A camera
 * looks along its own `-Z`, which in this Z-up world is straight down, so an unaimed viewport would open on a
 * top-down view of the ground. Only the direction matters: `frameAll` keeps the direction it is handed and moves the
 * camera to fit.
 */
const DEFAULT_VIEW_OFFSET = new Vector3(6, -8, 5);
/** The world's up axis, as the value every camera's frame is aimed with. */
const WORLD_UP = new Vector3(0, 0, 1);
/**
 * The demo project's opening shot, in world units: the camera stands on the far side of the demo content and aims at
 * it, so the shot is a real one and the carrier the viewport draws points at what it frames. A document's own camera
 * starts at the identity transform, which in this Z-up world is a camera at the origin looking straight down its `-Z`.
 */
const OPENING_SHOT_POSITION = new Vector3(-5, 6, 4);
const OPENING_SHOT_TARGET = new Vector3(0, 0, 2);
/** Initial capture size; every export resizes the capture to what the panel asked for. */
const DEFAULT_EXPORT_WIDTH = 1280;
const DEFAULT_EXPORT_HEIGHT = 720;
const EXPORT_FILENAME = 'vox-world.mp4';
/** The project file's default name: one JSON document holding the whole truth. */
const PROJECT_FILENAME = 'vox-world-project.json';
/** The carrier pivots about its own origin, which is the camera position. */
const CAMERA_CONTROL_PIVOT = new Vector3(0, 0, 0);
/**
 * An object's gizmo draws both handle sets at once, so rotation is a handle on the object rather than a mode
 * to find: the mode button belongs to the camera carrier alone, whose gizmo takes one set.
 */
const OBJECT_GIZMO_MODES: readonly GizmoMode[] = ['translate', 'rotate'];
/** Clip length before the author edits it, in the authoring unit: milliseconds. */
const DEFAULT_DURATION_MS = 10_000;
const DEFAULT_FPS = 30;
/** The dialog's extent seed before any import. */
/**
 * The extent the dialog seeds from when there is no import to measure: one default model's worth, in
 * voxels. One voxel is one world unit, so an extent and a voxel count are the same kind of
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

/** The canvas' layout aspect: it drives the viewport camera, and the output camera while a clip plays. */
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
        // The world's up axis is z, so the lid the top colour marks is the highest z, not the highest y.
        grid.set(x, y, z, z === DEMO_CELLS - 1 ? DEMO_TOP_COLOR : DEMO_COLOR);
      }
    }
  }
  return grid;
}

/** Width x height x depth and the cell count of an inclusive integer box, for the HUD's selection readout. */
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
  /** The session's undo stack: it holds edits, never the camera or the timeline (see `editor/history.ts`). */
  const history = new EditHistory(project);
  // The seed a created landscape grows from. One constant, so the same shape comes out every time and a different
  // landscape is a deliberate change here rather than a surprise in the panel.
  const CREATE_TERRAIN_SEED = 1;
  project.setDuration(DEFAULT_DURATION_MS);
  project.timeline.fps = DEFAULT_FPS;
  // The boot content. It is created before the session exists, so the session has to be told about it once it does
  // (step 6): a boot with no active object has no gizmo, no editable field, and no object track to key.
  const demoCube = project.createVoxelObject({
    name: 'Demo cube',
    maskColor: project.nextMaskColor(),
    payload: { kind: 'uniform', grid: buildDemoGrid() },
    // The world's ground is the xy plane, so the cube stands off the origin with its base at z = 0.
    position: new Vector3(-2, -2, 0),
  });
  // The demo's opening shot, written as the first key of the project's one shot: a camera that stands off the content
  // and aims at it, so the shot is a real one and the carrier the viewport draws points at what it frames. A project's
  // own camera starts at the identity transform, which in this Z-up world is a camera at the origin looking straight
  // down its `-Z`, and the model's own default is what the boot replaces here.
  const openingTake = activeTake(project.camera);
  const openingSegment = openingTake?.segments[0];
  if (openingTake !== undefined && openingSegment !== undefined) {
    upsertKey(project.camera, openingTake.id, openingSegment.id, {
      timeMs: 0,
      position: OPENING_SHOT_POSITION,
      quaternion: new Quaternion().setFromRotationMatrix(
        new Matrix4().lookAt(OPENING_SHOT_POSITION, OPENING_SHOT_TARGET, WORLD_UP),
      ),
      lens: DEFAULT_FOV,
    });
  }

  // 2. Viewport: renderer, mirror and its output camera, navigation, decorations, capture.
  const viewportCamera = new PerspectiveCamera(VIEWPORT_FOV, 1, VIEWPORT_NEAR, VIEWPORT_FAR);
  // The world's up axis is z and three's camera default is y, and `OrbitControls` snapshots `object.up` into its
  // orbit axis in its constructor — so this has to be set before `ViewportControls` builds them, or the viewport
  // would orbit about the wrong axis and every later `lookAt` would roll the frame a quarter turn.
  viewportCamera.up.copy(WORLD_UP);
  // The view the app opens on, aimed once here: `frameAll` preserves the direction it is handed, so an unaimed
  // camera would fit the ground from directly above — a camera looks along its own `-Z`, and that is this world's down.
  viewportCamera.position.copy(DEFAULT_VIEW_OFFSET);
  viewportCamera.lookAt(0, 0, 0);
  // The overlay and the gizmo live on camera layer 1 and the imported raw meshes on layer 2
  // so the viewport camera draws both while the raycaster tests layers 0
  // and 2 and the export camera — and the `Capture` that renders through it — stays on layer 0 alone.
  viewportCamera.layers.enable(1);
  viewportCamera.layers.enable(2);
  // The logarithmic depth buffer is what keeps a scene of any size drawable: an imported file is metres
  // per unit as authored, which for a centimetre-authored model is a scene kilometres across, and a linear
  // depth buffer with the near plane at 1e-4 spends its whole precision in the first metres — surfaces far
  // away then fight each other. It costs the depth test's early-out, which nothing here needs.
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
  // The camera carrier: a runtime-only handle on the output camera that the edit gizmo can move, so a shot can be
  // aimed from third person instead of by flying the viewport. It is decoration like the grid, so it
  // lives on layer 1 and no export frame contains it.
  const cameraControl = new CameraControl(mirror.scene);
  // The camera path: the trajectory of the authored camera, drawn as a polyline with one ring per keyframe.
  const cameraPath = new CameraPath(mirror.scene);
  const capture = new Capture({ width: DEFAULT_EXPORT_WIDTH, height: DEFAULT_EXPORT_HEIGHT });
  mirror.sync();
  mirror.frameAll(viewportCamera);

  // 3. Editor and animation objects.
  const session = new EditorSession(project);
  const picker = new Picker(mirror);
  const playback = new Playback();

  const dirtyIds = new Set<ObjectId>();
  /** The nodes the mixer was last bound to, by object id: a rebuilt node makes this stale, an id set alone cannot. */
  let boundNodes: ReadonlyMap<ObjectId, Object3D> = new Map<ObjectId, Object3D>();
  /**
   * A pose a gesture put on screen that no keyframe holds yet: the world matrix to keep on one object's mirrored node
   * until the playhead moves or a run starts, and `undefined` when the clip speaks for every object again. It is
   * runtime state — no document, no export frame, no file — and it exists because the mixer samples the clip on every
   * frame, whether or not a run is going, so an unkeyed pose would be off screen one frame after the pointer let go.
   */
  let poseOverride: { objectId: ObjectId; matrix: Matrix4 } | undefined;
  let bindingsDirty = true;
  let resolutionCache: EditResolution | null = null;
  /** The mirror node the gizmo is attached to, so a rebuilt replacement is noticed (see `syncGizmo`). */
  let gizmoNode: Object3D | undefined;
  /** Whether the timeline bar is on screen. It starts collapsed; the rail's `Animation` button is how it is shown. */
  let timelineVisible = false;
  /** Whether the camera carrier is selected: while it is, the gizmo drives the output camera instead of an object. */
  let cameraControlSelected = false;
  /**
   * The carrier's own gizmo mode, flipped by the `Camera` group's button; an object does not need one, because
   * its gizmo draws the arrows and the rings together (`OBJECT_GIZMO_MODES`).
   */
  let cameraGizmoMode: GizmoMode = 'translate';
  /** Whether the camera path is drawn. A track with fewer than two keyframes has no path, so this is cleared then. */
  let cameraPathVisible = false;
  /**
   * The take an export renders. `undefined` means "follow the preview take", which is the default until the `Render`
   * group's select is used; an explicit id is cleared when its take is deleted and on a project load, so the app never
   * holds a stale choice — and if one ever reached an export, the job would report it rather than substitute a plan.
   */
  let exportTakeId: string | undefined;
  /** The viewport state a run started from, so a pause can hand the view on and the end of a run can undo it. */
  let playbackView: { position: Vector3; quaternion: Quaternion; target: Vector3; time: number } | undefined;
  let lastImport: ImportedAssets | undefined;
  let jobController: AbortController | undefined;
  /** The raw meshes on layer 2, one per imported node: app-owned, kept for teardown. */
  const sourceMeshes: Mesh[] = [];

  // 4. UI over the actions of step 5; `pickImportFile` stays in app/. The voxelize settings live in the
  // dialog alone, so it is the fourth UI element, mounted like the panels into `panelsRoot`.
  const voxelizeDialog = new VoxelizeDialog(panelsRoot, () => defaults());

  const panelContext: PanelContext = {
    project,
    session,
    sceneVisible: () => mirror.sourceVisible,
    gridVisible: () => worldGrid.visible,
    timelineVisible: () => timelineVisible,
    // The carrier's controls are a view of the app's own flags and of the authored camera, never of the carrier
    // node: what the fields show is what a keyframe would record.
    cameraControl: () => {
      const shot = currentShot();
      return {
        selected: cameraControlSelected,
        mode: cameraGizmoMode,
        playing: playback.playing,
        pathVisible: cameraPathVisible,
        pathAvailable: cameraKeyframePositions(project).length >= 2,
        pose: {
          position: [shot.position.x, shot.position.y, shot.position.z],
          quaternion: [shot.quaternion.x, shot.quaternion.y, shot.quaternion.z, shot.quaternion.w],
          fov: shot.lens,
        },
        projection: shot.projection,
        near: shot.near,
        far: shot.far,
      };
    },
    // The `Render` group's export take: its own app state, defaulting to the preview take, so an export can render a
    // plan the editor is not looking at.
    exportCamera: () => ({
      takes: project.camera.takes.map((take) => ({ id: take.id, name: take.name })),
      // Two states, not one: `undefined` is "follow the preview take", which the select shows as an option of its own,
      // so `takeId` is `''` while it does — and `previewTakeName` is the take that option names.
      takeId: exportTakeId ?? '',
      previewTakeName: activeTake(project.camera)?.name ?? '',
    }),
    historyState: () => ({ canUndo: history.canUndo, canRedo: history.canRedo }),
    actions: {
      undo: () => applyHistoryStep('undo'),
      redo: () => applyHistoryStep('redo'),
      pickImportFile: openImportDialog,
      saveProject,
      openProject: openProjectDialog,
      exportMp4: runExport,
      createGroup: applyCreateGroup,
      createPrimitive: applyCreatePrimitive,
      deleteObject: applyDeleteObject,
      detachSelection: applyDetachSelection,
      setActiveMaskColor: applyMaskColor,
      setActiveVisible: applySetActiveVisible,
      setActiveAlignToGrid: applySetActiveAlignToGrid,
      setActiveSubdivision: applySetActiveSubdivision,
      setSourceVisible,
      setGridVisible,
      setTimelineVisible,
      renameActive: applyRenameActive,
      reparentActive: applyReparent,
      setCameraFov,
      setExportCamera: applySetExportCamera,
      setCameraProjection: applySetCameraProjection,
      setCameraLensParams: applySetCameraLensParams,
      setCameraPose,
      toggleCameraControl,
      toggleGizmoMode,
      cameraToView,
      viewToCamera,
      setCameraPathVisible,
    },
  };
  const timelineContext: TimelineContext = {
    project,
    playback,
    session,
    // The widget seeks in milliseconds, the authoring unit; the mixer's clip is seconds.
    onTransport: togglePlayback,
    onScrub: (timeMs) => {
      playback.pause();
      playback.setTime(timeMs / 1000);
      // The playhead moved: every object goes back to the clip's own value at the new time.
      clearPoseOverride();
    },
    onEdited: () => {
      playback.rebuild(project);
      // A keyframe edit is what changes the camera's trajectory, so the path is redrawn here.
      refreshCameraPath();
      // A keyframe the author just added or moved is the clip's to show now, not a held pose's.
      clearPoseOverride();
    },
    setDuration: applyDuration,
    // The bar's target select is the only place a take is switched or its structure changed, and every one of those is
    // the app's: a take switch re-reads the preview, and a key that moved or went changes the shot the playhead
    // resolves, not the clip. Each refuses while a run is in flight.
    setActiveTake: applySetActiveTake,
    copyTake: applyCopyTake,
    deleteTake: applyRemoveTake,
    cutAtPlayhead: applyCutAtPlayhead,
    moveCameraKey,
    removeCameraKey,
  };

  const panels = new Panels(panelsRoot, panelContext);
  const timelinePanel = new TimelinePanel(timelineRoot, timelineContext);
  // The markup carries `hidden` so the bar cannot flash while the bundle loads; this is what makes the app's flag
  // and that attribute agree from the first frame.
  timelinePanel.setVisible(timelineVisible);
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
    getCamera: () => viewportCamera,
    getGizmoBusy: () => controls.gizmoBusy(),
    history,
    callbacks: pointerCallbacks,
  });

  const app: AppContext = {
    project,
    mirror,
    picker,
    session,
    playback,
    controls,
    pointer,
    capture,
    overlay,
    worldGrid,
    cameraControl,
    cameraPath,
  };

  // 5. Flow wiring: the only place the modules meet.
  /**
   * The dialog's seed, derived from the retained import's voxelize bounds: their per-axis extent, which the
   * count is read against to print the model's dimensions. Before any import the extent
   * falls back to `DEFAULT_EXTENT`, so the dialog is usable with no scene.
   *
   * Those bounds are the nodes that are voxelized, not the nodes that are displayed: a stylized
   * export's outline shells are drawn around the model and a little larger than it, so letting them in
   * would inflate that extent for content they do not cover. A scene of
   * nothing but outlines has no outline-free bounds and falls back to the displayed ones;
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
   * Puts one raw mesh per imported node into the mirror, on layer 2, all of them under the
   * import's single object. The mesh is handed its node's own baked world matrix: the mirror
   * places it by that matrix relative to the object node, so the mesh reproduces the import exactly,
   * before and after a payload makes the object translation-only. That is what lets one object stand for
   * a whole file: the model's placement lives in the mesh matrices, not in the object's transform. The
   * meshes share the imported geometry and materials, are never disposed by the mirror, and stay in
   * `sourceMeshes` so teardown can detach them.
   *
   * `meshes` is filled on the first call for a scene and reused afterwards: confirming the dialog rescales
   * the import to the model's voxel count and the same meshes are re-placed by their new node
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
    // One voxel is one world unit, so the model is scaled onto the lattice before anything
    // sees it: the dialog's count then says how long it is, and both the raw meshes and the payload the
    // job later attaches are placed in the same unit.
    const scene = scaleImportedScene(result.scene, DEFAULT_VOXELS_ACROSS);
    const adopted = adoptImportedScene(project, scene);
    const meshes: Mesh[] = [];
    lastImport = { scene, objectId: adopted.objectId, meshes };
    attachSourceMeshes(scene, adopted.objectId, meshes);
    dirtyIds.add(adopted.objectId);
    // The object has to exist and its bounds have to be measurable before the settings can be asked in
    // context, so the view is fitted here, on the raw meshes: `frameAll` syncs, creates the node,
    // and measures layers 0 and 2. Nothing has voxelized it yet, so it is still `'empty'`.
    mirror.frameAll(viewportCamera);
    commitDirty();
    // The resolution is a per-model decision made when the model arrives, so the settings
    // dialog comes last: confirming voxelizes this import, cancelling leaves it as the raw model the
    // user is looking at.
    await promptVoxelize(scene, adopted.objectId);
  }

  /**
   * Asks for the voxelization settings of one retained import and runs the shared job when
   * the user confirms. The dialog is the only place the count exists, so nothing is derived here: a confirm
   * scales the import to that count — the model's length in voxels — re-places its raw meshes so they stay
   * glued to the content the job voxelizes, and runs the shared job on the scaled source;
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
   * The one voxelization job, run for the import a confirmed settings dialog was about. It
   * cancels whatever was in flight — a superseded job must not attach its payloads — then voxelizes the
   * source of one import at `target` and attaches its payload to `objectId`, the object
   * `adoptImportedScene` created for that import, through an `attachTo` map built from the source's own
   * id: that is the key every output carries, so the imported object gains the voxels instead of being
   * duplicated next to them. An import with nothing to voxelize — every node an outline shell — has no
   * source and stops after the abort, because there is nothing to attach. Success marks the id dirty,
   * refreshes the panels, and re-frames the viewport; framing belongs here, after the payload: an object
   * that rendered as raw meshes until this call renders as voxels now, and `frameAll` syncs first, so
   * the instance meshes rebuilt for the id just marked dirty are what it measures. Nothing is written while
   * it runs, and a failure reaches `reportFailure` with the `Result` literal and detail.
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
    const applied = recorded(() =>
    applyVoxelizeResult(project, result, {
      attachTo: new Map([[source.sourceId, objectId]]),
    }),
  );
    for (const id of applied.objectIds) dirtyIds.add(id);
    commitDirty();
    mirror.frameAll(viewportCamera);
  }

  /** Writes the whole project — objects, cells, camera, settings, timeline — to one JSON download. */
  function saveProject(): void {
    saveJson(toJson(project), PROJECT_FILENAME);
  }

  /** The rail's `Open project` button: the file dialog, then the same load a dropped file goes through. */
  function openProjectDialog(): void {
    void pickProjectFile().then((file) => {
      if (file !== undefined) void openProject(file);
    });
  }

  /**
   * Reads a project file and loads it. Nothing is written until the file has passed every check, so a
   * refused file leaves the editor exactly as it was.
   */
  async function openProject(file: File): Promise<void> {
    const result = readJson(await file.text());
    if (!result.ok) {
      reportFailure(result);
      return;
    }
    loadProject(result.data);
  }

  /**
   * Loads validated project data in place. The project instance, the mirror, the mixer, and the
   * session all survive, so this is where the state the replaced project left behind has to be reset: the job, the
   * transport, the view, the raw-mesh layer, the gizmo, the selection, and finally the derived state
   * that no `sync()` writes.
   */
  function loadProject(data: ProjectData): void {
    // The state a gesture left on screen belongs to the project being replaced.
    clearPoseOverride();
    // 1. Nothing may be in flight: a superseded job must not attach its payloads to the new project, and a
    //    run's saved view belongs to the project that started it.
    jobController?.abort();
    jobController = undefined;
    playback.pause();
    playbackView = undefined;
    // 2. The view: the carrier and the camera path are views of the project being replaced, so both are released.
    //    Navigation needs no reset of its own: the viewport renders through the output camera only while a run
    //    is playing, and the transport is paused above.
    cameraControlSelected = false;
    cameraPathVisible = false;
    // The export take is a view of the project being replaced, so it falls back to the loaded active take.
    exportTakeId = undefined;
    // 3. The raw-mesh layer goes. A source is recorded under an object id, so the records have to be dropped
    //    before ids are reused: the mirror's own pass would otherwise re-parent the replaced import's meshes
    //    under a loaded object. The meshes themselves are the app's, and it detaches them.
    for (const mesh of sourceMeshes) mesh.removeFromParent();
    sourceMeshes.length = 0;
    lastImport = undefined;
    mirror.clearSources();
    mirror.setSourceVisible(false);
    // 4. The session, before the objects: its setters validate against the project, so it must not see the
    //    load half-applied. This also drops the selection and leaves the edit mode.
    session.setActiveObject(null);
    // 5. The truth, and the two things `sync()` never publishes: the scene's settings and the output camera.
    project.restore(data);
    // A loaded document has no past: its own edits start from here.
    history.reset();
    mirror.applySettings();
    // 6. Every loaded object is rebuilt. `sync()` keeps the node of an id it already has, and a load normally
    //    reuses ids, so without a dirty mark the replaced project's geometry would stay on screen.
    for (const id of project.objects.keys()) dirtyIds.add(id);
    commitDirty();
    // 7. `frameAll` syncs, so the rebuild happens here rather than on the next frame: the rebinding below has
    //    to see the nodes the load just made.
    mirror.frameAll(viewportCamera);
    // 8. The mixer is still bound to the nodes step 6 released, and the frame loop's own check — node identity — would
    //    only notice on its next pass; a load publishes the rebinding here, before anything is drawn.
    rebuildBindings();
    playback.setTime(0);
    mirror.applyShot(0);
    // 9. The views of the loaded project.
    refreshCameraPath();
    refreshReadouts();
    panels.refresh();
    timelinePanel.refresh();
  }

  /**
   * Reports a failed `Result`. The panel has no message area any more, so the console is the only
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
    // The export renders the mirror's own scene, so a pose held on screen would reach the frames: an export shows the
    // clip, and an unkeyed pose is not part of it.
    clearPoseOverride();
    // The gizmo is viewport feedback on camera layer 0; it must not reach an exported frame.
    controls.detachGizmo();
    // The capture renders at the requested resolution; nothing in the viewport marks it.
    capture.resize(options.width, options.height);
    const job = new ExportJob({ mirror });
    // The `Render` group's take, defaulting to the preview take: an export renders the plan it was asked for, which may
    // not be the one on screen. An explicit stale choice is passed through rather than substituted — the job reports it
    // — while `undefined` leaves the job on the active take.
    const takeId = exportTakeId ?? activeTake(project.camera)?.id;
    let result: ExportResult;
    try {
      result = await job.run(
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
          ...(takeId === undefined ? {} : { takeId }),
        },
        controller.signal,
      );
    } finally {
      // The job's slot is released on every exit path, and the gizmo comes back with it: this is what keeps one
      // failed or stalled export from leaving the button refusing to start another for the rest of the session.
      if (jobController === controller) jobController = undefined;
      syncGizmo();
    }
    if (!result.ok) {
      reportFailure(result);
      return;
    }
    saveMp4(result.blob, EXPORT_FILENAME);
  }

  /**
   * Writes the clip's length through the document, which drags the camera's coverage with it — a take's segments tile the
   * clip, so its first and last ends move — and then rebuilds what reads the clip: the mixer at the same playhead, and the
   * shot, the path, the panel and the bar's camera rows through `refreshShotViews`.
   */
  function applyDuration(durationMs: number): void {
    project.setDuration(durationMs);
    playback.rebuild(project);
    // The keys were retimed onto the new length, so a pose held from the old one is stale.
    clearPoseOverride();
    playback.setTime(playback.time);
    refreshShotViews();
  }

  /**
   * The shot the camera holds at the playhead: what the carrier draws, what the panel's fields show, and what a key
   * holds. It always resolves — a take never has an empty segment chain — so a state that does not resolve is a broken
   * project rather than an expected case.
   */
  function currentShot(): ResolvedCamera {
    const state = resolveCameraAt(project.camera, playback.time * 1000);
    if (state === undefined) throw new Error('camera: the project holds no take to resolve');
    return state;
  }

  /**
   * The one camera write: a key at the playhead, in the segment the playhead is in, holding the state it is given.
   * Every camera gesture ends here — a carrier drag, the pose fields, the lens field, `Camera -> View` — which is what
   * makes a take's state at any time exactly the sum of its keys. A running clip refuses the write, because the clip
   * owns the playhead and the camera for the length of a run.
   */
  function writeShot(state: { position: Vector3; quaternion: Quaternion; lens: number }): void {
    if (playback.playing) return;
    const shot = shotTarget();
    if (shot === undefined) return;
    const result = upsertKey(project.camera, shot.takeId, shot.segmentId, { timeMs: playback.time * 1000, ...state });
    if (!result.ok) {
      reportFailure(result);
      return;
    }
    refreshShotViews();
  }

  /** The take and the segment the playhead is in: the shot every camera gesture edits. */
  function shotTarget(): { takeId: string; segmentId: string } | undefined {
    const take = activeTake(project.camera);
    const segment = take === undefined ? undefined : segmentAt(take, playback.time * 1000);
    return take === undefined || segment === undefined ? undefined : { takeId: take.id, segmentId: segment.id };
  }

  /**
   * After anything that reshapes the shot: the frame, the drawn path, the fields, and the timeline bar's camera rows all
   * read the camera, so they are re-read together. The output camera takes the new state at once, so a gesture is visible
   * as it lands rather than a frame later, and the bar is what says which keys that gesture left behind.
   */
  function refreshShotViews(): void {
    mirror.applyShot(playback.time * 1000);
    refreshCameraPath();
    panels.refresh();
    timelinePanel.refresh();
  }

  /**
   * Switches the take the timeline bar shows and the clip previews — the bar's camera target *is* the preview/editor
   * take. A run owns the shot for its length, so the switch is refused while one is in flight; the bar leaves its target
   * where it was. Returns whether the switch took effect.
   */
  function applySetActiveTake(takeId: string): boolean {
    if (playback.playing) return false;
    if (!setActiveTake(project.camera, takeId)) return false;
    refreshShotViews();
    return true;
  }

  /**
   * Copies the take the bar shows and switches to the copy — the point of takes: a different shooting plan is made by
   * editing a copy, and going back is a switch rather than an undo chain. Refused while a run owns the shot.
   */
  function applyCopyTake(): void {
    if (playback.playing) return;
    const source = activeTake(project.camera);
    const copy = addTake(project.camera, {
      ...(source === undefined ? {} : { source }),
      durationMs: project.timeline.durationMs,
    });
    setActiveTake(project.camera, copy.id);
    refreshShotViews();
  }

  /**
   * Deletes the take the bar shows. The model refuses the last one, and a run refuses the delete; the button mirrors
   * both. An explicit export choice of that take is cleared, so the export falls back to the preview take rather than
   * holding an id that names nothing.
   */
  function applyRemoveTake(): void {
    if (playback.playing) return;
    const take = activeTake(project.camera);
    if (take === undefined || !removeTake(project.camera, take.id)) return;
    if (exportTakeId === take.id) exportTakeId = undefined;
    refreshShotViews();
  }

  /** The `Render` group's export-camera select: an id that names a take is stored, anything else returns to the preview. */
  function applySetExportCamera(takeId: string): void {
    exportTakeId = takeById(project.camera, takeId) === undefined ? undefined : takeId;
    panels.refresh();
  }

  /**
   * Retimes one camera key of one segment, from the timeline bar's own row — the only place a key's own time can be
   * typed. The clip does not change with it (the camera is no track), so nothing is rebuilt; what does change is the
   * shot the playhead resolves, which `refreshShotViews` re-reads. The model clamps the time into the segment and
   * refuses one that already holds a key, so a refused move leaves the camera exactly as it was.
   */
  function moveCameraKey(takeId: string, segmentId: string, keyId: string, timeMs: number): void {
    if (playback.playing) return;
    if (!Number.isFinite(timeMs)) return;
    if (moveKey(project.camera, takeId, segmentId, keyId, timeMs)) refreshShotViews();
  }

  /** Removes one camera key. The model refuses the last key of a segment, which is why that row's button is disabled. */
  function removeCameraKey(takeId: string, segmentId: string, keyId: string): void {
    if (playback.playing) return;
    if (removeKey(project.camera, takeId, segmentId, keyId)) refreshShotViews();
  }

  /**
   * Cuts at the playhead: the shot is split in two, and the later half holds its own state from that instant — which is
   * an exact cut until the author moves it, and a seamless split if they never do. Refused while a run owns the shot,
   * because the playhead it would cut at is the run's.
   */
  function applyCutAtPlayhead(): void {
    if (playback.playing) return;
    const take = activeTake(project.camera);
    if (take === undefined) return;
    const result = splitSegment(project.camera, take.id, playback.time * 1000, project.timeline.durationMs);
    if (!result.ok) {
      reportFailure(result);
      return;
    }
    refreshShotViews();
  }

  /**
   * Switches the shot's projection. The lens scalar is reinterpreted rather than converted, so the number stands and
   * the author sets it for the new kind; the clip planes are the shot's own and are kept.
   */
  function applySetCameraProjection(projection: ProjectionKind): void {
    if (playback.playing) return;
    const shot = shotTarget();
    if (shot === undefined) return;
    const result = setSegmentProjection(project.camera, shot.takeId, shot.segmentId, projection);
    if (!result.ok) {
      reportFailure(result);
      return;
    }
    refreshShotViews();
  }

  /** Writes the shot's clip planes, which the model refuses unless they are a usable pair. */
  function applySetCameraLensParams(params: { near: number; far: number }): void {
    if (playback.playing) return;
    const shot = shotTarget();
    if (shot === undefined) return;
    const result = setSegmentLensParams(project.camera, shot.takeId, shot.segmentId, params);
    if (!result.ok) {
      reportFailure(result);
      refreshShotViews();
    }
  }

  /**
   * Writes the lens of the shot the author is on. It is a key at the playhead like every other camera write, because
   * in a take the state at a time *is* a key: the field, a drag, and `Camera -> View` all end in the same write.
   */
  function setCameraFov(fov: number): void {
    if (!Number.isFinite(fov)) return;
    const shot = currentShot();
    writeShot({ position: shot.position, quaternion: shot.quaternion, lens: Math.min(179, Math.max(1, fov)) });
  }

  /**
   * The rail's `Animation` toggle. The flag is the app's, so the panel is told what to show rather than asked, and
   * the bar keeps whatever it holds while it is hidden: the render loop goes on writing the playhead into it.
   *
   * Hiding or showing the bar changes the size of the canvas it sits above; the observer on the bar is what refits
   * the drawing buffer for that, so this writes the flag and the view and nothing else.
   */
  function setTimelineVisible(visible: boolean): void {
    timelineVisible = visible;
    timelinePanel.setVisible(visible);
  }

  /**
   * Writes a world matrix into the shot the author is on, which is what a drag on the carrier commits. The lens is
   * kept, because a drag moves the camera and does not change what it sees through.
   */
  function applyCameraMatrix(matrix: Matrix4): void {
    const shot = currentShot();
    const position = new Vector3();
    const quaternion = new Quaternion();
    matrix.decompose(position, quaternion, new Vector3());
    quaternion.normalize();
    writeShot({ position, quaternion, lens: shot.lens });
    // The viewport is deliberately left where it is: the carrier exists so a shot can be aimed from the third person,
    // which a view that followed every drag would make impossible — and a commit that moved nothing would still move
    // the view. `View -> Camera` is the one explicit way to look through the shot.
  }

  /**
   * Writes the carrier's numeric grid into the shot the author is on. The fields are the same state a drag produces,
   * so both paths end in the same write, and a refused field leaves the shot exactly as it was.
   */
  function setCameraPose(pose: CameraPose): void {
    const [qx, qy, qz, qw] = pose.quaternion;
    const numbers = [...pose.position, qx, qy, qz, qw, pose.fov];
    if (numbers.some((value) => !Number.isFinite(value))) return;
    // A zero quaternion is not a rotation, so it is refused before anything is written.
    const lengthSq = qx * qx + qy * qy + qz * qz + qw * qw;
    if (lengthSq < 1e-12) return;
    const normalize = 1 / Math.sqrt(lengthSq);
    writeShot({
      position: new Vector3(pose.position[0], pose.position[1], pose.position[2]),
      quaternion: new Quaternion(qx * normalize, qy * normalize, qz * normalize, qw * normalize),
      lens: pose.fov,
    });
    // The viewport is left alone for the same reason a drag leaves it alone: the pose fields edit the shot, and the
    // view is only ever moved by an explicit command.
  }

  /**
   * Selects or deselects the carrier. Selecting it takes the gizmo from the active object; deselecting it gives the
   * gizmo back, which `syncGizmo` resolves from the session alone.
   */
  /**
   * Redraws the camera path from the authored camera track, and clears the toggle when there is no path to draw.
   * Fewer than two position keyframes is not a path, so the panel disables the box and this clears the flag, which
   * is what a shorter track leaves behind.
   */
  function refreshCameraPath(): void {
    const markers = cameraKeyframePositions(project);
    if (markers.length < 2) cameraPathVisible = false;
    cameraPath.setTrajectory(sampleCameraTrajectory(project));
    cameraPath.setMarkers(markers);
    cameraPath.setVisible(cameraPathVisible);
    panels.refresh();
  }

  /** The `Show camera path` toggle: a view switch, so it redraws the path and writes nothing else. */
  function setCameraPathVisible(visible: boolean): void {
    cameraPathVisible = visible;
    refreshCameraPath();
  }

  /**
   * Starts a run: the viewport state is captured first, so whatever the run does to the view can be undone.
   */
  function startPlayback(): void {
    if (playback.playing) return;
    playbackView = {
      position: viewportCamera.position.clone(),
      quaternion: viewportCamera.quaternion.clone(),
      target: controls.orbit.target.clone(),
      time: playback.time,
    };
    playback.play();
    panels.refresh();
    // The bar's camera rows and take commands are gated on `playing`, so a run's start has to reach it too.
    timelinePanel.refresh();
  }

  /**
   * Pauses a run. Handing the view over is what makes a paused frame editable: the editor camera takes the pose the clip
   * stopped at, so the shot can be judged from there and flown on without the clip pulling it back — the authored data
   * is untouched either way.
   */
  function pausePlayback(): void {
    if (!playback.playing) return;
    playback.pause();
    controls.setViewFrom(mirror.camera.position, mirror.camera.quaternion);
    panels.refresh();
    timelinePanel.refresh();
  }

  /**
   * Ends a run: a non-looping clip that reached its last frame stops the transport, and the viewport goes back to
   * the state the run started from.
   */
  function finishPlayback(): void {
    const restore = playbackView;
    playbackView = undefined;
    playback.pause();
    if (restore !== undefined) {
      // The playhead goes back as well, so the frame on screen is the one the run started from.
      playback.setTime(restore.time);
      controls.setViewFrom(restore.position, restore.quaternion, restore.target);
    }
    panels.refresh();
    timelinePanel.refresh();
  }

  /** The transport toggle: the only entry point, so every run is saved and every pause can hand the view over. */
  function togglePlayback(): void {
    // A run owns every object's pose, and a pause hands the frame back to the clip: either way the hold is over.
    clearPoseOverride();
    if (playback.playing) pausePlayback();
    else startPlayback();
  }

  function toggleCameraControl(): void {
    cameraControlSelected = !cameraControlSelected;
    syncGizmo();
    panels.refresh();
  }

  /** Flips the carrier's handle set between moving and rotating the output camera. */
  function toggleGizmoMode(): void {
    cameraGizmoMode = cameraGizmoMode === 'translate' ? 'rotate' : 'translate';
    syncGizmo();
    panels.refresh();
  }

  /**
   * Captures the editor's current view as the authored camera pose, which is what a camera keyframe records: the
   * viewport is what the author aims with: a key takes the view, it does not read a stale document pose. The authored
   * `fov` is left alone, because the shot's field of view is its own value and not the viewport's. Skipped while a
   * clip runs: the view is not what the author is aiming then, and the clip owns the output camera's pose for the
   * length of the run.
   */
  function captureViewAsCamera(): void {
    if (playback.playing) return;
    const shot = currentShot();
    writeShot({ position: viewportCamera.position, quaternion: viewportCamera.quaternion, lens: shot.lens });
  }

  /**
   * `Camera -> View`: the authored camera adopts the editor's current view, which is how a shot is started without
   * aiming the carrier from scratch. It selects the carrier, because aiming it is what the user came here to do.
   */
  function cameraToView(): void {
    captureViewAsCamera();
    refreshCameraPath();
    cameraControlSelected = true;
    syncGizmo();
    panels.refresh();
  }

  /**
   * `View -> Camera`: the editor moves to the authored shot so it can be judged against the scene. It writes
   * nothing, which is what makes it a safe way to look at what a render would frame.
   */
  function viewToCamera(): void {
    const shot = currentShot();
    controls.setViewFrom(shot.position, shot.quaternion);
  }

  /**
   * Runs one document write as a single history step: the state before it, the write itself, and what the history
   * made of the difference. Wrapping the operation rather than the button is what lets a refusal record nothing
   * without a check of its own — an operation that wrote nothing leaves no difference to keep.
   */
  function recorded<T>(run: () => T): T {
    const capture = history.begin();
    const result = run();
    history.commit(capture);
    return result;
  }

  /**
   * Creates one primitive as its own object on the unit lattice, in the editing colour: the spec is built from the
   * panel's numbers — a box and a corner take the size on every axis, a sphere takes it as a radius, a landscape as its
   * footprint — and the whole thing is one history step, so an unwanted shape is one undo away.
   */
  function applyCreatePrimitive(options: { kind: PrimitiveKind; size: number; height: number; hollow: boolean }): void {
    const size = options.size;
    const spec: PrimitiveSpec =
      options.kind === 'sphere'
        ? { kind: 'sphere', radius: size }
        : options.kind === 'terrain'
          ? { kind: 'terrain', footprint: [size, size], height: options.height, seed: CREATE_TERRAIN_SEED }
          : options.kind === 'isometric'
            ? { kind: 'isometric', size: [size, size, size] }
            : { kind: 'box', size: [size, size, size], hollow: options.hollow };
    const result = recorded(() => createPrimitive(project, spec, session.editColor));
    if (!result.ok) {
      reportFailure(result);
      return;
    }
    if (result.objectId !== undefined) {
      session.setActiveObject(result.objectId);
      dirtyIds.add(result.objectId);
    }
    commitDirty();
  }

  function applyCreateGroup(): void {
    const result = recorded(() => createGroup(project, 'Group'));
    if (!result.ok) {
      reportFailure(result);
      return;
    }
    session.setActiveObject(result.objectId);
    dirtyIds.add(result.objectId);
    commitDirty();
  }

  /** Deletes one object by id: the row's trash button names it, so the active object need not be it. */
  function applyDeleteObject(objectId: ObjectId): void {
    const result = recorded(() => deleteObject(project, objectId));
    if (!result.ok) {
      reportFailure(result);
      return;
    }
    dirtyIds.delete(objectId);
    if (session.activeObjectId === objectId) session.setActiveObject(null);
    commitDirty();
  }

  function applyMaskColor(color: HexColor): void {
    const objectId = session.activeObjectId;
    if (objectId === null) return;
    const result = recorded(() => setObjectMaskColor(project, objectId, color));
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
   * rebuilt.
   */
  function applyDetachSelection(): void {
    pointer.detachSelection();
  }

  /** Shows or hides the active object; the mirror applies `object.visible` on its next `sync()`. */
  function applySetActiveVisible(visible: boolean): void {
    const objectId = session.activeObjectId;
    if (objectId === null) return;
    const result = recorded(() => setObjectVisible(project, objectId, visible));
    if (!result.ok) {
      reportFailure(result);
      return;
    }
    dirtyIds.add(objectId);
    commitDirty();
  }

  /**
   * Raises the active object's subdivision through the op: the payload is replaced by block replication, so the
   * object moves nowhere and only its cells get smaller.
   */
  function applySetActiveSubdivision(subdivision: number): void {
    const objectId = session.activeObjectId;
    if (objectId === null) return;
    const result = recorded(() => setObjectSubdivision(project, objectId, subdivision));
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
    const result = recorded(() => setObjectAlignToGrid(project, objectId, alignToGrid));
    if (!result.ok) {
      reportFailure(result);
      return;
    }
    dirtyIds.add(objectId);
    commitDirty();
  }

  /**
   * Shows or hides every imported raw mesh at once. The mirror owns the flag — the panel's
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
    const result = recorded(() => renameObject(project, objectId, name));
    if (!result.ok) {
      reportFailure(result);
      return;
    }
    dirtyIds.add(objectId);
    commitDirty();
  }

  /**
   * Puts the document one step back or forward. Only the objects the step touched are rebuilt, and a step that took
   * the active object away unsets it — the session names a live object or none at all — while a selection that named
   * the same object is cleared for the same reason.
   */
  function applyHistoryStep(direction: 'undo' | 'redo'): void {
    const touched = direction === 'undo' ? history.undo() : history.redo();
    if (touched === null) return;
    // A step rewrites the transforms a gesture left behind, so a held pose would hide what the history just restored.
    clearPoseOverride();
    for (const id of touched) {
      if (project.get(id) === undefined) dirtyIds.delete(id);
      else dirtyIds.add(id);
    }
    const active = session.activeObjectId;
    if (active !== null && project.get(active) === undefined) session.setActiveObject(null);
    const selection = session.selection;
    if (selection.kind === 'region' && project.get(selection.objectId) === undefined) {
      session.setSelection({ kind: 'none' });
    }
    commitDirty();
  }

  function applyReparent(parentId: ObjectId | null): void {
    const objectId = session.activeObjectId;
    if (objectId === null) return;
    const result = recorded(() => reparentObject(project, objectId, parentId));
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
    // The commit is what replaces the marked objects' nodes on the next `sync()`, so the mixer's binding may be about
    // to go stale — and this is the one funnel every dirty mark passes through, which is why the flag is written here
    // rather than beside the `dirtyIds.add` of each caller.
    bindingsDirty = true;
    refreshReadouts();
    panels.refresh();
    timelinePanel.refresh();
  }

  /**
   * The other half of a transform commit: the pose the gesture wrote either reaches the timeline or is held on screen.
   *
   * First, the keyframes the object already holds at the playhead take that pose, in place — an author who seeked to a
   * keyframe and dragged the object edits *that* key. Nothing is created: a time holding no keyframe is still the
   * author's to key with `add`.
   *
   * Then, whatever the gesture did *not* key is held. The mixer samples the clip on every frame, running or not, so a
   * channel the clip animates would be overwritten one frame after the pointer let go and the drag would leave nothing
   * on screen — the author could not even see where the object landed. The committed world matrix is kept instead and
   * put back on the node every frame, until the playhead or the transport moves on (`clearPoseOverride`). An object no
   * track animates is already safe and holds nothing.
   *
   * Nothing happens while a clip runs: the playhead is the mixer's there, and the transform a gesture reports is read
   * off the node the clip is driving rather than being an authored pose.
   */
  function keyOrHoldPose(objectId: ObjectId): void {
    if (playback.playing) return;
    const object = project.get(objectId);
    if (object === undefined) return;
    const target: TrackTarget = { kind: 'object', objectId };
    // The pose is read from the document *after* the commit, through the same `keyframePosition` rule `add` uses, so an
    // aligned object's keys stay on its lattice and a held pose is exactly what a keyed `add` would have stored. All
    // three channels are offered, not just the gesture's own: a rotate about the content center moves the origin too.
    const position = project.keyframePosition(target, object.transform.position);
    const { quaternion, scale } = object.transform;
    const written = overwriteKeyframesAt(project.timeline, target, playback.time * 1000, {
      position: [position.x, position.y, position.z],
      quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
      scale: [scale.x, scale.y, scale.z],
    });
    // The clip is derived from the timeline: a rewritten keyframe reaches the mixer only through a rebuild, which keeps
    // the playhead and re-resolves the action's bindings with it.
    if (written.length > 0) playback.rebuild(project);
    const unkeyed = animatedChannels(project.timeline, target).some(
      (channel) => !written.includes(channel),
    );
    poseOverride = unkeyed ? { objectId, matrix: project.worldMatrix(objectId) } : undefined;
  }

  /**
   * Puts a held pose back on the mirror, after the mixer's own write for this frame: the clip is sampled whether or not
   * a run is going, so this is what keeps a gesture on screen while it is unkeyed. Drag previews feed the same slot
   * through `onGizmoChange`, which is why a drag inside a track is visible before the pointer is released at all.
   */
  function applyPoseOverride(): void {
    const held = poseOverride;
    if (held === undefined) return;
    // A hold on an object that no longer exists — a load, a deletion — is dropped rather than written nowhere.
    if (project.get(held.objectId) === undefined) {
      poseOverride = undefined;
      return;
    }
    mirror.previewTransform(held.objectId, held.matrix);
  }

  /** Drops the held pose: the playhead, the transport, the selection, or the clip is about to speak again. */
  function clearPoseOverride(): void {
    poseOverride = undefined;
  }

  function sessionChanged(): void {
    if (session.activeObjectId !== null) dirtyIds.add(session.activeObjectId);
    // The hold belongs to the object it was made on, so it ends when the session stops naming that object. The session
    // notifies on every assignment, including one that re-selects the object already active — which is what a press on
    // the object itself does — so the comparison is what keeps a plain click from throwing a held pose away.
    if (poseOverride !== undefined && poseOverride.objectId !== session.activeObjectId) clearPoseOverride();
    refreshReadouts();
    syncGizmo();
    modeBar.refresh();
    panels.refresh();
    timelinePanel.refresh();
  }

  /** Grid group: whether the world grid is drawn. */
  function setGridVisible(visible: boolean): void {
    worldGrid.setVisible(visible);
    panels.refresh();
  }

  /** The objects an operation rewrote: they are the ones whose derived geometry is rebuilt. */
  function projectChanged(ids: readonly ObjectId[]): void {
    for (const id of ids) dirtyIds.add(id);
    commitDirty();
  }

  /** Recomputes the values the HUD shows from session and project state, never from the loop. */
  function refreshReadouts(): void {
    const objectId = session.activeObjectId;
    resolutionCache = objectId === null ? null : session.resolutionOf(objectId) ?? null;
  }

  /**
   * The node the gizmo belongs on right now: the active object's, while object mode is active, and none at all
   * in edit mode or with an empty selection.
   *
   * A rebuild replaces that node (`mirror.rebuild` releases the old one), so the identity is compared
   * against the attached one on every frame and a replacement is what re-attaches the gizmo.
   */
  function gizmoNodeNow(): Object3D | undefined {
    if (cameraControlSelected) return cameraControl.node;
    const objectId = session.activeObjectId;
    if (objectId === null || session.mode !== 'object') return undefined;
    return mirror.objectOf(objectId);
  }

  /**
   * Puts the gizmo on the active object, pivoting at the center of its content so the handles sit on what
   * the user edits rather than at the node origin, which is the payload's min corner (`contentCenterOf`).
   * Called on every session change and whenever the node under the gizmo was replaced.
   */
  function syncGizmo(): void {
    // The outline is object mode's affordance for the same choice the gizmo makes: it marks the object the gizmo is on,
    // and it is cleared in edit mode and while the carrier holds the gizmo.
    mirror.setSelected(session.mode === 'object' && !cameraControlSelected ? session.activeObjectId : null);
    const node = gizmoNodeNow();
    const objectId = session.activeObjectId;
    if (node === undefined) {
      controls.detachGizmo();
      gizmoNode = undefined;
      return;
    }
    // The carrier pivots about its own origin, which is the camera position; an object pivots about the center of
    // its content, so the handles sit on what the user edits.
    const pivot = cameraControlSelected || objectId === null ? CAMERA_CONTROL_PIVOT : mirror.contentCenterOf(objectId);
    // The carrier takes one set — the mode its `Camera` group button flips — while an object takes both, so an
    // object rotates from a handle and never from a mode that a panel elsewhere would have to be found to set.
    controls.attachGizmo(node, cameraControlSelected ? [cameraGizmoMode] : OBJECT_GIZMO_MODES, pivot);
    gizmoNode = node;
  }

  /** Binds the mixer to the mirrored nodes of every current object. */
  function rebuildBindings(): void {
    const bound = new Map<ObjectId, Object3D>();
    for (const id of project.objects.keys()) {
      const node = mirror.objectOf(id);
      if (node !== undefined) bound.set(id, node);
    }
    boundNodes = bound;
    bindingsDirty = false;
    // `Playback.bind` resolves its mixer root from the first bound node, so an empty scene keeps
    // the current binding instead of clearing it.
    if (bound.size === 0) return;
    const time = playback.time;
    playback.bind(bound);
    playback.rebuild(project);
    playback.setTime(time);
  }

  /**
   * Whether the mixer is still bound to the nodes the mirror holds. Identity, not membership: a rebuild replaces an
   * object's node while its id stays, so comparing id sets would leave the mixer writing into a node that is no longer
   * in the scene — the object would freeze at whatever pose that dead node held until something else recompiled the
   * clip. `Playback.bind` and the action it installs resolve their bindings against the root by name, which is why
   * rebinding is what makes the replaced node animate again.
   */
  function bindingsCurrent(): boolean {
    if (boundNodes.size !== project.objects.size) return false;
    for (const id of project.objects.keys()) {
      if (boundNodes.get(id) !== mirror.objectOf(id)) return false;
    }
    return true;
  }

  function objectName(objectId: ObjectId): string {
    return project.get(objectId)?.name ?? objectId;
  }

  /** Reads the session selection as text: the HUD shows this verbatim. */
  function selectionText(): string {
    const selection = session.selection;
    if (selection.kind !== 'region') return 'none';
    const shape = selection.shape;
    const what =
      shape.kind === 'box'
        ? boxText(shape)
        : shape.kind === 'color'
          ? `color #${shape.color.toString(16).padStart(6, '0')}`
          : `island at ${shape.seed.join(', ')}`;
    return `${what} on ${objectName(selection.objectId)}`;
  }

  function hudState(): HudState {
    const objectId = session.activeObjectId;
    const object = objectId === null ? undefined : project.get(objectId);
    return {
      activeObjectName: object?.name ?? null,
      representation: object?.representation ?? null,
      editResolution: resolutionCache,
      selectionText: selectionText(),
      unkeyedPose:
        poseOverride === undefined
          ? null
          : `${objectName(poseOverride.objectId)} @ ${Math.round(playback.time * 1000)} ms`,
      frame: Math.round(playback.time * project.timeline.fps),
      fps: project.timeline.fps,
    };
  }

  // 6. Gizmo, camera, session, drop target, resize, and the render loop.
  /**
   * Live drag feedback: the object follows the pointer through the mirror, not the document, so a gesture
   * that is abandoned or cancelled has written nothing. The document write happens once, on commit.
   */
  controls.onGizmoChange((matrix) => {
    if (cameraControlSelected) {
      // The carrier is the node the gizmo derives from, so the preview is that node's own transform: the drawing
      // follows the pointer, and the document is written once on release like every other drag.
      matrix.decompose(cameraControl.node.position, cameraControl.node.quaternion, cameraControl.node.scale);
      return;
    }
    const objectId = session.activeObjectId;
    // The preview takes the same aligned matrix the commit will, so a drag steps the object from cell to
    // cell and the release writes the pose already on screen.
    if (objectId !== null) {
      const aligned = project.alignWorldMatrix(objectId, matrix);
      mirror.previewTransform(objectId, aligned);
      // The same slot the commit fills: the mixer samples the clip every frame, so a preview that were not held would
      // be off screen again before the next pointermove — this is what makes a drag inside a track follow the pointer.
      poseOverride = playback.playing ? undefined : { objectId, matrix: aligned.clone() };
    }
  });
  controls.onGizmoCommit((matrix) => {
    if (cameraControlSelected) {
      applyCameraMatrix(matrix);
      return;
    }
    const objectId = session.activeObjectId;
    if (objectId === null || project.get(objectId) === undefined) return;
    // The world matrix the gizmo derived, not the node's own: the gizmo moves a pivot proxy and never the
    // node, and the object's live transform is discarded by the rebuild this write triggers.
    const result = recorded(() => setTransformFromWorldMatrix(project, objectId, matrix));
    if (!result.ok) {
      reportFailure(result);
      return;
    }
    // The document now holds the pose the gesture asked for; a keyframe sitting at the playhead takes it too, and
    // whatever the clip would overwrite is held on screen instead — dragging an object off a keyframe now shows.
    keyOrHoldPose(objectId);
    dirtyIds.add(objectId);
    commitDirty();
  });

  const unsubscribeSession = session.subscribe(sessionChanged);
  // The boot content starts active. It is created in step 1, before the session could name it, so without this a fresh
  // boot has no active object at all: nothing to edit, no gizmo, no fields, and no object track the timeline's `add`
  // could write — while the object list still shows the cube, which is what makes the omission look like a bug rather
  // than a state. Selecting it here rather than at creation puts the boot through the same session change every later
  // selection goes through, so the readouts, the gizmo, the panels and the bar are all told in one place.
  session.setActiveObject(demoCube.id);
  const detachDrop = wireDropTarget(viewport, ['.glb', '.json'], (file) => {
    // One drop target, two meanings; the composition root is the only place that knows which is which.
    if (file.name.toLowerCase().endsWith('.json')) void openProject(file);
    else void importFile(file);
  });

  function handleResize(): void {
    resizeViewport(renderer, viewport, viewportCamera);
  }
  window.addEventListener('resize', handleResize);
  /**
   * Undo and redo on the keyboard: Ctrl/Cmd+Z back, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y forward. This is the only key
   * handling the file owns; the transport and the text fields keep their own.
   */
  function handleHistoryKey(event: KeyboardEvent): void {
    if (!event.ctrlKey && !event.metaKey) return;
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      applyHistoryStep('undo');
      return;
    }
    if (key === 'y' || (key === 'z' && event.shiftKey)) {
      event.preventDefault();
      applyHistoryStep('redo');
    }
  }
  window.addEventListener('keydown', handleHistoryKey);
  // Anything that moves the boundary between the canvas and the timeline bar changes how much of the column the
  // canvas has — the bar's visibility, a keyframe row, its message line — and three's `setSize` never touches the
  // canvas' style, so the drawing buffer has to be refitted whenever that happens or the buffer and the box
  // disagree and the view is stretched. Observing the bar is what makes that automatic.
  const barObserver = new ResizeObserver(() => handleResize());
  barObserver.observe(timelineRoot);

  let frameHandle = 0;
  let lastTime = performance.now();

  function frame(now: number): void {
    frameHandle = requestAnimationFrame(frame);
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    playback.advance(dt);
    // A non-looping run is over at the last frame, which is where the transport stops and the view goes back.
    if (
      playback.playing &&
      !playback.loop &&
      playback.duration > 0 &&
      playback.time >= playback.duration - 1e-6
    ) {
      finishPlayback();
    }
    mirror.sync();
    // The mixer has already written this frame's clip value, and a rebuild above may have written the document's: a pose
    // a gesture left on screen goes back on top of both, which is what keeps an unkeyed drag where the author put it.
    applyPoseOverride();
    // A dirty object is rebuilt as a new node, which releases the one an attached gizmo drives; comparing
    // identities is what re-attaches it, and it has to happen after `sync()` because that is what replaces
    // the node. Nothing else moves the gizmo: `syncGizmo` on a session change covers the rest.
    if (gizmoNode !== gizmoNodeNow()) syncGizmo();
    if (bindingsDirty) {
      bindingsDirty = false;
      // The same replacement releases the node the mixer is bound to, and `bindingsCurrent()` compares node identity —
      // so a commit that rebuilt anything rebinds here, and `rebuildBindings` re-samples the playhead, which is why the
      // object never draws a frame at the document's own transform instead of the clip's.
      if (!bindingsCurrent()) rebuildBindings();
    }
    controls.update();
    // The shot reaches the frame here, once per drawn frame, and stands back while a drag owns the pose: the carrier
    // and any preview render through the same camera, and neither can show a state the document does not hold.
    if (!controls.gizmoBusy()) mirror.applyShot(playback.time * 1000);
    // While a clip runs the viewport *is* the shot, which is what makes a camera animation visible at all: the loop
    // renders through the output camera and hands navigation nothing but the editor camera, so nothing can re-aim the
    // pose the mixer just applied — the failure the removed camera lock had, where `OrbitControls.update()` ended with
    // `object.lookAt(target)` on the very camera the clip owned.
    const previewing = playback.playing;
    const renderCamera = previewing ? mirror.camera : viewportCamera;
    if (previewing) {
      // The preview camera draws the viewport too, so it needs the canvas' aspect: an export sets its own aspect for
      // its frames, and a resize would otherwise leave the preview stretched.
      const aspect = canvasAspect(viewport);
      if (renderCamera.aspect !== aspect) {
        renderCamera.aspect = aspect;
        renderCamera.updateProjectionMatrix();
      }
    }
    // The carrier reports the output camera as it stands right now — the authored pose, or the sampled one while a
    // clip runs — in one colour or the other, so the author can always see where that camera is. A drag
    // owns the pose until it commits, so the per-frame update stands back for it.
    cameraControl.setSelected(cameraControlSelected);
    // A camera cannot see itself: the carrier and the outline are viewport decoration, and the preview draws the shot.
    cameraControl.setVisible(!previewing);
    if (!(cameraControlSelected && controls.gizmoBusy())) {
      cameraControl.setPose(mirror.camera, canvasAspect(viewport));
    }
    // The path's marker size comes from how far the drawing camera is, floored at the distance navigation orbits from: a
    // viewport that sits *on* the carrier — which is exactly what `View -> Camera` produces — would otherwise shrink the
    // rings to a dot, and the orbit radius is the scene's own scale. The carrier needs none of this: its size is a fixed
    // world size, so it scales with the scene rather than with the view.
    const viewingDistance = Math.max(
      viewportCamera.position.distanceTo(cameraControl.node.position),
      controls.orbit.object.position.distanceTo(controls.orbit.target),
    );
    // The grid follows the camera that draws the viewport.
    worldGrid.update(renderCamera);
    cameraPath.setScreenScale(viewingDistance);
    renderer.render(mirror.scene, renderCamera);
    // The outline goes over the finished frame in a pass of its own, so the selected object alone cuts it.
    // It is viewport decoration like the carrier, so the shot never contains it.
    if (!previewing) mirror.renderSelectionOutline(renderer, renderCamera);
    timelinePanel.setTime(playback.time * 1000);
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
    barObserver.disconnect();
    window.removeEventListener('pagehide', dispose);
    unsubscribeSession();
    app.pointer.dispose();
    app.capture.dispose();
    app.overlay.dispose();
    app.worldGrid.dispose();
    app.cameraControl.dispose();
    app.cameraPath.dispose();
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
  refreshCameraPath();
  frameHandle = requestAnimationFrame(frame);
}

main();
