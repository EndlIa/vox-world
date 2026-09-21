import { Matrix4, Vector3 } from 'three';
import { UniformGrid, unpackKey } from '../voxels/uniform/grid.js';
import type { IntBox3 } from '../voxels/uniform/grid.js';
import { Octree } from '../voxels/octree/octree.js';
import type { LeafAttrs } from '../voxels/octree/octree.js';
import { parentLeafId, type LeafId } from '../voxels/octree/leafId.js';
import type { ObjectId, Project, SceneObject } from './project.js';

export type DetachResult =
  | { ok: true; objectId: ObjectId; name: string }
  | {
      ok: false;
      error: 'missing-object' | 'wrong-representation' | 'empty-region' | 'not-a-leaf';
      detail: string;
    };

const ROOT_LEAF_ID: LeafId = '0:'; // encodeLeafId(0, []), the root leaf of every octree (leafId.ts)

/**
 * D23 placement: `parentWorld⁻¹ ∘ regionWorld ∘ T(+localMin)`, read as a position. The payload was
 * rebased to a zero min corner, so this is the matrix that puts the extracted region back where it
 * was, expressed in the frame the new object inherits.
 */
function placementFor(project: Project, source: SceneObject, localMin: Vector3): Vector3 {
  const parentWorld =
    source.parentId === null ? new Matrix4() : project.worldMatrix(source.parentId);
  const placement = parentWorld.invert().multiply(project.worldMatrix(source.id));
  placement.multiply(new Matrix4().makeTranslation(localMin.x, localMin.y, localMin.z));
  return new Vector3().setFromMatrixPosition(placement);
}

/** Smallest positive `n` no existing object already uses in `"<source name> part <n>"`. */
function partName(project: Project, sourceName: string): string {
  const taken = new Set<string>();
  for (const object of project.objects.values()) taken.add(object.name);
  let index = 1;
  while (taken.has(`${sourceName} part ${index}`)) index += 1;
  return `${sourceName} part ${index}`;
}

/**
 * Turns an inclusive integer box of a uniform object into a new object: the extracted cells are
 * re-indexed to a zero min corner, the new object is placed per D23, and the source no longer holds
 * those cells.
 */
export function detachUniformBox(project: Project, sourceId: ObjectId, box: IntBox3): DetachResult {
  const source = project.get(sourceId);
  if (source === undefined) {
    return { ok: false, error: 'missing-object', detail: `no object ${sourceId}` };
  }
  const sourceGrid = source.uniform;
  if (source.representation !== 'uniform' || sourceGrid === undefined) {
    return {
      ok: false,
      error: 'wrong-representation',
      detail: `object ${sourceId} is ${source.representation}, not uniform`,
    };
  }
  const cells = sourceGrid.extractBox(box, { remove: true });
  if (cells.size === 0) {
    return {
      ok: false,
      error: 'empty-region',
      detail: `box [${box.min.join(', ')}]..[${box.max.join(', ')}] of ${sourceId} holds no occupied cell`,
    };
  }
  const voxelSize = sourceGrid.voxelSize;
  const [minX, minY, minZ] = box.min;
  const grid = UniformGrid.create(voxelSize);
  for (const [key, color] of cells) {
    const [x, y, z] = unpackKey(key);
    grid.set(x - minX, y - minY, z - minZ, color);
  }
  const position = placementFor(
    project,
    source,
    new Vector3(minX * voxelSize, minY * voxelSize, minZ * voxelSize),
  );
  const object = project.createVoxelObject({
    name: partName(project, source.name),
    parentId: source.parentId,
    maskColor: project.nextMaskColor(),
    payload: { kind: 'uniform', grid },
    position,
  });
  return { ok: true, objectId: object.id, name: object.name };
}

/**
 * Turns one occupied octree leaf into a new object whose root box *is* that leaf box, with the
 * source's depth budget, so the result can be split and detached again (D20).
 */
export function detachOctreeLeaf(project: Project, sourceId: ObjectId, leafId: LeafId): DetachResult {
  const source = project.get(sourceId);
  if (source === undefined) {
    return { ok: false, error: 'missing-object', detail: `no object ${sourceId}` };
  }
  const sourceOctree = source.octree;
  if (source.representation !== 'octree' || sourceOctree === undefined) {
    return {
      ok: false,
      error: 'wrong-representation',
      detail: `object ${sourceId} is ${source.representation}, not octree`,
    };
  }
  const attrs = sourceOctree.getLeaf(leafId);
  if (attrs === undefined) {
    return {
      ok: false,
      error: 'not-a-leaf',
      detail: `id ${leafId} of ${sourceId} names no leaf`,
    };
  }
  if (!attrs.occupied) {
    return {
      ok: false,
      error: 'empty-region',
      detail: `leaf ${leafId} of ${sourceId} is not occupied`,
    };
  }
  const leafBox = sourceOctree.leafBox(leafId);
  const half = leafBox.size / 2;
  const position = placementFor(
    project,
    source,
    new Vector3(leafBox.center.x - half, leafBox.center.y - half, leafBox.center.z - half),
  );
  if (parentLeafId(leafId) === null) {
    // A one-leaf octree is just its root leaf, and `removeLeaf` never removes the root: the source
    // gives up that leaf's occupancy instead, which is how an emptied container is expressed.
    sourceOctree.setLeaf(leafId, { occupied: false, color: attrs.color });
  } else if (!sourceOctree.removeLeaf(leafId)) {
    // The leaf was occupied a moment ago, so a failed removal is an internal invariant violation.
    throw new RangeError(`detach: leaf ${leafId} of ${sourceId} vanished during detach`);
  }
  const octree = Octree.create({ rootSize: leafBox.size, maxDepth: sourceOctree.maxDepth });
  const rootAttrs: LeafAttrs = { occupied: attrs.occupied, color: attrs.color };
  const label = attrs.label;
  if (label !== undefined) rootAttrs.label = label;
  octree.setLeaf(ROOT_LEAF_ID, rootAttrs);
  const object = project.createVoxelObject({
    name: label !== undefined && label !== '' ? label : partName(project, source.name),
    parentId: source.parentId,
    maskColor: project.nextMaskColor(),
    payload: { kind: 'octree', octree },
    position,
  });
  return { ok: true, objectId: object.id, name: object.name };
}
