/**
 * The scene mirror.
 *
 * Exactly one `Object3D` per document object plus the output camera, plus the derived
 * `InstancedMesh` geometry that renders uniform cells. It owns every derived render resource and the
 * instance-to-cell reverse map, and it owns no project data, no renderer, no DOM, and never the
 * viewport camera.
 *
 * The mirror is also the single `AnimationMixer` root of the application, which is why every mirrored
 * node is named with its `ObjectId` and the output camera is named `camera` (README D22).
 *
 * It also parents the app's imported raw meshes under their objects' nodes on layer 2, next to the
 * voxels of the same object: they are the raw half of the raw-versus-voxel comparison, and each is
 * placed by its own baked node matrix so it stays where the import put it (README D24, D25). The app
 * owns those meshes and the mirror never disposes them.
 */

import type { ObjectId, Project, SceneObject } from '../document/project.js';
import type { HexColor } from '../voxels/uniform/grid.js';
import * as THREE from 'three';
import { Outlines } from '@pmndrs/vanilla/core/Outlines';
import { applyFaceBorder } from './faceGrid.js';

/** The imported-source-mesh layer (README D24); `picking.ts` enables it on its raycaster too. */
const SOURCE_LAYER = 2;
/**
 * The selection outline's own layer (README D24, D50): the hull and the depth-only copy of the selected object's
 * instances that cuts it to a rim live here, apart from the layer-1 decorations, because the outline is drawn in a pass
 * of its own that must contain nothing else. A pick's raycaster and the export camera never test it, so an outline
 * cannot change what a click or an export sees either.
 */
const OUTLINE_LAYER = 3;
/** The selected object's outline: yellow, which nothing else in the scene uses. */
const SELECTION_COLOR = 0xffd400;
/**
 * How far the outline's hull is pushed out along each face, as a share of the object's own cell. A share rather than a
 * world size keeps the line proportional at every subdivision, and it is small on purpose: the rim reads as a drawn edge
 * at roughly one pixel per cell on screen, which is what a selection affordance wants.
 */
const OUTLINE_SHARE = 0.025;
/** Drawn after the content it wraps and below the 1000 the box preview and the camera path draw at. */
const OUTLINE_RENDER_ORDER = 1;
/** The mirror's face-shading light: separates cube faces without overwhelming the ambient term. */
const DIRECTIONAL_INTENSITY = 0.5;
const FRAME_MARGIN = 1.1;
const MIN_NEAR = 1e-4;

/**
 * The layers the mirror's content lives on — voxel instances (0) and imported raw meshes (2), the two
 * halves of the comparison — and therefore the layers `frameAll` measures. Layer 1 is viewport
 * feedback (`controls.ts` and `overlay.ts`), which is never picked, exported, or measured (README D24).
 */
const CONTENT_LAYERS = new THREE.Layers();
CONTENT_LAYERS.set(0);
CONTENT_LAYERS.enable(SOURCE_LAYER);

export type CellLookup = {
  objectId: ObjectId;
  cells: [number, number, number][];
  colors: HexColor[];
};

/** One derived instanced mesh and the state `setMaskMode` has to stash and restore. */
type VoxelMesh = {
  mesh: THREE.InstancedMesh;
  instanceColor: THREE.InstancedBufferAttribute | null;
  maskMaterial: THREE.MeshBasicMaterial | null;
};

/** The derived node of one document object plus its lookup and its voxel meshes. */
type MirrorEntry = {
  node: THREE.Object3D;
  meshes: VoxelMesh[];
  lookup: CellLookup | undefined;
  /**
   * The selected object's outline, present for a `uniform` object and absent for a transform-only one: the library's
   * inverted hull over this node's own instances, hidden until `setSelected` names this object. It is a child of the
   * node, so it follows the object's transform without any per-frame work.
   */
  outline: THREE.Group | undefined;
  /**
   * The depth the outline is cut against, present exactly when `outline` is: the object's own instances drawn with
   * `colorWrite: false`, so the outline's pass sees this object's silhouette and nothing else (README D50). It shares
   * the mesh's `instanceMatrix` — the same instances, not a copy — and is shown and hidden with `outline`.
   */
  outlineDepth: THREE.InstancedMesh | undefined;
};

/**
 * One imported raw mesh and the baked matrix of the node it came from (README D24, D25). The matrix is
 * that mesh's own anchor: `applySources` places the mesh by it, so it stays exactly where the import put
 * it however the object's own transform changes.
 *
 * It is per mesh, not per object: one object holds every mesh of one import (README D28), and those nodes
 * sit at different places, so a single matrix shared by the object's meshes would stack them all on the
 * last attached node's pose.
 */
type SourceRecord = {
  mesh: THREE.Object3D;
  nodeMatrix: THREE.Matrix4;
};

type UniformPayload = NonNullable<SceneObject['uniform']>;

export class SceneMirror {
  readonly scene: THREE.Scene;
  /** The **output** camera: derived from `project.camera`, used for export and for FOV tracks. */
  readonly camera: THREE.PerspectiveCamera;

  private readonly project: Project;
  private readonly shadingMaterial: THREE.MeshLambertMaterial;
  /** The outline pass's depth-only material, one instance shared by every object's silhouette copy (README D50). */
  private readonly outlineDepthMaterial: THREE.MeshBasicMaterial;
  private readonly entries = new Map<ObjectId, MirrorEntry>();
  private readonly dirty = new Set<ObjectId>();
  private maskMode = false;
  /** The object whose outline is drawn: the app's object-mode selection, kept so a rebuild re-shows it (README D39). */
  private selectedId: ObjectId | null = null;
  /**
   * The raw meshes the app attached, per object, each with the baked node matrix it is placed by. The
   * mirror parents and shows them but never disposes them: they belong to the app, which drops them at
   * teardown (README D24, D25).
   */
  private readonly sources = new Map<ObjectId, SourceRecord[]>();
  /** The global raw-mesh override; off, a source mesh shows only while its object has no payload. */
  private sourceVisibility = false;
  /** Scratch for `applySources`: one placement at a time, never held across a call. */
  private readonly sourcePlacement = new THREE.Matrix4();
  /** The scene's one ambient light, held so `applySettings` can rewrite the project's ambient term. */
  private readonly ambientLight: THREE.AmbientLight;

  constructor(project: Project, opts?: { background?: HexColor; ambientIntensity?: number }) {
    this.project = project;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(opts?.background ?? project.settings.background);
    this.ambientLight = new THREE.AmbientLight(
      0xffffff,
      opts?.ambientIntensity ?? project.settings.ambientIntensity,
    );
    this.scene.add(this.ambientLight);

    const sun = new THREE.DirectionalLight(0xffffff, DIRECTIONAL_INTENSITY);
    sun.position.set(4, 8, 6);
    this.scene.add(sun);

    // The one material every voxel instance shares, carrying the per-face border on top of its shading (README D35):
    // the mask pass swaps in a material of its own, so the border never reaches an identity frame (README D11).
    this.shadingMaterial = new THREE.MeshLambertMaterial();
    applyFaceBorder(this.shadingMaterial);

    // No colour at all and no transparent tricks: this exists to leave depth, which is what cuts the hull to a rim.
    this.outlineDepthMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true });

    const settings = project.camera;
    this.camera = new THREE.PerspectiveCamera(settings.fov, 1, settings.near, settings.far);
    this.camera.name = 'camera';
    this.camera.position.copy(settings.transform.position);
    this.camera.quaternion.copy(settings.transform.quaternion);
    this.camera.scale.copy(settings.transform.scale);
    this.scene.add(this.camera);
  }

  /**
   * Reconciles the mirror with the project: membership, hierarchy, the objects marked dirty, and the
   * raw meshes the app attached (README D4, D22, D24). A clean object keeps its node, its meshes and
   * its lookup identity, and its transform is never rewritten, so a mixer-driven transform is not
   * clobbered and the output camera — which the timeline owns — is never touched at all.
   */
  sync(): void {
    const project = this.project;

    // 1. Membership: every live object gets an entry, every entry that left the project is released.
    const touched = new Set<ObjectId>();
    for (const [id, object] of project.objects) {
      if (this.entries.has(id)) continue;
      this.rebuild(id, object);
      touched.add(id);
    }
    for (const [id, entry] of this.entries) {
      if (project.objects.has(id)) continue;
      this.releaseEntry(entry);
      this.entries.delete(id);
      this.dirty.delete(id);
      touched.delete(id);
    }

    // 2. Rebuild only what a caller marked dirty (README D4).
    for (const id of this.dirty) {
      const object = project.objects.get(id);
      if (object === undefined) continue;
      this.rebuild(id, object);
      touched.add(id);
    }
    this.dirty.clear();

    // 3. Hierarchy comes from `parentId`. This reattaches a node whose parent node was just replaced,
    //    and a reparented one. Visibility is rendering state, not a mixer channel, so it is applied to
    //    every node; no transform of a clean object is written.
    for (const [id, entry] of this.entries) {
      const object = project.objects.get(id);
      if (object === undefined) continue;
      const parent = object.parentId === null ? undefined : this.entries.get(object.parentId)?.node;
      const expectedParent = parent === undefined ? this.scene : parent;
      if (entry.node.parent !== expectedParent) expectedParent.add(entry.node);
      entry.node.visible = object.visible;
    }

    // 4. Source meshes (README D24, D25): every raw mesh the app attached is parented under its
    //    object's node, placed by its baked node matrix, and shown exactly when the override is on or
    //    the object has no payload yet. A request made before its node existed lands here, and a
    //    rebuilt node adopts the meshes of the node it replaced instead of duplicating them.
    for (const id of this.sources.keys()) this.applySources(id);

    // 5. Transform, for the objects this call rebuilt only, so a mixer-driven transform survives.
    for (const id of touched) {
      const object = project.objects.get(id);
      const entry = this.entries.get(id);
      if (object === undefined || entry === undefined) continue;
      entry.node.position.copy(object.transform.position);
      entry.node.quaternion.copy(object.transform.quaternion);
      entry.node.scale.copy(object.transform.scale);
    }
  }

  /** Marks one object's derived meshes for the next `sync()`. */
  markDirty(id: ObjectId): void {
    if (!this.project.objects.has(id)) {
      throw new TypeError(`SceneMirror.markDirty: ${id} is not a project object`);
    }
    this.dirty.add(id);
  }

  objectOf(id: ObjectId): THREE.Object3D | undefined {
    return this.entries.get(id)?.node;
  }

  /**
   * Puts one object's mirrored node on this world matrix without touching the document: the live half of a
   * gizmo drag, so the object follows the pointer instead of jumping when the gesture is released.
   *
   * The node's transform is local, so the parent's world matrix is divided out first (`worldMatrix`), the
   * same conversion the commit to the document performs. A clean object's transform is never rewritten by
   * `sync()` (README D22), which is why this write stands until the caller commits: the rebuild that commit
   * triggers then re-derives the node from the document, which by then holds the same matrix.
   */
  previewTransform(id: ObjectId, matrixWorld: THREE.Matrix4): void {
    const entry = this.entries.get(id);
    const object = this.project.objects.get(id);
    if (entry === undefined || object === undefined) return;
    const local = object.parentId === null
      ? matrixWorld
      : this.project.worldMatrix(object.parentId).invert().multiply(matrixWorld);
    local.decompose(entry.node.position, entry.node.quaternion, entry.node.scale);
  }

  /**
   * The local-space center of one object's own content: the mid-point of the occupied cells' bounding box
   * for a `uniform` object, and the origin for anything else — an `'empty'` placeholder, or a payload with
   * no occupied cell, neither of which has content of its own to sit in the middle of. A cell is
   * `CELL_SIZE / subdivision` world units (README D41, D43), so the center is the mid-point of the box's two
   * outer faces.
   *
   * Derived, never a document value: the document's transform keeps meaning "the world position of the
   * object's local (0, 0, 0)", which after a voxelization is the payload's min corner (README D25). This is
   * where the edit gizmo pivots (README D37), so its handles sit on the content instead of at that corner.
   * A raw source mesh never moves the center: it is display-only and stays on the pose the import put it on
   * however the object's own transform changes (README D25).
   */
  contentCenterOf(id: ObjectId): THREE.Vector3 {
    const center = new THREE.Vector3();
    const grid = this.project.objects.get(id)?.uniform;
    if (grid === undefined) return center;
    const bounds = grid.bounds();
    if (bounds === null) return center;
    // Cell `i` spans `[i, i + 1]` cells and one cell is `cellSize` world units, so the center is half a cell
    // past the average of the box's min and max.
    const half = grid.cellSize / 2;
    return center.set(
      (bounds.min[0] + bounds.max[0] + 1) * half,
      (bounds.min[1] + bounds.max[1] + 1) * half,
      (bounds.min[2] + bounds.max[2] + 1) * half,
    );
  }

  /**
   * The instance -> cell reverse map of one object, filled from document data by the rebuild that
   * created the instances. A material swap, `setMaskMode`, or a stale `instanceId` can therefore never
   * change what picking reports.
   */
  lookupOf(id: ObjectId): CellLookup | undefined {
    return this.entries.get(id)?.lookup;
  }

  /**
   * Draws the selected object's outline over the frame the caller has already rendered, and returns whether it drew.
   *
   * The outline has to be cut by the selected object's own silhouette and by nothing else (README D50). In the main pass
   * the whole scene shares one depth buffer, so anything standing in front of the rim — a neighbour touching the object,
   * or any geometry between the camera and it — clips the rim away. The pass therefore keeps the colour, clears the
   * depth, and renders `OUTLINE_LAYER` alone, where the object's own depth copy and its hull are the only things that
   * exist: the hull is then cut by that object and by nothing else, and stands over everything in front of it. The
   * camera's layers, the auto-clear flag, and the scene's background are all restored before it returns.
   */
  renderSelectionOutline(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera): boolean {
    const outline = this.selectedId === null ? undefined : this.entries.get(this.selectedId)?.outline;
    if (outline === undefined || !outline.visible) return false;
    const layers = camera.layers.mask;
    const autoClear = renderer.autoClear;
    const background = this.scene.background;
    // A `Color` background forces a full clear even with `autoClear` off, which would wipe the frame this draws over.
    this.scene.background = null;
    camera.layers.set(OUTLINE_LAYER);
    renderer.autoClear = false;
    try {
      renderer.clearDepth();
      renderer.render(this.scene, camera);
    } finally {
      renderer.autoClear = autoClear;
      camera.layers.mask = layers;
      this.scene.background = background;
    }
    return true;
  }

  /**
   * Marks one object as the selected one: its outline is drawn and every other object's is hidden.
   *
   * The outline says which object the edit gizmo is on, so it belongs to object mode: the app clears it in edit mode
   * and while the camera carrier holds the gizmo (`app/main.ts`, README D39, D46). The id is remembered, not only
   * applied, because a rebuild replaces a node and its outline together (README D4) — a payload edit would otherwise
   * drop the outline the user is looking at.
   */
  setSelected(id: ObjectId | null): void {
    this.selectedId = id;
    for (const [objectId, entry] of this.entries) {
      const selected = objectId === id;
      if (entry.outline !== undefined) entry.outline.visible = selected;
      if (entry.outlineDepth !== undefined) entry.outlineDepth.visible = selected;
    }
  }

  /**
   * Swaps every voxel mesh to a flat unlit `maskColor` material for the mask pass, stashing the
   * instance colors so the beauty pass can be restored exactly. Idempotent.
   */
  setMaskMode(enabled: boolean): void {
    if (this.maskMode === enabled) return;
    this.maskMode = enabled;

    for (const [id, entry] of this.entries) {
      if (enabled) {
        const object = this.project.objects.get(id);
        if (object === undefined) continue;
        this.enterMask(entry, object);
      } else {
        this.exitMask(entry);
      }
    }
  }

  /**
   * Parents one imported raw mesh under the object's mirrored node, tags it with the object id, and
   * puts it on layer 2 (README D24): the viewport draws and picks it, an export never does. The mesh
   * is never disposed here and its geometry and material stay the importer's, because the app owns it.
   *
   * `nodeWorldMatrix` is the imported mesh node's own baked world matrix (README D25), stored per
   * object and cloned, because the caller's matrix belongs to the imported scene and stays live there.
   * `applySources` places the meshes by it, which is what keeps the raw-versus-voxel comparison exactly
   * where the import put it even after a payload has made its object translation-only (README D21).
   *
   * The request is remembered per object, so attaching the same mesh twice leaves it as one child, and
   * an id whose node does not exist yet — an import that attaches before the next `sync()` — is
   * attached by the rebuild that creates it. Parenting, placement, and visibility all go through
   * `applySources`, which runs here when the node exists and on every `sync()`.
   */
  attachSourceObject(id: ObjectId, source: THREE.Object3D, nodeWorldMatrix: THREE.Matrix4): void {
    source.userData['objectId'] = id;
    source.layers.set(SOURCE_LAYER);
    const entry: SourceRecord = { mesh: source, nodeMatrix: nodeWorldMatrix.clone() };
    const recorded = this.sources.get(id);
    if (recorded === undefined) {
      this.sources.set(id, [entry]);
    } else {
      const existing = recorded.findIndex((candidate) => candidate.mesh === source);
      // The same mesh attached twice stays one entry — `Array.findIndex` is the identity test — and a
      // second attach of it refreshes the matrix it is placed by.
      if (existing === -1) recorded.push(entry);
      else recorded[existing] = entry;
    }
    this.applySources(id);
  }

  /**
   * The global "show raw meshes" override (README D24). A source mesh renders exactly when the
   * override is on **or** its object has no payload, so the moment a voxelization attaches one the raw
   * mesh hides again unless the override is on: that is what makes the raw-versus-voxel comparison
   * readable, and it is what keeps an un-voxelized source mesh the only thing a fresh import shows.
   *
   * The flag is published to the meshes here, not only on the next `sync()`: this is a live control, and
   * a setter that merely recorded intent would leave the viewport showing the old state until something
   * else happened to reconcile it — after a voxelization nothing is dirty, so nothing would. `sync()`
   * runs the same rule for every recorded id as well, which is the redundant path that keeps a source
   * attached or rebuilt later correct. A repeated call with the value already stored touches no mesh.
   */
  setSourceVisible(enabled: boolean): void {
    if (this.sourceVisibility === enabled) return;
    this.sourceVisibility = enabled;
    for (const id of this.sources.keys()) this.applySources(id);
  }

  get sourceVisible(): boolean {
    return this.sourceVisibility;
  }

  /**
   * Forgets every raw-mesh record without touching the meshes: they belong to the app, which detaches them.
   * A source is keyed by object id, and `sync()` runs the raw-mesh pass for every recorded id, so a record
   * that outlives its project would re-parent the previous project's mesh under an object that reuses that
   * id — which is exactly what a load does (README D51).
   */
  clearSources(): void {
    this.sources.clear();
  }

  /**
   * Re-reads the project settings into the scene: the background the renderer clears to and the ambient term.
   * A load replaces both without rebuilding the mirror (README D51), and `sync()` never touches either, so
   * nothing else would publish them.
   */
  applySettings(): void {
    const settings = this.project.settings;
    this.scene.background = new THREE.Color(settings.background);
    this.ambientLight.intensity = settings.ambientIntensity;
  }

  /**
   * Re-reads the authored camera into the output camera: pose, field of view, and the near/far range, with the
   * projection refreshed. `sync()` never writes the camera node because the timeline owns it (README D22), so a
   * load says so explicitly here; `app/main.ts`'s `setCameraFov` is the other writer of the same state.
   */
  applyCamera(): void {
    const settings = this.project.camera;
    this.camera.fov = settings.fov;
    this.camera.near = settings.near;
    this.camera.far = settings.far;
    this.camera.position.copy(settings.transform.position);
    this.camera.quaternion.copy(settings.transform.quaternion);
    this.camera.scale.copy(settings.transform.scale);
    this.camera.updateProjectionMatrix();
  }

  /**
   * Fits the **given** camera to the union bounds of the mirrored nodes.
   *
   * The caller passes the camera that draws the viewport; the output camera is a document node the
   * user or the timeline owns and is never framed here (README D17). Layer-2 source meshes are measured
   * with the voxels, so an import frames the imported model itself before any payload exists; layer-1
   * decorations are skipped, so the overlay can never widen the frame.
   */
  frameAll(camera: THREE.PerspectiveCamera): void {
    // The nodes have to exist before they can be measured, and their world matrices have to be
    // current: the caller usually frames right after a document change, before the next render.
    this.sync();
    this.scene.updateMatrixWorld(true);

    const bounds = new THREE.Box3();
    const box = new THREE.Box3();
    for (const entry of this.entries.values()) {
      if (!entry.node.layers.test(CONTENT_LAYERS)) continue;
      box.setFromObject(entry.node, true);
      if (box.isEmpty()) continue;
      bounds.union(box);
    }
    if (bounds.isEmpty()) return;

    const center = bounds.getCenter(new THREE.Vector3());
    const radius = bounds.getSize(new THREE.Vector3()).length() / 2;
    const distance = (radius / Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2)) * FRAME_MARGIN;
    const direction = camera.getWorldDirection(new THREE.Vector3());

    camera.position.copy(center).addScaledVector(direction, -distance);
    camera.lookAt(center);
    camera.near = Math.max(MIN_NEAR, Math.min(camera.near, distance - radius));
    camera.far = Math.max(camera.far, distance + radius);
    camera.updateProjectionMatrix();
  }

  /** Releases every geometry, material, instance buffer and lookup the mirror created. */
  dispose(): void {
    for (const entry of this.entries.values()) {
      this.releaseEntry(entry);
    }
    this.entries.clear();
    this.dirty.clear();
    this.sources.clear();
    this.maskMode = false;
    this.sourceVisibility = false;
    this.shadingMaterial.dispose();
    this.outlineDepthMaterial.dispose();
  }

  /**
   * Parents the raw meshes of one object, puts each on the pose its baked node matrix says, and shows
   * them by one rule, or does nothing before the object's node exists. The visibility rule lives here
   * alone: on, or the object is still an `'empty'` placeholder that renders as nothing else.
   *
   * The pose (README D25) is the mesh's local matrix, `project.worldMatrix(id)⁻¹ ∘ nodeWorldMatrix`, so
   * the mesh's own world matrix is the imported node's, whatever the document node has become: before
   * voxelization the object's transform *is* that matrix, so the local result is the identity, and
   * after `applyVoxelizeResult` made the object translation-only it is the `-origin` offset that keeps
   * the raw mesh where the import put it. It is rewritten on every apply — `sync()` applies every
   * recorded id — with `matrixAutoUpdate` off, so a mixer track, a stale `matrixWorld`, or a rebuild
   * can never drift a raw mesh away from its import pose.
   */
  private applySources(id: ObjectId): void {
    const recorded = this.sources.get(id);
    if (recorded === undefined) return;
    const entry = this.entries.get(id);
    const object = this.project.objects.get(id);
    if (entry === undefined || object === undefined) return;

    // The object's inverse world matrix, held in the scratch for the whole pass: each mesh's placement is
    // its own node matrix seen from the object, so the mesh's world matrix is exactly the import's.
    const inverseWorld = this.sourcePlacement.copy(this.project.worldMatrix(id)).invert();
    const visible = this.sourceVisibility || object.representation === 'empty';
    for (const { mesh, nodeMatrix } of recorded) {
      if (mesh.parent !== entry.node) entry.node.add(mesh);
      mesh.matrix.copy(inverseWorld).multiply(nodeMatrix);
      mesh.matrixAutoUpdate = false;
      mesh.matrixWorldNeedsUpdate = true;
      mesh.visible = visible;
    }
  }

  /** Creates the node of one object and, for a uniform payload, its instances and its lookup. */
  private rebuild(id: ObjectId, object: SceneObject): void {
    const previous = this.entries.get(id);
    if (previous !== undefined) this.releaseEntry(previous);

    const uniform = object.uniform;
    let entry: MirrorEntry;
    if (object.representation === 'uniform' && uniform !== undefined) {
      entry = this.buildUniform(id, uniform);
    } else {
      const node = new THREE.Group();
      node.name = id;
      node.userData['objectId'] = id;
      entry = { node, meshes: [], lookup: undefined, outline: undefined, outlineDepth: undefined };
    }

    this.entries.set(id, entry);
    if (this.maskMode) {
      this.enterMask(entry, object);
    }
  }

  /** One `InstancedMesh` over one cube per occupied cell, in `forEach` order. */
  private buildUniform(id: ObjectId, grid: UniformPayload): MirrorEntry {
    // One cube the size of this object's own cell: the subdivision is the grid's, so the geometry is built per
    // rebuild rather than shared across objects of different levels (README D43).
    const cell = grid.cellSize;
    const geometry = new THREE.BoxGeometry(cell, cell, cell);
    const mesh = new THREE.InstancedMesh(geometry, this.shadingMaterial, grid.size);
    mesh.name = id;
    mesh.userData['objectId'] = id;
    mesh.userData['instanceBase'] = 0;

    const cells: [number, number, number][] = [];
    const colors: HexColor[] = [];
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    let instance = 0;
    grid.forEach((x, y, z, cellColor) => {
      // Cell `(x, y, z)` starts `x` cells from the object's origin, so its center is half a cell past
      // `x * cell` — the coordinate is in cells, the offset is in world units.
      matrix.makeTranslation((x + 0.5) * cell, (y + 0.5) * cell, (z + 0.5) * cell);
      mesh.setMatrixAt(instance, matrix);
      color.setHex(cellColor);
      mesh.setColorAt(instance, color);
      cells.push([x, y, z]);
      colors.push(cellColor);
      instance += 1;
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;

    // The selection outline, built over this mesh's own instances: the library's inverted hull shares the instance
    // matrix, so every cube of the object is wrapped and no per-instance work is added. The hull's thickness is a share
    // of the cell rather than a world constant, so an object at subdivision 4 has four times the finer outline, and the
    // whole group is on the decoration layer so a pick and an export both miss it (README D24).
    const outline = Outlines({
      color: new THREE.Color(SELECTION_COLOR),
      thickness: cell * OUTLINE_SHARE,
      screenspace: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      renderOrder: OUTLINE_RENDER_ORDER,
    });
    mesh.add(outline.group);
    outline.generate();
    outline.group.traverse((child) => {
      child.layers.set(OUTLINE_LAYER);
    });
    outline.group.visible = this.selectedId === id;

    // The depth the outline's pass cuts the hull against (README D50): the object's own instances with colour off, so
    // the hull is clipped by this object's silhouette alone — no other object's depth is in that pass, which is what
    // keeps the rim whole along a shared boundary. Sharing the instance matrix makes it the same instances, not a copy,
    // and the hull draws after it (its render order 1 against this 0), so the depth it leaves is already there.
    const outlineDepth = new THREE.InstancedMesh(geometry, this.outlineDepthMaterial, grid.size);
    outlineDepth.instanceMatrix = mesh.instanceMatrix;
    outlineDepth.frustumCulled = false;
    outlineDepth.layers.set(OUTLINE_LAYER);
    outlineDepth.visible = this.selectedId === id;
    mesh.add(outlineDepth);

    return {
      node: mesh,
      meshes: [{ mesh, instanceColor: null, maskMaterial: null }],
      lookup: cells.length === 0 ? undefined : { objectId: id, cells, colors },
      outline: outline.group,
      outlineDepth,
    };
  }

  private enterMask(entry: MirrorEntry, object: SceneObject): void {
    for (const item of entry.meshes) {
      item.instanceColor = item.mesh.instanceColor;
      item.mesh.instanceColor = null;
      const material = new THREE.MeshBasicMaterial({ color: object.maskColor, toneMapped: false });
      item.maskMaterial = material;
      item.mesh.material = material;
    }
  }

  private exitMask(entry: MirrorEntry): void {
    for (const item of entry.meshes) {
      if (item.mesh.instanceColor === null) item.mesh.instanceColor = item.instanceColor;
      item.mesh.material = this.shadingMaterial;
      item.maskMaterial?.dispose();
      item.maskMaterial = null;
      item.instanceColor = null;
    }
  }

  private releaseEntry(entry: MirrorEntry): void {
    for (const item of entry.meshes) {
      item.mesh.geometry.dispose();
      item.mesh.dispose();
      item.maskMaterial?.dispose();
    }
    // The outline's geometry is the library's own creased copy of the mesh's, and its material is its own too: both are
    // rebuilt with every rebuild, so both are released here. The hull is a child of the mesh, so `removeFromParent`
    // below takes it out of the scene as well.
    entry.outline?.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry.dispose();
      if (Array.isArray(child.material)) {
        for (const material of child.material) material.dispose();
      } else {
        child.material.dispose();
      }
    });
    entry.meshes = [];
    entry.lookup = undefined;
    entry.outline = undefined;
    // The depth copy shares the mesh's geometry and the mirror's material, so it owns nothing to release.
    entry.outlineDepth = undefined;
    entry.node.removeFromParent();
  }
}
