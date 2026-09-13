import {
  EPSILON,
  approximatelyEqual,
  quatNormalize,
  type Quat,
  type Vec3,
} from "../../util/math";
import { err, ok, type Result } from "../../util/result";
import type { UniformVoxSnapshot } from "../voxel/uniform/types";

/**
 * Stable, opaque node identity. Never derived from a name, an array index or a
 * position; only the entries in this module mint it.
 */
export type SceneNodeId = string & {
  readonly __brand: "SceneNodeId";
};

/** Stable, opaque object identity. See `SceneNodeId`. */
export type SceneObjectId = string & {
  readonly __brand: "SceneObjectId";
};

/** Validated local transform of a node: parent space is reached by `T * R * S`. */
export type SceneTransform = Readonly<{
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
}>;

/**
 * Unvalidated transform accepted by `sceneSnapshot`. The rotation is a bare
 * quaternion because a `Quat` can only be produced after the unit-length check.
 */
export type SceneTransformInput = Readonly<{
  position: Vec3;
  rotation: Readonly<{ x: number; y: number; z: number; w: number }>;
  scale: Vec3;
}>;

/** Validated node of a scene snapshot. */
export type SceneNodeSnapshot = Readonly<{
  id: SceneNodeId;
  parentId: SceneNodeId | null;
  childIds: readonly SceneNodeId[];
  name: string;
  transform: SceneTransform;
  visible: boolean;
  sceneObjectId: SceneObjectId | null;
}>;

/** Unvalidated node accepted by `sceneSnapshot`. */
export type SceneNodeSnapshotInput = Readonly<{
  id: string;
  parentId: string | null;
  childIds: readonly string[];
  name: string;
  transform: SceneTransformInput;
  visible: boolean;
  sceneObjectId: string | null;
}>;

/** One voxel object, carrying only its own local grid. */
export type SceneObjectSnapshot = Readonly<{
  id: SceneObjectId;
  voxels: UniformVoxSnapshot;
}>;

/** Unvalidated object accepted by `sceneSnapshot`. */
export type SceneObjectSnapshotInput = Readonly<{
  id: string;
  voxels: UniformVoxSnapshot;
}>;

/**
 * Canonical scene snapshot: flat readonly arrays, `nodes` and `objects` sorted
 * by id, relationships expressed only through `parentId` / `childIds`.
 */
export type SceneSnapshot = Readonly<{
  rootNodeId: SceneNodeId;
  nodes: readonly SceneNodeSnapshot[];
  objects: readonly SceneObjectSnapshot[];
}>;

/** Unvalidated snapshot accepted by `sceneSnapshot`. */
export type SceneSnapshotInput = Readonly<{
  rootNodeId: string;
  nodes: readonly SceneNodeSnapshotInput[];
  objects: readonly SceneObjectSnapshotInput[];
}>;

/**
 * Every recoverable scene validation failure. Members are plain serializable
 * data and appear in the order `sceneSnapshot` reports them.
 */
export type SceneValidationError =
  | Readonly<{ code: "empty-id" }>
  | Readonly<{ code: "duplicate-node-id"; id: string }>
  | Readonly<{ code: "duplicate-object-id"; id: string }>
  | Readonly<{ code: "root-missing" }>
  | Readonly<{ code: "root-invalid"; nodeId: string }>
  | Readonly<{ code: "parent-missing"; nodeId: string }>
  | Readonly<{ code: "parent-not-found"; nodeId: string; parentId: string }>
  | Readonly<{ code: "child-not-found"; nodeId: string; childId: string }>
  | Readonly<{ code: "duplicate-child"; nodeId: string; childId: string }>
  | Readonly<{ code: "parent-child-mismatch"; nodeId: string; childId: string }>
  | Readonly<{ code: "cycle"; nodeId: string }>
  | Readonly<{ code: "object-not-found"; nodeId: string; sceneObjectId: string }>
  | Readonly<{ code: "object-unbound"; sceneObjectId: string }>
  | Readonly<{
      code: "object-multiply-bound";
      sceneObjectId: string;
      nodeIds: readonly string[];
    }>
  | Readonly<{ code: "leaf-node-has-children"; nodeId: string }>
  | Readonly<{
      code: "invalid-transform";
      nodeId: string;
      channel: "position" | "rotation" | "scale";
    }>;

/**
 * Mints identities that the checks in this module already accepted. Both
 * assertions live here so no other module can produce a branded scene id.
 */
function brandNodeId(raw: string): SceneNodeId {
  return raw as SceneNodeId;
}

function brandObjectId(raw: string): SceneObjectId {
  return raw as SceneObjectId;
}

/** Validating entry point for `SceneNodeId`: any non-empty string, nothing else. */
export function sceneNodeId(
  raw: string,
): Result<SceneNodeId, SceneValidationError> {
  if (raw.length === 0) {
    return err({ code: "empty-id" });
  }

  return ok(brandNodeId(raw));
}

/** Validating entry point for `SceneObjectId`. See `sceneNodeId`. */
export function sceneObjectId(
  raw: string,
): Result<SceneObjectId, SceneValidationError> {
  if (raw.length === 0) {
    return err({ code: "empty-id" });
  }

  return ok(brandObjectId(raw));
}

function compareIds(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

function isFiniteVec3(vector: Vec3): boolean {
  return (
    Number.isFinite(vector.x) &&
    Number.isFinite(vector.y) &&
    Number.isFinite(vector.z)
  );
}

/** Every component at the origin, as the root transform requires. */
function isZeroVec3(vector: Vec3): boolean {
  return (
    approximatelyEqual(vector.x, 0) &&
    approximatelyEqual(vector.y, 0) &&
    approximatelyEqual(vector.z, 0)
  );
}

/**
 * Any zero component makes the node matrix non-invertible, so the scale check
 * rejects `(0, 1, 1)` exactly like `(0, 0, 0)`.
 */
function hasZeroComponent(vector: Vec3): boolean {
  return (
    approximatelyEqual(vector.x, 0) ||
    approximatelyEqual(vector.y, 0) ||
    approximatelyEqual(vector.z, 0)
  );
}

/**
 * The root's fixed transform. `+w` and `-w` name the same rotation, so both
 * spellings of the identity are accepted; everything else is rejected.
 */
function isIdentityTransform(transform: SceneTransformInput): boolean {
  const { position, rotation, scale } = transform;

  return (
    isZeroVec3(position) &&
    approximatelyEqual(rotation.x, 0) &&
    approximatelyEqual(rotation.y, 0) &&
    approximatelyEqual(rotation.z, 0) &&
    approximatelyEqual(Math.abs(rotation.w), 1) &&
    approximatelyEqual(scale.x, 1) &&
    approximatelyEqual(scale.y, 1) &&
    approximatelyEqual(scale.z, 1)
  );
}

/**
 * Unit-length check for a raw quaternion. Non-finite components fail here, and a
 * component scale extreme enough to overflow the length also fails, so no
 * repair happens before `quatNormalize` may mint the brand.
 */
function isUnitQuaternion(
  rotation: Readonly<{ x: number; y: number; z: number; w: number }>,
): boolean {
  if (
    !Number.isFinite(rotation.x) ||
    !Number.isFinite(rotation.y) ||
    !Number.isFinite(rotation.z) ||
    !Number.isFinite(rotation.w)
  ) {
    return false;
  }

  const length = Math.sqrt(
    rotation.x * rotation.x +
      rotation.y * rotation.y +
      rotation.z * rotation.z +
      rotation.w * rotation.w,
  );

  return Math.abs(length - 1) <= EPSILON;
}

/** First failing transform channel in position → rotation → scale order. */
function firstInvalidTransformChannel(
  transform: SceneTransformInput,
): "position" | "rotation" | "scale" | null {
  if (!isFiniteVec3(transform.position)) {
    return "position";
  }

  if (!isUnitQuaternion(transform.rotation)) {
    return "rotation";
  }

  if (!isFiniteVec3(transform.scale) || hasZeroComponent(transform.scale)) {
    return "scale";
  }

  return null;
}

/**
 * Node ids reachable from the root through `childIds`. Every non-root node has a
 * parent and every child link is bidirectional by the time this runs, so a node
 * outside the set necessarily sits on a parent cycle.
 */
function collectReachableNodeIds(
  rootNodeId: string,
  nodeById: ReadonlyMap<string, SceneNodeSnapshotInput>,
): ReadonlySet<string> {
  const reachable = new Set<string>([rootNodeId]);
  const pending = [rootNodeId];

  while (pending.length > 0) {
    const nodeId = pending.pop();

    // `pending` is only pushed from a non-empty loop body.
    if (nodeId === undefined) {
      throw new Error("Scene traversal stack lost an entry");
    }

    const node = nodeById.get(nodeId);

    // Every pushed id was found in `nodeById` before being pushed.
    if (node === undefined) {
      throw new Error("Scene traversal reached an unknown node");
    }

    for (const childId of node.childIds) {
      if (reachable.has(childId)) {
        continue;
      }

      reachable.add(childId);
      pending.push(childId);
    }
  }

  return reachable;
}

/**
 * The only constructor of a `SceneSnapshot` and the only scene structure
 * validator. Checks run in the order of the `SceneValidationError` union and the
 * first failure is returned, so callers cannot observe a partially repaired
 * scene. Inputs are never modified; the result is canonical (`nodes` and
 * `objects` ascending by id, `childIds` as given) and mints every brand it
 * carries.
 */
export function sceneSnapshot(
  input: SceneSnapshotInput,
): Result<SceneSnapshot, SceneValidationError> {
  if (input.rootNodeId.length === 0) {
    return err({ code: "empty-id" });
  }

  for (const node of input.nodes) {
    if (node.id.length === 0) {
      return err({ code: "empty-id" });
    }
  }

  for (const object of input.objects) {
    if (object.id.length === 0) {
      return err({ code: "empty-id" });
    }
  }

  const nodeById = new Map<string, SceneNodeSnapshotInput>();

  for (const node of input.nodes) {
    if (nodeById.has(node.id)) {
      return err({ code: "duplicate-node-id", id: node.id });
    }

    nodeById.set(node.id, node);
  }

  const objectById = new Map<string, SceneObjectSnapshotInput>();

  for (const object of input.objects) {
    if (objectById.has(object.id)) {
      return err({ code: "duplicate-object-id", id: object.id });
    }

    objectById.set(object.id, object);
  }

  const root = nodeById.get(input.rootNodeId);

  if (root === undefined) {
    return err({ code: "root-missing" });
  }

  if (
    root.parentId !== null ||
    root.sceneObjectId !== null ||
    !isIdentityTransform(root.transform)
  ) {
    return err({ code: "root-invalid", nodeId: root.id });
  }

  for (const node of input.nodes) {
    if (node.id === input.rootNodeId) {
      continue;
    }

    if (node.parentId === null) {
      return err({ code: "parent-missing", nodeId: node.id });
    }

    if (!nodeById.has(node.parentId)) {
      return err({
        code: "parent-not-found",
        nodeId: node.id,
        parentId: node.parentId,
      });
    }
  }

  for (const node of input.nodes) {
    for (const childId of node.childIds) {
      if (!nodeById.has(childId)) {
        return err({ code: "child-not-found", nodeId: node.id, childId });
      }
    }
  }

  for (const node of input.nodes) {
    const seenChildIds = new Set<string>();

    for (const childId of node.childIds) {
      if (seenChildIds.has(childId)) {
        return err({ code: "duplicate-child", nodeId: node.id, childId });
      }

      seenChildIds.add(childId);
    }
  }

  for (const node of input.nodes) {
    for (const childId of node.childIds) {
      const child = nodeById.get(childId);

      // Existence was checked above, so a miss means the lookup is broken.
      if (child === undefined) {
        throw new Error("Scene child lookup failed after existence check");
      }

      if (child.parentId !== node.id) {
        return err({ code: "parent-child-mismatch", nodeId: node.id, childId });
      }
    }
  }

  for (const node of input.nodes) {
    if (node.parentId === null) {
      continue;
    }

    const parent = nodeById.get(node.parentId);

    // Existence was checked above, so a miss means the lookup is broken.
    if (parent === undefined) {
      throw new Error("Scene parent lookup failed after existence check");
    }

    if (!parent.childIds.includes(node.id)) {
      return err({
        code: "parent-child-mismatch",
        nodeId: parent.id,
        childId: node.id,
      });
    }
  }

  const reachableNodeIds = collectReachableNodeIds(input.rootNodeId, nodeById);

  for (const node of input.nodes) {
    if (!reachableNodeIds.has(node.id)) {
      return err({ code: "cycle", nodeId: node.id });
    }
  }

  for (const node of input.nodes) {
    const sceneObjectId = node.sceneObjectId;

    if (sceneObjectId !== null && !objectById.has(sceneObjectId)) {
      return err({
        code: "object-not-found",
        nodeId: node.id,
        sceneObjectId,
      });
    }
  }

  const nodeIdsByObjectId = new Map<string, string[]>();

  for (const node of input.nodes) {
    const sceneObjectId = node.sceneObjectId;

    if (sceneObjectId === null) {
      continue;
    }

    const boundNodeIds = nodeIdsByObjectId.get(sceneObjectId);

    if (boundNodeIds === undefined) {
      nodeIdsByObjectId.set(sceneObjectId, [node.id]);
      continue;
    }

    boundNodeIds.push(node.id);
  }

  for (const object of input.objects) {
    if (!nodeIdsByObjectId.has(object.id)) {
      return err({ code: "object-unbound", sceneObjectId: object.id });
    }
  }

  for (const object of input.objects) {
    const boundNodeIds = nodeIdsByObjectId.get(object.id);

    if (boundNodeIds !== undefined && boundNodeIds.length > 1) {
      return err({
        code: "object-multiply-bound",
        sceneObjectId: object.id,
        nodeIds: [...boundNodeIds],
      });
    }
  }

  for (const node of input.nodes) {
    if (node.sceneObjectId !== null && node.childIds.length > 0) {
      return err({ code: "leaf-node-has-children", nodeId: node.id });
    }
  }

  const transformByNodeId = new Map<string, SceneTransform>();

  for (const node of input.nodes) {
    const channel = firstInvalidTransformChannel(node.transform);

    if (channel !== null) {
      return err({ code: "invalid-transform", nodeId: node.id, channel });
    }

    transformByNodeId.set(node.id, {
      position: node.transform.position,
      // The unit-length check above rejected every other input, so this only
      // mints the `Quat` brand instead of repairing anything.
      rotation: quatNormalize(node.transform.rotation),
      scale: node.transform.scale,
    });
  }

  const nodes = [...input.nodes]
    .sort((left, right) => compareIds(left.id, right.id))
    .map((node): SceneNodeSnapshot => {
      const transform = transformByNodeId.get(node.id);

      // Every node was validated above, so a miss means the lookup is broken.
      if (transform === undefined) {
        throw new Error("Scene transform lookup failed after validation");
      }

      return {
        id: brandNodeId(node.id),
        parentId: node.parentId === null ? null : brandNodeId(node.parentId),
        childIds: node.childIds.map((childId) => brandNodeId(childId)),
        name: node.name,
        transform,
        visible: node.visible,
        sceneObjectId:
          node.sceneObjectId === null ? null : brandObjectId(node.sceneObjectId),
      };
    });

  const objects = [...input.objects]
    .sort((left, right) => compareIds(left.id, right.id))
    .map(
      (object): SceneObjectSnapshot => ({
        id: brandObjectId(object.id),
        voxels: object.voxels,
      }),
    );

  return ok({
    rootNodeId: brandNodeId(input.rootNodeId),
    nodes,
    objects,
  });
}
