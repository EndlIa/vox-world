/**
 * The viewport's world grid: one of three displays, each a set of shader-drawn planes.
 *
 * The displays are the reference viewport's, and they are mutually exclusive rather than additive (README D49):
 *
 * - `floor` — one horizontal plane on the world's ground, which is the reference for building on it.
 * - `volume` — that ground plus the two walls that close a work cube, so a model can be read in three dimensions
 *   while it is being built rather than only from above.
 * - `multi` — one plane the user aims at an axis and slides along it, for work that does not happen on the ground.
 * - `off` — no grid at all.
 *
 * Every plane is a shader grid (`gridPlane.ts`), so its lines anti-alias and fade instead of dissolving into
 * noise with distance, and every plane is anchored in phase to the world's cell boundaries: the camera moves the
 * quad, never the lines. The whole display is decoration — layer 1, no depth write, no project data — and the
 * active object's own lattice is gone: a lattice at a model's own subdivision, on the model's own plane, read as a
 * sheet hanging in the air the moment the model left the ground, and a per-object grid is not what the reference
 * viewport shows at all (README D49, replacing the second layer D43 introduced).
 */

import * as THREE from 'three';
import { GRID_AXES, GridPlane } from './gridPlane.js';
import type { GridAxis } from './gridPlane.js';

/** The display settings the Grid group offers. */
export const GRID_MODES = ['off', 'floor', 'volume', 'multi'] as const;

export type GridMode = (typeof GRID_MODES)[number];

/** The viewport opens with a ground grid, which is what a model is placed against (README D41). */
export const DEFAULT_GRID_MODE: GridMode = 'floor';

/** The world's ground: the bottom plane of cell row zero, which is where placement starts (README D41). */
const GROUND_OFFSET = 0;

/** The work cube's half side, in world units, so its walls sit here at negative `x` and `z` (D49). */
const VOLUME_WALL_OFFSET = -60;

/** The moved plane starts vertical through the origin, which is where a centred model wants slicing. */
const DEFAULT_MULTI_AXIS: GridAxis = 'x';

export class WorldGrid {
  /** The owner adds this to its scene; it holds every display's planes and is the thing `dispose` empties. */
  readonly root: THREE.Group;

  /** Which planes each display shows. Never two displays at once, so nothing is ever drawn twice. */
  private readonly displays: Readonly<Record<GridMode, readonly GridPlane[]>>;

  private mode: GridMode = DEFAULT_GRID_MODE;

  private axis: GridAxis = DEFAULT_MULTI_AXIS;

  private offset = 0;

  constructor() {
    const floor = new GridPlane('y', GROUND_OFFSET);
    const volumeGround = new GridPlane('y', GROUND_OFFSET);
    const volumeWallX = new GridPlane('x', VOLUME_WALL_OFFSET);
    const volumeWallZ = new GridPlane('z', VOLUME_WALL_OFFSET);
    const multi = new GridPlane(this.axis, this.offset);
    const named: readonly [string, GridPlane][] = [
      ['world-grid-floor', floor],
      ['world-grid-volume-ground', volumeGround],
      ['world-grid-volume-wall-x', volumeWallX],
      ['world-grid-volume-wall-z', volumeWallZ],
      ['world-grid-multi', multi],
    ];
    for (const [name, plane] of named) plane.mesh.name = name;
    this.displays = { off: [], floor: [floor], volume: [volumeGround, volumeWallX, volumeWallZ], multi: [multi] };
    this.root = new THREE.Group();
    this.root.name = 'world-grid';
    this.root.add(...named.map(([, plane]) => plane.mesh));
    this.apply();
  }

  /** The display on screen. */
  get gridMode(): GridMode {
    return this.mode;
  }

  /** The axis the moved plane faces. */
  get multiAxis(): GridAxis {
    return this.axis;
  }

  /** Where the moved plane sits along that axis, in world units, which for a grid is whole cells. */
  get multiOffset(): number {
    return this.offset;
  }

  /** Switches displays; the argument has to name one, and a stranger is a programming error. */
  setMode(mode: GridMode): void {
    if (!GRID_MODES.includes(mode)) {
      throw new RangeError(`WorldGrid.setMode: unknown display ${String(mode)}`);
    }
    if (mode === this.mode) return;
    this.mode = mode;
    this.apply();
  }

  /** Aims the moved plane at `axis` and slides it to `offset`, a whole number of world units along that axis. */
  setMultiPlane(axis: GridAxis, offset: number): void {
    if (!GRID_AXES.includes(axis)) {
      throw new RangeError(`WorldGrid.setMultiPlane: unknown axis ${String(axis)}`);
    }
    if (!Number.isInteger(offset)) {
      throw new RangeError(`WorldGrid.setMultiPlane: offset must be a whole world unit, got ${offset}`);
    }
    this.axis = axis;
    this.offset = offset;
    this.displays.multi.forEach((plane) => plane.setFacing(axis, offset));
  }

  /** Puts the display's planes on `camera`: once a frame, after the camera itself has been settled. */
  update(camera: THREE.Camera): void {
    for (const plane of this.displays[this.mode]) plane.follow(camera);
  }

  /** Releases every display's planes. Safe to call twice. */
  dispose(): void {
    for (const planes of Object.values(this.displays)) {
      for (const plane of planes) plane.dispose();
    }
    this.root.clear();
  }

  private apply(): void {
    const shown = this.displays[this.mode];
    for (const planes of Object.values(this.displays)) {
      for (const plane of planes) plane.setVisible(shown.includes(plane));
    }
  }
}
