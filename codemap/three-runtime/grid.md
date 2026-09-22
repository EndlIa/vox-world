# src/three-runtime/grid.ts

Ring: 2 · Layer: three-runtime · Depends on: `three`

## Responsibility
The world grid: a reference plane at `y = 0` that tells the user how big a metre is, which a viewport showing a bare model against a flat background otherwise cannot. It builds two `GridHelper`s — a fine one at one-metre cells and a brighter coarse one at ten-metre cells — on the viewport-decoration layer, and owns nothing else: no state, no per-frame work, no project data, no interaction. It is a port of the shape the previous project's editor grid uses (`GridMaterial` with `gridRatio = 1`, `majorUnitFrequency = 20`, `minorUnitVisibility = 0.4`, white lines), built from the library's own helper instead of a shader material because a fixed two-level line grid needs no shader and the extra material would have to be maintained.

## Public interface
```ts
class WorldGrid {
  constructor();
  readonly root: THREE.Group;   // the owner adds this to its scene
  dispose(): void;              // releases both helpers' geometry and material
}
```

## Internal logic
1. Construction builds `minor = new THREE.GridHelper(200, 200, color, color)` and `major = new THREE.GridHelper(200, 20, color, color)`: 200 m on a side, one-metre and ten-metre cells, `color1` equal to `color2` because the two levels are separate helpers rather than the helper's own centre-line pairing — a differently coloured centre cross would read as a world axis this grid does not have.
2. Both helpers get `material.transparent = true`, `material.opacity` (minor `0.28`, major `0.5`), `material.depthWrite = false`, and `layers.set(1)`.
3. The colours are panel greys — `0x9aa2ad` for the minor level and `0xe6e8ea` for the major one — rather than the reference grid's pure white, which reads as a stray frame line against this viewport's slate background (README D32 is the same lesson). The major level stays brighter so the two are told apart.
4. `major.renderOrder = 1` because both levels share `y = 0`: where their lines coincide the brighter one is drawn last. Neither writes depth, so voxels below the plane still render through it.
5. Both helpers go into one named `Group` (`world-grid`), which is what `root` is and what `dispose` empties: each `GridHelper`'s geometry and material are disposed, and the group is left with no children.

## Invariants
- Everything is on layer 1: the raycaster tests layers 0 and 2, so the grid is never picked, and the export camera enables layer 0 alone, so it never appears in a frame (README D24).
- `frameAll` measures layers 0 and 2, so the grid can never widen the framing of an import.
- `depthWrite = false`, so the grid can never occlude a voxel that sits below `y = 0`, and drawing order between the two levels is fixed by `renderOrder` rather than by geometry.
- The grid is static: `WorldGrid` has no update method, adds no listener, and holds no reference to a camera, a project, or a session.
- `dispose()` leaves `root` childless, so a second call is a no-op rather than a double dispose.

## Errors
None. Nothing here takes an argument, reads state, or can fail: a wrong size or colour is a visible defect in the viewport, not a runtime condition.

## Dependencies
- `three` — `GridHelper` and `Group`. No project, editor, UI, or other three-runtime module; the owner passes the scene in by adding `root` itself, exactly as `Overlay` is used.

## Tests
No vitest file: the module needs a WebGL context to be observed and vitest runs in the node environment. Verified by running the app (README section 10): the grid must be visible around an imported model with one-metre cells and a brighter ten-metre level, must sit under the voxels rather than over them, must not be pickable (a click on an empty grid area selects nothing), and must not appear in an exported frame — which is checked by exporting and looking at the background the model leaves empty.

## Open questions
- The extent is fixed at 200 m and the cell size at 1 m. A scene much larger than that would want the extent to follow the content or the camera, and a scene authored in centimetre voxels would want a finer level; both are viewport conveniences this slice does not need, and neither may change the stored data (a grid is decoration, never a source of scale).
- There is no visibility toggle: the grid is always on. A `Show grid` checkbox next to `Show raw meshes` would be the place for one if the grid ever gets in the way of reading a model.
