/**
 * The viewport's grids: a base reference at the world unit, and the active object's own lattice.
 *
 * The base layer is a plane at `y = 0` with lines every world unit and a brighter line every tenth, which is
 * how scale is read in a viewport that otherwise shows a bare model against a flat background (README D35).
 * The second layer is the *active* object's lattice, drawn at that object's own subdivision over its footprint
 * plus a margin of its cells (README D43): a grid at its own cell size, on its lowest occupied plane, in its own
 * frame. Where that layer is drawn the base layer is cut away, so the two never read as one grid at two scales.
 *
 * Both layers are decorations in every direction: layer 1 means the raycaster never picks them (it tests 0 and 2)
 * and an export never contains them (the export camera enables 0 alone), `depthWrite = false` means they cannot
 * occlude voxels, and `frameAll` ignores the layer, so a grid can never widen the framing of an import.
 *
 * It owns the two layers, their line geometry, and the three display settings behind the Grid group; it holds no
 * project data, does no per-frame work, and rebuilds a layer only when the caller hands it something new.
 */

import * as THREE from 'three';
import type { UniformGrid } from '../voxels/uniform/grid.js';

/** The viewport decoration layer (README D24); `overlay.ts` and `controls.ts` use the same number. */
const OVERLAY_LAYER = 1;

/** Side length of the base plane, in world units. A 14-unit model and a 60-unit island both fit inside it. */
const GRID_EXTENT = 200;
/** Base line spacing: the world unit itself (README D41, D43). */
const GRID_CELL = 1;
/** Every this many base cells the brighter line is drawn, matching the reference grid's 1 : 10 ratio. */
const GRID_MAJOR_EVERY = 10;

/**
 * Line colors and opacities. All are greys from the panel palette rather than the reference grid's pure white,
 * which reads as a stray frame line against this viewport's slate background; the major base lines stay brighter
 * than the minor ones, and the object's own lattice is brighter still so it is read as the finer measure.
 */
const MINOR_COLOR = 0x9aa2ad;
const MINOR_OPACITY = 0.28;
const MAJOR_COLOR = 0xe6e8ea;
const MAJOR_OPACITY = 0.5;
const LATTICE_COLOR = 0xe6e8ea;
const LATTICE_OPACITY = 0.6;

/** Cells of margin drawn around the active object's occupancy, and the Grid group's default for it. */
export const DEFAULT_GRID_MARGIN = 8;

/** An axis-aligned rectangle in world `x`/`z`: the base layer is cut away inside one. */
type Footprint = { minX: number; maxX: number; minZ: number; maxZ: number };

/** One decoration line set: its geometry is replaced wholesale on every rebuild. */
type LineSet = { readonly lines: THREE.LineSegments; readonly material: THREE.LineBasicMaterial };

function lineSet(color: number, opacity: number, renderOrder: number): LineSet {
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
  const lines = new THREE.LineSegments(new THREE.BufferGeometry(), material);
  lines.frustumCulled = false;
  lines.renderOrder = renderOrder;
  lines.layers.set(OVERLAY_LAYER);
  return { lines, material };
}

/** Replaces a line set's geometry with these segments and releases the geometry it had. */
function setVertices(set: LineSet, vertices: number[]): void {
  const previous = set.lines.geometry;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  set.lines.geometry = geometry;
  previous.dispose();
}

/**
 * The base plane's segments, with every line that runs through the footprint cut at its edges.
 *
 * A line's fixed coordinate decides whether it crosses the hole at all, and a crossing line is emitted as the one
 * or two pieces outside it, so the plane keeps its full extent and simply has a rectangle missing.
 */
function baseVertices(step: number, hole: Footprint | undefined): number[] {
  const half = GRID_EXTENT / 2;
  const vertices: number[] = [];
  for (let fixed = -half; fixed <= half; fixed += step) {
    const inHole = hole !== undefined && fixed > hole.minZ && fixed < hole.maxZ;
    pushSegment(vertices, -half, fixed, half, fixed, inHole ? hole!.minX : undefined, inHole ? hole!.maxX : undefined);
    const inHoleX = hole !== undefined && fixed > hole.minX && fixed < hole.maxX;
    pushSegment(vertices, fixed, -half, fixed, half, inHoleX ? hole!.minZ : undefined, inHoleX ? hole!.maxZ : undefined);
  }
  return vertices;
}

/** Appends a ground-plane segment from `from` to `to` along one axis, or its two pieces around `holeMin..holeMax`. */
function pushSegment(
  vertices: number[],
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  holeMin: number | undefined,
  holeMax: number | undefined,
): void {
  const alongX = fromZ === toZ;
  const start = alongX ? fromX : fromZ;
  const end = alongX ? toX : toZ;
  const pieces: [number, number][] = [];
  if (holeMin === undefined || holeMax === undefined || holeMin >= holeMax) {
    pieces.push([start, end]);
  } else {
    if (holeMin > start) pieces.push([start, Math.min(holeMin, end)]);
    if (holeMax < end) pieces.push([Math.max(holeMax, start), end]);
  }
  for (const [pieceStart, pieceEnd] of pieces) {
    if (pieceStart === pieceEnd) continue;
    if (alongX) vertices.push(pieceStart, 0, fromZ, pieceEnd, 0, fromZ);
    else vertices.push(fromX, 0, pieceStart, fromX, 0, pieceEnd);
  }
}

/**
 * The active object's own lattice: cell boundaries of its grid, on the plane of its lowest occupied cell, over
 * its occupancy plus `margin` cells on every side. Emitted in the object's own frame, so the owner places it with
 * the object's world matrix and a parent's rotation is carried rather than approximated.
 */
function latticeVertices(grid: UniformGrid, margin: number): { vertices: number[]; footprint: Footprint } | undefined {
  const bounds = grid.bounds();
  const cell = grid.cellSize;
  if (bounds === null) return undefined;
  const minX = (bounds.min[0] - margin) * cell;
  const maxX = (bounds.max[0] + 1 + margin) * cell;
  const minZ = (bounds.min[2] - margin) * cell;
  const maxZ = (bounds.max[2] + 1 + margin) * cell;
  const y = bounds.min[1] * cell;
  const vertices: number[] = [];
  for (let x = bounds.min[0] - margin; x <= bounds.max[0] + 1 + margin; x += 1) {
    vertices.push(x * cell, y, minZ, x * cell, y, maxZ);
  }
  for (let z = bounds.min[2] - margin; z <= bounds.max[2] + 1 + margin; z += 1) {
    vertices.push(minX, y, z * cell, maxX, y, z * cell);
  }
  return { vertices, footprint: { minX, maxX, minZ, maxZ } };
}

/** The world-space footprint of a local rectangle under a matrix: its `x`/`z` bounding box, so a turned object
 *  is cut into the base plane by its extent rather than exactly. */
function footprintOf(local: Footprint, matrixWorld: THREE.Matrix4): Footprint {
  const corners: [number, number][] = [
    [local.minX, local.minZ],
    [local.maxX, local.minZ],
    [local.minX, local.maxZ],
    [local.maxX, local.maxZ],
  ];
  const point = new THREE.Vector3();
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const [x, z] of corners) {
    point.set(x, 0, z).applyMatrix4(matrixWorld);
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  return { minX, maxX, minZ, maxZ };
}

export class WorldGrid {
  /** The owner adds this to its scene; it holds both layers and is the thing `dispose` empties. */
  readonly root: THREE.Group;

  private readonly base = new THREE.Group();
  private readonly lattice = new THREE.Group();
  private readonly minor: LineSet;
  private readonly major: LineSet;
  private readonly objectLines: LineSet;
  private baseOn = true;
  private objectOn = true;
  private marginCells = DEFAULT_GRID_MARGIN;
  /** What the lattice was last built for, so a repeat call with the same answer costs nothing. */
  private shown: { grid: UniformGrid; matrixWorld: THREE.Matrix4; margin: number } | undefined;

  constructor() {
    this.minor = lineSet(MINOR_COLOR, MINOR_OPACITY, 0);
    this.major = lineSet(MAJOR_COLOR, MAJOR_OPACITY, 1);
    setVertices(this.minor, baseVertices(GRID_CELL, undefined));
    setVertices(this.major, baseVertices(GRID_CELL * GRID_MAJOR_EVERY, undefined));
    this.base.name = 'world-grid-base';
    this.base.add(this.minor.lines, this.major.lines);

    this.objectLines = lineSet(LATTICE_COLOR, LATTICE_OPACITY, 2);
    this.objectLines.lines.matrixAutoUpdate = false;
    this.lattice.name = 'world-grid-lattice';
    this.lattice.add(this.objectLines.lines);
    this.lattice.visible = false;

    this.root = new THREE.Group();
    this.root.name = 'world-grid';
    this.root.add(this.base, this.lattice);
  }

  /** Whether the base plane is drawn. */
  get baseVisible(): boolean {
    return this.baseOn;
  }

  /** Whether the active object's lattice is drawn. */
  get objectVisible(): boolean {
    return this.objectOn;
  }

  /** Cells of lattice drawn outside the active object's occupancy. */
  get margin(): number {
    return this.marginCells;
  }

  /** Shows or hides the base plane; the active object's lattice is not affected. */
  setBaseVisible(visible: boolean): void {
    this.baseOn = visible;
    this.base.visible = visible;
  }

  /** Shows or hides the active object's lattice; the base plane's hole follows it. */
  setObjectVisible(visible: boolean): void {
    this.objectOn = visible;
    this.lattice.visible = visible && this.shown !== undefined;
  }

  /** Cells of lattice drawn outside the object's occupancy; a whole number, `0` for its footprint alone. */
  setMargin(cells: number): void {
    if (!Number.isInteger(cells) || cells < 0) {
      throw new RangeError(`WorldGrid.setMargin: cells must be a non-negative integer, got ${cells}`);
    }
    if (cells === this.marginCells) return;
    this.marginCells = cells;
    const shown = this.shown;
    if (shown === undefined) return;
    this.shown = undefined;
    this.showObjectLattice(shown.grid, shown.matrixWorld);
  }

  /**
   * Draws `grid` as the active object's lattice, placed by `matrixWorld`, or clears it when either is missing.
   *
   * The caller owns the decision to call this: a repeat with the same grid, matrix, and margin is skipped here,
   * and everything that can change the answer — a different active object, a subdivision, an edit, the margin —
   * comes through as a different argument.
   */
  showObjectLattice(grid: UniformGrid | undefined, matrixWorld: THREE.Matrix4 | undefined): void {
    if (
      grid !== undefined &&
      matrixWorld !== undefined &&
      this.shown?.grid === grid &&
      this.shown.matrixWorld.elements.join(',') === matrixWorld.elements.join(',') &&
      this.shown.margin === this.marginCells
    ) {
      return;
    }
    if (grid === undefined || matrixWorld === undefined) {
      this.shown = undefined;
      this.lattice.visible = false;
      setVertices(this.objectLines, []);
      this.setHole(undefined);
      return;
    }

    const built = latticeVertices(grid, this.marginCells);
    if (built === undefined) {
      this.shown = undefined;
      this.lattice.visible = false;
      setVertices(this.objectLines, []);
      this.setHole(undefined);
      return;
    }
    setVertices(this.objectLines, built.vertices);
    this.objectLines.lines.matrix.copy(matrixWorld);
    this.objectLines.lines.matrixWorldNeedsUpdate = true;
    this.shown = { grid, matrixWorld: matrixWorld.clone(), margin: this.marginCells };
    this.lattice.visible = this.objectOn;
    this.setHole(footprintOf(built.footprint, matrixWorld));
  }

  /** Cuts the base plane around this world-space rectangle, or restores it. */
  private setHole(hole: Footprint | undefined): void {
    setVertices(this.minor, baseVertices(GRID_CELL, hole));
    setVertices(this.major, baseVertices(GRID_CELL * GRID_MAJOR_EVERY, hole));
  }

  /** Releases every layer's geometry and material and empties the group. */
  dispose(): void {
    for (const set of [this.minor, this.major, this.objectLines]) {
      set.lines.geometry.dispose();
      set.material.dispose();
    }
    this.base.clear();
    this.lattice.clear();
    this.root.clear();
    this.shown = undefined;
  }
}
