# src/three-runtime/grid.ts

Ring: 2 · Layer: three-runtime · Depends on: `./gridPlane.js`, `three`

## Responsibility
The viewport's world grid: one of three displays, each a set of shader-drawn planes, chosen by the Grid group's
`Display` field. They are the reference viewport's displays and they are mutually exclusive rather than additive
(README D49):

- `floor` — one horizontal plane on the world's ground, the reference for building on it.
- `volume` — that ground plus the two walls that close a work cube, so a model can be read in three dimensions while
  it is being built rather than only from above.
- `multi` — one plane the user aims at an axis and slides along it, for work that does not happen on the ground.
- `off` — no grid at all.

Every plane is a `GridPlane` (`./gridPlane.ts`), so the lines anti-alias and fade instead of dissolving into noise
with distance, and every plane is anchored in phase to the world's cell boundaries: the camera moves the quad, never
the lines. The whole display is decoration — layer 1, no depth write, no project data, outside `frameAll`'s
measurement — so it is never picked, never exported, and can never widen the framing of an import (README D24, D35).

The active object's own lattice is gone with the displays that replaced it (README D49): a lattice at a model's own
subdivision, on the model's own plane, read as a sheet hanging in the air the moment the model left the ground, and a
per-object grid is not what the reference viewport shows at all. What D43 decided about the **data** stands
untouched — a model still carries its subdivision, its cells and its placement are still measured in its own cells,
and the import dialog is unchanged — so this module no longer imports `../voxels/uniform/grid.js` at all: only the
drawing went, and with it the base plane's line geometry, its hole cutting, and the footprint maths that drove it.

## Public interface
```ts
const GRID_MODES = ['off', 'floor', 'volume', 'multi'] as const;
type GridMode = 'off' | 'floor' | 'volume' | 'multi';
const DEFAULT_GRID_MODE: GridMode = 'floor';

class WorldGrid {
  constructor();
  readonly root: THREE.Group;   // `world-grid`: the five named planes; only the shown display's are visible
  get gridMode(): GridMode;
  get multiAxis(): GridAxis;
  get multiOffset(): number;
  setMode(mode: GridMode): void;
  setMultiPlane(axis: GridAxis, offset: number): void;
  update(camera: THREE.Camera): void;
  dispose(): void;
}
```
Module-private: `GROUND_OFFSET = 0` (the world's ground, the bottom plane of cell row zero), `VOLUME_WALL_OFFSET =
-60` (the work cube's half side, so its walls sit there at negative `x` and `z`), and `DEFAULT_MULTI_AXIS = 'x'` (the
moved plane opens vertical through the origin, where a centred model wants slicing).

## Internal logic
1. Construction builds five planes — `new GridPlane('y', GROUND_OFFSET)` for `floor`;
   `('y', GROUND_OFFSET)`, `('x', VOLUME_WALL_OFFSET)`, and `('z', VOLUME_WALL_OFFSET)` for `volume`; and
   `(this.axis, this.offset)` for `multi` — names their meshes `world-grid-floor`, `world-grid-volume-ground`,
   `world-grid-volume-wall-x`, `world-grid-volume-wall-z`, and `world-grid-multi`, and adds all five to one `Group`
   named `world-grid`, which is `root`. The instance's `axis` and `offset` are the moved plane's state and start at
   the constants above.
2. `displays` is the map from a display to the planes it shows, and it partitions the five: `floor` holds the floor
   plane, `volume` its own ground plus the two walls, `multi` the moved plane, and `off` nothing. No plane belongs to
   two displays, so nothing is ever drawn twice and `dispose` can release each plane exactly once.
3. `apply()` writes visibility for every plane from the current display's list, and is the only writer: `setMode`
   calls it after storing the mode, and the constructor calls it once. A mode switch therefore leaves nothing of the
   previous display on screen, and the visibility state of all five planes is always the map's answer.
4. `setMode(mode)` throws a `RangeError` when the argument is not one of `GRID_MODES` — a stranger is a programming
   error, not a value to ignore — and returns early when the mode is already the one on screen, so a repeated write
   does no work.
5. `setMultiPlane(axis, offset)` is the moved plane's writer: it throws a `RangeError` for an axis that is not in
   `GRID_AXES` and another when the offset is not a whole world unit, then records both and hands them to the moved
   plane's `setFacing`. It does not touch `apply`, because aiming or sliding a plane never changes which display is
   on screen.
6. `update(camera)` is the per-frame call: it walks the **current** display's planes and follows each, so the two
   fixed displays and the hidden planes cost nothing, and the whole display moves on one camera in one pass.
7. `dispose()` disposes every plane in `displays` and clears `root`, so the group is emptied as well as its children
   released. A second call walks the same planes and re-runs the idempotent per-plane disposal on an already-empty
   group; nothing is called twice by the app, and nothing fails.

## Invariants
- One display at a time, and only its planes are visible: `apply()` derives all five planes' `visible` from
  `displays[mode]`, so the displays can never be additive and switching one off leaves nothing behind (README D49).
- The floor and the volume's ground are two different planes, not one plane shown twice: a display's planes are its
  own instances, so a mode switch never aliases the facing or the offset one display was given into another's.
- The fixed displays are fixed: the ground sits at `0` on `y` and the work cube's walls at `-60` on `x` and `z`, whole
  cells out, and only `update` moves them — and it moves the two coordinates each plane does not face, so its own
  plane is untouched.
- Per-frame work is the shown display's planes and nothing else: `update` reads the current display's list, so `off`
  and every plane of the other displays are genuinely free.
- Grid settings are the viewport's, never the document's: the three settings are the only state, the app reads them
  for the panel through `gridMode` / `multiAxis` / `multiOffset`, and nothing here reads a `Project`, a session, or an
  export.
- `dispose()` releases every plane exactly once and empties `root`; afterwards nothing of the grid is in the scene,
  and calling it again is harmless.

## Errors
- `RangeError` from `setMode` for a name that is not a display, naming the method and the value.
- `RangeError` from `setMultiPlane` for an unknown axis, and another for an offset that is not a whole world unit:
  a plane between two cells would put its lines between the world's own (README D49).
- Everything else is total. The constructor builds only compile-time constants, so a plane can never be constructed
  with a bad offset from here; `update` accepts any camera; `dispose()` is safe twice. Nothing here throws
  `TypeError`.

## Dependencies
- `./gridPlane.js` — `GridPlane`, the one plane, and `GRID_AXES`, so the axis check asks the module that defines the
  axes rather than restating them; `GridAxis` is a type-only import for the same reason.
- `three` — `Group` for `root` and the `Camera` type `update` takes. No project, editor, UI, document, or other
  three-runtime module: the owner (`app/main.ts`) adds `root` to `mirror.scene` and calls `update` from the render
  loop, exactly as it does for `Overlay`.
- It no longer imports `../voxels/uniform/grid.js`: `UniformGrid`, `DEFAULT_GRID_MARGIN`, `showObjectLattice`, the
  margin, the hole, and the footprint maths that existed to cut the base plane under a lattice are all gone with
  D43's second layer.

## Tests
`tests/grid.test.ts` pins the displays and their mutual exclusivity, the default, the work cube's three planes staying
on their own planes under a camera move, and the moved plane's aim, offset, facing, and refusal — in the node
environment, no DOM and no GPU; see `codemap/tests/grid.md`. What needs a GPU stays app-verified (README §10): the
display visible with its palette, the percentage of the view region it changes, the walls and the moved plane moving
with the axis and the offset, nothing of the grid inside the model's silhouette, the fine lines fading before the
coarse ones, and no hard edge where a plane ends.

## Open questions
- The three displays are the reference's, and `multi` is one plane: a second movable plane, or planes the pointer
  can pick and build on as a work surface, is a later slice (README D49).
- The work cube's half side is fixed at 60 world units — the reference's 120-cell cube — so its walls are off screen
  for a small model until the view is pulled back.
- Offsets are whole world units: a plane between two cells is refused rather than rounded, so sub-cell work planes
  are not offered.
- The display is viewport state with no persistence, so a reload opens on `floor`; nothing in a project records which
  grid the user was looking at.
