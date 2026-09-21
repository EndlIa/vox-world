# src/three-runtime/overlay.ts

Ring: 2 · Layer: three-runtime · Depends on: `../voxels/uniform/grid.js`, `three`

## Responsibility
Draws transient viewport feedback: the box-drag preview frame and the picked leaf's bounds wireframe. It is strictly presentational — one wireframe object, rewritten per update, holding no persistent state, no document reference, and no source data.

## Public interface
```ts
class Overlay {
  constructor(scene: THREE.Scene);
  showBox(boxLocal: IntBox3, voxelSize: number, matrixWorld: THREE.Matrix4, color?: HexColor): void;
  showLeafBounds(centerWorld: THREE.Vector3, size: number, color?: HexColor): void;
  clear(): void;
  dispose(): void;
}
```
`IntBox3` and `HexColor` come from `voxels/uniform/grid.js` and are not re-declared here.

## Internal logic
1. Construction builds exactly one `THREE.LineSegments`: a fixed 12-edge unit-cube position buffer (24 vertices, edge length 1 centered on the origin), `LineBasicMaterial({ depthTest: false, transparent: true })`, `frustumCulled = false`, a high `renderOrder`, and `layers.set(1)` — the overlay layer. The object is added to the scene it was given, which is the mirror's scene.
2. The buffer is allocated once. Every update rewrites the same object's position, quaternion, and scale (and, for a non-cube request, the same preallocated position array) instead of creating geometry or material, so a pointer-move drag allocates nothing.
3. `showBox(boxLocal, voxelSize, matrixWorld, color?)`: normalize the inclusive `IntBox3` with `normalizeBox(boxLocal.min, boxLocal.max)`, convert to object-local meters with the min-corner convention — `min * voxelSize` to `(max + 1) * voxelSize` — and set the wireframe matrix to `matrixWorld × translate(center) × scale(size)`. The frame therefore shows exactly the voxel space the edit will write, in the owning object's space and orientation.
4. `showLeafBounds(centerWorld, size, color?)`: set the wireframe matrix to `translate(centerWorld) × scale(size, size, size)`, in world space, with no object transform involved.
5. Both calls set `visible = true` and replace whatever the previous call drew. There is only ever one piece of feedback on screen, because a box drag and a leaf selection never coexist.
6. Default color when the optional argument is omitted: `0x38bdf8`. The material's color is updated in place, never reallocated.
7. `clear()` sets `visible = false` and touches nothing else; `dispose()` removes the object from the scene and disposes its geometry and material. The composition root calls it in the same teardown as `SceneMirror.dispose()`, after which no overlay object remains in the scene.
8. Layer 1 keeps the feedback out of both consumers: `Picker`'s raycaster tests layer 0 only, and the export camera enables layer 0 only, so no overlay line can be picked or captured.

## Invariants
- At most one feedback object exists, with a fixed vertex count; updates allocate nothing.
- `showBox` and `showLeafBounds` never mutate the scene graph, the mirror, or the document: they only move and scale their own wireframe.
- Conventions hold: `showBox` takes an inclusive integer box in the owning object's cells plus that object's world matrix, so the drawn frame is the region an edit writes; `showLeafBounds` takes world-space data only.
- After `clear()` nothing of the overlay is visible; the overlay is never a source of truth, never saved, and never exported.
- The overlay layer number (1) is shared with the `OutputPreview` guide and must stay equal in both files.

## Errors
- `RangeError` when `voxelSize` or `size` is not a finite positive number, or when a `boxLocal` corner is not a finite integer.
- `TypeError` when the constructor argument is not a `THREE.Scene`, or when `matrixWorld` or `centerWorld` is not a `THREE.Matrix4`/`THREE.Vector3`.
- An empty selection or a miss is expressed by `clear()`, never by drawing a degenerate zero-size frame.

## Dependencies
- `three` — `Scene`, `LineSegments`, `BufferGeometry`, `BufferAttribute`, `LineBasicMaterial`, `Matrix4`, `Vector3`.
- `../voxels/uniform/grid.js` — `IntBox3`, `HexColor`, `normalizeBox`.
No outer-ring import: the overlay knows nothing about tools, sessions, ops, or picking.

## Tests
- No vitest file: the object needs a scene and is verified visually. README §10 covers it by running the app — the box preview tracks the drag in the object's local grid and in world orientation, the picked leaf frame matches the leaf bounds, and neither appears in a pick nor in an exported frame.
- The corner handling `showBox` relies on is already pinned by `tests/uniform.test.ts` (`normalizeBox`, box counts).

## Open questions
- The brief fixes no default feedback color; `0x38bdf8` is chosen here and both callers may override it. If a shared palette appears later, the default should come from it.
