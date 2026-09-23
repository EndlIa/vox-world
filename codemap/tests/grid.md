# tests/grid.test.ts

Ring: 3 · Layer: tests (node, no GPU) · Depends on: `../src/three-runtime/grid.js`, `three`, `vitest`

## Responsibility
Pins the three displays of the viewport grid: which planes each one shows and that they are exclusive, the default
display, the two fixed displays' planes staying on their own planes and their own offsets whatever the camera does,
and the moved plane's aim, offset, facing, and refusal (README D49). It reads only the default constant, the root's
children by name, their `visible` flags, and their `position` and `quaternion` after an `update`. The planes' drawing
is `gridPlane.ts`'s and is tested there; the panel's three fields, the app's three actions, the frame loop, and the
colours as they render are not tested here.

## Public interface
`describe` / `it` names are this file's observable surface:
- `world grid` — `shows one display at a time, and opens on the ground`,
  `shows the work cube as its ground and the two walls that close it`,
  `aims the moved plane at an axis and keeps it where it was put`

## Internal logic
1. `cameraAt(x, y, z)` builds a fresh `PerspectiveCamera` at that position, which is all a plane reads from a camera.
2. `visiblePlanes(grid)` is what a frame would draw: it filters `grid.root.children` by `visible` and returns their
   names, **sorted**, so the assertion is about the set and not about the constructor's insertion order. The mutual
   exclusivity claim is therefore made against visibility, the thing that decides the picture, rather than against the
   private map.
3. `planeAt(grid, name)` finds a plane through `root.getObjectByName` and requires a `Mesh`, throwing its own
   `TypeError` when the name is absent — a renamed or missing plane fails in the fixture rather than passing
   vacuously.
4. Each case constructs its own `WorldGrid` and calls `dispose()` at the end, so no case runs against another's state,
   and each reads the planes by the names the app and the panel use rather than through the class's private fields.

## Invariants
- `DEFAULT_GRID_MODE` is `'floor'` and a fresh grid shows exactly `['world-grid-floor']`: the viewport opens with a
  ground grid and with nothing else.
- `setMode('volume')` shows exactly `['world-grid-volume-ground', 'world-grid-volume-wall-x',
  'world-grid-volume-wall-z']`, `setMode('multi')` shows exactly `['world-grid-multi']`, and `setMode('off')` shows
  nothing at all. Each switch is asserted as the complete visible set, so a display that left a plane from the
  previous one on screen — the additive behaviour D49 rejected — cannot pass, and the five plane names are pinned by
  being the ones a visible plane is found under.
- The work cube, followed from `(3.4, 2.6, -8.1)`, sits at `(3, 0, -8)` for its ground, `(-60, 3, -8)` for the wall on
  `x`, and `(3, 3, -60)` for the wall on `z`: the ground stays on the world's own ground and each wall on its own
  plane, while only the two coordinates inside a plane follow the camera. A wall that followed the camera off `-60`,
  or a ground that took the camera's height, fails here — this is the case that says the work cube is fixed.
- A fresh grid's moved plane reports `multiAxis === 'x'` and `multiOffset === 0`; after `setMultiPlane('z', -5)` it
  reports `'z'` and `-5`, and an `update` from `(0.4, 9.6, 2.2)` puts its mesh at `(0, 10, -5)`. So the two discrete
  settings are readable before any frame, and the plane's placement follows the axis it was aimed at: only the in-plane
  coordinates take the camera's values, rounding `y` up to `10`.
- The moved plane's quaternion turns its own normal onto the axis it was aimed at: after `setMultiPlane('z', -5)` the
  quad's `(0, 1, 0)` normal, read through the quaternion, is `+z` to six places. The facing is therefore the mesh's
  own geometry, not a flag the test could not see fail.
- `setMultiPlane('x', 0.5)` throws `RangeError`: a plane between two cells would put its lines between the world's
  own, and it is refused rather than rounded (README D49).

## Errors
The half-cell offset is the only error asserted. Not pinned here: `setMode` with a name that is not a display, and
`setMultiPlane` with an axis that is not `x`, `y`, or `z` — both are `RangeError`s in the class, not on this path.

## Dependencies
`../src/three-runtime/grid.js` for `WorldGrid` and `DEFAULT_GRID_MODE`; `three` for `Mesh`, `PerspectiveCamera`, and
`Vector3`; `vitest` for `describe`, `it`, `expect`. No DOM and no GPU: the suite runs in the node environment, and
the planes' meshes and materials are built there without a renderer.

## Tests
This file *is* the test, run by `npm test` in the node environment. It is the only coverage of
`three-runtime/grid.ts`. Not covered here: the planes' layers, materials, render order, and uniform values (those are
`tests/gridPlane.test.ts`'s and `codemap/tests/gridPlane.md`'s), the whole-cell snapping and the fade (the same), the
`root` group's own name and its being added to a scene — the app's step, not the class's — `dispose` being safe
twice, and the Grid group's panel and app wiring. What needs a GPU — the displays visible with their palette, the
percentage of the view region each changes,
the walls and the moved plane moving with the axis and the offset, no grid pixel inside the model's silhouette, the
fine lines fading before the coarse ones, and no hard edge where a plane ends — is verified by running the
application (README §10).
