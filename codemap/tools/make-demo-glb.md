# tools/make-demo-glb.mjs

Ring: n/a (build-time tool, outside the `src/` onion) · Layer: tools · Depends on: Node built-ins only (`node:fs`, `node:path`, `node:process`)

## Responsibility
Generates the two demo GLB assets used by acceptance scenarios A and B. It is a build-time tool: no
`src/` module imports it, it imports nothing from `src/`, and it has no third-party dependency. It is
not the import path — real GLBs still arrive through `three-runtime/import.ts`.

## Public interface
```
node tools/make-demo-glb.mjs [outDir]
```
- `outDir` defaults to `public/` relative to the repository root and is created with
  `mkdirSync(dir, { recursive: true })` when missing. `public/` is the Vite static root, so the
  generated files are served at `/island.glb` and `/big.glb` with no copy step.
- Writes `<outDir>/island.glb` and `<outDir>/big.glb`, overwriting existing files.
- Prints one line per written file with its byte size; exits `0` on success.
- Exits `1` with a message on `stderr` for an argument count above one, a destination that exists as a
  file, or a write failure (`EACCES`, `ENOSPC`), which is caught and reported rather than escaping as an
  unhandled stack trace.
- Exports nothing and runs `main()` on load; nothing imports this file, and no `tests/*.test.ts` loads
  it — determinism is checked by running it twice and comparing bytes.

## Internal logic
1. **Seeded generator.** One 32-bit LCG per asset, seeded from the constants `ISLAND_SEED` and
   `BIG_SEED` (`state = (state * 1664525 + 1013904223) >>> 0`). `Math.random`, `Date`, and
   `performance.now` are never used.
2. **Integer heights.** Terrain height for a cell comes from an LCG hash of the cell coordinates,
   quantized by integer division (`h / 64`) into meters. No transcendental function is called, so no
   libm difference can change a byte of output.
3. **Geometry.** Every mesh is built as flat arrays: positions (`Float32Array`, meters, Y-up,
   counter-clockwise winding seen from outside), per-vertex normals computed per face or per quad (no
   smoothing pass), and indices (`Uint16Array` while the vertex count is below 65536, otherwise
   `Uint32Array`). Each mesh vertex list is emitted once and shared by the whole mesh.
4. **GLB writer.** The BIN chunk is laid out first in the order the JSON references it, then padded to
   a 4-byte multiple with `0x00`; the JSON chunk is serialized with a fixed key order and padded with
   spaces (`0x20`); each chunk is written as `<length:uint32> <type:uint32> <payload>` after a 12-byte
   header (`magic 0x46546C67`, version `2`, total file length).
5. **Emitted glTF subset.** `asset: { version: "2.0", generator: "vox-world demo asset generator" }`,
   one `scene` with its root node ids, `node`/`mesh`/`material`/`accessor`/`bufferView`/`buffer`
   arrays, `POSITION`, `NORMAL`, and `indices` accessors, and
   `pbrMetallicRoughness.baseColorFactor` plus `metallicFactor`/`roughnessFactor` per material. This is
   the subset `GLTFLoader` and `buildColorSource` consume.
6. **Textures are deliberately omitted.** No `images`, `samplers`, or `textures` entry is written and
   no material references one, so `ColorSource.baseColor` covers the demo and
   `buildVoxelizeSources` reads `material.color` for every node. Base-color texture sampling stays
   deferred (README section 9), and a real GLB with textures still works through the same import path.

Asset layout:

- `island.glb` — node `terrain` → mesh `terrain` (64×64 quad heightfield, 1 m spacing) → material
  `terrain` (green base color); node `car` → mesh `car` (body, cabin, and four wheel boxes merged into
  one indexed mesh) → material `car` with its own base color; plus two or three simple prop nodes
  (rock/tree/block shapes) with distinct base colors. Every node is a separate mesh node, so the import
  produces separately selectable objects, scenario A needs no detach step, and the SRS rule that
  voxelization must not force-merge objects is visible in the object list.
- `big.glb` — node `terrain` → 256×256 quad heightfield (1 m spacing); node `city` → boxes placed by
  the seeded generator on a coarse 32×32 grid; node `humanoid` (no mesh, transform-only, so it imports
  as `representation: 'empty'`) with five child mesh nodes `torso`, `hand-left`, `hand-right`,
  `foot-left`, `foot-right`, each its own mesh and material with a distinct base color. Scenario B
  splits the detach of hands and feet across separate nodes it already has.

## Invariants
- Two runs with no argument produce byte-identical `island.glb` and `big.glb`; nothing in the output
  depends on wall-clock time, iteration order of a `Set`/`Map` keyed by object, or unseeded randomness.
- Each output is a valid GLB: 12-byte header, JSON chunk first, BIN chunk second, both 4-byte aligned,
  declared total length equal to the file size.
- Node names are unique within a file and stable across runs; every mesh node has a name, because
  import uses it for the document object name.
- Every material sets `baseColorFactor` with alpha `1` and references no texture.
- Every mesh has an index count divisible by 3 and no index at or above its vertex count, so surface
  voxelization sees closed, watertight boxes.
- The script never substitutes a smaller asset: a write failure exits non-zero with the destination path.

## Errors
- Exit `1` plus a `stderr` line for bad usage, an unusable destination, or a write failure; no
  fallback path, no partial second file, and no silent success.
- Neither `src/` nor the test suite depends on the script's exit status, so a failure cannot make the
  build or `npm run check` fail for an unrelated reason.

## Dependencies
Node built-ins only: `node:fs` (`writeFileSync`, `mkdirSync`), `node:path` (destination join),
`node:process` (argv, exit code). Plain JS ESM, not typechecked (outside `tsconfig.include`). Using
`three` here would add a dependency and break the "no third-party dependency" rule, so the BoxGeometry
and matrix helpers Three.js offers are not used.

## Tests
No vitest file covers this script. Verification is by running it twice into two directories and
comparing the files (byte-identical), then importing both outputs through the app's GLB import path.

## Open questions
- The default `outDir` is `public/` (settled above). Generated GLBs stay out of version control:
  `.gitignore` carries `public/*.glb` because they are regenerable from this script alone.
