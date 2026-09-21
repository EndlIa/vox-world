import { describe, expect, it } from 'vitest';
import { Color, LinearSRGBColorSpace, Matrix4, SRGBColorSpace, Vector3 } from 'three';
import { Octree } from '../src/voxels/octree/octree.js';
import { packKey, unpackKey } from '../src/voxels/uniform/grid.js';
import { resolvePrimitiveColor } from '../src/voxels/voxelize/colorSampler.js';
import { voxelizeSurface } from '../src/voxels/voxelize/surface.js';
import type { SurfaceCells, TriangleSoup } from '../src/voxels/voxelize/surface.js';
import { DEFAULT_CELL_BUDGET, voxelize } from '../src/voxels/voxelize/voxelize.js';
import type {
  VoxelizeOutput,
  VoxelizePart,
  VoxelizeResult,
  VoxelizeSource,
} from '../src/voxels/voxelize/voxelize.js';

type OkResult = Extract<VoxelizeResult, { ok: true }>;

/** What a surface pass returns, named here because the kernel declares it inline. */
type SurfaceResult = SurfaceCells | { error: 'budget-exceeded' | 'cancelled'; detail: string };

/**
 * Closed axis-aligned box from `(0, 0, 0)` to `(side, side, side)`: 12 triangles, two per face.
 * Its surface covers the cells of the side's cell block minus the strictly interior ones.
 */
function boxSoup(side: number): TriangleSoup {
  const positions = Float32Array.of(
    0, 0, 0, side, 0, 0, side, side, 0, 0, side, 0, // z = 0
    0, 0, side, 0, side, side, side, side, side, side, 0, side, // z = side
  );
  const index = Uint32Array.of(
    0, 1, 2, 0, 2, 3, // z = 0
    4, 5, 6, 4, 6, 7, // z = side
    0, 1, 7, 0, 7, 4, // y = 0
    3, 2, 6, 3, 6, 5, // y = side
    0, 3, 5, 0, 5, 4, // x = 0
    1, 2, 6, 1, 6, 7, // x = side
  );
  return { positions, index };
}

/** Bakes a local soup into world space, the way the importer hands geometry to `voxelize`. */
function translated(soup: TriangleSoup, x: number, y: number, z: number): TriangleSoup {
  const matrix = new Matrix4().makeTranslation(x, y, z);
  const positions = new Float32Array(soup.positions.length);
  const vertex = new Vector3();
  for (let i = 0; i < positions.length; i += 3) {
    vertex.set(soup.positions[i]!, soup.positions[i + 1]!, soup.positions[i + 2]!).applyMatrix4(matrix);
    positions[i] = vertex.x;
    positions[i + 1] = vertex.y;
    positions[i + 2] = vertex.z;
  }
  return { positions, index: soup.index };
}

/** A flat sheet of `n * n` quads at z = 0.25: `2 * n * n` triangles, more than one CHUNK. */
function quadGrid(n: number): TriangleSoup {
  const positions: number[] = [];
  const index: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const first = positions.length / 3;
      const x = i * 0.5;
      const y = j * 0.5;
      positions.push(x, y, 0.25, x + 0.5, y, 0.25, x + 0.5, y + 0.5, 0.25, x, y + 0.5, 0.25);
      index.push(first, first + 1, first + 2, first, first + 2, first + 3);
    }
  }
  return { positions: Float32Array.from(positions), index: Uint32Array.from(index) };
}

/** One part of a source: a world-space soup and the color its cells are sampled from. */
function partOf(soup: TriangleSoup, baseColor = 0xffffff): VoxelizePart {
  return { soup, color: { baseColor } };
}

function sourceOf(sourceId: string, soup: TriangleSoup, baseColor = 0xffffff): VoxelizeSource {
  return { sourceId, name: sourceId, parts: [partOf(soup, baseColor)] };
}

/**
 * A 2x2 base color texture whose texels are the four quadrants of the UV square: red, green, blue and
 * `(64, 128, 192)`, row-major from the top-left — the origin glTF UVs and an image readback share.
 */
function quadrantTexture(): { width: number; height: number; pixels: Uint8ClampedArray } {
  return {
    width: 2,
    height: 2,
    pixels: Uint8ClampedArray.of(255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 64, 128, 192, 255),
  };
}

/** A `uv` attribute whose three vertices all sit on `(u, v)`, so the triangle's centroid is that point. */
function flatUv(u: number, v: number): Float32Array {
  return Float32Array.of(u, v, u, v, u, v);
}

/**
 * A 2x2 base color texture with an alpha mask, row-major from the top-left: an opaque red texel, a
 * half-transparent green one (alpha 128, which a cutoff of 0.5 keeps and a cutoff of 0.75 masks out), and
 * a fully transparent bottom row holding blue and white — the colours hiding inside a hole that an
 * alpha-masked sample must never paint with.
 */
function maskedTexture(): { width: number; height: number; pixels: Uint8ClampedArray } {
  return {
    width: 2,
    height: 2,
    pixels: Uint8ClampedArray.of(
      255, 0, 0, 255, 0, 255, 0, 128,
      0, 0, 255, 0, 255, 255, 255, 0,
    ),
  };
}

/** Narrows a surface result to its cells, failing the test on a reported error. */
function surfaceCells(result: SurfaceResult): SurfaceCells {
  if ('error' in result) throw new Error(`voxelizeSurface failed: ${result.error}: ${result.detail}`);
  return result;
}

/** Awaits a request that must succeed, so the rest of the test can read its payloads. */
async function okResult(request: Promise<VoxelizeResult>): Promise<OkResult> {
  const settled = await request;
  if (!settled.ok) throw new Error(`voxelize failed: ${settled.error}: ${settled.detail}`);
  return settled;
}

function onlyOutput(result: OkResult): VoxelizeOutput {
  const output = result.outputs[0];
  if (output === undefined) throw new Error('expected the request to produce one output');
  return output;
}

describe('voxelizeSurface', () => {
  it('voxelizes an axis-aligned cube into exactly the cells its faces intersect', () => {
    const soup = boxSoup(1.9);
    const { cells, triangleCount } = surfaceCells(voxelizeSurface(soup, 0.5, { budget: 100_000 }));

    // The 4x4x4 cell block the 1.9 m cube spans, minus its strictly interior 2x2x2 block.
    const expected: number[] = [];
    for (let x = 0; x <= 3; x++) {
      for (let y = 0; y <= 3; y++) {
        for (let z = 0; z <= 3; z++) {
          if (x === 0 || x === 3 || y === 0 || y === 3 || z === 0 || z === 3) expected.push(packKey(x, y, z));
        }
      }
    }

    expect(triangleCount).toBe(12);
    expect(expected).toHaveLength(56);
    expect(cells.size).toBe(56);
    expect([...cells.keys()].sort((a, b) => a - b)).toEqual(expected.sort((a, b) => a - b));

    // Touching counts as a hit, so the far corner cell of the shell stays...
    expect(cells.has(packKey(0, 0, 0))).toBe(true);
    expect(cells.has(packKey(3, 3, 3))).toBe(true);
    // ...while nothing strictly inside the surface and nothing outside the block is claimed.
    expect(cells.has(packKey(1, 1, 1))).toBe(false);
    expect(cells.has(packKey(2, 2, 2))).toBe(false);
    expect(cells.has(packKey(4, 0, 0))).toBe(false);
  });
  it('never emits a cell outside a triangle AABB', () => {
    // A right triangle of legs 1.8 m at z = 0.05: cells (x, y, 0) with x + y <= 3 are touched,
    // while (3, 3, 0) sits inside the candidate AABB but outside the triangle.
    const soup: TriangleSoup = {
      positions: Float32Array.of(0.05, 0.05, 0.05, 1.85, 0.05, 0.05, 0.05, 1.85, 0.05),
      index: Uint32Array.of(0, 1, 2),
    };
    const { cells } = surfaceCells(voxelizeSurface(soup, 0.5, { budget: 1000 }));

    const expected: number[] = [];
    for (let x = 0; x <= 3; x++) {
      for (let y = 0; y <= 3; y++) {
        if (x + y <= 3) expected.push(packKey(x, y, 0));
      }
    }

    expect(expected).toHaveLength(10);
    expect(cells.size).toBe(10);
    expect([...cells.keys()].sort((a, b) => a - b)).toEqual(expected.sort((a, b) => a - b));
    expect(cells.has(packKey(3, 3, 0))).toBe(false);
    for (const key of cells.keys()) {
      const [x, y, z] = unpackKey(key);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(3);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(3);
      expect(z).toBe(0);
    }
  });

  it('keeps the first triangle that claims a cell', () => {
    // Triangle 0 stays inside cell (0, 0, 0); triangle 1 reaches that cell and its neighbours.
    const soup: TriangleSoup = {
      positions: Float32Array.of(
        0.1, 0.1, 0.1, 0.4, 0.1, 0.1, 0.1, 0.4, 0.1,
        0, 0, 0, 0.5, 0, 0, 0, 0.5, 0,
      ),
      index: Uint32Array.of(0, 1, 2, 3, 4, 5),
    };
    const { cells } = surfaceCells(voxelizeSurface(soup, 0.5, { budget: 100 }));

    expect(cells.size).toBe(3);
    // Both triangles claim it, so the lower index wins.
    expect(cells.get(packKey(0, 0, 0))).toBe(0);
    expect(cells.get(packKey(1, 0, 0))).toBe(1);
    expect(cells.get(packKey(0, 1, 0))).toBe(1);
  });

  it('returns budget-exceeded with the measured count', () => {
    const result = voxelizeSurface(boxSoup(1.9), 0.5, { budget: 10 });
    expect(result).toEqual({
      error: 'budget-exceeded',
      detail: 'cell budget exceeded: 11 cells at the limit of 10',
    });
    expect('cells' in result).toBe(false);
  });

  it('returns cancelled for an aborted signal', () => {
    const soup = quadGrid(23); // 1058 triangles, so the first 512-triangle boundary is reached
    const controller = new AbortController();
    controller.abort();
    const ratios: number[] = [];

    const result = voxelizeSurface(soup, 1, {
      budget: DEFAULT_CELL_BUDGET,
      onProgress: (ratio) => {
        ratios.push(ratio);
      },
      signal: controller.signal,
    });

    expect(result).toEqual({ error: 'cancelled', detail: 'cancelled after 512 of 1058 triangles' });
    expect('cells' in result).toBe(false);
    expect(ratios).toEqual([512 / 1058]);
  });
});

describe('resolvePrimitiveColor', () => {
  it('multiplies the first vertex color into the base color factor for stride 3 and stride 4', () => {
    // A white factor reduces the product to the vertex color, which is the first vertex of the triangle.
    const stride3 = { baseColor: 0xffffff, vertexColors: Float32Array.of(1, 1, 1, 0, 0, 1) };
    expect(resolvePrimitiveColor(stride3, [0, 1, 2])).toBe(0xffffff);
    expect(resolvePrimitiveColor(stride3, [1, 2, 0])).toBe(0x0000ff);

    // Linear 0.5 encodes to sRGB 0xbc through THREE.Color, not to 0x80 by a plain multiply.
    expect(resolvePrimitiveColor({ baseColor: 0xffffff, vertexColors: Float32Array.of(0.5, 0.5, 0.5) }, [0, 1, 2])).toBe(
      0xbcbcbc,
    );

    // Stride 4: vertex 1 starts at slot 4 and its alpha slot is ignored.
    const stride4 = {
      baseColor: 0xffffff,
      vertexColors: Float32Array.of(1, 0, 0, 1, 0.5, 1, 0.25, 0),
      vertexColorSize: 4,
    };
    const expected = new Color().setRGB(0.5, 1, 0.25, LinearSRGBColorSpace).getHex();
    expect(resolvePrimitiveColor(stride4, [1, 2, 0])).toBe(expected);
    expect(expected).not.toBe(0xffffff);
    expect(resolvePrimitiveColor({ ...stride4, vertexColors: Float32Array.of(1, 0, 0, 1, 0.5, 1, 0.25, 1) }, [1, 2, 0])).toBe(
      expected,
    );
  });

  it('resolves one texel per triangle through nearest-neighbour repeat addressing', () => {
    const texture = quadrantTexture();
    const uv = Float32Array.of(
      0.25, 0.25, 0.25, 0.25, 0.25, 0.25, // top-left texel
      0.75, 0.25, 0.75, 0.25, 0.75, 0.25, // top-right texel
      0.25, 0.75, 0.25, 0.75, 0.25, 0.75, // bottom-left texel
      0.5, 0.5, 0.5, 0.5, 0.5, 0.5, // exactly on the seam: the nearest texel rounds up
      1.25, 1.75, 1.25, 1.75, 1.25, 1.75, // wraps to (0.25, 0.75)
      -0.75, -0.25, -0.75, -0.25, -0.75, -0.25, // wraps to (0.25, 0.75) too
    );
    const source = { baseColor: 0xffffff, texture, uv };

    expect(resolvePrimitiveColor(source, [0, 1, 2])).toBe(0xff0000);
    expect(resolvePrimitiveColor(source, [3, 4, 5])).toBe(0x00ff00);
    expect(resolvePrimitiveColor(source, [6, 7, 8])).toBe(0x0000ff);
    expect(resolvePrimitiveColor(source, [9, 10, 11])).toBe(0x4080c0);
    expect(resolvePrimitiveColor(source, [12, 13, 14])).toBe(0x0000ff);
    expect(resolvePrimitiveColor(source, [15, 16, 17])).toBe(0x0000ff);
  });

  it('samples the UV centroid of the triangle rather than one of its vertices', () => {
    // A 3x3 texture whose centre texel is the only yellow one: the centroid reaches it, each vertex
    // sits on a red texel, so a "first vertex" or "any single vertex" rule cannot pass this case.
    const texture = {
      width: 3,
      height: 3,
      pixels: Uint8ClampedArray.of(
        255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255,
        255, 0, 0, 255, 255, 255, 0, 255, 255, 0, 0, 255,
        255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255,
      ),
    };
    const source = { baseColor: 0xffffff, texture, uv: Float32Array.of(0.05, 0.05, 0.95, 0.05, 0.05, 0.95) };

    expect(resolvePrimitiveColor(source, [0, 1, 2])).toBe(0xffff00);
    expect(resolvePrimitiveColor({ ...source, uv: flatUv(0.05, 0.05) }, [0, 1, 2])).toBe(0xff0000);
    expect(resolvePrimitiveColor({ ...source, uv: flatUv(0.95, 0.05) }, [0, 1, 2])).toBe(0xff0000);
    expect(resolvePrimitiveColor({ ...source, uv: flatUv(0.05, 0.95) }, [0, 1, 2])).toBe(0xff0000);
  });

  it('resolves a below-cutoff texel to the average of the visible texels', () => {
    const texture = maskedTexture();
    // With a cutoff of 0.5 the two transparent bottom-row texels are masked out, so the average of the
    // texels it keeps is the opaque red and the half-transparent green: bytes (127.5, 127.5, 0).
    const average = new Color().setRGB(0.5, 0.5, 0, SRGBColorSpace).getHex();
    expect(average).not.toBe(0x0000ff);
    expect(average).not.toBe(0xffffff);

    // Both holes resolve to it, not to the blue and white hiding inside them.
    expect(resolvePrimitiveColor({ baseColor: 0xffffff, texture, uv: flatUv(0.25, 0.75), alphaTest: 0.5 }, [0, 1, 2])).toBe(
      average,
    );
    expect(resolvePrimitiveColor({ baseColor: 0xffffff, texture, uv: flatUv(0.75, 0.75), alphaTest: 0.5 }, [0, 1, 2])).toBe(
      average,
    );

    // A texel that reaches the cutoff is still sampled itself — red stays red, and the half-transparent
    // green (128 / 255 = 0.502) is visible at 0.5.
    expect(resolvePrimitiveColor({ baseColor: 0xffffff, texture, uv: flatUv(0.25, 0.25), alphaTest: 0.5 }, [0, 1, 2])).toBe(
      0xff0000,
    );
    expect(resolvePrimitiveColor({ baseColor: 0xffffff, texture, uv: flatUv(0.75, 0.25), alphaTest: 0.5 }, [0, 1, 2])).toBe(
      0x00ff00,
    );
  });

  it('resolves every masked texel of one texture and cutoff to the same cached average', () => {
    const texture = maskedTexture();
    const atHalfCutoff = { baseColor: 0xffffff, texture, alphaTest: 0.5 };

    // Two triangles whose centroids land on two different transparent texels: one value, the average
    // computed once for the texture and the cutoff, rather than a per-texel or per-triangle colour.
    const blueHole = resolvePrimitiveColor({ ...atHalfCutoff, uv: flatUv(0.25, 0.75) }, [0, 1, 2]);
    const whiteHole = resolvePrimitiveColor({ ...atHalfCutoff, uv: flatUv(0.75, 0.75) }, [0, 1, 2]);
    expect(blueHole).toBe(whiteHole);
    expect(blueHole).toBe(new Color().setRGB(0.5, 0.5, 0, SRGBColorSpace).getHex());

    // The cutoff keys that average: at 0.75 the half-transparent green is masked out too, so the only
    // visible texel is the opaque red — the 0.5 average is not reused for it.
    const atThreeQuarterCutoff = { baseColor: 0xffffff, texture, alphaTest: 0.75 };
    expect(resolvePrimitiveColor({ ...atThreeQuarterCutoff, uv: flatUv(0.75, 0.25) }, [0, 1, 2])).toBe(0xff0000);
    expect(resolvePrimitiveColor({ ...atThreeQuarterCutoff, uv: flatUv(0.25, 0.75) }, [0, 1, 2])).toBe(0xff0000);
    expect(blueHole).not.toBe(0xff0000);
  });

  it('contributes no texture term for a fully transparent texel without a cutoff', () => {
    const texture = maskedTexture();
    const hole = flatUv(0.25, 0.75); // the transparent blue texel

    // Without a cutoff the transparency leaves the factor alone, whether the field is absent or zero.
    expect(resolvePrimitiveColor({ baseColor: 0x123456, texture, uv: hole }, [0, 1, 2])).toBe(0x123456);
    expect(resolvePrimitiveColor({ baseColor: 0x123456, texture, uv: hole, alphaTest: 0 }, [0, 1, 2])).toBe(0x123456);
    // The vertex colour survives with it, so the product is factor x vertex colour, exactly as it is for
    // a source with no texture at all.
    expect(
      resolvePrimitiveColor(
        { baseColor: 0xffffff, texture, uv: hole, vertexColors: Float32Array.of(1, 0.5, 0.25), vertexColorSize: 3 },
        [0, 1, 2],
      ),
    ).toBe(new Color().setRGB(1, 0.5, 0.25, LinearSRGBColorSpace).getHex());
    // A visible texel is unaffected by an absent or zero cutoff.
    expect(resolvePrimitiveColor({ baseColor: 0xffffff, texture, uv: flatUv(0.25, 0.25) }, [0, 1, 2])).toBe(0xff0000);
    expect(resolvePrimitiveColor({ baseColor: 0xffffff, texture, uv: flatUv(0.25, 0.25), alphaTest: 0 }, [0, 1, 2])).toBe(
      0xff0000,
    );

    // What the cutoff changes is the masked sample: it becomes the visible average instead of dropping
    // the texture term, still as the factor x texture x vertex product.
    const product = new Color().setHex(0x123456, SRGBColorSpace).multiply(new Color().setRGB(0.5, 0.5, 0, SRGBColorSpace));
    const masked = resolvePrimitiveColor({ baseColor: 0x123456, texture, uv: hole, alphaTest: 0.5 }, [0, 1, 2]);
    expect(masked).toBe(product.getHex());
    expect(masked).not.toBe(0x123456);
  });

  it('multiplies only the factor and the vertex color when the cutoff hides every texel', () => {
    const fullyMasked = { width: 1, height: 1, pixels: Uint8ClampedArray.of(0, 0, 255, 0) };
    const uv = flatUv(0.5, 0.5);

    // Nothing survives the cutoff, so there is no average to use and the texture term is dropped instead
    // of being multiplied by a hole.
    expect(resolvePrimitiveColor({ baseColor: 0x808080, texture: fullyMasked, uv, alphaTest: 0.5 }, [0, 1, 2])).toBe(0x808080);
    expect(
      resolvePrimitiveColor(
        {
          baseColor: 0xffffff,
          texture: fullyMasked,
          uv,
          alphaTest: 0.5,
          vertexColors: Float32Array.of(1, 0.5, 0.25),
          vertexColorSize: 3,
        },
        [0, 1, 2],
      ),
    ).toBe(new Color().setRGB(1, 0.5, 0.25, LinearSRGBColorSpace).getHex());
    // Whatever colour the hidden texel holds never reaches the result.
    const greenHole = { ...fullyMasked, pixels: Uint8ClampedArray.of(0, 255, 0, 0) };
    expect(resolvePrimitiveColor({ baseColor: 0x808080, texture: greenHole, uv, alphaTest: 0.5 }, [0, 1, 2])).toBe(0x808080);
  });

  it('multiplies the factor, the texture and the vertex color, and still exchanges a 0xRRGGBB hex', () => {
    const texture = { width: 1, height: 1, pixels: Uint8ClampedArray.of(255, 128, 64, 255) };
    const uv = flatUv(0.5, 0.5);
    const vertexColors = Float32Array.of(1, 0.5, 0.25);

    // Each pair on its own, so the triple below cannot be mistaken for any two-factor implementation.
    expect(resolvePrimitiveColor({ baseColor: 0x808080, texture, uv }, [0, 1, 2])).toBe(0x803d1b);
    expect(resolvePrimitiveColor({ baseColor: 0x808080, vertexColors, vertexColorSize: 3 }, [0, 1, 2])).toBe(0x805c42);
    expect(
      resolvePrimitiveColor({ baseColor: 0xffffff, texture, uv, vertexColors, vertexColorSize: 3 }, [0, 1, 2]),
    ).toBe(0xff5c1e);

    const product = resolvePrimitiveColor({ baseColor: 0x808080, texture, uv, vertexColors, vertexColorSize: 3 }, [0, 1, 2]);
    expect(product).toBe(0x802a09);
    expect(Number.isInteger(product)).toBe(true);
    expect(product).toBeGreaterThanOrEqual(0);
    expect(product).toBeLessThanOrEqual(0xffffff);
  });

  it('skips a missing texture or a missing uv instead of throwing', () => {
    const texture = quadrantTexture();
    // Neither half can be sampled alone, and each leaves the factor of the product untouched.
    expect(resolvePrimitiveColor({ baseColor: 0x123456, uv: flatUv(0.25, 0.25) }, [0, 1, 2])).toBe(0x123456);
    expect(resolvePrimitiveColor({ baseColor: 0x123456, texture }, [0, 1, 2])).toBe(0x123456);
    expect(resolvePrimitiveColor({ baseColor: 0x123456, texture, uv: flatUv(0.25, 0.25) }, [0, 1, 2])).not.toBe(0x123456);
    // The vertex-color half of the product survives a texture that has no uv to sample it with.
    expect(
      resolvePrimitiveColor({ baseColor: 0xffffff, texture, vertexColors: Float32Array.of(1, 1, 0), vertexColorSize: 3 }, [
        0, 1, 2,
      ]),
    ).toBe(0xffff00);
  });

  it('falls back to baseColor and exchanges both as 0xRRGGBB', () => {
    expect(resolvePrimitiveColor({ baseColor: 0x123456 }, [0, 1, 2])).toBe(0x123456);
    expect(resolvePrimitiveColor({ baseColor: 0x000000 }, [7, 8, 9])).toBe(0x000000);

    const vertex = resolvePrimitiveColor({ baseColor: 0x123456, vertexColors: Float32Array.of(0.25, 0.5, 0.75) }, [
      0, 1, 2,
    ]);
    expect(Number.isInteger(vertex)).toBe(true);
    expect(vertex).toBeGreaterThanOrEqual(0);
    expect(vertex).toBeLessThanOrEqual(0xffffff);
    expect(vertex).not.toBe(0x123456);
  });

  it('throws RangeError for a vertex or an attribute slot outside the data', () => {
    const source = { baseColor: 0xffffff, vertexColors: Float32Array.of(1, 0, 0) };
    expect(() => resolvePrimitiveColor(source, [1, 1, 1])).toThrow(RangeError); // no such vertex
    expect(() => resolvePrimitiveColor(source, [-1, 0, 0])).toThrow(RangeError);
    expect(() => resolvePrimitiveColor(source, [0.5, 0, 0])).toThrow(RangeError);
    expect(() => resolvePrimitiveColor({ ...source, vertexColorSize: 0 }, [0, 0, 0])).toThrow(RangeError);

    // Attributes that do not cover the vertices naming them are caller bugs, not a colour fallback.
    const texture = quadrantTexture();
    expect(() =>
      resolvePrimitiveColor({ baseColor: 0xffffff, texture, uv: Float32Array.of(0.25, 0.25, 0.25, 0.25) }, [0, 1, 2]),
    ).toThrow(RangeError);
    expect(() =>
      resolvePrimitiveColor(
        { baseColor: 0xffffff, texture: { width: 2, height: 2, pixels: Uint8ClampedArray.of(0, 0, 0, 255) }, uv: flatUv(0.5, 0.5) },
        [0, 0, 0],
      ),
    ).toThrow(RangeError);
    expect(() =>
      resolvePrimitiveColor(
        { baseColor: 0xffffff, texture: { width: 0, height: 2, pixels: new Uint8ClampedArray(0) }, uv: flatUv(0.5, 0.5) },
        [0, 0, 0],
      ),
    ).toThrow(RangeError);
    expect(() =>
      resolvePrimitiveColor(
        { baseColor: 0xffffff, texture, uv: Float32Array.of(Number.NaN, 0, 0, 0, 0, 0) },
        [0, 0, 0],
      ),
    ).toThrow(RangeError);
  });
});
describe('voxelize', () => {
  it('returns one output per source with the requested representation', async () => {
    const sources: VoxelizeSource[] = [
      { sourceId: 'node-car', name: 'Car', parts: [partOf(boxSoup(1.9), 0xff0000)] },
      { sourceId: 'node-wheel', name: 'Wheel', parts: [partOf(translated(boxSoup(0.75), 4, 0, 0), 0x00ff00)] },
    ];
    const ratios: number[] = [];
    const result = await okResult(
      voxelize({
        sources,
        target: { kind: 'uniform', voxelSize: 0.5 },
        budget: DEFAULT_CELL_BUDGET,
        onProgress: (ratio) => {
          ratios.push(ratio);
        },
      }),
    );
    expect(ratios).toEqual([1]); // both soups are below one CHUNK, so progress lands exactly on 1

    expect(result.outputs).toHaveLength(sources.length);
    expect(result.outputs.map((output) => output.sourceId)).toEqual(['node-car', 'node-wheel']);
    expect(result.outputs.map((output) => output.name)).toEqual(['Car', 'Wheel']);
    expect(result.stats.triangles).toBe(24);
    expect(result.outputs[0]?.payload).not.toBe(result.outputs[1]?.payload);

    let summed = 0;
    for (const output of result.outputs) {
      const { payload } = output;
      expect(payload.kind).toBe('uniform');
      summed += payload.kind === 'uniform' ? payload.grid.size : payload.octree.occupiedLeafCount;
      if (payload.kind === 'uniform') expect(payload.grid.voxelSize).toBe(0.5);
    }
    expect(summed).toBe(64); // the 1.9 m cube's 56-cell shell plus the 0.75 m cube's 8
    expect(result.stats.cells).toBe(summed);

    const car = result.outputs[0]?.payload;
    if (car?.kind !== 'uniform') throw new Error('expected a uniform payload');
    expect(car.grid.getColor(0, 0, 0)).toBe(0xff0000);
    const wheel = result.outputs[1]?.payload;
    if (wheel?.kind !== 'uniform') throw new Error('expected a uniform payload');
    expect(wheel.grid.size).toBe(8);
    expect(wheel.grid.getColor(0, 0, 0)).toBe(0x00ff00);
  });
  it('writes one cell per shared cell, coloured by the first part that claims it', async () => {
    // Two identical cubes in one source: the second part reaches every cell of the first, so the payload
    // holds the 56 cells of a single cube — no cell is written twice — and each of them keeps the colour
    // of the part that claimed it first, whichever way round the parts are ordered.
    const soup = boxSoup(1.9);
    const orders = [
      [0xff0000, 0x00ff00],
      [0x00ff00, 0xff0000],
    ] as const;

    for (const [first, second] of orders) {
      const result = await okResult(
        voxelize({
          sources: [{ sourceId: 'scene-two', name: 'Two', parts: [partOf(soup, first), partOf(soup, second)] }],
          target: { kind: 'uniform', voxelSize: 0.5 },
          budget: DEFAULT_CELL_BUDGET,
        }),
      );
      const output = onlyOutput(result);
      if (output.payload.kind !== 'uniform') throw new Error('expected a uniform payload');

      expect(output.payload.grid.size).toBe(56);
      expect(result.stats).toEqual({ cells: 56, triangles: 24 }); // both parts count, in triangles
      output.payload.grid.forEach((_x, _y, _z, color) => {
        expect(color).toBe(first);
      });
    }
  });

  it('colours a cell only a later part claims from that part', async () => {
    // The second part sits four metres away, so its cells are free: they take its own colour, while the
    // cells the first part claimed keep theirs.
    const output = onlyOutput(
      await okResult(
        voxelize({
          sources: [
            {
              sourceId: 'scene-two',
              name: 'Two',
              parts: [partOf(boxSoup(1.9), 0xff0000), partOf(translated(boxSoup(0.75), 4, 0, 0), 0x00ff00)],
            },
          ],
          target: { kind: 'uniform', voxelSize: 0.5 },
          budget: DEFAULT_CELL_BUDGET,
        }),
      ),
    );
    if (output.payload.kind !== 'uniform') throw new Error('expected a uniform payload');
    const grid = output.payload.grid;

    expect(grid.size).toBe(64); // the 1.9 m shell's 56 cells plus the 0.75 m cube's 8
    let claimed = 0;
    let later = 0;
    grid.forEach((x, _y, _z, color) => {
      // The origin is the union AABB's floor, 0 here, so the far cube starts at cell 8.
      if (x < 8) {
        expect(color).toBe(0xff0000);
        claimed += 1;
        return;
      }
      expect(color).toBe(0x00ff00);
      later += 1;
    });
    expect(claimed).toBe(56);
    expect(later).toBe(8);
  });

  it('places the payload at the union AABB of every part', async () => {
    // Two one-metre cubes at x = 2 and x = 0.3: the first part alone would put the payload at 2, the union
    // minimum is 0.3. One payload holds both, so the origin is the union's.
    const source: VoxelizeSource = {
      sourceId: 'scene-union',
      name: 'Union',
      parts: [partOf(translated(boxSoup(1), 2, 0, 0)), partOf(translated(boxSoup(1), 0.3, 0, 0))],
    };

    // Uniform: the origin is the union minimum floored to the cell size — 0, not 2 — and both parts are
    // measured from it, so the far part covers cells 4..6 while the near one covers 0..2.
    const uniform = onlyOutput(
      await okResult(
        voxelize({
          sources: [source],
          target: { kind: 'uniform', voxelSize: 0.5 },
          budget: DEFAULT_CELL_BUDGET,
        }),
      ),
    );
    expect(uniform.origin.equals(new Vector3(0, 0, 0))).toBe(true);
    if (uniform.payload.kind !== 'uniform') throw new Error('expected a uniform payload');
    expect(uniform.payload.grid.bounds()).toEqual({ min: [0, 0, 0], max: [6, 2, 2] });

    // Octree: the origin is the union minimum itself, so it is the near part's 0.3 and not the 2 the
    // first part alone would have given the payload; the positions are float32, so the coordinate is
    // compared with a tolerance like every other soup coordinate in this file.
    const octree = onlyOutput(
      await okResult(
        voxelize({
          sources: [source],
          target: { kind: 'octree', rootSize: 8, maxDepth: 10, targetCellSize: 1 },
          budget: DEFAULT_CELL_BUDGET,
        }),
      ),
    );
    expect(octree.origin.x).toBeCloseTo(0.3, 5);
    expect(octree.origin.y).toBe(0);
    expect(octree.origin.z).toBe(0);
  });

  it('treats a source with no parts like a soup with no triangles', async () => {
    const target = { kind: 'uniform', voxelSize: 0.5 } as const;
    const partless: VoxelizeSource = { sourceId: 'scene-none', name: 'None', parts: [] };

    // Nothing to voxelize anywhere: the same `empty` result a zero-triangle soup gives.
    const alone = await voxelize({ sources: [partless], target, budget: 1000 });
    expect(alone).toEqual({ ok: false, error: 'empty', detail: expect.any(String) });
    expect('outputs' in alone).toBe(false);

    // Beside a source that has geometry, a partless source keeps its slot with an empty payload, at the
    // origin a source without bounds gets, exactly as a source whose soup has no triangles does.
    const result = await okResult(
      voxelize({
        sources: [sourceOf('node-box', boxSoup(1.9)), partless],
        target,
        budget: DEFAULT_CELL_BUDGET,
      }),
    );
    expect(result.outputs).toHaveLength(2);
    expect(result.outputs[1]?.sourceId).toBe('scene-none');
    expect(result.outputs[1]?.origin.equals(new Vector3(0, 0, 0))).toBe(true);
    const empty = result.outputs[1]?.payload;
    if (empty?.kind !== 'uniform') throw new Error('expected a uniform payload');
    expect(empty.grid.size).toBe(0);
    expect(result.stats.triangles).toBe(12); // the partless source contributes none
  });

  it('derives the octree depth from targetCellSize and clamps it to maxDepth', async () => {
    const soup = boxSoup(1.9);
    const octreeFor = async (maxDepth: number, targetCellSize: number) => {
      const result = await okResult(
        voxelize({
          sources: [sourceOf('node-box', soup)],
          target: { kind: 'octree', rootSize: 8, maxDepth, targetCellSize },
          budget: DEFAULT_CELL_BUDGET,
        }),
      );
      const { payload } = onlyOutput(result);
      if (payload.kind !== 'octree') throw new Error('expected an octree payload');
      const tree = payload.octree;
      const sizes = new Set<number>();
      const depths = new Set<number>();
      let leaves = 0;
      tree.forEachOccupiedLeaf((id) => {
        const box = tree.leafBox(id);
        sizes.add(box.size);
        depths.add(box.depth);
        leaves++;
      });
      return { tree, leaves, sizes: [...sizes], depths: [...depths] };
    };

    // ceil(log2(8 / 1)) = 3, leaf edge 1: the 1.9 m shell fills the whole 2x2x2 leaf block.
    const deep = await octreeFor(10, 1);
    expect(deep.tree).toBeInstanceOf(Octree);
    expect(deep.leaves).toBe(8);
    expect(deep.sizes).toEqual([1]);
    expect(deep.depths).toEqual([3]);

    // Clamped to maxDepth 2: leaf edge 2, one leaf.
    const clamped = await octreeFor(2, 1);
    expect(clamped.leaves).toBe(1);
    expect(clamped.sizes).toEqual([2]);
    expect(clamped.depths).toEqual([2]);

    // ceil(log2(8 / 8)) = 0 clamps up to the minimum depth 1: leaf edge 4, one leaf.
    const coarse = await octreeFor(10, 8);
    expect(coarse.leaves).toBe(1);
    expect(coarse.sizes).toEqual([4]);
    expect(coarse.depths).toEqual([1]);

    // A target cell size of 8 / 512 gives depth 9, so this rod's aligned leaf columns run past
    // 512 — further than the uniform container's own storage range, and still keyed by the kernel.
    const rod: TriangleSoup = {
      positions: Float32Array.of(0, 0.001, 0.001, 8, 0.001, 0.001, 0, 0.031, 0.001),
      index: Uint32Array.of(0, 1, 2),
    };
    const rodOutput = onlyOutput(
      await okResult(
        voxelize({
          sources: [sourceOf('node-rod', rod)],
          target: { kind: 'octree', rootSize: 8, maxDepth: 10, targetCellSize: 0.015625 },
          budget: DEFAULT_CELL_BUDGET,
        }),
      ),
    );
    if (rodOutput.payload.kind !== 'octree') throw new Error('expected an octree payload');
    const rodTree = rodOutput.payload.octree;
    let rodLeaves = 0;
    let rodSize = 0;
    let rodDepth = 0;
    let farColumn = -Infinity;
    rodTree.forEachOccupiedLeaf((id) => {
      const box = rodTree.leafBox(id);
      if (box.center.x > farColumn) farColumn = box.center.x;
      rodLeaves++;
      rodSize = box.size;
      rodDepth = box.depth;
    });
    expect(rodSize).toBe(0.015625);
    expect(rodDepth).toBe(9);
    expect(rodLeaves).toBeGreaterThan(512);
    // The far column is clamped into the root box, so every leaf center stays inside `[0, 8]`.
    expect(farColumn).toBeCloseTo(7.9921875, 10);
    expect(rodTree.occupiedLeafCount).toBe(rodLeaves);
  });

  it('places each origin at the payload world min corner', async () => {
    const soup = translated(boxSoup(1.9), 2.7, 2.7, 2.7);
    const uniform = onlyOutput(
      await okResult(
        voxelize({
          sources: [sourceOf('node-placed', soup)],
          target: { kind: 'uniform', voxelSize: 0.5 },
          budget: DEFAULT_CELL_BUDGET,
        }),
      ),
    );

    // The origin is the AABB minimum floored to the voxel size, so no local coordinate is negative.
    expect(uniform.origin.equals(new Vector3(2.5, 2.5, 2.5))).toBe(true);
    expect(uniform.origin.x).toBeLessThanOrEqual(2.7);
    expect(uniform.origin.x).toBeGreaterThan(2.7 - 0.5);
    if (uniform.payload.kind !== 'uniform') throw new Error('expected a uniform payload');
    expect(uniform.payload.grid.bounds()).toEqual({ min: [0, 0, 0], max: [4, 4, 4] });

    const octree = onlyOutput(
      await okResult(
        voxelize({
          sources: [sourceOf('node-placed', soup)],
          target: { kind: 'octree', rootSize: 8, maxDepth: 10, targetCellSize: 1 },
          budget: DEFAULT_CELL_BUDGET,
        }),
      ),
    );

    // An octree keeps the AABB minimum itself as the origin of the root box [0, rootSize]^3.
    expect(octree.origin.x).toBeCloseTo(2.7, 5);
    expect(octree.origin.y).toBeCloseTo(2.7, 5);
    expect(octree.origin.z).toBeCloseTo(2.7, 5);
    if (octree.payload.kind !== 'octree') throw new Error('expected an octree payload');
    const tree = octree.payload.octree;
    let leaves = 0;
    tree.forEachOccupiedLeaf((id) => {
      const center = tree.leafBox(id).center;
      expect(center.x).toBeGreaterThanOrEqual(0);
      expect(center.x).toBeLessThanOrEqual(8);
      leaves++;
    });
    expect(leaves).toBeGreaterThan(0);
    expect(leaves).toBe(tree.occupiedLeafCount);
  });

  it('returns empty for soups with no triangles', async () => {
    const empty: TriangleSoup = { positions: new Float32Array(0), index: new Uint32Array(0) };
    const result = await voxelize({
      sources: [sourceOf('node-empty', empty)],
      target: { kind: 'uniform', voxelSize: 0.5 },
      budget: 1000,
    });

    expect(result).toEqual({ ok: false, error: 'empty', detail: expect.any(String) });
    expect('outputs' in result).toBe(false);
  });

  it('returns unsupported-geometry for a malformed soup', async () => {
    const triangle: TriangleSoup = {
      positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0),
      index: Uint32Array.of(0, 1, 2),
    };
    const malformed: TriangleSoup[] = [
      { positions: triangle.positions, index: Uint32Array.of(0, 1, 3) }, // index past the vertices
      { positions: triangle.positions, index: Uint32Array.of(0, 1, 2, 0) }, // not a triangle multiple
      { positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1), index: Uint32Array.of(0, 1, 2) },
      { positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, Number.NaN, 0), index: Uint32Array.of(0, 1, 2) },
    ];

    for (const soup of malformed) {
      const result = await voxelize({
        sources: [sourceOf('node-bad', soup)],
        target: { kind: 'uniform', voxelSize: 0.5 },
        budget: 1000,
      });
      expect(result).toMatchObject({ ok: false, error: 'unsupported-geometry' });
      expect('outputs' in result).toBe(false);
    }
  });

  it('returns exceeds-grid for a uniform extent past the key range and for an octree root box smaller than the source AABB, with detail naming the sourceId and the offending axis', async () => {
    // A 300 m triangle: 601 cells on X at voxelSize 0.5, past the 512 cells a payload may hold.
    const wide: TriangleSoup = {
      positions: Float32Array.of(0, 0, 0, 300, 0, 0, 0, 300, 0),
      index: Uint32Array.of(0, 1, 2),
    };

    const uniform = await voxelize({
      sources: [sourceOf('node-wide', wide)],
      target: { kind: 'uniform', voxelSize: 0.5 },
      budget: DEFAULT_CELL_BUDGET,
    });
    expect(uniform).toMatchObject({ ok: false, error: 'exceeds-grid' });
    if (uniform.ok) throw new Error('expected the request to fail');
    expect(uniform.detail).toContain('node-wide');
    expect(uniform.detail).toContain('X axis');
    expect(uniform.detail).toContain('601');

    const octree = await voxelize({
      sources: [sourceOf('node-deep', wide)],
      target: { kind: 'octree', rootSize: 1, maxDepth: 10, targetCellSize: 0.5 },
      budget: DEFAULT_CELL_BUDGET,
    });
    expect(octree).toMatchObject({ ok: false, error: 'exceeds-grid' });
    if (octree.ok) throw new Error('expected the request to fail');
    expect(octree.detail).toContain('node-deep');
    expect(octree.detail).toContain('X axis');
    expect(octree.detail).toContain('300');
  });

  it('exports DEFAULT_CELL_BUDGET as 4_000_000', () => {
    expect(DEFAULT_CELL_BUDGET).toBe(4_000_000);
  });

  it('reports cancel and budget failures with no outputs', async () => {
    const source = sourceOf('node-cube', boxSoup(1.9));
    const target = { kind: 'uniform', voxelSize: 0.5 } as const;

    const controller = new AbortController();
    controller.abort();
    const cancelledResult = await voxelize({
      sources: [source],
      target,
      budget: DEFAULT_CELL_BUDGET,
      signal: controller.signal,
    });
    expect(cancelledResult).toEqual({
      ok: false,
      error: 'cancelled',
      detail: 'voxelization cancelled; the scene was left untouched',
    });
    expect('outputs' in cancelledResult).toBe(false);

    // The 1.9 m shell holds 56 cells, so this limit is passed on the 11th cell of one slice.
    const starved = await voxelize({ sources: [source], target, budget: 10 });
    expect(starved).toMatchObject({ ok: false, error: 'budget-exceeded' });
    expect('outputs' in starved).toBe(false);
    if (starved.ok) throw new Error('expected the request to fail');
    expect(starved.detail).toContain('11 cells');
    expect(starved.detail).toContain('limit of 10');

    await expect(voxelize({ sources: [source], target: { kind: 'uniform', voxelSize: 0 }, budget: 10 })).rejects.toThrow(
      RangeError,
    );
    await expect(voxelize({ sources: [source], target, budget: 1.5 })).rejects.toThrow(RangeError);
  });

  it('colors each cell from the three vertices of the triangle that claimed it', async () => {
    // The soup's own index buffer names vertex 2 first, and the per-vertex colors differ, so a
    // triangle-index lookup would read vertex 0 (red) where the triangle's own vertex is 2 (blue).
    const soup: TriangleSoup = {
      positions: Float32Array.of(0.05, 0.05, 0.05, 1.05, 0.05, 0.05, 0.05, 1.05, 0.05),
      index: Uint32Array.of(2, 1, 0),
    };
    const color = { baseColor: 0xffffff, vertexColors: Float32Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1), vertexColorSize: 3 };
    const output = onlyOutput(
      await okResult(
        voxelize({
          sources: [{ sourceId: 'node-tri', name: 'Tri', parts: [{ soup, color }] }],
          target: { kind: 'uniform', voxelSize: 0.5 },
          budget: DEFAULT_CELL_BUDGET,
        }),
      ),
    );
    if (output.payload.kind !== 'uniform') throw new Error('expected a uniform payload');
    const grid = output.payload.grid;

    let cells = 0;
    grid.forEach((_x, _y, _z, cellColor) => {
      expect(cellColor).toBe(0x0000ff);
      cells += 1;
    });
    expect(cells).toBeGreaterThan(0);
    expect(cells).toBe(grid.size);
  });

  it('keeps every cell of a masked sample, colouring it with the visible average', async () => {
    // One triangle whose UV centroid sits on the transparent blue texel of an alpha-masked texture. The
    // cutoff chooses a colour and nothing else: the cells, and their count, are the voxelizer's business
    // and must be identical with and without it.
    const soup: TriangleSoup = {
      positions: Float32Array.of(0.05, 0.05, 0.05, 1.05, 0.05, 0.05, 0.05, 1.05, 0.05),
      index: Uint32Array.of(0, 1, 2),
    };
    const texture = maskedTexture();
    const uv = flatUv(0.25, 0.75);
    const target = { kind: 'uniform', voxelSize: 0.5 } as const;

    const masked = onlyOutput(
      await okResult(
        voxelize({
          sources: [
            {
              sourceId: 'node-leaf',
              name: 'Leaf',
              parts: [{ soup, color: { baseColor: 0xffffff, texture, uv, alphaTest: 0.5 } }],
            },
          ],
          target,
          budget: DEFAULT_CELL_BUDGET,
        }),
      ),
    );
    const unmasked = onlyOutput(
      await okResult(
        voxelize({
          sources: [{ sourceId: 'node-leaf', name: 'Leaf', parts: [{ soup, color: { baseColor: 0xffffff, texture, uv } }] }],
          target,
          budget: DEFAULT_CELL_BUDGET,
        }),
      ),
    );

    if (masked.payload.kind !== 'uniform') throw new Error('expected a uniform payload');
    if (unmasked.payload.kind !== 'uniform') throw new Error('expected a uniform payload');
    const maskedCells = masked.payload.grid;
    const unmaskedCells = unmasked.payload.grid;

    expect(maskedCells.size).toBeGreaterThan(0);
    expect(maskedCells.size).toBe(unmaskedCells.size);

    const average = new Color().setRGB(0.5, 0.5, 0, SRGBColorSpace).getHex();
    let colored = 0;
    maskedCells.forEach((_x, _y, _z, color) => {
      expect(color).toBe(average);
      colored += 1;
    });
    expect(colored).toBe(maskedCells.size);

    unmaskedCells.forEach((_x, _y, _z, color) => {
      // Without a cutoff the transparent texel drops the texture term, so the white factor is the colour.
      expect(color).toBe(0xffffff);
    });
  });
});

