/**
 * The scene mirror.
 *
 * Exactly one `Object3D` per document object plus the output camera, plus the derived
 * `InstancedMesh` geometry that renders uniform cells and octree leaves. It owns every derived render
 * resource and both instance-to-cell/leaf reverse maps, and it owns no project data, no renderer, no
 * DOM, and never the viewport camera.
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
import { decodeLeafId } from '../voxels/octree/leafId.js';
import type { LeafId } from '../voxels/octree/leafId.js';
import type { HexColor } from '../voxels/uniform/grid.js';
import * as THREE from 'three';

/** The imported-source-mesh layer (README D24); `picking.ts` enables it on its raycaster too. */
const SOURCE_LAYER = 2;
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

export type LeafLookupItem = {
  leafId: LeafId;
  depth: number;
  size: number;
  occupied: boolean;
  color: HexColor;
};

export type LeafLookup = { objectId: ObjectId; leaves: LeafLookupItem[] };

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
  lookup: CellLookup | LeafLookup | undefined;
};

/**
 * One object's imported raw meshes plus the baked node matrix of the mesh node they came from (README
 * D24, D25). The matrix is the raw mesh's anchor: `applySources` places the meshes by it, so they stay
 * exactly where the import put them however the object's own transform changes.
 */
type SourceRecord = {
  meshes: THREE.Object3D[];
  nodeMatrix: THREE.Matrix4;
};

type UniformPayload = NonNullable<SceneObject['uniform']>;
type OctreePayload = NonNullable<SceneObject['octree']>;

export class SceneMirror {
  readonly scene: THREE.Scene;
  /** The **output** camera: derived from `project.camera`, used for export and the aspect guide. */
  readonly camera: THREE.PerspectiveCamera;

  private readonly project: Project;
  private readonly shadingMaterial: THREE.MeshLambertMaterial;
  private readonly entries = new Map<ObjectId, MirrorEntry>();
  private readonly dirty = new Set<ObjectId>();
  private maskMode = false;
  /**
   * The raw meshes the app attached, per object, each with the baked node matrix it is placed by. The
   * mirror parents and shows them but never disposes them: they belong to the app, which drops them at
   * teardown (README D24, D25).
   */
  private readonly sources = new Map<ObjectId, SourceRecord>();
  /** The global raw-mesh override; off, a source mesh shows only while its object has no payload. */
  private sourceVisibility = false;
  /** Scratch for `applySources`: one placement at a time, never held across a call. */
  private readonly sourcePlacement = new THREE.Matrix4();

  constructor(project: Project, opts?: { background?: HexColor; ambientIntensity?: number }) {
    this.project = project;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(opts?.background ?? project.settings.background);
    this.scene.add(new THREE.AmbientLight(0xffffff, opts?.ambientIntensity ?? project.settings.ambientIntensity));

    const sun = new THREE.DirectionalLight(0xffffff, DIRECTIONAL_INTENSITY);
    sun.position.set(4, 8, 6);
    this.scene.add(sun);

    this.shadingMaterial = new THREE.MeshLambertMaterial();

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
   * The instance -> cell or leaf reverse map of one object, filled from document data by the rebuild
   * that created the instances. A material swap, `setMaskMode`, or a stale `instanceId` can therefore
   * never change what picking or the HUD reports.
   */
  lookupOf(id: ObjectId): CellLookup | LeafLookup | undefined {
    return this.entries.get(id)?.lookup;
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
    const recorded = this.sources.get(id);
    if (recorded === undefined) {
      this.sources.set(id, { meshes: [source], nodeMatrix: nodeWorldMatrix.clone() });
    } else {
      if (!recorded.meshes.includes(source)) recorded.meshes.push(source);
      recorded.nodeMatrix.copy(nodeWorldMatrix);
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
   * Fits the **given** camera to the union bounds of the mirrored nodes.
   *
   * The caller passes the camera that draws the viewport; the output camera is a document node the
   * user or the timeline owns and is never framed here (README D17). Layer-2 source meshes are measured
   * with the voxels, so an import frames the imported model itself before any payload exists; layer-1
   * decorations are skipped, so the overlay and the aspect guide can never widen the frame.
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

    const placement = this.sourcePlacement
      .copy(this.project.worldMatrix(id))
      .invert()
      .multiply(recorded.nodeMatrix);
    const visible = this.sourceVisibility || object.representation === 'empty';
    for (const source of recorded.meshes) {
      if (source.parent !== entry.node) entry.node.add(source);
      source.matrix.copy(placement);
      source.matrixAutoUpdate = false;
      source.matrixWorldNeedsUpdate = true;
      source.visible = visible;
    }
  }

  /** Creates the node of one object and, for a voxel payload, its instances and its lookup. */
  private rebuild(id: ObjectId, object: SceneObject): void {
    const previous = this.entries.get(id);
    if (previous !== undefined) this.releaseEntry(previous);

    const uniform = object.uniform;
    const octree = object.octree;
    let entry: MirrorEntry;
    if (object.representation === 'uniform' && uniform !== undefined) {
      entry = this.buildUniform(id, uniform);
    } else if (object.representation === 'octree' && octree !== undefined) {
      entry = this.buildOctree(id, octree);
    } else {
      const node = new THREE.Group();
      node.name = id;
      node.userData['objectId'] = id;
      entry = { node, meshes: [], lookup: undefined };
    }

    this.entries.set(id, entry);
    if (this.maskMode) {
      this.enterMask(entry, object);
    }
  }

  /** One `InstancedMesh` over one cube per occupied cell, in `forEach` order. */
  private buildUniform(id: ObjectId, grid: UniformPayload): MirrorEntry {
    const voxelSize = grid.voxelSize;
    const geometry = new THREE.BoxGeometry(voxelSize, voxelSize, voxelSize);
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
      matrix.makeTranslation((x + 0.5) * voxelSize, (y + 0.5) * voxelSize, (z + 0.5) * voxelSize);
      mesh.setMatrixAt(instance, matrix);
      color.setHex(cellColor);
      mesh.setColorAt(instance, color);
      cells.push([x, y, z]);
      colors.push(cellColor);
      instance += 1;
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;

    return {
      node: mesh,
      meshes: [{ mesh, instanceColor: null, maskMaterial: null }],
      lookup: cells.length === 0 ? undefined : { objectId: id, cells, colors },
    };
  }

  /**
   * One `InstancedMesh` per leaf-size bucket, deepest bucket first and ascending `LeafId` inside a
   * bucket — the instance order the pick contract depends on. Each bucket is one geometry sized
   * exactly to that depth's leaf edge, and the object-wide `leaves` array is their concatenation.
   */
  private buildOctree(id: ObjectId, octree: OctreePayload): MirrorEntry {
    const buckets = new Map<number, { leafId: LeafId; occupied: boolean; color: HexColor }[]>();
    octree.forEachOccupiedLeaf((leafId, attrs) => {
      const depth = decodeLeafId(leafId).depth;
      let bucket = buckets.get(depth);
      if (bucket === undefined) {
        bucket = [];
        buckets.set(depth, bucket);
      }
      bucket.push({ leafId, occupied: attrs.occupied, color: attrs.color });
    });

    const node = new THREE.Group();
    node.name = id;
    node.userData['objectId'] = id;

    const meshes: VoxelMesh[] = [];
    const leaves: LeafLookupItem[] = [];
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    const center = new THREE.Vector3();
    let instanceBase = 0;

    const ordered = [...buckets.entries()].sort((a, b) => b[0] - a[0]);
    for (const [depth, bucket] of ordered) {
      bucket.sort((a, b) => (a.leafId < b.leafId ? -1 : a.leafId > b.leafId ? 1 : 0));

      const leafSize = octree.leafSize(depth);
      const geometry = new THREE.BoxGeometry(leafSize, leafSize, leafSize);
      const mesh = new THREE.InstancedMesh(geometry, this.shadingMaterial, bucket.length);
      mesh.userData['objectId'] = id;
      mesh.userData['instanceBase'] = instanceBase;

      let instance = 0;
      for (const leaf of bucket) {
        leafCenter(leaf.leafId, leafSize, center);
        matrix.makeTranslation(center.x, center.y, center.z);
        mesh.setMatrixAt(instance, matrix);
        color.setHex(leaf.color);
        mesh.setColorAt(instance, color);
        leaves.push({
          leafId: leaf.leafId,
          depth,
          size: leafSize,
          occupied: leaf.occupied,
          color: leaf.color,
        });
        instance += 1;
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;

      node.add(mesh);
      meshes.push({ mesh, instanceColor: null, maskMaterial: null });
      instanceBase += bucket.length;
    }

    return { node, meshes, lookup: leaves.length === 0 ? undefined : { objectId: id, leaves } };
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
    entry.meshes = [];
    entry.lookup = undefined;
    entry.node.removeFromParent();
  }
}

/** The leaf center in octree-local space, `(i + 0.5) * leafSize` with `i` built from the path digits. */
function leafCenter(leafId: LeafId, leafSize: number, target: THREE.Vector3): THREE.Vector3 {
  const { path } = decodeLeafId(leafId);
  let x = 0;
  let y = 0;
  let z = 0;
  for (const digit of path) {
    x = (x << 1) | (digit & 1);
    y = (y << 1) | ((digit >> 1) & 1);
    z = (z << 1) | ((digit >> 2) & 1);
  }
  return target.set((x + 0.5) * leafSize, (y + 0.5) * leafSize, (z + 0.5) * leafSize);
}
