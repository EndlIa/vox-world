import { Matrix4, Quaternion, Vector3 } from 'three';
import { CELL_SIZE } from '../voxels/uniform/grid.js';
import type { HexColor, UniformGrid } from '../voxels/uniform/grid.js';
import { adoptKeyframeIds, removeTracksFor, type Timeline, type TrackTarget } from './timeline.js';

export type ObjectId = string;
export type Transform = {
  position: Vector3;
  quaternion: Quaternion;
  scale: Vector3;
};
export type Representation = 'empty' | 'uniform';
export type SceneObject = {
  id: ObjectId;
  name: string;
  parentId: ObjectId | null;
  transform: Transform;
  representation: Representation;
  uniform?: UniformGrid;
  maskColor: HexColor;
  visible: boolean;
  /**
   * While set, the object's own placement holds whole cells of its own grid, so its voxels sit on the world grid
   * the lattice is (README D42, on D41's unit and D43's subdivision). Switched off, the object may sit between
   * cells. A voxel object is created with the flag already set when the placement it was given is whole, and
   * unset when it is not.
   */
  alignToGrid: boolean;
};
export type CameraSettings = {
  fov: number;
  near: number;
  far: number;
  transform: Transform;
};
export type ProjectSettings = { background: HexColor; ambientIntensity: number };
/**
 * The minters, saved so a restore re-mints nothing (README D51): `nextId` is the counter `allocateId` reads and
 * `maskCursor` the palette walk's position.
 */
export type ProjectCounters = { nextId: number; maskCursor: number };
/**
 * The project as plain data — what a file carries of it and what `restore` takes back (README D51). Payload grids
 * are shared by reference: they are read-only where a file is concerned, and copying millions of cells to answer a
 * read is not worth it.
 */
export type ProjectData = {
  objects: SceneObject[];
  camera: CameraSettings;
  settings: ProjectSettings;
  timeline: Timeline;
  counters: ProjectCounters;
};

/** The only id shape this file mints, so a restore can tell a loaded id from a foreign one (README D51). */
const OBJECT_ID_PATTERN = /^obj-(\d+)$/;

/** True for the one id shape this file mints: the reader's half of the same rule `restore` enforces. */
export function isObjectId(value: unknown): value is ObjectId {
  return typeof value === 'string' && OBJECT_ID_PATTERN.test(value);
}

/** Deterministic mask-color walk: 12 distinct `0xRRGGBB` values, in a fixed order. */
const PALETTE: readonly HexColor[] = Object.freeze([
  0xe6194b, 0x3cb44b, 0xffe119, 0x4363d8, 0xf58231, 0x911eb4,
  0x46f0f0, 0xf032e6, 0xbcf60c, 0xfabebe, 0x008080, 0x9a6324,
]);

const DEFAULT_FOV = 50;
const DEFAULT_NEAR = 0.1;
const DEFAULT_FAR = 2000;
const DEFAULT_FPS = 30;
/**
 * The scene background, and the one place it is defined. `index.html` mirrors it as `--scene`, so the
 * page behind the canvas matches and a sub-pixel seam is not a darker line; the previous project's
 * editor uses the same slate, where the value is read from its stylesheet as `COL_SCENE_BG`. It is kept
 * here rather than read from the stylesheet so that editing CSS cannot change an exported video.
 */
const DEFAULT_BACKGROUND: HexColor = 0x3d4250;

/**
 * Whether a placement is already whole `cell`-sized cells, which is what an aligned object holds (README D42, D43).
 * An object whose placement an operation derived — detach, under a parent that is turned or off the lattice — is
 * created unaligned rather than snapped: snapping it would move content that operation promised to leave in place.
 */
function isOnLattice(position: Vector3, cell: number): boolean {
  return (
    Number.isInteger(position.x / cell) &&
    Number.isInteger(position.y / cell) &&
    Number.isInteger(position.z / cell)
  );
}

function identityTransform(): Transform {
  return {
    position: new Vector3(0, 0, 0),
    quaternion: new Quaternion(),
    scale: new Vector3(1, 1, 1),
  };
}

/** A copy of one object record: fresh transform values, payload by reference (README D51). */
function copySceneObject(object: SceneObject): SceneObject {
  const copy: SceneObject = {
    id: object.id,
    name: object.name,
    parentId: object.parentId,
    transform: {
      position: object.transform.position.clone(),
      quaternion: object.transform.quaternion.clone(),
      scale: object.transform.scale.clone(),
    },
    representation: object.representation,
    maskColor: object.maskColor,
    visible: object.visible,
    alignToGrid: object.alignToGrid,
  };
  if (object.uniform !== undefined) copy.uniform = object.uniform;
  return copy;
}

/** A copy of a timeline: one fresh track and keyframe per entry, so a snapshot cannot be written through. */
function copyTimeline(timeline: Timeline): Timeline {
  return {
    durationMs: timeline.durationMs,
    fps: timeline.fps,
    tracks: timeline.tracks.map((track) => {
      const target: TrackTarget =
        track.target.kind === 'camera' ? { kind: 'camera' } : { kind: 'object', objectId: track.target.objectId };
      return {
        target,
        channel: track.channel,
        interpolation: track.interpolation,
        keyframes: track.keyframes.map((keyframe) => ({
          id: keyframe.id,
          timeMs: keyframe.timeMs,
          value: [...keyframe.value],
        })),
      };
    }),
  };
}

/**
 * Project truth: objects, identity, hierarchy, transforms, representation binding, mask colors,
 * camera and project settings, and the one `Timeline` instance. Payloads are held by reference; no
 * scene object is stored here (README D1).
 */
export class Project {
  readonly objects: Map<ObjectId, SceneObject> = new Map();
  readonly camera: CameraSettings = {
    fov: DEFAULT_FOV,
    near: DEFAULT_NEAR,
    far: DEFAULT_FAR,
    transform: identityTransform(),
  };
  readonly settings: ProjectSettings = { background: DEFAULT_BACKGROUND, ambientIntensity: 1 };
  readonly timeline: Timeline = { durationMs: 0, fps: DEFAULT_FPS, tracks: [] };

  private nextId = 0;
  private maskCursor = 0;

  /** Ids are allocated only here, from a monotonic counter, and are never reused after `remove`. */
  allocateId(): ObjectId {
    return `obj-${this.nextId++}`;
  }

  createObject(init: {
    name: string;
    parentId?: ObjectId | null;
    representation: 'empty';
  }): SceneObject {
    const parentId = init.parentId ?? null;
    this.requireParent(parentId);
    const object: SceneObject = {
      id: this.allocateId(),
      name: init.name,
      parentId,
      transform: identityTransform(),
      representation: 'empty',
      maskColor: this.nextMaskColor(),
      visible: true,
      alignToGrid: true,
    };
    this.objects.set(object.id, object);
    return object;
  }

  createVoxelObject(init: {
    name: string;
    parentId?: ObjectId | null;
    maskColor: HexColor;
    payload: { kind: 'uniform'; grid: UniformGrid };
    position: Vector3;
  }): SceneObject {
    const parentId = init.parentId ?? null;
    this.requireParent(parentId);
    const transform = identityTransform();
    transform.position.copy(init.position);
    const object: SceneObject = {
      id: this.allocateId(),
      name: init.name,
      parentId,
      transform,
      representation: init.payload.kind,
      maskColor: init.maskColor,
      visible: true,
      alignToGrid: isOnLattice(transform.position, init.payload.grid.cellSize),
    };
    object.uniform = init.payload.grid;
    this.objects.set(object.id, object);
    return object;
  }

  /**
   * The only mutator that writes `representation` and the payload fields. It touches nothing else:
   * `transform`, `name`, `parentId`, `maskColor`, `visible`, and `alignToGrid` are left as they were, and
   * no dirty flag is set — the caller marks the object dirty for the mirror (D4).
   */
  setPayload(id: ObjectId, payload: { kind: 'uniform'; grid: UniformGrid } | undefined): void {
    const object = this.get(id);
    if (object === undefined) {
      throw new RangeError(`setPayload: unknown object id ${id}`);
    }
    if (payload === undefined) {
      delete object.uniform;
      object.representation = 'empty';
      return;
    }
    object.uniform = payload.grid;
    object.representation = 'uniform';
  }

  get(id: ObjectId): SceneObject | undefined {
    return this.objects.get(id);
  }

  /**
   * Deletes one object, reparenting its direct children to the object's own parent, and drops every
   * timeline track that targeted it. An unknown id is a no-op.
   */
  remove(id: ObjectId): void {
    const object = this.objects.get(id);
    if (object === undefined) return;
    for (const other of this.objects.values()) {
      if (other.parentId === id) other.parentId = object.parentId;
    }
    this.objects.delete(id);
    removeTracksFor(this.timeline, id);
  }

  /** Refuses a move that would close a cycle or name an object that does not exist. */
  reparent(
    id: ObjectId,
    parentId: ObjectId | null,
  ): { ok: true } | { ok: false; error: 'missing' | 'cycle' } {
    const object = this.objects.get(id);
    if (object === undefined) return { ok: false, error: 'missing' };
    if (parentId !== null) {
      if (!this.objects.has(parentId)) return { ok: false, error: 'missing' };
      let ancestor = this.objects.get(parentId);
      while (ancestor !== undefined) {
        if (ancestor.id === id) return { ok: false, error: 'cycle' };
        ancestor = ancestor.parentId === null ? undefined : this.objects.get(ancestor.parentId);
      }
    }
    object.parentId = parentId;
    return { ok: true };
  }

  /** Objects with no parent, in `objects` insertion order. */
  roots(): SceneObject[] {
    const roots: SceneObject[] = [];
    for (const object of this.objects.values()) {
      if (object.parentId === null) roots.push(object);
    }
    return roots;
  }

  /** Direct children, in `objects` insertion order. An unknown id has no children. */
  childrenOf(id: ObjectId): SceneObject[] {
    const children: SceneObject[] = [];
    for (const object of this.objects.values()) {
      if (object.parentId === id) children.push(object);
    }
    return children;
  }

  /**
   * `M_root · … · M_parent · M_local`. Nothing is cached: transforms are mutable value objects and
   * the mirror owns invalidation (D4).
   */
  worldMatrix(id: ObjectId): Matrix4 {
    const chain: SceneObject[] = [];
    let current = this.get(id);
    if (current === undefined) {
      throw new RangeError(`worldMatrix: unknown object id ${id}`);
    }
    while (current !== undefined) {
      chain.push(current);
      current = current.parentId === null ? undefined : this.get(current.parentId);
    }
    const out = new Matrix4();
    const local = new Matrix4();
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      const object = chain[i]!; // the chain holds exactly the entries pushed above
      local.compose(object.transform.position, object.transform.quaternion, object.transform.scale);
      out.multiply(local);
    }
    return out;
  }

  /**
   * The placement an aligned object may take (README D42, D43): the nearest whole cell of its own grid, per axis.
   * A cell is `CELL_SIZE / subdivision` world units and the world unit is the base (README D41), so rounding to the
   * object's own cell is what puts its voxels on the world grid, whatever level of subdivision it carries.
   *
   * An object that does not align, and an unknown id, get a copy of `position`, so a caller can route every
   * placement write through here without testing the flag itself.
   */
  alignedPosition(id: ObjectId, position: Vector3): Vector3 {
    const object = this.get(id);
    if (object === undefined || !object.alignToGrid) return position.clone();
    const cell = object.uniform?.cellSize ?? CELL_SIZE;
    return new Vector3(
      Math.round(position.x / cell) * cell,
      Math.round(position.y / cell) * cell,
      Math.round(position.z / cell) * cell,
    );
  }

  /**
   * The placement a keyframe may store for a target (README D42, D43). An object that aligns gets its own whole
   * cells, exactly as a direct transform write does, so everything a track holds is on its lattice; every other
   * target keeps the placement it was given.
   *
   * The camera is one of those: it is not a scene object, its placement is a viewpoint rather than voxel content,
   * and a camera confined to whole cells could not frame anything. Nothing here constrains what the mixer
   * interpolates between two returned placements — smooth motion between cells is the point of a track.
   */
  keyframePosition(target: TrackTarget, position: Vector3): Vector3 {
    return target.kind === 'object' ? this.alignedPosition(target.objectId, position) : position.clone();
  }

  /**
   * The world matrix an aligned object may take: `alignedPosition`'s rule applied in the object's own frame,
   * so a gizmo drag previews exactly what its commit will store instead of jumping on release (README D42).
   *
   * Returns `matrix` itself for an object that does not align and for an unknown id, and never mutates it.
   */
  alignWorldMatrix(id: ObjectId, matrix: Matrix4): Matrix4 {
    const object = this.get(id);
    if (object === undefined || !object.alignToGrid) return matrix;
    const parent = object.parentId === null ? undefined : this.worldMatrix(object.parentId);
    const local = parent === undefined ? matrix.clone() : parent.clone().invert().multiply(matrix);
    local.setPosition(this.alignedPosition(id, new Vector3().setFromMatrixPosition(local)));
    return parent === undefined ? local : parent.multiply(local);
  }

  /** Palette walk: a plain cursor increment, so two fresh projects produce the same sequence. */
  nextMaskColor(): HexColor {
    // The cursor is reduced modulo the palette length, so the index is always in range.
    return PALETTE[this.maskCursor++ % PALETTE.length]!;
  }

  /**
   * The project as plain data (README D51): one copied record per object in `objects` order, the camera and the
   * settings copied by the same rule, and the timeline as one copied record. Payload grids are shared, so the
   * result must not be written to; the file boundary reads it and encodes what it finds.
   */
  snapshot(): ProjectData {
    return {
      objects: [...this.objects.values()].map(copySceneObject),
      camera: {
        fov: this.camera.fov,
        near: this.camera.near,
        far: this.camera.far,
        transform: {
          position: this.camera.transform.position.clone(),
          quaternion: this.camera.transform.quaternion.clone(),
          scale: this.camera.transform.scale.clone(),
        },
      },
      settings: { background: this.settings.background, ambientIntensity: this.settings.ambientIntensity },
      timeline: copyTimeline(this.timeline),
      counters: { nextId: this.nextId, maskCursor: this.maskCursor },
    };
  }

  /**
   * Replaces the truth in place (README D51). Like `setPayload`, it validates before it writes, so a rejected
   * restore leaves the project exactly as it was; and it keeps instance identity — the `objects` map, `camera`,
   * `settings`, `timeline`, and `timeline.tracks` are the objects every holder already has — because the mirror,
   * the mixer, and the editor hold this project rather than a copy of it.
   */
  restore(data: ProjectData): void {
    const loaded = new Map<ObjectId, SceneObject>();
    let highestId = -1;
    for (const object of data.objects) {
      const match = OBJECT_ID_PATTERN.exec(object.id);
      if (match === null) {
        throw new RangeError(`restore: object id is not obj-<n>: ${object.id}`);
      }
      if (loaded.has(object.id)) {
        throw new RangeError(`restore: duplicate object id: ${object.id}`);
      }
      loaded.set(object.id, object);
      highestId = Math.max(highestId, Number(match[1]));
    }
    for (const object of loaded.values()) {
      if (object.parentId !== null && !loaded.has(object.parentId)) {
        throw new RangeError(`restore: unknown parent ${object.parentId} for ${object.id}`);
      }
    }
    // A cycle is a parent walk that never reaches a root: with at most one parent per object, a chain longer
    // than the object count has closed on itself.
    for (const object of loaded.values()) {
      let steps = 0;
      let current: SceneObject | undefined = object;
      while (current !== undefined && current.parentId !== null) {
        steps += 1;
        if (steps > loaded.size) {
          throw new RangeError(`restore: parent cycle at ${object.id}`);
        }
        current = loaded.get(current.parentId);
      }
    }

    // Records are copied and payloads are not; the camera, the settings, the timeline, and its `tracks` array
    // keep their identity, which is what makes a load invisible to every holder of this project.
    this.objects.clear();
    for (const object of data.objects) {
      this.objects.set(object.id, copySceneObject(object));
    }
    this.camera.fov = data.camera.fov;
    this.camera.near = data.camera.near;
    this.camera.far = data.camera.far;
    this.camera.transform.position.copy(data.camera.transform.position);
    this.camera.transform.quaternion.copy(data.camera.transform.quaternion);
    this.camera.transform.scale.copy(data.camera.transform.scale);
    this.settings.background = data.settings.background;
    this.settings.ambientIntensity = data.settings.ambientIntensity;
    const timeline = copyTimeline(data.timeline);
    this.timeline.durationMs = timeline.durationMs;
    this.timeline.fps = timeline.fps;
    this.timeline.tracks.splice(0, this.timeline.tracks.length, ...timeline.tracks);
    // The floor is what keeps identity unique in both directions: above every loaded id, and never below the
    // counter the file recorded (README D51). The keyframe minter gets the same treatment.
    this.nextId = Math.max(data.counters.nextId, highestId + 1);
    this.maskCursor = data.counters.maskCursor;
    adoptKeyframeIds(this.timeline);
  }

  private requireParent(parentId: ObjectId | null): void {
    if (parentId !== null && !this.objects.has(parentId)) {
      throw new RangeError(`unknown parent id ${parentId}`);
    }
  }
}
