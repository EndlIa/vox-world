/**
 * Picking.
 *
 * Turns a viewport pointer position into voxel identity by raycasting the mirrored meshes and
 * resolving the hit's `instanceId` through `SceneMirror.lookupOf()` — no CPU voxel traversal
 * (README D5). A hit on an imported raw mesh (layer 2) has no instances and no lookup, so it resolves
 * to the object its mesh was attached to instead (README D24). The camera that rendered the viewport
 * is a parameter, never the mirror's output camera (README D17).
 *
 * It never mutates the scene graph, the document, or voxel data, and holds no state beyond a reused
 * `Raycaster`.
 */

import type { ObjectId } from '../document/project.js';
import type { HexColor } from '../voxels/uniform/grid.js';
import * as THREE from 'three';
import type { SceneMirror } from './scene.js';

export type PickHit =
  | {
      kind: 'cell';
      objectId: ObjectId;
      cell: [number, number, number];
      color: HexColor;
      point: THREE.Vector3;
    }
  | {
      /** An imported raw mesh: the hit names its object and nothing finer (README D24). */
      kind: 'object';
      objectId: ObjectId;
      point: THREE.Vector3;
    };

export type SurfaceHit = {
  objectId: ObjectId;
  pointWorld: THREE.Vector3;
  pointLocal: THREE.Vector3;
};

type Payload = { kind: 'cell'; cell: [number, number, number]; color: HexColor } | { kind: 'object' };

/** One resolved hit, carrying only values the lookup provided. */
type Candidate = {
  objectId: ObjectId;
  distance: number;
  point: THREE.Vector3;
  payload: Payload;
};

/** The voxel-content layer (README D24); layer 1 is viewport feedback, layer 2 the raw meshes. */
const SCENE_LAYER = 0;
/** The imported-source-mesh layer (README D24), enabled alongside layer 0 on the raycaster. */
const SOURCE_LAYER = 2;

export class Picker {
  private readonly mirror: SceneMirror;
  private readonly raycaster = new THREE.Raycaster();

  constructor(mirror: SceneMirror) {
    this.mirror = mirror;
    // Layers 0 and 2: voxel content and the imported raw meshes. Layer 1 holds the viewport
    // decorations and the gizmo, which can never be picked (README D24).
    this.raycaster.layers.set(SCENE_LAYER);
    this.raycaster.layers.enable(SOURCE_LAYER);
  }

  /** The best hit under `ndc`, or `undefined` when nothing resolvable and on screen is there. */
  pick(ndc: THREE.Vector2, camera: THREE.PerspectiveCamera): PickHit | undefined {
    const winner = this.resolve(ndc, camera);
    if (winner === undefined) return undefined;

    if (winner.payload.kind === 'object') {
      return { kind: 'object', objectId: winner.objectId, point: winner.point.clone() };
    }

    return {
      kind: 'cell',
      objectId: winner.objectId,
      cell: winner.payload.cell,
      color: winner.payload.color,
      point: winner.point.clone(),
    };
  }

  /** The best hit's surface point in world space and in the owning object's local space. */
  pickSurface(ndc: THREE.Vector2, camera: THREE.PerspectiveCamera): SurfaceHit | undefined {
    const winner = this.resolve(ndc, camera);
    if (winner === undefined) return undefined;

    const owner = this.mirror.objectOf(winner.objectId);
    if (owner === undefined) return undefined;

    return {
      objectId: winner.objectId,
      pointWorld: winner.point.clone(),
      pointLocal: owner.worldToLocal(winner.point.clone()),
    };
  }

  /** Builds every resolvable candidate and returns the first in the fixed overlap order. */
  private resolve(ndc: THREE.Vector2, camera: THREE.PerspectiveCamera): Candidate | undefined {
    if (!Number.isFinite(ndc.x) || !Number.isFinite(ndc.y)) {
      throw new RangeError(`Picker: ndc is not finite (${ndc.x}, ${ndc.y})`);
    }
    if (!(camera instanceof THREE.PerspectiveCamera)) {
      throw new TypeError('Picker: the camera argument must be a THREE.PerspectiveCamera');
    }

    // The ray has to come from the state the viewport was drawn with; the caller owns the projection
    // matrix, and refreshing the derived world matrix keeps this call correct within one tick of a
    // camera move.
    camera.updateMatrixWorld();
    this.raycaster.setFromCamera(ndc, camera);

    let winner: Candidate | undefined;
    for (const hit of this.raycaster.intersectObject(this.mirror.scene, true)) {
      const candidate = this.candidateOf(hit);
      if (candidate === undefined) continue;
      if (winner === undefined || compareCandidates(candidate, winner) < 0) winner = candidate;
    }
    return winner;
  }

  private candidateOf(hit: THREE.Intersection): Candidate | undefined {
    const ownerId: unknown = hit.object.userData['objectId'];
    if (typeof ownerId !== 'string') return undefined;
    if (this.mirror.objectOf(ownerId) === undefined) return undefined;

    const instanceId = hit.instanceId;
    if (instanceId === undefined) {
      // Every instance mesh the mirror builds carries an `instanceId`, so a tagged hit without one is
      // a raw source mesh on layer 2. Hiding a source mesh is `visible = false`, which the raycaster
      // does not test, so an off-screen mesh would otherwise steal every click on the voxels it
      // produced: the visibility of the whole chain is part of being pickable.
      if (!isVisible(hit.object)) return undefined;
      return { objectId: ownerId, distance: hit.distance, point: hit.point, payload: { kind: 'object' } };
    }

    const lookup = this.mirror.lookupOf(ownerId);
    if (lookup === undefined) return undefined;

    const instanceBase: unknown = hit.object.userData['instanceBase'];
    const index = instanceId + (typeof instanceBase === 'number' ? instanceBase : 0);
    const base = { objectId: ownerId, distance: hit.distance, point: hit.point };

    const cell = lookup.cells[index];
    const color = lookup.colors[index];
    if (cell === undefined || color === undefined) return undefined;
    return { ...base, payload: { kind: 'cell', cell: [cell[0], cell[1], cell[2]], color } };
  }
}

/**
 * Whether a hit is actually shown. `Raycaster` tests layers but never `visible`, so a source mesh the
 * mirror hid — or one under an object the user hid — would otherwise keep claiming picks on the voxels
 * it produced.
 */
function isVisible(object: THREE.Object3D): boolean {
  let node: THREE.Object3D | null = object;
  while (node !== null) {
    if (!node.visible) return false;
    node = node.parent;
  }
  return true;
}

/**
 * The fixed overlap order (README D5): the nearer hit, then ascending `objectId`, then ascending
 * `(x, y, z)`, which keeps the comparator total, geometry-free and deterministic — the same ray always
 * yields the same hit.
 *
 * A raw source mesh and a voxel instance are two surfaces of the same object that overlap by
 * construction, so two hits of different kinds are separated by distance alone: a voxel instance behind
 * the raw mesh it was produced from must not take the pick and hide the surface the user clicked.
 */
function compareCandidates(a: Candidate, b: Candidate): number {
  if ((a.payload.kind === 'object') !== (b.payload.kind === 'object')) return a.distance - b.distance;

  if (a.distance !== b.distance) return a.distance - b.distance;

  if (a.objectId !== b.objectId) return a.objectId < b.objectId ? -1 : 1;
  if (a.payload.kind !== 'cell' || b.payload.kind !== 'cell') return 0;

  const [ax, ay, az] = a.payload.cell;
  const [bx, by, bz] = b.payload.cell;
  if (ax !== bx) return ax < bx ? -1 : 1;
  if (ay !== by) return ay < by ? -1 : 1;
  if (az !== bz) return az < bz ? -1 : 1;
  return 0;
}
