# src/three-runtime/overlay.ts

Ring: 2 · Layer: three-runtime · Depends on: `../voxels/uniform/grid.js`, `three`

## Responsibility
Draws transient viewport feedback: the box-drag preview frame, using three's own `Box3Helper`, and the cell ghost — the
cells an operation would touch, one translucent unit cube per cell in a single `InstancedMesh`. It is strictly
presentational — one helper, one instanced mesh, and one group carrying the owning object's space, rewritten per update,
holding no persistent state, no document reference, and no source data.

The helper draws an axis-aligned box in the space it sits in, so it is parented into that group rather than added to
the scene: the group carries the owning object's world matrix, and a rotated or scaled object therefore draws the
rotated frame the edit will write. Composing the two matrices that way is also what keeps a non-uniform scale exact —
decomposing their product into a single transform, which the hand-written version did, cannot express the shear a
rotation inside a scale produces.

## Public interface
```ts
class Overlay {
  constructor(scene: THREE.Scene);
  showBox(boxLocal: IntBox3, matrixWorld: THREE.Matrix4, cell: number, color?: HexColor): void;   // cell = the owning object's cell size in world units
  showCells(cells: readonly number[], matrixWorld: THREE.Matrix4, cell: number, color?: HexColor): void;   // x, y, z per cell
  hideCells(): void;
  clear(): void;
  dispose(): void;
}
```
`IntBox3` and `HexColor` come from `voxels/uniform/grid.js` and are not re-declared here.

## Internal logic
1. Construction builds one `Box3Helper` over a `Box3` it owns, with `frustumCulled = false`, a high `renderOrder`, and
   the material the library gives it narrowed once (the library types it as a generic `Material`) so its `depthTest`
   can be turned off and `transparent` turned on. The helper is added to one `THREE.Group` — the owning object's space
   — whose `matrixAutoUpdate` is off, because its matrix is always written from the outside; the group is hidden and
   added to the scene it was given, which is the mirror's scene. The group takes the layer along with its child, so
   nothing added later can escape `layers.set(1)`, the overlay layer.
2. The box is allocated once, as a live object the helper reads. Every update rewrites its two corners and the group's
   matrix, so a pointer-move drag allocates nothing and creates no geometry or material.
3. `showBox(boxLocal, matrixWorld, cell, color?)`: normalize the inclusive `IntBox3` with `normalizeBox(boxLocal.min,
   boxLocal.max)` and write the min-corner convention's extents into the box as `min * cell` to `(max + 1) * cell` —
   one cell is `cell` world units, the owning object's own cell size — then copy `matrixWorld` onto
   the group's matrix and set `matrixWorldNeedsUpdate`, because a matrix written directly is not the one
   `updateMatrix()` would produce. The helper's own `updateMatrixWorld` reads the box and places the frame inside that
   space, so the frame shows exactly the voxel space the edit will write, in the owning object's space and orientation
   and at the object's own cell size, whatever its subdivision.
4. `showBox` makes the frame visible and replaces what the previous call drew with it; the ghost keeps its own
   visibility, so the two drawings do not erase each other. Each is a view of its own: the frame marks a region's
   extent, the ghost marks the cells themselves.
4b. `showCells(cells, matrixWorld, cell, color?)` draws one cube per cell: `cells` is a flat list of integer cell
   coordinates in the owning object's own cells, and a unit `BoxGeometry` instance is scaled by `cell` and placed at
   the cell's centre — `(x + 0.5) * cell` on each axis, since `x * cell` is its min corner. The instanced mesh is
   built lazily and replaced by one twice as large when a drawing needs more instances than it holds; its `count` is
   what is drawn, so a later call with fewer cells draws fewer and nothing is left over. Its material is transparent,
   `depthTest` off and `depthWrite` off, so a marked cell is never hidden by the voxel in front of it and the ghost
   never fights a surface for depth.
4c. `hideCells()` hides the ghost alone, which is what a hover that left the model does; `clear()` — the empty
   selection and the miss — hides both.
5. Default color when the optional argument is omitted: `0x38bdf8`. The material's color is updated in place, never reallocated.
6. `clear()` hides both drawings and touches nothing else; `dispose()` disposes the helper, the ghost's geometry and
   material, and removes the group from the scene. The composition root calls it in the same teardown as `SceneMirror.dispose()`,
   after which no overlay object remains in the scene.
7. Layer 1 keeps the feedback out of both consumers: `Picker`'s raycaster tests layer 0 only, and the export camera
   enables layer 0 only, so no overlay line can be picked or captured. The group is not part of any document object's
   node either, which is what keeps `frameAll`'s measurement — it walks the mirror's own entries and their descendants
   — from ever seeing the preview.

## Invariants
- One frame and one ghost exist per overlay, with fixed geometry and material; an update rewrites the box, the group's
  matrix, the material's color, and the instance matrices, and allocates nothing unless the ghost has to grow.
- The group itself is always in the scene and always visible; what shows is decided per drawing, so `hideCells()` can
  take the ghost away without touching a committed frame.
- `showBox` never mutates the scene graph, the mirror, or the document: it only rewrites its own box, its own group's matrix, and its own material's color.
- Conventions hold: `showBox` takes an inclusive integer box in the owning object's cells, that object's world matrix, and the world size of one of its cells, so the drawn frame is the region an edit writes — at the cell size it was handed, not at a fixed world unit.
- The frame follows the owning object's orientation and scale exactly: the group's matrix is composed with the helper's own placement rather than folded into one transform, so a rotated object shows a rotated frame and a non-uniformly scaled one shows no shear error.
- The ghost's instance matrices are cell-sized cubes at cell centres, in the object's own cells, so the group's matrix
  is the only thing that turns them into world space — the same composition rule the frame follows.
- After `clear()` nothing of the overlay is visible; the overlay is never a source of truth, never saved, and never exported.
- The overlay layer number (1) is shared with `controls.ts` (its gizmo helper) and must stay equal in both files.

## Errors
- `RangeError` when a `boxLocal` corner is not a finite integer, when a ghost cell coordinate is not an integer, when
  the ghost's list is not a whole number of `x, y, z` triples, or when `cell` is not a positive finite number.
- `TypeError` when the constructor argument is not a `THREE.Scene`, or when `matrixWorld` is not a `THREE.Matrix4`.
- An empty selection or a miss is expressed by `clear()`, never by drawing a degenerate zero-size frame.

## Dependencies
- `three` — `Scene`, `Group`, `Box3`, `Box3Helper`, `LineBasicMaterial`, `BoxGeometry`, `InstancedMesh`, `MeshBasicMaterial`, `Matrix4`.
- `../voxels/uniform/grid.js` — `IntBox3`, `HexColor`, `normalizeBox`.
No outer-ring import: the overlay knows nothing about tools, sessions, ops, or picking.

## Tests
- `tests/overlay.test.ts` pins the frame's placement — the inclusive cell box at the owning object's cell size, in that
  object's world space, including a rotated and non-uniformly scaled one — and the ghost's: one cell-sized cube per
  cell, centred on its cell, growing past the capacity it started with, drawing fewer on a later call, and hiding
  without touching the frame. Both pin the visible/hidden rules, the colour writes, the argument errors, and
  `dispose`, in the node environment.
- The corner handling `showBox` relies on is already pinned by `tests/uniform.test.ts` (`normalizeBox`, box counts).
- What needs a GPU stays app-verified (README §10): the frame on screen over the voxels while a drag runs, following the
  object's orientation, and its absence from a pick and from an exported frame — layer 1 is what the picker's and the
  export camera's layer sets already exclude.

## Open questions
- No shared palette fixes a default feedback color; `0x38bdf8` is chosen here and the caller may override it. If a shared palette appears later, the default should come from it.
