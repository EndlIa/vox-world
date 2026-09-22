import { Matrix4, Vector3 } from 'three';
import { UniformGrid, unpackKey } from '../voxels/uniform/grid.js';
import type { IntBox3 } from '../voxels/uniform/grid.js';
import type { ObjectId, Project, SceneObject } from './project.js';

export type DetachResult =
  | { ok: true; objectId: ObjectId; name: string }
  | {
      ok: false;
      error: 'missing-object' | 'wrong-representation' | 'empty-region';
      detail: string;
    };

/**
 * D23 placement: `parentWorld⁻¹ ∘ regionWorld ∘ T(+localMin · cell)`, read as a position. The payload was
 * rebased to a zero min corner, so this is the matrix that puts the extracted region back where it was,
 * expressed in the frame the new object inherits; `cell` is the source grid's own cell size (README D43).
 */
function placementFor(project: Project, source: SceneObject, localMin: Vector3, cell: number): Vector3 {
  const parentWorld =
    source.parentId === null ? new Matrix4() : project.worldMatrix(source.parentId);
  const placement = parentWorld.invert().multiply(project.worldMatrix(source.id));
  placement.multiply(new Matrix4().makeTranslation(localMin.x * cell, localMin.y * cell, localMin.z * cell));
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
 * those cells. The new grid keeps the source's subdivision, so the slice is exactly as fine as the model it
 * came from (README D43).
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
  const [minX, minY, minZ] = box.min;
  const cell = sourceGrid.cellSize;
  const grid = UniformGrid.create(sourceGrid.subdivision);
  for (const [key, color] of cells) {
    const [x, y, z] = unpackKey(key);
    grid.set(x - minX, y - minY, z - minZ, color);
  }
  // A cell is `cell` world units (README D41, D43), so the extracted region's local min corner times that is its
  // world offset inside the source.
  const position = placementFor(project, source, new Vector3(minX, minY, minZ), cell);
  const object = project.createVoxelObject({
    name: partName(project, source.name),
    parentId: source.parentId,
    maskColor: project.nextMaskColor(),
    payload: { kind: 'uniform', grid },
    position,
  });
  return { ok: true, objectId: object.id, name: object.name };
}
