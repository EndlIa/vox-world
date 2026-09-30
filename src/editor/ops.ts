import type { ObjectId, Project, Representation, SceneObject } from '../document/project.js';
import { detachUniformBox } from '../document/detach.js';
import type { HexColor } from '../voxels/uniform/grid.js';
import { KEY_MAX, KEY_MIN, isSubdivision } from '../voxels/uniform/grid.js';
/*
 * The ring-0 writers are aliased because this file's own verbs are named for what the user asks for (`add`,
 * `remove`, `paint`) while ring 0 names what the container does (`fill`, `clear`, `paint`).
 */
import {
  clearRegion as clearRegionCells,
  fillRegion as fillRegionCells,
  paintRegion as paintRegionCells,
  regionCount,
} from '../voxels/uniform/region.js';
import type { RegionShape } from '../voxels/uniform/region.js';
import { createPrimitive as createPrimitiveGrid, primitiveCellCount } from '../voxels/uniform/generator.js';
import type { PrimitiveSpec } from '../voxels/uniform/generator.js';
import { DEFAULT_CELL_BUDGET, type VoxelizeResult } from '../voxels/voxelize/voxelize.js';
import type { Selection } from './session.js';
import { Vector3 } from 'three';
import type { Matrix4 } from 'three';

/**
 * What an edit did. A user-facing failure is data here, never an exception; detach's own literals
 * pass through unchanged so the vocabulary of ring 0 is what the UI reports.
 * There is no undo and no command object: a command layer wraps these functions later.
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
 * Places an object that has just been given a voxel payload: the payload's cells are
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
 * left translation-only, because the payload is world space — see `placePayload`.
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

/** Writes every cell a region names, after the budget check that can refuse it. */
export function addRegion(project: Project, objectId: ObjectId, shape: RegionShape, color: HexColor): OpResult {
  const found = requireUniform(project, objectId);
  if (!found.ok) return found.result;
  // The count is what the shape names rather than what it would add: a box counts its whole extent, a colour or
  // an island the cells it reaches. That over-estimates a write, which is the safe direction for a budget.
  const total = found.grid.size + regionCount(found.grid, shape);
  if (total > DEFAULT_CELL_BUDGET) {
    return {
      ok: false,
      error: 'budget-exceeded',
      detail: `${total} cells would exceed the budget of ${DEFAULT_CELL_BUDGET}`,
    };
  }
  const cells = fillRegionCells(found.grid, shape, color);
  return { ok: true, detail: `added ${cells} cells to ${objectId}`, cells };
}

/** Clears the occupied cells a region names; it can only shrink the grid, so there is no budget check. */
export function removeRegion(project: Project, objectId: ObjectId, shape: RegionShape): OpResult {
  const found = requireUniform(project, objectId);
  if (!found.ok) return found.result;
  const cells = clearRegionCells(found.grid, shape);
  return { ok: true, detail: `removed ${cells} cells from ${objectId}`, cells };
}

/** Recolors the occupied cells a region names and never creates one. */
export function paintRegion(project: Project, objectId: ObjectId, shape: RegionShape, color: HexColor): OpResult {
  const found = requireUniform(project, objectId);
  if (!found.ok) return found.result;
  const cells = paintRegionCells(found.grid, shape, color);
  return { ok: true, detail: `painted ${cells} cells in ${objectId}`, cells };
}

/**
 * Turns the selected region into a new scene object. A detach extracts a box, so only a box selection can name
 * one: a colour or an island is refused with data rather than quietly detached as its bounding box, which would
 * take cells the user never named.
 */
export function detachSelection(project: Project, selection: Selection): OpResult & { objectId?: ObjectId } {
  if (selection.kind === 'none') {
    return { ok: false, error: 'empty-selection', detail: 'nothing is selected to detach' };
  }
  if (selection.shape.kind !== 'box') {
    return {
      ok: false,
      error: 'wrong-region',
      detail: `detach needs a box region, this one is a ${selection.shape.kind}`,
    };
  }
  const result = detachUniformBox(project, selection.objectId, {
    min: selection.shape.min,
    max: selection.shape.max,
  });
  if (!result.ok) return { ok: false, error: result.error, detail: result.detail };
  return { ok: true, detail: `detached ${result.name} as ${result.objectId}`, objectId: result.objectId };
}

/**
 * Creates one object holding a primitive: the payload the spec asks for, on the world lattice, with an id and a mask
 * color of its own. The spec's own upper bound is what the budget is checked against, before the payload is built, so
 * an oversized primitive is refused with data rather than by allocating it first.
 *
 * A spec that names no cells — a size of zero, a radius of nothing — is data too, because a spec comes from a form:
 * the generator's `RangeError` is turned into `'invalid-primitive'` here rather than reaching the caller as a throw.
 */
export function createPrimitive(
  project: Project,
  spec: PrimitiveSpec,
  color: HexColor,
): OpResult & { objectId?: ObjectId } {
  let bound: number;
  try {
    bound = primitiveCellCount(spec);
  } catch (error) {
    return {
      ok: false,
      error: 'invalid-primitive',
      detail: error instanceof Error ? error.message : 'the spec names no cells',
    };
  }
  if (bound > DEFAULT_CELL_BUDGET) {
    return {
      ok: false,
      error: 'budget-exceeded',
      detail: `${bound} cells would exceed the budget of ${DEFAULT_CELL_BUDGET}`,
    };
  }
  const object = project.createVoxelObject({
    name: primitiveName(spec.kind),
    parentId: null,
    maskColor: project.nextMaskColor(),
    payload: { kind: 'uniform', grid: createPrimitiveGrid(spec, color) },
    // A primitive is created on the lattice: its payload starts at its own origin and the object is placed on a whole
    // cell of the world, which is what makes `alignToGrid` true for it.
    position: new Vector3(0, 0, 0),
  });
  const cells = object.uniform?.size ?? 0;
  return { ok: true, detail: `created ${object.name} as ${object.id} with ${cells} cells`, objectId: object.id, cells };
}

/** The name a new primitive carries, so the Scene list says what was made rather than which call made it. */
function primitiveName(kind: PrimitiveSpec['kind']): string {
  switch (kind) {
    case 'box':
      return 'Box';
    case 'sphere':
      return 'Sphere';
    case 'isometric':
      return 'Isometric';
    case 'terrain':
      return 'Terrain';
    default:
      return 'Primitive';
  }
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

/** Assigns the identity channel; never a cell color, and never a voxel write. */
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
 * An aligned object lands on the lattice, and it does so in two steps, both needed: the
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
 * Raises one object's subdivision to `subdivision`, a power of two at or above the level its grid already holds.
 * The payload is replaced by block replication, so the object's placement and the world extent of its
 * content are unchanged and it stays exactly as aligned as it was.
 *
 * Refused with data when the object has no grid (`'wrong-representation'`), when the level is below the one it
 * holds — coarsening is not offered — when the finer cells would leave the packed key space, and when the block
 * count would pass the budget. A level that is not a power of two is a programming error and throws.
 */
export function setObjectSubdivision(project: Project, objectId: ObjectId, subdivision: number): OpResult {
  if (!isSubdivision(subdivision)) {
    throw new RangeError(`subdivision must be a power of two, got ${subdivision}`);
  }
  const found = requireUniform(project, objectId);
  if (!found.ok) return found.result;
  const grid = found.grid;
  if (subdivision === grid.subdivision) {
    return { ok: true, detail: `${objectId} is already at subdivision ${subdivision}` };
  }
  if (subdivision < grid.subdivision) {
    return {
      ok: false,
      error: 'unsupported-subdivision',
      detail: `${objectId} is at subdivision ${grid.subdivision}; coarsening is not offered`,
    };
  }
  const levels = Math.round(Math.log2(subdivision / grid.subdivision));
  const factor = 2 ** levels;
  const bounds = grid.bounds();
  if (bounds !== null) {
    // Every cell becomes a `factor` block, so the extremes move to `min * factor` and `(max + 1) * factor - 1`.
    const lowest = Math.min(...bounds.min) * factor;
    const highest = (Math.max(...bounds.max) + 1) * factor - 1;
    if (lowest < KEY_MIN || highest > KEY_MAX) {
      return {
        ok: false,
        error: 'exceeds-grid',
        detail: `subdivision ${subdivision} would need cells outside [${KEY_MIN}, ${KEY_MAX}]; the model is too large to subdivide`,
      };
    }
  }
  const refined = grid.size * factor * factor * factor;
  if (refined > DEFAULT_CELL_BUDGET) {
    return {
      ok: false,
      error: 'budget-exceeded',
      detail: `${refined} cells would exceed the budget of ${DEFAULT_CELL_BUDGET}`,
    };
  }
  const payload = grid.subdividedBy(levels);
  project.setPayload(objectId, { kind: 'uniform', grid: payload });
  return { ok: true, detail: `subdivided ${objectId} to ${subdivision} (${payload.size} cells)` };
}

/**
 * Sets the flag behind the panel's `Grid align` checkbox. Switching it on pulls the object onto the lattice
 * there and then, because the flag is a property the object has to satisfy from that moment on, not a mode a
 * later edit applies; switching it off writes nothing but the flag.
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
