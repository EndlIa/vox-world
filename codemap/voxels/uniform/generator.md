# src/voxels/uniform/generator.ts

Ring: 0 · Layer: voxels/uniform · Depends on: ./grid.ts, three (the addons' `SimplexNoise`)

## Responsibility
The primitives the editor can create, as pure functions from a spec to a payload: a filled or hollow box, a ball, the
three faces that meet at the origin, and a noise landscape. A spec is plain data in cells — a primitive is built at the
unit lattice, where one cell is one world unit, the same unit an import is measured in — and the payload is the whole
result.

It holds no project, no placement, no identity, no colour of its own, and no budget: the caller decides where the
payload goes and whether it fits, which is what keeps this file free of both the document and the editor.

The behaviour is modelled on the reference editor's generators, adapted deliberately:

- a **terrain** here is a solid landscape — every footprint column filled from the ground up — where the reference
  draws a one-cell sheet at the noise height, and a different seed is a different landscape;
- a **sphere** is solid where the reference draws a shell between two radii, and it carries one colour where the
  reference offers an inner one, because a created shape is something to sculpt from rather than a finished object.

## Public interface
```ts
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { UniformGrid } from './grid.js';
import type { HexColor } from './grid.js';

type PrimitiveKind = 'box' | 'sphere' | 'isometric' | 'terrain';
type PrimitiveSpec =
  | { kind: 'box'; size: readonly [number, number, number]; hollow: boolean }
  | { kind: 'sphere'; radius: number }
  | { kind: 'isometric'; size: readonly [number, number, number] }
  | { kind: 'terrain'; footprint: readonly [number, number]; height: number; seed: number };

const MAX_PRIMITIVE_AXIS = 1024;

function primitiveCellCount(spec: PrimitiveSpec): number;   // an upper bound, so a caller can refuse before building
function createPrimitive(spec: PrimitiveSpec, color: HexColor): UniformGrid;
```

## Internal logic
1. Every builder starts at the payload's own origin — `(0, 0, 0)` — which is what makes the result placeable at any
   whole cell of the world lattice.
2. A `box` writes every cell of its extent, or, when `hollow`, every cell that is not strictly inside it: a box two
   cells thick is all surface, so hollowing it changes nothing.
3. A `sphere` of radius `r` occupies a `2r - 1` cube and keeps the cells whose centre is within `r` of the ball's
   centre, which sits half a cell in (`(2r - 1) / 2`). A radius of one is therefore the single cell at the origin.
4. An `isometric` shape keeps the cells of the three faces that meet at the origin — the reference's own corner, which
   is what makes it a shape to build out from rather than a solid to carve.
5. A `terrain` samples three's `SimplexNoise` at `0.17` per cell across its footprint and fills each column solid from
   the ground up to `round(((noise + 1) / 2) * (height - 1))`, so the result is a landscape whose columns are between
   one and `height` cells tall. The noise is given a seeded random function (a `mulberry32` mixer over the spec's
   seed), which is what makes the same spec the same landscape and nothing about it depend on the clock.
6. `primitiveCellCount` answers an upper bound: exact for a box and for the corner, the bounding cube for a ball, and
   the filled footprint for a landscape. A budget check wants a bound — refusing too much is recoverable, allocating
   it first is not — and the bound is computed without building anything.
7. Every size is validated as a whole number of cells at least one and no larger than `MAX_PRIMITIVE_AXIS` — the key
   space, `[-512, 511]`, is 1024 cells across — and the colour as a `0xRRGGBB` integer. The validation is shared by
   the counter and the builders, so a spec the counter accepts is a spec the builder can draw.

## Invariants
- Nothing here mutates: a call builds and returns a grid, and reads nothing outside its arguments.
- A primitive's coordinates are its own payload's, never the world's: placement is the caller's, the object's transform.
- The same spec and colour are the same payload, cell for cell — the terrain's noise is seeded from the spec, so no
  call depends on `Math.random` or on the order calls are made in.
- `primitiveCellCount(spec)` is never smaller than the payload `createPrimitive(spec, color)` returns.

## Errors
- `RangeError` for a size, radius, footprint, or height that is not a whole number of cells at least one, for an axis
  past the key space, for a terrain seed that is not an integer, and for a colour that is not a `0xRRGGBB` integer. The
  message names the value, and the caller — a form — turns it into data rather than letting it escape.
- No other failure exists: a spec that validates always produces a payload.

## Dependencies
- `./grid.ts` — `UniformGrid`, `HexColor`, and the key space bounds `KEY_MIN`/`KEY_MAX`.
- `three/addons/math/SimplexNoise.js` — the landscape's noise, taken from the library rather than hand-rolled.
No document, no editor, no scene: a primitive is a payload and nothing else.

## Tests
`tests/generator.test.ts` pins each shape's own rule rather than its arithmetic: a box filling its extent and a hollow
one leaving its interior (and changing nothing when it has none), a ball whose centre is inside and whose corners are
not at radius two, the corner's 19 cells at size three (three faces, less the edges and vertices they share), and a
landscape that is the same for the same seed, different for another, with every column solid from the ground to a top
inside the height it asked for. It also pins what it refuses. `tests/ops.test.ts` covers the operation that writes a
primitive into the document, and what the app-verified path adds (README §10) is the panel's row and where a created
shape lands in the scene.
