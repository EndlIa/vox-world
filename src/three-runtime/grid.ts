/**
 * The viewport's world grid: one horizontal plane of shader-drawn lines on the world's ground.
 *
 * It is the only grid. The vertical displays the previous rewrite offered — `volume`'s two walls and the movable
 * `multi` plane — are gone, and so is the second copy of the ground the volume display carried: vox-world places and
 * aligns content on the world lattice itself (README D41, D42), and a wall of grid is a reference nothing here is
 * built against. The active object's own lattice is gone as well (README D49).
 *
 * The look is the reference viewport's floor plane (README D35, D49): one white line per world cell, a brighter one
 * every `GRID_SECTION_SIZE` cells, drawn by `@pmndrs/vanilla`'s shader grid with three pure patches — three's
 * logarithmic-depth chunks, the reference's derivative-based line attenuation (without it a unit grid beats against
 * the pixel grid at the horizon), and no distance fade at all, because the reference's grid does not fade with
 * distance: what ends a line there is how tightly it packs on screen. There is deliberately no fill colour and no
 * overall plane alpha: the reference's floor is a dark translucent surface, and over this viewport's slate
 * background that would only darken what is already there.
 *
 * The quad lies in the world's `xz` plane without any turn of its own: the library's vertex program swizzles the
 * geometry (`localPosition = position.xzy`) before the model matrix, so an unturned `PlaneGeometry` already lies in
 * the plane whose normal is the world's up. Turning the mesh as well would stand the grid up as a wall, and the
 * library's own `followCamera`/`infiniteGrid` are off for the related reason: both move the grid inside the shader,
 * while the quad is moved instead, by whole cells.
 *
 * The whole grid is decoration: layer 1, so the picker's raycaster (layers 0 and 2) never hits it and no export
 * frame contains it (README D24), and `depthWrite = false`, so it cannot occlude a voxel below the plane. The camera
 * moves the quad, never the lines: `update` re-centres it on the camera snapped to whole cells, so the lines stay on
 * the world's cell boundaries however far the viewport travels.
 */

import * as THREE from 'three';
import { Grid } from '@pmndrs/vanilla/core/Grid';
import { insertChunks } from './shaderPatch.js';

/** The viewport decoration layer (README D24); `overlay.ts`, `controls.ts`, and the drawings share the number. */
const OVERLAY_LAYER = 1;

/** Below the decorations drawn on top of it — the box preview and the camera path draw at 1000. */
const GRID_RENDER_ORDER = 0;

/** The plane's finer spacing: the world unit itself, so the lines are the cell boundaries (README D41). */
export const GRID_CELL_SIZE = 1;

/** Every this many cells the brighter line is drawn, which is the reference material's `majorUnitFrequency`. */
export const GRID_SECTION_SIZE = 20;

/**
 * Side of the quad, in world units. With no distance fade the grid has to end at the quad's own edge, so this is
 * large enough that the edge stays off screen in any view of demo-scale content; the reference answers the same
 * problem with a disc of radius 5100.
 */
export const GRID_PLANE_EXTENT = 4096;

/** Line half-width in pixels, as the share of a cell the library's line function reads. */
const CELL_THICKNESS = 0.42;
const SECTION_THICKNESS = 0.55;

/** One colour for both levels: the brightness difference comes from the line coverage, not from two greys. */
const GRID_LINE_COLOR = 0xffffff;

/**
 * Adds three's logarithmic-depth chunks to a shader pair.
 *
 * The renderer defines `USE_LOGARITHMIC_DEPTH_BUFFER` for every material and sets `logDepthBufFC` for every
 * program, but only these chunks read them: a custom shader without them writes a depth nothing else in the
 * scene can be compared against (README D40). Pure, so the injection is checked without a GPU.
 */
export function withLogDepth(
  vertexShader: string,
  fragmentShader: string,
): { vertexShader: string; fragmentShader: string } {
  return {
    // `<common>` comes along because the vertex chunk calls `isPerspectiveMatrix`, which only that chunk defines:
    // a custom shader carries no other chunk that would have included it, so the vertex program would not compile.
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
 * anisotropy clamp — removes those lines instead, so what survives at distance is the coarse spacing and what reads
 * up close is the fine one. Pure, and a no-op on any source that does not carry the library's grid function.
 */
export function withAnisotropicAttenuation(fragmentShader: string): string {
  return fragmentShader.replace(
    'return 1.0 - min(line, 1.0);',
    'return (1.0 - min(line, 1.0)) * clamp(1.0 / (length(vec2(dFdx(r.x), dFdy(r.x))) * 1.41421356 + 1.0) - 0.1, 0.0, 1.0);',
  );
}

/**
 * Drops the library's distance fade.
 *
 * The library multiplies a line's alpha by `pow(1 - min(dist / fadeDistance, 1), fadeStrength)`, which dissolves the
 * whole grid past a fixed distance from the camera's own point on the plane. The reference has no such term — its
 * grid reaches the plane's edge, and only the derivative clamp above thins it — so the fade factor is replaced by
 * the constant it approaches at the camera. Pure, and a no-op on any source that does not carry the library's fade.
 */
export function withoutDistanceFade(fragmentShader: string): string {
  return fragmentShader.replace(
    'float d = 1.0 - min(dist / fadeDistance, 1.0);',
    'float d = 1.0;',
  );
}

export class WorldGrid {
  /** The owner adds this to its scene; `dispose` empties it and `setVisible` is the one switch over it. */
  readonly root: THREE.Group;

  private readonly plane: THREE.Mesh;

  constructor() {
    const { mesh } = Grid({
      args: [GRID_PLANE_EXTENT, GRID_PLANE_EXTENT],
      cellSize: GRID_CELL_SIZE,
      sectionSize: GRID_SECTION_SIZE,
      cellThickness: CELL_THICKNESS,
      sectionThickness: SECTION_THICKNESS,
      cellColor: new THREE.Color(GRID_LINE_COLOR),
      sectionColor: new THREE.Color(GRID_LINE_COLOR),
      // Both of these move the grid inside the shader, which is the one thing the display must not do: the quad is
      // moved instead, by whole cells, so the lines stay on the world's boundaries and the mesh stays where the
      // grid it draws is (README D49).
      followCamera: false,
      infiniteGrid: false,
      side: THREE.DoubleSide,
    });
    mesh.name = 'world-grid-plane';
    mesh.layers.set(OVERLAY_LAYER);
    mesh.renderOrder = GRID_RENDER_ORDER;

    const material = mesh.material as THREE.ShaderMaterial;
    material.depthWrite = false;
    material.onBeforeCompile = (shader): void => {
      const patched = withLogDepth(shader.vertexShader, shader.fragmentShader);
      shader.vertexShader = patched.vertexShader;
      shader.fragmentShader = withoutDistanceFade(withAnisotropicAttenuation(patched.fragmentShader));
    };
    this.plane = mesh;

    this.root = new THREE.Group();
    this.root.name = 'world-grid';
    this.root.add(mesh);
  }

  /** Whether the grid is drawn. The app's `World grid` checkbox is the one writer (README D35). */
  get visible(): boolean {
    return this.root.visible;
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  /**
   * Puts the plane on the camera: its two coordinates follow the camera snapped to whole cells, and its height stays
   * the world's ground, `y = 0`. Snapping is what keeps the lines on the cell boundaries rather than sliding with
   * the view, and the height is the plane's own — a grid is a floor here, not a plane to be aimed.
   */
  update(camera: THREE.Camera): void {
    this.plane.position.set(
      Math.round(camera.position.x / GRID_CELL_SIZE) * GRID_CELL_SIZE,
      0,
      Math.round(camera.position.z / GRID_CELL_SIZE) * GRID_CELL_SIZE,
    );
  }

  /** Releases the plane's geometry and material and takes it out of the scene. Safe to call twice. */
  dispose(): void {
    this.plane.removeFromParent();
    this.plane.geometry.dispose();
    (this.plane.material as THREE.Material).dispose();
    this.root.clear();
  }
}
