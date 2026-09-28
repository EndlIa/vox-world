/**
 * The scene-graph layer numbers and the decoration render order the viewport runtime shares: one
 * owner for the numbers `app/main.ts`, the drawings, the picker, and the export pass all have to
 * agree on (README D24). Every decoration is layer 1; the outline is drawn in its own pass (D50).
 */

/** The content layer: mirrored document nodes and the output camera. */
const SCENE_LAYER = 0;
/** Viewport-only decoration: the overlay box preview, the grid, the gizmo, the camera carrier and path. */
const OVERLAY_LAYER = 1;
/** The imported raw source meshes (README D25), tested alongside `SCENE_LAYER` on the raycaster. */
const SOURCE_LAYER = 2;
/** The selection outline's own layer: the hull and the object's depth copy (README D50). */
const OUTLINE_LAYER = 3;
/** The render order every layer-1 decoration draws at, above the grid (README D24). */
const DECORATION_RENDER_ORDER = 1000;

export { SCENE_LAYER, OVERLAY_LAYER, SOURCE_LAYER, OUTLINE_LAYER, DECORATION_RENDER_ORDER };
