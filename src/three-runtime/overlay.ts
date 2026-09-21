/**
 * Transient viewport feedback.
 *
 * Draws the box-drag preview frame and the picked leaf's bounds wireframe. It is strictly
 * presentational: one wireframe object, rewritten per update, holding no persistent state, no document
 * reference, and no source data. Layer 1 keeps it out of both consumers — the picker's raycaster tests
 * layer 0 only and the export camera enables layer 0 only (README D24).
 */

import type { HexColor, IntBox3 } from '../voxels/uniform/grid.js';
import { normalizeBox } from '../voxels/uniform/grid.js';
import * as THREE from 'three';

/** The viewport decoration layer (README D24); `controls.ts` uses the same number for its guide. */
const OVERLAY_LAYER = 1;
const DEFAULT_COLOR: HexColor = 0x38bdf8;
const OVERLAY_RENDER_ORDER = 1000;

/** The 12 edges of a unit cube centered on the origin, as 24 line-segment vertices. Read-only. */
const CUBE_EDGES = new Float32Array([
  -0.5, -0.5, -0.5, 0.5, -0.5, -0.5,
  -0.5, -0.5, 0.5, 0.5, -0.5, 0.5,
  -0.5, 0.5, -0.5, 0.5, 0.5, -0.5,
  -0.5, 0.5, 0.5, 0.5, 0.5, 0.5,

  -0.5, -0.5, -0.5, -0.5, 0.5, -0.5,
  -0.5, -0.5, 0.5, -0.5, 0.5, 0.5,
  0.5, -0.5, -0.5, 0.5, 0.5, -0.5,
  0.5, -0.5, 0.5, 0.5, 0.5, 0.5,

  -0.5, -0.5, -0.5, -0.5, -0.5, 0.5,
  0.5, -0.5, -0.5, 0.5, -0.5, 0.5,
  -0.5, 0.5, -0.5, -0.5, 0.5, 0.5,
  0.5, 0.5, -0.5, 0.5, 0.5, 0.5,
]);

/** Scratch matrices, so a pointer-move update allocates nothing. */
const _placement = new THREE.Matrix4();
const _scale = new THREE.Matrix4();

export class Overlay {
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.LineBasicMaterial;
  private readonly lines: THREE.LineSegments;

  constructor(scene: THREE.Scene) {
    if (!(scene instanceof THREE.Scene)) {
      throw new TypeError('Overlay: the constructor argument must be a THREE.Scene');
    }

    this.geometry = new THREE.BufferGeometry();
    // Allocated once; every update only moves and scales this unit cube, never rewriting vertices.
    this.geometry.setAttribute('position', new THREE.BufferAttribute(CUBE_EDGES, 3));
    this.material = new THREE.LineBasicMaterial({ depthTest: false, transparent: true });
    this.lines = new THREE.LineSegments(this.geometry, this.material);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = OVERLAY_RENDER_ORDER;
    this.lines.layers.set(OVERLAY_LAYER);
    this.lines.visible = false;
    scene.add(this.lines);
  }

  /**
   * Shows the inclusive integer box an edit will write, in the owning object's space.
   *
   * The box is min-corner indexed in cells, so its local extents are `min * voxelSize` to
   * `(max + 1) * voxelSize`, and the wireframe matrix is
   * `matrixWorld * translate(center) * scale(size)`.
   */
  showBox(boxLocal: IntBox3, voxelSize: number, matrixWorld: THREE.Matrix4, color: HexColor = DEFAULT_COLOR): void {
    if (!Number.isFinite(voxelSize) || voxelSize <= 0) {
      throw new RangeError(`Overlay.showBox: voxelSize must be a finite positive number, got ${voxelSize}`);
    }
    if (!(matrixWorld instanceof THREE.Matrix4)) {
      throw new TypeError('Overlay.showBox: matrixWorld must be a THREE.Matrix4');
    }
    requireIntegerCorners(boxLocal);

    const box = normalizeBox(boxLocal.min, boxLocal.max);
    const minX = box.min[0] * voxelSize;
    const minY = box.min[1] * voxelSize;
    const minZ = box.min[2] * voxelSize;
    const maxX = (box.max[0] + 1) * voxelSize;
    const maxY = (box.max[1] + 1) * voxelSize;
    const maxZ = (box.max[2] + 1) * voxelSize;

    _placement.makeTranslation((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
    _placement.multiply(_scale.makeScale(maxX - minX, maxY - minY, maxZ - minZ));
    _placement.premultiply(matrixWorld);
    _placement.decompose(this.lines.position, this.lines.quaternion, this.lines.scale);

    this.material.color.setHex(color);
    this.lines.visible = true;
  }

  /** Shows one leaf's bounds, centered on a world-space point. */
  showLeafBounds(centerWorld: THREE.Vector3, size: number, color: HexColor = DEFAULT_COLOR): void {
    if (!Number.isFinite(size) || size <= 0) {
      throw new RangeError(`Overlay.showLeafBounds: size must be a finite positive number, got ${size}`);
    }
    if (!(centerWorld instanceof THREE.Vector3)) {
      throw new TypeError('Overlay.showLeafBounds: centerWorld must be a THREE.Vector3');
    }

    this.lines.position.copy(centerWorld);
    this.lines.quaternion.identity();
    this.lines.scale.set(size, size, size);

    this.material.color.setHex(color);
    this.lines.visible = true;
  }

  clear(): void {
    this.lines.visible = false;
  }

  /** Removes the wireframe from the scene and releases its geometry and material. */
  dispose(): void {
    this.lines.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
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
