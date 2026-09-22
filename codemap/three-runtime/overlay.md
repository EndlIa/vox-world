# src/three-runtime/overlay.ts

Ring: 2 · Layer: three-runtime · Depends on: `../voxels/uniform/grid.js`, `three`

## Responsibility
Draws transient viewport feedback: the box-drag preview frame. It is strictly presentational — one wireframe object, rewritten per update, holding no persistent state, no document reference, and no source data.

## Public interface
```ts
class Overlay {
  constructor(scene: THREE.Scene);
  showBox(boxLocal: IntBox3, matrixWorld: THREE.Matrix4, cell: number, color?: HexColor): void;   // cell = the owning object's cell size in world units
  clear(): void;
  dispose(): void;
}
```
`IntBox3` and `HexColor` come from `voxels/uniform/grid.js` and are not re-declared here.

## Internal logic
1. Construction builds exactly one `THREE.LineSegments`: a fixed 12-edge unit-cube position buffer (24 vertices, edge length 1 centered on the origin), `LineBasicMaterial({ depthTest: false, transparent: true })`, `frustumCulled = false`, a high `renderOrder`, and `layers.set(1)` — the overlay layer. The object is added to the scene it was given, which is the mirror's scene.
2. The buffer is allocated once. Every update rewrites the same object's position, quaternion, and scale (and, for a non-cube request, the same preallocated position array) instead of creating geometry or material, so a pointer-move drag allocates nothing.
3. `showBox(boxLocal, matrixWorld, cell, color?)`: normalize the inclusive `IntBox3` with `normalizeBox(boxLocal.min, boxLocal.max)`, take the min-corner convention's local extents as `min * cell` to `(max + 1) * cell` — one cell is `cell` world units, the owning object's own cell size (README D41, D43) — and set the wireframe matrix to `matrixWorld × translate(center) × scale(size)`. The frame therefore shows exactly the voxel space the edit will write, in the owning object's space and orientation and at the object's own cell size, whatever its subdivision.
4. `showBox` sets `visible = true` and replaces whatever the previous call drew. There is only ever one piece of feedback on screen.
5. Default color when the optional argument is omitted: `0x38bdf8`. The material's color is updated in place, never reallocated.
6. `clear()` sets `visible = false` and touches nothing else; `dispose()` removes the object from the scene and disposes its geometry and material. The composition root calls it in the same teardown as `SceneMirror.dispose()`, after which no overlay object remains in the scene.
7. Layer 1 keeps the feedback out of both consumers: `Picker`'s raycaster tests layer 0 only, and the export camera enables layer 0 only, so no overlay line can be picked or captured.

## Invariants
- At most one feedback object exists, with a fixed vertex count; updates allocate nothing.
- `showBox` never mutates the scene graph, the mirror, or the document: it only moves and scales its own wireframe.
- Conventions hold: `showBox` takes an inclusive integer box in the owning object's cells, that object's world matrix, and the world size of one of its cells, so the drawn frame is the region an edit writes — at the cell size it was handed, not at a fixed world unit.
- After `clear()` nothing of the overlay is visible; the overlay is never a source of truth, never saved, and never exported.
- The overlay layer number (1) is shared with `controls.ts` (its gizmo helper) and must stay equal in both files.

## Errors
- `RangeError` when a `boxLocal` corner is not a finite integer, or when `cell` is not a positive finite number.
- `TypeError` when the constructor argument is not a `THREE.Scene`, or when `matrixWorld` is not a `THREE.Matrix4`.
- An empty selection or a miss is expressed by `clear()`, never by drawing a degenerate zero-size frame.

## Dependencies
- `three` — `Scene`, `LineSegments`, `BufferGeometry`, `BufferAttribute`, `LineBasicMaterial`, `Matrix4`.
- `../voxels/uniform/grid.js` — `IntBox3`, `HexColor`, `normalizeBox`.
No outer-ring import: the overlay knows nothing about tools, sessions, ops, or picking.

## Tests
- No vitest file: the object needs a scene and is verified visually. README §10 covers it by running the app — the box preview tracks the drag in the object's local grid and in world orientation, and it never appears in a pick or in an exported frame.
- The corner handling `showBox` relies on is already pinned by `tests/uniform.test.ts` (`normalizeBox`, box counts).

## Open questions
- The brief fixes no default feedback color; `0x38bdf8` is chosen here and the caller may override it. If a shared palette appears later, the default should come from it.
