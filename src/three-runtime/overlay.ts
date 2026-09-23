/**
 * Transient viewport feedback.
 *
 * Draws the box-drag preview frame with three's own `Box3Helper`, which supplies the box's 12 edges and puts
 * them on the box it is handed. It is strictly presentational: one wireframe object and one box, rewritten per
 * update, holding no persistent state, no document reference, and no source data. Layer 1 keeps it out of both
 * consumers — the picker's raycaster tests layer 0 only and the export camera enables layer 0 only (README D24).
 *
 * A `Box3Helper` draws an axis-aligned box in the space it sits in, so it is parented into the group that
 * carries the owning object's world matrix rather than added to the scene: a rotated or scaled object then
 * draws the rotated box the edit will write. Composing the two matrices that way is also what keeps a
 * non-uniform scale exact — decomposing their product into one transform, which the hand-written version did,
 * cannot express the shear that a rotation inside a scale produces.
 */

import type { HexColor, IntBox3 } from '../voxels/uniform/grid.js';
import { normalizeBox } from '../voxels/uniform/grid.js';
import * as THREE from 'three';

/** The viewport decoration layer (README D24); `controls.ts` uses the same number for its gizmo. */
const OVERLAY_LAYER = 1;
const DEFAULT_COLOR: HexColor = 0x38bdf8;
const OVERLAY_RENDER_ORDER = 1000;

export class Overlay {
  /** The owning object's space, which every update copies a world matrix onto. The scene's only added node. */
  private readonly space: THREE.Group;
  private readonly helper: THREE.Box3Helper;
  private readonly material: THREE.LineBasicMaterial;

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

    // The space is posed from the matrix `showBox` is handed, never from its own transform.
    this.space = new THREE.Group();
    this.space.matrixAutoUpdate = false;
    this.space.add(this.helper);
    // The group takes the layer too, so a child added later cannot escape it (README D24).
    this.space.traverse((child) => {
      child.layers.set(OVERLAY_LAYER);
    });
    this.space.visible = false;
    scene.add(this.space);
  }

  /**
   * Shows the inclusive integer box an edit will write, in the owning object's space.
   *
   * The box is min-corner indexed in cells and one cell is `cell` world units (README D41, D43), so the box runs
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

    this.space.matrix.copy(matrixWorld);
    // The matrix is written directly rather than composed from a transform, so the renderer has to be told to
    // recompute the space's world matrix — and, through it, the helper's own placement from the box.
    this.space.matrixWorldNeedsUpdate = true;
    this.material.color.setHex(color);
    this.space.visible = true;
  }

  clear(): void {
    this.space.visible = false;
  }

  /** Removes the frame from the scene and releases the helper's geometry and material. */
  dispose(): void {
    this.helper.dispose();
    this.space.removeFromParent();
  }
}

/** Rejects a box that is not an inclusive integer box; `showBox` never draws a degenerate frame. */
function requireIntegerCorners(box: IntBox3): void {
  const { min, max } = box;
  const integer =
    Number.isInteger(min[0]) &&
    Number.isInteger(min[1]) &&
    Number.isInteger(min[2]) &&
    Number.isInteger(max[0]) &&
    Number.isInteger(max[1]) &&
    Number.isInteger(max[2]);
  if (!integer) {
    throw new RangeError('Overlay.showBox: both box corners must be finite integers');
  }
}
