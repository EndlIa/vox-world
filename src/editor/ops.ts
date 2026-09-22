import type { ObjectId, Project, Representation, SceneObject } from '../document/project.js';
import { detachUniformBox } from '../document/detach.js';
import type { HexColor, IntBox3 } from '../voxels/uniform/grid.js';
import { boxCount, normalizeBox } from '../voxels/uniform/grid.js';
import { DEFAULT_CELL_BUDGET, type VoxelizeResult } from '../voxels/voxelize/voxelize.js';
import type { Selection } from './session.js';
import type { Matrix4, Vector3 } from 'three';

/**
 * What an edit did. A user-facing failure is data here, never an exception; detach's own literals
 * pass through unchanged so the vocabulary of ring 0 is what the UI reports.
 * There is no undo and no command object (README D9): a command layer wraps these functions later.
 */
export type OpResult = { ok: true; detail: string; cells?: number } | { ok: false; error: string; detail: string };

type UniformPayload = NonNullable<SceneObject['uniform']>;

type UniformLookup = { ok: true; grid: UniformPayload } | { ok: false; result: OpResult };

function missingObject(objectId: ObjectId): OpResult {
  return { ok: false, error: 'missing-object', detail: `no object with id ${objectId}` };
}

function wrongRepresentation(objectId: ObjectId, representation: Representation): OpResult {
  return {
    ok: false,
    error: 'wrong-representation',
    detail: `object ${objectId} is ${representation}; expected a uniform grid`,
  };
}

/** Guard 1 of the common order: the object resolves, and it carries the representation asked for. */
function requireUniform(project: Project, objectId: ObjectId): UniformLookup {
  const object = project.get(objectId);
  if (object === undefined) return { ok: false, result: missingObject(objectId) };
  const grid = object.representation === 'uniform' ? object.uniform : undefined;
  if (grid === undefined) return { ok: false, result: wrongRepresentation(objectId, object.representation) };
  return { ok: true, grid };
}

/**
 * Places an object that has just been given a voxel payload (README D21, D25): the payload's cells are
 * axis-aligned in world space, because `voxelize` bakes every node transform into the triangle soup, so
 * the object may keep only the translation `origin` that positions them — its payload's world-space
 * local min corner. An imported quaternion or a non-uniform scale left in place would transform the
 * payload a second time and land the whole object rotated, sheared, and mis-scaled. Translation-only is
 * therefore the invariant of attaching a payload, not an incidental side effect.
 */
function placePayload(object: SceneObject, origin: Vector3): void {
  object.transform.position.copy(origin);
  object.transform.quaternion.identity();
  object.transform.scale.set(1, 1, 1);
}

/**
 * Adopts a successful voxelization: an output whose `sourceId` maps through `opts.attachTo` to an
 * existing object keeps that object's id, name, parent, and mask color and only gains the payload
 * and the world position; every other output becomes a new voxel object. Either way the object is
 * left translation-only, because the payload is world space (README D21, D25) — see `placePayload`.
 * Ids come back in output order. Success carries no `OpResult` union because the failure already
 * happened inside `voxelize`.
 */
export function applyVoxelizeResult(
  project: Project,
  result: Extract<VoxelizeResult, { ok: true }>,
  opts?: { attachTo?: ReadonlyMap<string, ObjectId> | undefined; parentId?: ObjectId | null | undefined },
): { objectIds: ObjectId[] } {
  const objectIds: ObjectId[] = [];
  const attachTo = opts?.attachTo;
  const parentId = opts?.parentId ?? null;
  for (const output of result.outputs) {
    const mapped = attachTo?.get(output.sourceId);
    const existing = mapped === undefined ? undefined : project.get(mapped);
    if (mapped !== undefined && existing !== undefined) {
      project.setPayload(mapped, output.payload);
      placePayload(existing, output.origin);
      objectIds.push(mapped);
      continue;
    }
    const created = project.createVoxelObject({
      name: output.name,
      parentId,
      maskColor: project.nextMaskColor(),
      payload: output.payload,
      position: output.origin,
    });
    placePayload(created, output.origin);
    objectIds.push(created.id);
  }
  return { objectIds };
}

/** Writes every cell of an inclusive integer box, after the budget check that can refuse it. */
export function addBox(project: Project, objectId: ObjectId, box: IntBox3, color: HexColor): OpResult {
  const found = requireUniform(project, objectId);
  if (!found.ok) return found.result;
  const region = normalizeBox(box.min, box.max);
  const added = boxCount(region);
  const total = found.grid.size + added;
  if (total > DEFAULT_CELL_BUDGET) {
    return {
      ok: false,
      error: 'budget-exceeded',
      detail: `${total} cells would exceed the budget of ${DEFAULT_CELL_BUDGET}`,
    };
  }
  const cells = found.grid.fillBox(region, color);
  return { ok: true, detail: `added ${cells} cells to ${objectId}`, cells };
}

/** Clears occupied cells inside the box; it can only shrink the grid, so there is no budget check. */
export function removeBox(project: Project, objectId: ObjectId, box: IntBox3): OpResult {
  const found = requireUniform(project, objectId);
  if (!found.ok) return found.result;
  const cells = found.grid.clearBox(normalizeBox(box.min, box.max));
  return { ok: true, detail: `removed ${cells} cells from ${objectId}`, cells };
}

/** Recolors occupied cells inside the box and never creates one. */
export function paintBox(project: Project, objectId: ObjectId, box: IntBox3, color: HexColor): OpResult {
  const found = requireUniform(project, objectId);
  if (!found.ok) return found.result;
  const cells = found.grid.paintBox(normalizeBox(box.min, box.max), color);
  return { ok: true, detail: `painted ${cells} cells in ${objectId}`, cells };
}

/** Turns the selected box region into a new scene object. */
export function detachSelection(project: Project, selection: Selection): OpResult & { objectId?: ObjectId } {
  if (selection.kind === 'none') {
    return { ok: false, error: 'empty-selection', detail: 'nothing is selected to detach' };
  }
  const result = detachUniformBox(project, selection.objectId, selection.box);
  if (!result.ok) return { ok: false, error: result.error, detail: result.detail };
  return { ok: true, detail: `detached ${result.name} as ${result.objectId}`, objectId: result.objectId };
}

export function createGroup(project: Project, name: string): OpResult & { objectId: ObjectId } {
  const object = project.createObject({ name, parentId: null, representation: 'empty' });
  return { ok: true, detail: `created group ${object.name} as ${object.id}`, objectId: object.id };
}

export function deleteObject(project: Project, objectId: ObjectId): OpResult {
  if (project.get(objectId) === undefined) return missingObject(objectId);
  project.remove(objectId);
  return { ok: true, detail: `deleted ${objectId}` };
}

export function reparentObject(project: Project, objectId: ObjectId, parentId: ObjectId | null): OpResult {
  const result = project.reparent(objectId, parentId);
  if (!result.ok) {
    return { ok: false, error: result.error, detail: `cannot reparent ${objectId} to ${parentId ?? 'the root'}: ${result.error}` };
  }
  return { ok: true, detail: `reparented ${objectId} to ${parentId ?? 'the root'}` };
}

/** Assigns the identity channel (README D11); never a cell color, and never a voxel write. */
export function setObjectMaskColor(project: Project, objectId: ObjectId, color: HexColor): OpResult {
  const object = project.get(objectId);
  if (object === undefined) return missingObject(objectId);
  object.maskColor = color;
  return { ok: true, detail: `mask color of ${objectId} is #${color.toString(16).padStart(6, '0')}` };
}

/**
 * Writes a world-space transform into the object's own `position`/`quaternion`/`scale` instances, in place.
 *
 * The document stores each object's *local* transform — `Project.worldMatrix` is what walks the parent chain
 * — so the parent's world matrix is divided out first: a gizmo reports the world matrix its drag derived,
 * which for a child of a moved parent is not the local one the object has to keep.
 *
 * An aligned object lands on the lattice (README D42), and it does so in two steps, both needed: the
 * placement is snapped on the world matrix first, exactly as the drag preview snapped the same matrix, so
 * the pose that was on screen is the pose this writes; then the decomposed placement is snapped again, so
 * what the document stores is whole cells rather than a value a matrix round trip left at 1.9999999999999998.
 */
export function setTransformFromWorldMatrix(project: Project, objectId: ObjectId, matrix: Matrix4): OpResult {
  const object = project.get(objectId);
  if (object === undefined) return missingObject(objectId);
  const aligned = project.alignWorldMatrix(objectId, matrix);
  const parentId = object.parentId;
  const local = parentId === null ? aligned : project.worldMatrix(parentId).invert().multiply(aligned);
  for (const value of local.elements) {
    if (!Number.isFinite(value)) {
      return { ok: false, error: 'degenerate-transform', detail: `matrix for ${objectId} has a non-finite entry` };
    }
  }
  if (local.determinant() === 0) {
    return { ok: false, error: 'degenerate-transform', detail: `matrix for ${objectId} is not invertible` };
  }
  const { position, quaternion, scale } = object.transform;
  local.decompose(position, quaternion, scale);
  if (object.alignToGrid) position.copy(project.alignedPosition(objectId, position));
  return { ok: true, detail: `updated the transform of ${objectId}` };
}

/** Flips the visibility flag `SceneMirror.sync` copies into the scene node; no voxel or transform write. */
export function setObjectVisible(project: Project, objectId: ObjectId, visible: boolean): OpResult {
  const object = project.get(objectId);
  if (object === undefined) return missingObject(objectId);
  object.visible = visible;
  return { ok: true, detail: `${objectId} is now ${visible ? 'visible' : 'hidden'}` };
}

/**
 * Sets the flag behind the panel's `Grid align` checkbox. Switching it on pulls the object onto the lattice
 * there and then, because the flag is a property the object has to satisfy from that moment on, not a mode a
 * later edit applies (README D42); switching it off writes nothing but the flag.
 */
export function setObjectAlignToGrid(project: Project, objectId: ObjectId, alignToGrid: boolean): OpResult {
  const object = project.get(objectId);
  if (object === undefined) return missingObject(objectId);
  object.alignToGrid = alignToGrid;
  if (!alignToGrid) {
    return { ok: true, detail: `${objectId} may now be placed between cells` };
  }
  const aligned = project.alignedPosition(objectId, object.transform.position);
  const moved = !aligned.equals(object.transform.position);
  object.transform.position.copy(aligned);
  const cell = `${aligned.x}, ${aligned.y}, ${aligned.z}`;
  return { ok: true, detail: moved ? `aligned ${objectId} to [${cell}]` : `${objectId} is already on the grid` };
}

/** Renames the object; the name is trimmed first, so whitespace alone is refused rather than stored. */
export function renameObject(project: Project, objectId: ObjectId, name: string): OpResult {
  const object = project.get(objectId);
  if (object === undefined) return missingObject(objectId);
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: 'invalid-name', detail: `the name for ${objectId} is empty after trimming` };
  }
  object.name = trimmed;
  return { ok: true, detail: `renamed ${objectId} to "${trimmed}"` };
}
