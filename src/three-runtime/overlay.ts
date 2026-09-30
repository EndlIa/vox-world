/**
 * Transient viewport feedback.
 *
 * Two drawings share one space: the box-drag frame, three's own `Box3Helper`, and the cell ghost — the cells an
 * operation would touch, one translucent unit cube per cell in a single `InstancedMesh`. It is strictly
 * presentational: one wireframe object, one instanced mesh, and the space that carries the owning object's world
 * matrix, rewritten per update, holding no persistent state, no document reference, and no source data. Layer 1
 * keeps both out of every consumer — the picker's raycaster tests layers 0 and 2 and the export camera enables
 * layer 0 alone.
 *
 * A `Box3Helper` draws an axis-aligned box in the space it sits in, so it is parented into the group that carries
 * the owning object's world matrix rather than added to the scene: a rotated or scaled object then draws the
 * rotated box the edit will write. Composing the two matrices that way is also what keeps a non-uniform scale
 * exact — decomposing their product into one transform, which the hand-written version did, cannot express the
 * shear that a rotation inside a scale produces. The ghost is instanced in the same space for the same reason: its
 * instance matrices are cell-sized cubes in the object's own cells, and the space is what turns them into world.
 *
 * Each drawing carries its own visibility, so a hover ghost never removes a committed frame: `clear()` hides both,
 * and `hideCells()` hides only the ghost.
 */

import type { HexColor, IntBox3 } from '../voxels/uniform/grid.js';
import { normalizeBox } from '../voxels/uniform/grid.js';
import * as THREE from 'three';

/** The viewport decoration layer; `controls.ts` uses the same number for its gizmo. */
const OVERLAY_LAYER = 1;
const DEFAULT_COLOR: HexColor = 0x38bdf8;
const OVERLAY_RENDER_ORDER = 1000;
/** How many instances the ghost starts with; the mesh is replaced with a larger one when a drawing needs more. */
const GHOST_CAPACITY = 256;
/** The ghost is see-through and drawn over the model, so a cell it marks is never hidden by the voxel in front of it. */
const GHOST_OPACITY = 0.32;

export class Overlay {
  /** The owning object's space, which every update copies a world matrix onto. The scene's only added node. */
  private readonly space: THREE.Group;
  private readonly helper: THREE.Box3Helper;
  private readonly material: THREE.LineBasicMaterial;
  /** The cells of the current ghost: one unit cube per instance, placed at the cell's own centre. */
  private ghost: THREE.InstancedMesh;
  private readonly ghostGeometry: THREE.BoxGeometry;
  private readonly ghostMaterial: THREE.MeshBasicMaterial;
  private readonly ghostMatrix = new THREE.Matrix4();

  constructor(scene: THREE.Scene) {
    if (!(scene instanceof THREE.Scene)) {
      throw new TypeError('Overlay: the constructor argument must be a THREE.Scene');
    }

    // The box is the live one the helper reads, so an update rewrites two triples instead of a transform, and
    // the helper's own `updateMatrixWorld` is what places the frame. Its material comes from the library with a
    // generic `Material` type, so it is narrowed once here.
    this.helper = new THREE.Box3Helper(new THREE.Box3(), DEFAULT_COLOR);
    this.helper.frustumCulled = false;
    this.helper.renderOrder = OVERLAY_RENDER_ORDER;
    this.material = this.helper.material as THREE.LineBasicMaterial;
    this.material.depthTest = false;
    this.material.transparent = true;
    this.helper.visible = false;

    this.ghostGeometry = new THREE.BoxGeometry(1, 1, 1);
    this.ghostMaterial = new THREE.MeshBasicMaterial({
      color: DEFAULT_COLOR,
      transparent: true,
      opacity: GHOST_OPACITY,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.ghost = this.buildGhost(GHOST_CAPACITY);

    // The space is posed from the matrix `showBox` is handed, never from its own transform. It stays visible and
    // always in the scene: what shows is decided per drawing, so one of them can be cleared without the other.
    this.space = new THREE.Group();
    this.space.matrixAutoUpdate = false;
    this.space.add(this.helper);
    this.space.add(this.ghost);
    // The group takes the layer too, so a child added later cannot escape it.
    this.space.traverse((child) => {
      child.layers.set(OVERLAY_LAYER);
    });
    scene.add(this.space);
  }

  /**
   * Shows the inclusive integer box an edit will write, in the owning object's space.
   *
   * The box is min-corner indexed in cells and one cell is `cell` world units, so the box runs
   * from `min * cell` to `(max + 1) * cell` in the owning object's space, and the space is put on the world matrix
   * the caller hands over: the frame follows the object's own position, orientation, and scale, at the object's own
   * cell size, whatever its subdivision.
   */
  showBox(
    boxLocal: IntBox3,
    matrixWorld: THREE.Matrix4,
    cell: number,
    color: HexColor = DEFAULT_COLOR,
  ): void {
    if (!(matrixWorld instanceof THREE.Matrix4)) {
      throw new TypeError('Overlay.showBox: matrixWorld must be a THREE.Matrix4');
    }
    if (!Number.isFinite(cell) || cell <= 0) {
      throw new RangeError(`Overlay.showBox: cell must be a positive finite number, got ${cell}`);
    }
    requireIntegerCorners(boxLocal);

    const box = normalizeBox(boxLocal.min, boxLocal.max);
    this.helper.box.min.set(box.min[0] * cell, box.min[1] * cell, box.min[2] * cell);
    this.helper.box.max.set(
      (box.max[0] + 1) * cell,
      (box.max[1] + 1) * cell,
      (box.max[2] + 1) * cell,
    );

    this.pose(matrixWorld);
    this.material.color.setHex(color);
    this.helper.visible = true;
  }

  /**
   * Shows one translucent cube per cell, in the owning object's space: the cells an operation would touch, which is
   * what makes a preview of a colour group or an island as legible as a preview of a box. `cells` is a flat list of
   * integer cell coordinates — `x, y, z` per cell, the same min-corner indexing the grid uses — and a cell is drawn
   * from `x * cell` to `(x + 1) * cell`, so the space's own matrix is what places it on the object.
   *
   * The mesh grows to whatever the caller hands over, in powers of two, and keeps the instances it drew last until
   * the next call or `hideCells`.
   */
  showCells(cells: readonly number[], matrixWorld: THREE.Matrix4, cell: number, color: HexColor = DEFAULT_COLOR): void {
    if (!(matrixWorld instanceof THREE.Matrix4)) {
      throw new TypeError('Overlay.showCells: matrixWorld must be a THREE.Matrix4');
    }
    if (!Number.isFinite(cell) || cell <= 0) {
      throw new RangeError(`Overlay.showCells: cell must be a positive finite number, got ${cell}`);
    }
    if (cells.length % 3 !== 0) {
      throw new RangeError(`Overlay.showCells: cells must be x, y, z triples, got ${cells.length} numbers`);
    }
    for (const value of cells) {
      if (!Number.isInteger(value)) {
        throw new RangeError(`Overlay.showCells: a cell coordinate must be an integer, got ${value}`);
      }
    }

    const count = cells.length / 3;
    this.ensureGhostCapacity(count);
    for (let index = 0; index < count; index += 1) {
      const x = cells[index * 3] as number;
      const y = cells[index * 3 + 1] as number;
      const z = cells[index * 3 + 2] as number;
      // A unit cube is centred on its own origin, so the scale is the cell size and the position is the cell's
      // centre: `x * cell` is its min corner, and half a cell further is its middle.
      this.ghostMatrix.makeScale(cell, cell, cell);
      this.ghostMatrix.setPosition((x + 0.5) * cell, (y + 0.5) * cell, (z + 0.5) * cell);
      this.ghost.setMatrixAt(index, this.ghostMatrix);
    }
    this.ghost.count = count;
    this.ghost.instanceMatrix.needsUpdate = true;
    this.pose(matrixWorld);
    this.ghostMaterial.color.setHex(color);
    this.ghost.visible = count > 0;
  }

  /** Hides the ghost and leaves the frame as it is: a hover that left the model takes only its own drawing away. */
  hideCells(): void {
    this.ghost.visible = false;
    this.ghost.count = 0;
  }

  /** Hides both drawings. */
  clear(): void {
    this.helper.visible = false;
    this.hideCells();
  }

  /** Removes both drawings from the scene and releases their geometry and materials. */
  dispose(): void {
    this.helper.dispose();
    this.ghostGeometry.dispose();
    this.ghostMaterial.dispose();
    this.space.removeFromParent();
  }

  /** Puts the space on a world matrix and tells the renderer to recompute it, since it is written directly. */
  private pose(matrixWorld: THREE.Matrix4): void {
    this.space.matrix.copy(matrixWorld);
    this.space.matrixWorldNeedsUpdate = true;
  }

  /** Replaces the mesh when a drawing needs more instances than it holds, doubling until it fits. */
  private ensureGhostCapacity(count: number): void {
    if (count <= this.ghost.instanceMatrix.count) return;
    let capacity = this.ghost.instanceMatrix.count;
    while (capacity < count) capacity *= 2;
    this.space.remove(this.ghost);
    this.ghost.dispose();
    this.ghost = this.buildGhost(capacity);
    this.space.add(this.ghost);
    this.ghost.layers.set(OVERLAY_LAYER);
  }

  /** One instanced mesh with nothing drawn yet; the capacity is fixed per mesh, which is why it can be replaced. */
  private buildGhost(capacity: number): THREE.InstancedMesh {
    const ghost = new THREE.InstancedMesh(this.ghostGeometry, this.ghostMaterial, capacity);
    ghost.frustumCulled = false;
    ghost.renderOrder = OVERLAY_RENDER_ORDER;
    ghost.count = 0;
    ghost.visible = false;
    return ghost;
  }
}

/** Rejects a box that is not an inclusive integer box; `showBox` never draws a degenerate frame. */
function requireIntegerCorners(box: IntBox3): void {
  const corners = [...box.min, ...box.max];
  for (const value of corners) {
    if (!Number.isInteger(value)) {
      throw new RangeError(`Overlay.showBox: both box corners must be finite integers, got ${value}`);
    }
  }
}
