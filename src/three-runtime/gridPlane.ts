/**
 * One world grid plane: a quad whose grid a shader draws.
 *
 * The drawing is `@pmndrs/vanilla`'s `Grid` — the vanilla three descendant of the shader grid the reference
 * viewport is built on — so the lines are computed per fragment from screen-space derivatives rather than
 * tessellated. They anti-alias, they keep their apparent thickness, and the finer spacing fades out with distance
 * instead of collapsing into noise as the camera pulls back, which is what line geometry cannot do and why the
 * plane it replaces had to stop at 200 units (README D49).
 *
 * Three things here are ours rather than the library's, each because the display depends on it:
 *
 * - `onBeforeCompile` injects three's logarithmic-depth chunks. Rendering enables log depth (D40), and a plain
 *   `ShaderMaterial` writes an unencoded depth, so without them the plane sorts wrongly against every voxel.
 * - The plane follows the camera here, on the CPU, snapped to a whole cell, instead of through the library's own
 *   `followCamera`. That option shifts the grid inside the vertex shader, which slides the lines under a moving
 *   camera and leaves the mesh where a raycast would find nothing; moving the mesh by whole cells keeps the lines
 *   on the world's cell boundaries and keeps the geometry and the picture in agreement.
 * - Layer 1 and `depthWrite = false`: decoration the raycaster never tests, an export never contains, and voxels
 *   are never occluded by (README D24).
 */

import * as THREE from 'three';
import { Grid } from '@pmndrs/vanilla/core/Grid';

/** The viewport decoration layer (README D24); `overlay.ts` and `controls.ts` use the same number. */
const OVERLAY_LAYER = 1;

/** Below the decorations drawn on top of it — the voxel highlight and the camera path draw at 1000. */
const GRID_RENDER_ORDER = 0;

/** The plane's finer spacing: the world unit itself, so the lines are the cell boundaries (README D41). */
export const GRID_CELL_SIZE = 1;

/** Every this many cells the coarser, brighter spacing is drawn. */
export const GRID_SECTION_SIZE = 10;

/** Side of the quad, in world units: well beyond two fade radii, so its edge is never on screen. */
export const GRID_PLANE_EXTENT = 512;

/** Distance from the camera's own point on the plane at which the grid has faded out entirely. */
export const GRID_FADE_DISTANCE = 160;

/** Fade curve exponent; `1` is the library's default and reads as a straight falloff. */
const GRID_FADE_STRENGTH = 1;

/** Line thickness as its share of the spacing it belongs to, and the two colors the palette's greys give. */
const CELL_THICKNESS = 0.42;
const SECTION_THICKNESS = 0.55;
const CELL_COLOR = 0x9aa2ad;
const SECTION_COLOR = 0xe6e8ea;

/** The axes a plane can face. `y` is the horizontal one, so it is the world's ground (README D49). */
export const GRID_AXES = ['x', 'y', 'z'] as const;

export type GridAxis = (typeof GRID_AXES)[number];

/** The up-vector each axis turns the quad's own normal into, and the axes' indices for the component writes. */
const AXIS_NORMALS: Readonly<Record<GridAxis, THREE.Vector3>> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

const AXIS_INDICES: Readonly<Record<GridAxis, 0 | 1 | 2>> = { x: 0, y: 1, z: 2 };

/** Every axis, so a plane can snap the two components it does not face. */
const COMPONENT_INDICES = [0, 1, 2] as const;

/** The quad's own normal, before it is turned onto the axis the plane faces. */
const PLANE_NORMAL = new THREE.Vector3(0, 1, 0);

/**
 * Adds three's logarithmic-depth chunks to a shader pair.
 *
 * The renderer defines `USE_LOGARITHMIC_DEPTH_BUFFER` for every material and sets `logDepthBufFC` for every
 * program, but only these chunks read them: a custom shader without them writes a depth nothing else in the
 * scene can be compared against (README D40, D49). Pure, so the injection is checked without a GPU.
 */
export function withLogDepth(
  vertexShader: string,
  fragmentShader: string,
): { vertexShader: string; fragmentShader: string } {
  return {
    // `<common>` comes along because the vertex chunk calls `isPerspectiveMatrix`, which only that chunk defines:
    // a custom shader carries no other chunk that would have included it, so the vertex program would not compile.
    // The fragment side needs nothing of the sort — it reads varyings and a uniform, and the library's own
    // tonemapping chunk defines the one helper it borrows.
    vertexShader: insertChunks(
      vertexShader,
      '#include <common>\n#include <logdepthbuf_pars_vertex>',
      '#include <logdepthbuf_vertex>',
    ),
    fragmentShader: insertChunks(
      fragmentShader,
      '#include <logdepthbuf_pars_fragment>',
      '#include <logdepthbuf_fragment>',
    ),
  };
}

/**
 * Fades a line by how fast it varies across a pixel, which is what a unit grid needs in the distance.
 *
 * The library saturates a line as its spacing shrinks (`min(line, 1.0)`), which stops it flickering but leaves the
 * far field as a flat wash that beats against the pixel grid: neighbouring unit lines interfere and the horizon
 * reads as a dark cross-hatch. Attenuating by the screen-space derivative — the reference grid material's own
 * `maxNumberOfLines` clamp — removes those lines instead, so what survives at distance is the coarse spacing and
 * what reads up close is the fine one. Pure, and a no-op on any source that is not the library's grid function.
 */
export function withAnisotropicAttenuation(fragmentShader: string): string {
  return fragmentShader.replace(
    'return 1.0 - min(line, 1.0);',
    'return (1.0 - min(line, 1.0)) * clamp(1.0 / (length(vec2(dFdx(r.x), dFdy(r.x))) * 1.41421356 + 1.0) - 0.1, 0.0, 1.0);',
  );
}

/** Adds a declaration above `main` and a statement at the end of its body, or returns the source unchanged. */
function insertChunks(source: string, declaration: string, statement: string): string {
  const start = source.indexOf('void main() {');
  const end = source.lastIndexOf('}');
  if (start < 0 || end < start) return source;
  return `${source.slice(0, start)}${declaration}\n${source.slice(start, end)}${statement}\n${source.slice(end)}`;
}

export class GridPlane {
  /** The quad. Its owner adds it to the scene, sets its name, and calls `follow` once a frame. */
  readonly mesh: THREE.Mesh;

  /** The library's own uniform update, which measures the fade from the camera's point on the plane. */
  private readonly syncFade: (camera: THREE.Camera) => void;

  private readonly normal = new THREE.Vector3();

  /** The axis the plane faces, and where along it: both are read back on every follow, so both track `setFacing`. */
  private axis: GridAxis;

  private offset: number;

  /**
   * A plane facing `axis`, sitting `offset` world units along it: the ground is `y` at `0`, a wall is `x` or `z`
   * at some whole number of cells out.
   */
  constructor(axis: GridAxis, offset: number) {
    const { mesh, update } = Grid({
      args: [GRID_PLANE_EXTENT, GRID_PLANE_EXTENT],
      cellSize: GRID_CELL_SIZE,
      sectionSize: GRID_SECTION_SIZE,
      cellThickness: CELL_THICKNESS,
      sectionThickness: SECTION_THICKNESS,
      cellColor: new THREE.Color(CELL_COLOR),
      sectionColor: new THREE.Color(SECTION_COLOR),
      fadeDistance: GRID_FADE_DISTANCE,
      fadeStrength: GRID_FADE_STRENGTH,
      // Both of these move the grid in the shader, which is the one thing the display must not do: the quad is
      // moved instead, by whole cells, so the lines stay on the world's boundaries and so a raycast against the
      // mesh still finds the grid it can see (README D49).
      followCamera: false,
      infiniteGrid: false,
      side: THREE.DoubleSide,
    });
    mesh.layers.set(OVERLAY_LAYER);
    mesh.renderOrder = GRID_RENDER_ORDER;
    const material = mesh.material as THREE.ShaderMaterial;
    material.depthWrite = false;
    material.onBeforeCompile = (shader): void => {
      const patched = withLogDepth(shader.vertexShader, shader.fragmentShader);
      shader.vertexShader = patched.vertexShader;
      shader.fragmentShader = withAnisotropicAttenuation(patched.fragmentShader);
    };
    this.mesh = mesh;
    this.syncFade = update;
    this.axis = axis;
    this.offset = offset;
    this.setFacing(axis, offset);
  }

  /** Faces `axis` at `offset`: turns the quad onto it and records where along it the plane sits. */
  setFacing(axis: GridAxis, offset: number): void {
    if (!Number.isInteger(offset)) {
      throw new RangeError(`GridPlane.setFacing: offset must be a whole world unit, got ${offset}`);
    }
    this.axis = axis;
    this.normal.copy(AXIS_NORMALS[axis]);
    this.mesh.quaternion.setFromUnitVectors(PLANE_NORMAL, this.normal);
    this.offset = offset;
  }

  /**
   * Puts the quad on the camera: its two in-plane coordinates follow the camera projected onto the plane, snapped
   * to whole cells, while the coordinate along its normal stays the plane's own offset — which is what keeps a
   * wall a wall. The camera's point on the plane is then where the fade is measured from.
   */
  follow(camera: THREE.Camera): void {
    const index = AXIS_INDICES[this.axis];
    const target = this.mesh.position.copy(camera.position);
    for (const component of COMPONENT_INDICES) {
      target.setComponent(
        component,
        component === index ? this.offset : Math.round(target.getComponent(component) / GRID_CELL_SIZE) * GRID_CELL_SIZE,
      );
    }
    this.mesh.updateMatrixWorld();
    this.syncFade(camera);
  }

  setVisible(visible: boolean): void {
    this.mesh.visible = visible;
  }

  /** Releases the quad's geometry and material and takes it out of the scene. Safe to call twice. */
  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
