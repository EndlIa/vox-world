import { Matrix4, Quaternion, Vector3 } from 'three';
import type { HexColor, UniformGrid } from '../voxels/uniform/grid.js';
import type { Octree } from '../voxels/octree/octree.js';
import { removeTracksFor, type Timeline } from './timeline.js';

export type ObjectId = string;
export type Transform = {
  position: Vector3;
  quaternion: Quaternion;
  scale: Vector3;
};
export type Representation = 'empty' | 'uniform' | 'octree';
export type SceneObject = {
  id: ObjectId;
  name: string;
  parentId: ObjectId | null;
  transform: Transform;
  representation: Representation;
  uniform?: UniformGrid;
  octree?: Octree;
  maskColor: HexColor;
  visible: boolean;
};
export type CameraSettings = {
  fov: number;
  near: number;
  far: number;
  transform: Transform;
};
export type ProjectSettings = { background: HexColor; ambientIntensity: number };

/** Deterministic mask-color walk: 12 distinct `0xRRGGBB` values, in a fixed order. */
const PALETTE: readonly HexColor[] = Object.freeze([
  0xe6194b, 0x3cb44b, 0xffe119, 0x4363d8, 0xf58231, 0x911eb4,
  0x46f0f0, 0xf032e6, 0xbcf60c, 0xfabebe, 0x008080, 0x9a6324,
]);

const DEFAULT_FOV = 50;
const DEFAULT_NEAR = 0.1;
const DEFAULT_FAR = 2000;
const DEFAULT_FPS = 30;

function identityTransform(): Transform {
  return {
    position: new Vector3(0, 0, 0),
    quaternion: new Quaternion(),
    scale: new Vector3(1, 1, 1),
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
  readonly settings: ProjectSettings = { background: 0x000000, ambientIntensity: 1 };
  readonly timeline: Timeline = { duration: 0, fps: DEFAULT_FPS, tracks: [] };

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
    };
    this.objects.set(object.id, object);
    return object;
  }

  createVoxelObject(init: {
    name: string;
    parentId?: ObjectId | null;
    maskColor: HexColor;
    payload: { kind: 'uniform'; grid: UniformGrid } | { kind: 'octree'; octree: Octree };
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
    };
    if (init.payload.kind === 'uniform') object.uniform = init.payload.grid;
    else object.octree = init.payload.octree;
    this.objects.set(object.id, object);
    return object;
  }

  /**
   * The only mutator that writes `representation` and the payload fields. It touches nothing else:
   * `transform`, `name`, `parentId`, `maskColor`, and `visible` are left as they were, and no dirty
   * flag is set — the caller marks the object dirty for the mirror (D4).
   */
  setPayload(
    id: ObjectId,
    payload:
      | { kind: 'uniform'; grid: UniformGrid }
      | { kind: 'octree'; octree: Octree }
      | undefined,
  ): void {
    const object = this.get(id);
    if (object === undefined) {
      throw new RangeError(`setPayload: unknown object id ${id}`);
    }
    if (payload === undefined) {
      delete object.uniform;
      delete object.octree;
      object.representation = 'empty';
      return;
    }
    if (payload.kind === 'uniform') {
      object.uniform = payload.grid;
      delete object.octree;
      object.representation = 'uniform';
    } else {
      object.octree = payload.octree;
      delete object.uniform;
      object.representation = 'octree';
    }
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

  /** Palette walk: a plain cursor increment, so two fresh projects produce the same sequence. */
  nextMaskColor(): HexColor {
    // The cursor is reduced modulo the palette length, so the index is always in range.
    return PALETTE[this.maskCursor++ % PALETTE.length]!;
  }

  private requireParent(parentId: ObjectId | null): void {
    if (parentId !== null && !this.objects.has(parentId)) {
      throw new RangeError(`unknown parent id ${parentId}`);
    }
  }
}
