import { Color, SRGBColorSpace } from 'three';
import type { HexColor } from '../uniform/grid.js';

/**
 * One base color texture: sRGB-encoded RGBA texels, row-major from the top-left, as an image readback
 * yields them.
 */
type TexturePixels = { width: number; height: number; pixels: Uint8ClampedArray };

/**
 * What one primitive of a voxelized source can be colored by: the material's base color factor, its
 * base color texture, and the geometry's vertex colors.
 */
export type ColorSource = {
  baseColor: HexColor;
  vertexColors?: Float32Array;
  vertexColorSize?: number;
  /** Base color texture pixels, or absent: a source without one multiplies the factor alone. */
  texture?: TexturePixels;
  /** Texture coordinates, 2 floats per vertex, in the source soup's own vertex order. */
  uv?: Float32Array;
  /**
   * The material's alpha cutoff — `alphaTest`, which glTF's `alphaMode: MASK` sets to its
   * `alphaCutoff` (0.5 by default). A texel whose `alpha / 255` falls below it is masked out, and the
   * texture term becomes the texture's visible average rather than the sampled texel. `0`, or absent,
   * means the material has no cutoff and only a fully transparent texel drops the texture term.
   */
  alphaTest?: number;
};

/**
 * Scratch colors reused by every primitive. Safe because the function is synchronous, calls no
 * caller code, and returns a plain number, so the instances are never observable outside it.
 */
const scratch = new Color();

/** Second scratch, for the one texel of a primitive: it must be sRGB-decoded before it multiplies. */
const texelScratch = new Color();

/** Floats per texture coordinate. */
const UV_COMPONENT_COUNT = 2;

/** Bytes per texel in an sRGB readback: RGBA. */
const BYTES_PER_TEXEL = 4;

/** Components per vertex color slot when the source does not say: RGB, no alpha. */
const DEFAULT_VERTEX_COLOR_SIZE = 3;

/**
 * Appearance color of one primitive: the product of the material's base color factor, its base color
 * texture, and the primitive's first vertex color — the three terms glTF multiplies into a base color
 * (`baseColorFactor * baseColorTexture * COLOR_0`), returned as the `0xRRGGBB` hex the project
 * exchanges. Nothing is blended or dithered across a primitive, no mip level is chosen, and no cell is
 * ever dropped for its alpha: a voxel cell stores no transparency, so a masked-out sample still
 * resolves a colour and keeps the geometric coverage the voxelizer gave it.
 *
 * The material's `alphaTest` is the one alpha rule that does apply, and it only chooses the texture
 * term. A texel whose `alpha / 255` falls below a positive cutoff is masked out — the transparent
 * region of a foliage card — and the visible average of that texture (see `visibleAverage`) is
 * multiplied in its place. Substituting the sampled texel there would paint a hole with whatever
 * colour hides inside it, and falling back to the factor alone would paint the mask flat; deleting the
 * cell instead, which is what a mask conventionally does, fragments every foliage card and grass patch
 * at the voxel resolutions this project uses. A fully transparent texel without a cutoff contributes
 * no texture term at all, so that source keeps its factor and vertex colours.
 *
 * The factor is already the exchange format, so a source with neither texture nor vertex colors is
 * returned bit-exact, without a re-encoding round trip. Every other path converts through
 * `THREE.Color` (README D1/D14): the factor is decoded from sRGB by `setHex`, the vertex components
 * are linear sRGB — the working color space glTF `COLOR_0` arrives in — straight into the working
 * components, and the texel is decoded from the sRGB bytes an image readback yields by
 * `setRGB(..., SRGBColorSpace)`. The product is therefore linear, and `getHex()`'s default
 * `SRGBColorSpace` encodes it into the hex the project exchanges. No hand-written color math exists
 * anywhere in the path.
 *
 * A missing attribute is simply skipped, so a source with a texture but no `uv`, or a `uv` but no
 * texture, degrades to the terms it does have. An index outside the data it indexes is a caller bug
 * — the sampler was handed an attribute that does not cover the vertices it names — and throws.
 */
export function resolvePrimitiveColor(
  source: ColorSource,
  triangleVertices: readonly [number, number, number],
): HexColor {
  const [first, second, third] = triangleVertices;
  assertVertexIndex(first, 0);
  assertVertexIndex(second, 1);
  assertVertexIndex(third, 2);

  const vertexColors = source.vertexColors;
  const texture = source.texture;
  const uv = source.uv;

  // Nothing to multiply: the factor is already the `0xRRGGBB` exchange format, and a `THREE.Color`
  // round trip would only re-encode a value that is exact as it stands.
  if (vertexColors === undefined && (texture === undefined || uv === undefined)) return source.baseColor;

  scratch.setHex(source.baseColor, SRGBColorSpace);

  if (vertexColors !== undefined) {
    const size = source.vertexColorSize ?? DEFAULT_VERTEX_COLOR_SIZE;
    if (!Number.isInteger(size) || size <= 0) {
      throw new RangeError(`vertexColorSize must be a positive integer, received ${size}`);
    }

    // The primitive's first vertex: a stride of 4 (`COLOR_0` with alpha) ignores the alpha slot.
    const offset = first * size;
    const length = vertexColors.length;
    if (offset + 2 >= length) {
      throw new RangeError(`vertex ${first} needs slots ${offset}..${offset + 2} of ${length} vertex color slots`);
    }

    // Linear-sRGB components multiply straight into the working space, which is what glTF's product is.
    scratch.r *= vertexColors[offset]!;
    scratch.g *= vertexColors[offset + 1]!;
    scratch.b *= vertexColors[offset + 2]!;
  }

  if (texture !== undefined && uv !== undefined) {
    multiplyTexel(scratch, texture, uv, triangleVertices, source.alphaTest ?? 0);
  }

  return scratch.getHex();
}

/**
 * Multiplies the triangle's texture term into `target`, decoding it from sRGB into the working space
 * first: the texel nearest the triangle's UV centroid normally, the texture's visible average when the
 * material's cutoff masks that texel out.
 *
 * The centroid is the mean of the three vertices' coordinates: one texel per flat-shaded triangle,
 * independent of which vertex the caller listed first.
 */
function multiplyTexel(
  target: Color,
  texture: TexturePixels,
  uv: Float32Array,
  triangleVertices: readonly [number, number, number],
  alphaTest: number,
): void {
  const { width, height, pixels } = texture;
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new RangeError(`texture must have positive integer dimensions, received ${width}x${height}`);
  }

  const [first, second, third] = triangleVertices;
  const firstSlot = first * UV_COMPONENT_COUNT;
  const secondSlot = second * UV_COMPONENT_COUNT;
  const thirdSlot = third * UV_COMPONENT_COUNT;
  const lastSlot = Math.max(firstSlot, secondSlot, thirdSlot) + 1;
  if (lastSlot >= uv.length) {
    throw new RangeError(
      `vertices ${first}, ${second}, ${third} need UV slots up to ${lastSlot} of ${uv.length} UV slots`,
    );
  }

  const u = (uv[firstSlot]! + uv[secondSlot]! + uv[thirdSlot]!) / 3;
  const v = (uv[firstSlot + 1]! + uv[secondSlot + 1]! + uv[thirdSlot + 1]!) / 3;

  // Row-major from the top-left: ImageData and glTF's UV origin agree, so no coordinate is flipped.
  const offset = (texelIndex(v, height) * width + texelIndex(u, width)) * BYTES_PER_TEXEL;
  if (offset + 3 >= pixels.length) {
    throw new RangeError(`texel at byte ${offset} runs past ${pixels.length} texture bytes`);
  }

  const alpha = pixels[offset + 3]! / 255;
  if (alphaTest > 0 && alpha < alphaTest) {
    const average = visibleAverage(texture, alphaTest);
    // A texture whose every texel the cutoff hides has no texture term left, so the factor and the
    // vertex colors stand on their own.
    if (average === null) return;
    texelScratch.setRGB(average[0] / 255, average[1] / 255, average[2] / 255, SRGBColorSpace);
  } else if (alpha === 0) {
    // Without a cutoff, a fully transparent texel contributes no texture term — the same product a
    // source with no texture at all resolves to.
    return;
  } else {
    texelScratch.setRGB(
      pixels[offset]! / 255,
      pixels[offset + 1]! / 255,
      pixels[offset + 2]! / 255,
      SRGBColorSpace,
    );
  }

  target.r *= texelScratch.r;
  target.g *= texelScratch.g;
  target.b *= texelScratch.b;
}

/** One texture's visible average as sRGB-encoded bytes, `0..255` per component. */
type VisibleAverage = readonly [number, number, number];

/**
 * Averaged visible colours, keyed by the texture record and then by the cutoff. Module-level and weak:
 * a released texture releases its averages, and nothing is attached to a caller's `TexturePixels`, so
 * a `ColorSource` stays plain data.
 */
const visibleAverages = new WeakMap<TexturePixels, Map<number, VisibleAverage | null>>();

/**
 * The average colour of one texture's visible texels — the ones whose `alpha / 255` reaches `cutoff` —
 * as sRGB-encoded bytes, or `null` when the cutoff hides every texel of it.
 *
 * The average is computed once, on first need, in a single pass over the pixels, and cached for the
 * lifetime of the texture record: a foliage card samples its texture thousands of times at one cutoff,
 * and the mask's own colour is a texture-wide property, so every later triangle of that texture and
 * cutoff reuses the same value. The cutoff keys the cache because which texels are visible depends on
 * it. The bytes are accumulated as they are read — the same sRGB-encoded space a single texel is
 * sampled in — so the caller decodes masked and unmasked terms through `THREE.Color` alike.
 */
function visibleAverage(texture: TexturePixels, cutoff: number): VisibleAverage | null {
  let byCutoff = visibleAverages.get(texture);
  if (byCutoff === undefined) {
    byCutoff = new Map();
    visibleAverages.set(texture, byCutoff);
  }

  const cached = byCutoff.get(cutoff);
  if (cached !== undefined) return cached;

  const { pixels } = texture;
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;
  for (let offset = 0; offset + 3 < pixels.length; offset += BYTES_PER_TEXEL) {
    if (pixels[offset + 3]! / 255 < cutoff) continue;
    red += pixels[offset]!;
    green += pixels[offset + 1]!;
    blue += pixels[offset + 2]!;
    count += 1;
  }

  const average: VisibleAverage | null = count === 0 ? null : [red / count, green / count, blue / count];
  byCutoff.set(cutoff, average);
  return average;
}

/**
 * Nearest texel index along one axis under repeat addressing: the coordinate wraps into `[0, 1)`
 * first, so tiling works and a negative coordinate is not a special case.
 */
function texelIndex(component: number, size: number): number {
  if (!Number.isFinite(component)) {
    throw new RangeError(`UV component must be finite, received ${component}`);
  }
  const wrapped = component - Math.floor(component);
  // `wrapped` is in `[0, 1)`, so the floor lands in `[0, size - 1]`; the clamp is belt and braces.
  return Math.min(size - 1, Math.floor(wrapped * size));
}

/** One of the three vertex indices a triangle is made of; a bad one is a caller bug, not a bad source. */
function assertVertexIndex(vertex: number, position: number): void {
  if (!Number.isInteger(vertex) || vertex < 0) {
    throw new RangeError(`triangleVertices[${position}] must be a non-negative integer, received ${vertex}`);
  }
}
