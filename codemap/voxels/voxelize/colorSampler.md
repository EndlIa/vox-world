# src/voxels/voxelize/colorSampler.ts

Ring: 0 · Layer: voxels/voxelize · Depends on: `../uniform/grid.js` (types only), `three`

## Responsibility
Decide the appearance color of one primitive of a voxelized source: the product of the material's base
color factor, its base color texture sampled at the triangle's UV centroid, and the first vertex color of
the triangle. It is not a palette, it does not blend or dither across a primitive, and it picks no mip
level. Alpha never decides geometry here: a sample the material's cutoff masks out keeps its cell and
only changes the texture term, and a fully transparent texel without a cutoff drops that term. It owns the
sampling rules — nearest-neighbour lookup, repeat addressing, the sRGB decode of a readback, and the
masked average — while the pixels, the UVs and the cutoff are handed to it by `three-runtime/import.ts`.
It never touches an image, a canvas, or a `THREE.Texture`.

## Public interface
```ts
type ColorSource = {
  baseColor: HexColor;
  vertexColors?: Float32Array;
  vertexColorSize?: number;
  texture?: { width: number; height: number; pixels: Uint8ClampedArray };  // sRGB RGBA texels
  uv?: Float32Array;                                                        // 2 per vertex
  alphaTest?: number;                                                       // material alpha cutoff; 0 or absent = none
};
function resolvePrimitiveColor(source: ColorSource, triangleVertices: readonly [number, number, number]): HexColor;
```
`triangleVertices` are the three indices the soup's own index buffer gives for one triangle, so they index
`vertexColors` and `uv` in the source's vertex order. `alphaTest` is `material.alphaTest` verbatim — the
value glTF's `alphaMode: MASK` sets to its `alphaCutoff` (0.5 by default) — and is compared against
`alpha / 255` of a texel, so a non-positive value means the material has no cutoff.

## Internal logic
1. Identity path: with neither `vertexColors` nor a usable `texture` + `uv` pair, `source.baseColor` is
   returned unchanged. It is already in the `HexColor = 0xRRGGBB` exchange format (the form
   `THREE.Color.getHex()` produces), so the identity path is bit-exact and deliberately skips a
   `THREE.Color` round trip that would re-encode an already-encoded value.
2. Otherwise the accumulator starts from the factor, `scratch.setHex(source.baseColor, SRGBColorSpace)`,
   which decodes it into the working space, and every remaining term multiplies into its linear
   components:
   - `vertexColors`: `size = vertexColorSize ?? 3`, the primitive's color comes from its first vertex,
     `offset = triangleVertices[0] * size`, reading `vertexColors[offset]`, `[offset + 1]`,
     `[offset + 2]`. Vertex components are linear sRGB — the working color space glTF `COLOR_0` arrives
     in — so they multiply in directly, and a stride of 4 (`COLOR_0` with alpha) ignores the alpha slot,
     because a voxel cell stores no transparency.
   - `texture` + `uv`: the triangle's UV centroid — the mean of the three vertices' `u` and the mean of
     their `v` — so a flat-shaded triangle reads one place in the texture independent of which vertex the
     caller listed first. Each component is wrapped into `[0, 1)` and mapped to the texel it falls in
     (`floor`), i.e. repeat addressing with nearest-neighbour lookup; no filtering and no mip level. Rows
     run from the top-left, the origin `ImageData` and glTF UVs share, so nothing is flipped. The texel's
     sRGB bytes are decoded by a second scratch `THREE.Color` (`setRGB(r/255, g/255, b/255,
     SRGBColorSpace)`) and multiply into the accumulator.
   - **alpha cutoff**: the sampled texel's `alpha / 255` decides which of the three texel terms is
     multiplied in, and nothing else — the geometry, the factor and the vertex colors are untouched:
     - `alphaTest > 0 && alpha / 255 < alphaTest` — a masked-out texel (glTF `MASK`) — contributes the
       texture's **visible average** instead of itself. The average is the mean of the r/g/b bytes of every
       texel whose `alpha / 255` reaches the cutoff, decoded from sRGB exactly like a single texel, so
       masked and unmasked samples of one texture stay in one space.
     - a texture with **no** visible texel at that cutoff (an all-transparent map) has no average to use,
       so the texture term is dropped and the factor × vertex-color product stands, as it does for a
       source with no texture.
     - no cutoff (`alphaTest` absent or `0`) and `alpha === 0`: the fully transparent texel contributes no
       texture term either — the same factor × vertex-color product — while any visible texel (alpha
       `1..255`) is sampled as itself. An alpha of `0` is the only transparency a cell cannot represent, so
       it is the only one that drops the term.
3. The visible average is **cached**, per texture record and per cutoff, and computed once, on first need,
   by `visibleAverage(texture, cutoff)`: one pass over `pixels` accumulating r/g/b over the texels the
   cutoff keeps and counting them. The cache is a module-level `WeakMap<texture record, Map<cutoff, average
   | null>>`, so it lives as long as the texture record does (a released texture releases its averages),
   is keyed by cutoff because which texels are visible depends on it, and is never attached to the caller's
   `TexturePixels` — a `ColorSource` stays plain, cloneable data. A foliage card samples one texture at one
   cutoff thousands of times, so every triangle after the first reads the cached value; a `null` entry is a
   cached "no visible texel" and is a hit, not a miss.
4. `scratch.getHex()` (default `SRGBColorSpace`) encodes the linear product into the hex the project
   exchanges. No hand-written color math exists anywhere in the path.
5. Two module-level scratch `THREE.Color` instances are reused instead of allocating one per primitive;
   that is safe because the function is synchronous, calls no caller code, and returns a number.

### Why the product
glTF computes a base color as `baseColorFactor * baseColorTexture * COLOR_0`, all of it linear, and
encodes the result for output. The three terms here are exactly those three, in that order and in that
space: the factor decoded from its sRGB hex, the texel decoded from its sRGB bytes, and the vertex colors,
which already arrive linear. The texture replaces neither the factor nor the vertex colors, so a material
whose color lives only in its map keeps a `0xffffff` factor and a black-factor material stays black.

### Why the cutoff chooses a colour rather than deleting a cell
An alpha mask conventionally discards the fragment a below-cutoff sample belongs to, and doing that here
would be the obvious port of the rule — but a voxel cell is an entire cube of the model, and at the voxel
resolutions this project uses (a foliage card is a few cells across) the transparent region between two
leaves covers whole cells. Dropping them punches the card full of holes, so the leaves fragment and grass
thins out to nothing. The voxelizer therefore keeps every cell a triangle covers, and the sampler's only
job is to name the colour of the masks that are left: the texture's visible average, which is the colour
the card reads as at a distance and which is what a mip pyramid would converge to. Pixel-perfect mask
edges are not on the table at this resolution, so a slightly soft mask edge is the right trade.

## Invariants
- **Alpha never removes or skips a cell.** The cutoff chooses the texture term and nothing else: a
  below-cutoff sample still resolves a colour, and geometric coverage stays entirely in the voxelizer. The
  reason is resolution: a masked foliage card is a few voxels across, so deleting every cell whose sample
  falls below the cutoff fragments the card and thins grass out to nothing, which is exactly the defect
  this rule exists to prevent. A caller that wants holes must not have asked for voxels of the whole card.
- The result is always a finite integer in `[0, 0xFFFFFF]` — never `undefined`, never `NaN`.
- A source with neither vertex colors nor a complete texture/UV pair implies a bit-exact
  `source.baseColor` result.
- The function is pure with respect to its arguments: equal `triangleVertices` and an equal source give an
  equal hex, and resolving one primitive never changes another primitive's color (the scratch instances and
  the visible-average cache are not observable to the caller — a cache entry is a pure function of the
  pixels and the cutoff it is keyed by).
- The visible average is one value per texture *record* and cutoff, shared by every triangle that samples
  that record at that cutoff; two triangles whose masked samples land on different transparent texels get
  the same colour, and two different cutoffs may get different ones.
- One texel per primitive, and a UV outside `[0, 1)` wraps instead of clamping, so a tiling texture
  samples correctly and two triangles whose centroids land in the same texel get the same color.
- Component values outside `[0, 1]` are handed to `THREE.Color` as given; clamping is Three.js's rule,
  not a local one.

## Errors
- Throws `RangeError` when any of `triangleVertices` is not a non-negative integer; when `vertexColorSize`
  is present and not a positive integer; when the vertex color slot the first vertex needs falls outside
  `vertexColors`; when `uv` does not cover the highest vertex named; when a texture dimension is not a
  positive integer; when a UV component is not finite; or when the resolved texel runs past `pixels`.
  Every one of these means the sampler was handed an attribute that does not cover the vertices it names —
  a caller bug, because the caller indexes both from the same soup.
- A *missing* attribute is never an error: `texture` without `uv`, `uv` without `texture`, and a source
  with neither are resolved from the terms that do exist.
- No result union: for well-formed input color resolution cannot fail, and a source without vertex
  colors or a texture always carries `baseColor`. A failure here is never swallowed into a fallback color.

## Dependencies
- `../uniform/grid.js` — `HexColor` as a type only.
- `three` — `Color` and `SRGBColorSpace`, for color-space-correct decode of the factor and the texels and
  encode of the result (README D1/D14). Nothing else from Three.js is needed and no local RGB math is
  written.
No outer-ring import, and no DOM: this file never touches an image, a canvas, or a texture object.

## Tests
`tests/voxelize.test.ts` (node, no DOM, no GPU — every `ColorSource` is hand-built) pins:
- precedence as a product: the first vertex's color multiplies into the factor for stride 3 and stride 4,
  a white factor reduces the product to the vertex color, and the vertex index — not the triangle index —
  selects the slot.
- the texture path: a 2x2 texture with four distinct texels resolves one hex per triangle; the UV
  centroid is what is sampled, shown by a 3x3 texture whose centre texel no vertex sits on; wrap-around
  repeat addressing for coordinates above 1 and below 0; nearest-neighbour rounding on the `0.5` seam.
- the masked path, over a 2x2 fixture holding an opaque texel, a half-transparent one (alpha 128) and two
  fully transparent ones whose bytes are decoys: a below-cutoff sample resolves to the average of the
  visible bytes, and not to the texel's own colour, the factor, or a neighbour; a texel that reaches the
  cutoff is still sampled itself; two triangles over two *different* transparent texels get that one
  cached average, while the same texture at a higher cutoff — which masks the half-transparent texel too —
  gets the recomputed one, so the cache is keyed by the cutoff; a texture whose every texel the cutoff
  hides leaves the factor × vertex-color product standing.
- a transparent texel without a cutoff (absent field, and `0`): no texture term, so the factor and the
  vertex colors stand while visible texels are unaffected — and the same sample with a cutoff differs,
  which is the whole point of carrying one.
- `voxelize`'s side: a soup whose index buffer names vertex 2 first colors its cells with vertex 2's
  color, and a masked sample keeps exactly the cells the same soup produces without the cutoff — proven
  by an equal `grid.size` — while every one of them takes the visible average, not the transparent texel.
- every two-factor product differs from the three-factor product, so no term can be dropped silently.
- clean fallbacks: `uv` without `texture`, `texture` without `uv`, and a `texture` whose `pixels` cannot
  cover the texel resolved.
- `RangeError` for a non-integer or negative vertex, a `vertexColorSize` of 0, a `uv` shorter than the
  vertices named, a non-positive texture dimension, a non-finite UV, and a too-short `pixels` buffer.

## Open questions
- Which channel of an image is authoritative: a readback is always treated as sRGB-encoded RGBA, which is
  what glTF requires of a base color map, so `texture.colorSpace` is never consulted. A non-base-color map
  handed to this sampler would be decoded wrongly.
- Filtering is nearest-neighbour with no mip level, so a minified texture aliases instead of averaging;
  averaging the texels a triangle covers, or a mip pyramid, would cost more than one lookup per primitive.
- The masked average is unweighted and computed over sRGB-encoded bytes: it stands in for the colour a
  transparent region reads as, not for a physically correct downsampled mip (which would average in the
  working space and weight each texel by the area it covers). It is also one average per texture, so a
  card whose leaves and trunk sit in one map gets a single colour in every hole.
- Whether incoming colors are linear-sRGB or already sRGB-encoded is inherited from whoever builds the
  `ColorSource` (`three-runtime/import.ts`); this file assumes linear-sRGB vertex components, an
  sRGB-encoded factor in hex form, and sRGB-encoded texel bytes.
