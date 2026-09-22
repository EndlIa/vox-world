/**
 * The world grid: a reference plane at `y = 0` that says how big a metre is.
 *
 * Two `GridHelper`s on the viewport-decoration layer: a fine one at one metre and a coarse one whose
 * lines are ten metres apart and brighter, which is the two-level arrangement the previous project's
 * editor grid uses (`GridMaterial` with `gridRatio = 1`, `majorUnitFrequency = 20`,
 * `minorUnitVisibility = 0.4`, white lines). They are the only way to read scale in a viewport that
 * otherwise shows a bare model against a flat background, and they are decorative in every direction:
 * layer 1 means the raycaster never picks them (it tests 0 and 2) and an export never contains them
 * (the export camera enables 0 alone), `depthWrite = false` means they cannot occlude voxels, and
 * `frameAll` ignores the layer, so a grid can never widen the framing of an import.
 *
 * It owns its two helpers and nothing else: no state, no per-frame work, no project data.
 */

import * as THREE from 'three';

/** The viewport decoration layer (README D24); `overlay.ts` and `controls.ts` use the same number. */
const OVERLAY_LAYER = 1;

/** Side length of the grid, in metres. A 14 m model and a 60 m island both fit inside it. */
const GRID_EXTENT = 200;
/** Minor cell size in metres: the unit the grid is read in. */
const GRID_CELL = 1;
/** Major lines every this many minor cells, matching the 1 : 20 ratio of the reference grid. */
const GRID_MAJOR_EVERY = 10;

/**
 * Line colours and opacities. Both are greys from the panel palette rather than the reference grid's pure
 * white, which reads as a stray frame line against this viewport's slate background; the major lines stay
 * brighter than the minor ones so the two levels are told apart.
 */
const MINOR_COLOR = 0x9aa2ad;
const MINOR_OPACITY = 0.28;
const MAJOR_COLOR = 0xe6e8ea;
const MAJOR_OPACITY = 0.5;

/** A `GridHelper` on the decoration layer that draws without writing depth. */
function helper(size: number, divisions: number, color: number, opacity: number): THREE.GridHelper {
  const lines = new THREE.GridHelper(size, divisions, color, color);
  const { material } = lines;
  material.transparent = true;
  material.opacity = opacity;
  material.depthWrite = false;
  lines.layers.set(OVERLAY_LAYER);
  return lines;
}

export class WorldGrid {
  /** The owner adds this to its scene; it holds both levels and is the thing `dispose` empties. */
  readonly root: THREE.Group;

  constructor() {
    const minor = helper(GRID_EXTENT, GRID_EXTENT / GRID_CELL, MINOR_COLOR, MINOR_OPACITY);
    const major = helper(GRID_EXTENT, GRID_EXTENT / (GRID_CELL * GRID_MAJOR_EVERY), MAJOR_COLOR, MAJOR_OPACITY);
    // Both levels share `y = 0`, so the brighter one is drawn after the fainter one where they coincide;
    // neither writes depth, so voxels below the plane still render through it.
    major.renderOrder = 1;
    this.root = new THREE.Group();
    this.root.name = 'world-grid';
    this.root.add(minor, major);
  }

  /** Releases both helpers' geometries and materials and empties the group. */
  dispose(): void {
    for (const child of [...this.root.children]) {
      this.root.remove(child);
      if (child instanceof THREE.GridHelper) {
        child.geometry.dispose();
        child.material.dispose();
      }
    }
  }
}
