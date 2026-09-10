import { describe, expect, expectTypeOf, it } from "vitest";
import { Color, LinearSRGBColorSpace, SRGBColorSpace } from "three";

import {
  equals,
  linearize,
  parseHex,
  parseRgb,
  srgbToLinear,
  toHex,
  type ColorChannelError,
  type ColorHex,
  type LinearRgb,
  type Rgb,
} from "../../src/util/color";
import type { Result } from "../../src/util/result";

function expectOk<T, E>(result: Result<T, E>): T {
  if (!result.ok) {
    throw new Error(`Expected a successful result, got ${JSON.stringify(result.error)}`);
  }

  return result.value;
}

function color(input: string): ColorHex {
  return expectOk(parseHex(input));
}

function rgbOf(input: Readonly<{ r: number; g: number; b: number }>): Rgb {
  return expectOk(parseRgb(input));
}

describe("parseHex", () => {
  it.each([
    ["#ffaa00", "#FFAA00"],
    ["ffaa00", "#FFAA00"],
    ["#0a1B2c", "#0A1B2C"],
    ["abcdef", "#ABCDEF"],
    ["000000", "#000000"],
    ["FFFFFF", "#FFFFFF"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(parseHex(input)).toEqual({ ok: true, value: expected });
  });

  it.each([
    "",
    "#",
    "#f0a",
    "#F0A",
    "#f0a0",
    "f0a0",
    "ffaa0",
    "ffaa000",
    "ffaa0000",
    "#ffaa0080",
    "#ffaa00ff",
    " ffaa00",
    "ffaa00 ",
    "#ffaa0g",
    "##ffaa00",
    "0xFFAA00",
    "ffaa00\n",
  ])("rejects invalid input %j and preserves it", (input) => {
    expect(parseHex(input)).toEqual({
      ok: false,
      error: {
        code: "invalid_hex",
        input,
      },
    });
  });
});

describe("parseRgb", () => {
  it.each([
    { r: 0, g: 0, b: 0 },
    { r: 255, g: 255, b: 255 },
    { r: 10, g: 171, b: 255 },
    { r: 1, g: 2, b: 3 },
  ])("accepts the valid channel triple %j as a plain object", (input) => {
    expect(parseRgb(input)).toEqual({ ok: true, value: input });
  });

  it.each<
    {
      channel: ColorChannelError["channel"];
      rgb: Readonly<{ r: number; g: number; b: number }>;
      value: number;
    }
  >([
    { channel: "r", rgb: { r: -1, g: 0, b: 0 }, value: -1 },
    { channel: "g", rgb: { r: 0, g: 1.5, b: 0 }, value: 1.5 },
    { channel: "b", rgb: { r: 0, g: 0, b: 256 }, value: 256 },
    {
      channel: "r",
      rgb: { r: Number.NaN, g: 0, b: 0 },
      value: Number.NaN,
    },
    {
      channel: "g",
      rgb: { r: 0, g: Number.POSITIVE_INFINITY, b: 0 },
      value: Number.POSITIVE_INFINITY,
    },
    {
      channel: "b",
      rgb: { r: 0, g: 0, b: Number.NEGATIVE_INFINITY },
      value: Number.NEGATIVE_INFINITY,
    },
  ])(
    "rejects invalid $channel channel value $value",
    ({ channel, rgb, value }) => {
      expect(parseRgb(rgb)).toEqual({
        ok: false,
        error: {
          code: "invalid_rgb_channel",
          channel,
          value,
        },
      });
    },
  );

  it("does not mutate the input channels", () => {
    const input = { r: 18, g: 52, b: 86 };
    const before = { ...input };

    expect(toHex(rgbOf(input))).toBe("#123456");
    expect(input).toEqual(before);
  });

  it("returns a fresh object instead of re-branding the caller's object", () => {
    const input = { r: 18, g: 52, b: 86 };
    const rgb = expectOk(parseRgb(input));

    expect(rgb).not.toBe(input);

    // The brand promises validated channels; aliasing the caller's mutable object
    // would let it invalidate that promise after validation.
    input.r = 999;

    expect(rgb.r).toBe(18);
  });
});

describe("toHex", () => {
  it.each([
    [{ r: 0, g: 0, b: 0 }, "#000000"],
    [{ r: 255, g: 255, b: 255 }, "#FFFFFF"],
    [{ r: 10, g: 171, b: 255 }, "#0AABFF"],
    [{ r: 1, g: 2, b: 3 }, "#010203"],
  ])("encodes %j as %s", (input, expected) => {
    expect(toHex(rgbOf(input))).toBe(expected);
  });
});

describe("srgbToLinear", () => {
  it("uses the standard sRGB EOTF below the threshold", () => {
    const channel = 0.04045;

    expect(expectOk(srgbToLinear(channel))).toBe(channel / 12.92);
    expect(expectOk(srgbToLinear(0))).toBe(0);
  });

  it("uses the standard sRGB EOTF above the threshold", () => {
    expect(expectOk(srgbToLinear(0.04046))).toBeCloseTo(
      Math.pow((0.04046 + 0.055) / 1.055, 2.4),
      15,
    );
    expect(expectOk(srgbToLinear(0.5))).toBeCloseTo(0.21404114048223255, 15);
    expect(expectOk(srgbToLinear(1))).toBe(1);
  });

  it.each([
    -0.001,
    1.001,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])("rejects invalid scalar %s and preserves it", (value) => {
    const result = srgbToLinear(value);

    expect(result.ok).toBe(false);

    if (!result.ok) {
      const error = result.error;

      expect(error.code).toBe("invalid_srgb_channel");

      if (Number.isNaN(value)) {
        expect(Number.isNaN(error.value)).toBe(true);
      } else {
        expect(error.value).toBe(value);
      }
    }
  });
});

describe("linearize", () => {
  it("decodes and linearizes all channels", () => {
    expect(linearize(color("#FF0000"))).toEqual({ r: 1, g: 0, b: 0 });
    expect(linearize(color("#00FF00"))).toEqual({ r: 0, g: 1, b: 0 });
    expect(linearize(color("#0000FF"))).toEqual({ r: 0, g: 0, b: 1 });
    expect(linearize(color("#000000"))).toEqual({ r: 0, g: 0, b: 0 });
    expect(linearize(color("#FFFFFF"))).toEqual({ r: 1, g: 1, b: 1 });
  });

  it("uses the sRGB formula for each 8-bit channel", () => {
    const linearized = linearize(color("#336699"));
    const expectedR = Math.pow((51 / 255 + 0.055) / 1.055, 2.4);
    const expectedG = Math.pow((102 / 255 + 0.055) / 1.055, 2.4);
    const expectedB = Math.pow((153 / 255 + 0.055) / 1.055, 2.4);

    expect(linearized.r).toBeCloseTo(expectedR, 15);
    expect(linearized.g).toBeCloseTo(expectedG, 15);
    expect(linearized.b).toBeCloseTo(expectedB, 15);
  });

  it("returns a fresh plain object per call", () => {
    const linearized = linearize(color("#123456"));

    expect(linearize(color("#123456"))).not.toBe(linearized);
    expect(linearized).toEqual({ r: linearized.r, g: linearized.g, b: linearized.b });
  });
});

describe("equals", () => {
  it("compares normalized colors exactly", () => {
    expect(equals(color("#ffaa00"), color("FFAA00"))).toBe(true);
    expect(equals(color("#FFAA00"), color("#FFAA01"))).toBe(false);
    expect(equals(color("#000000"), color("#FFFFFF"))).toBe(false);
  });
});

describe("color type contract", () => {
  it("keeps ColorHex, Rgb and LinearRgb brand-gated and mutually exclusive", () => {
    expectTypeOf<string>().not.toExtend<ColorHex>();
    expectTypeOf<Readonly<{ r: number; g: number; b: number }>>().not.toExtend<Rgb>();
    expectTypeOf<Rgb>().not.toExtend<LinearRgb>();
    expectTypeOf<LinearRgb>().not.toExtend<Rgb>();
    expectTypeOf(expectOk(parseRgb({ r: 1, g: 2, b: 3 }))).toEqualTypeOf<Rgb>();
    expectTypeOf(linearize(color("#010203"))).toEqualTypeOf<LinearRgb>();
    expectTypeOf(toHex(rgbOf({ r: 1, g: 2, b: 3 }))).toEqualTypeOf<ColorHex>();
  });
});

describe("Three.js alignment", () => {
  // Measured maximum absolute deviation from three's transfer function over the 8-bit
  // grid: 1.0815e-11 at channel value 143. codemap/src/util/color.md pins the bound at
  // 1.1e-11; a looser tolerance would hide a wrong formula.
  const THREE_TRANSFER_TOLERANCE = 1.1e-11;

  // `color.ts` deliberately stays stricter than three's CSS parser. three's `setStyle`
  // also accepts `#RGB`, color names, `rgb()`/`hsl()` and percentages, and merely warns
  // (keeping the previous color) on 4- or 8-digit hex; `parseHex` accepts exactly
  // `#RRGGBB` (see the parseHex table).

  it("encodes every 8-bit grey level to the same hex string as three", () => {
    for (let value = 0; value <= 255; value += 1) {
      const theirs = new Color()
        .setRGB(value / 255, value / 255, value / 255, SRGBColorSpace)
        .getHexString(SRGBColorSpace);

      expect(toHex(rgbOf({ r: value, g: value, b: value }))).toBe(
        `#${theirs.toUpperCase()}`,
      );
    }
  });

  it("encodes mixed channels to the same hex string as three", () => {
    const cases = [
      [10, 171, 255],
      [1, 2, 3],
      [51, 102, 153],
      [255, 0, 128],
    ] as const;

    for (const [r, g, b] of cases) {
      const theirs = new Color()
        .setRGB(r / 255, g / 255, b / 255, SRGBColorSpace)
        .getHexString(SRGBColorSpace);

      expect(toHex(rgbOf({ r, g, b }))).toBe(`#${theirs.toUpperCase()}`);
    }
  });

  it("matches three's sRGB transfer across all 256 channel values", () => {
    let maxDelta = 0;

    for (let value = 0; value <= 255; value += 1) {
      const channel = value / 255;
      const ours = expectOk(srgbToLinear(channel));
      const theirs = new Color().setRGB(channel, 0, 0, SRGBColorSpace).r;

      maxDelta = Math.max(maxDelta, Math.abs(ours - theirs));
    }

    // three evaluates the EOTF as `c * 0.9478672986 + 0.0521327014`, we evaluate
    // `(c + 0.055) / 1.055`. They are the same transfer function; the residue is
    // float rounding in the coefficient form.
    expect(maxDelta).toBeLessThan(THREE_TRANSFER_TOLERANCE);
  });

  it("switches between the sRGB branches at the documented threshold", () => {
    const threshold = 0.04045;
    const ours = expectOk(srgbToLinear(threshold));
    const theirs = new Color().setRGB(threshold, 0, 0, SRGBColorSpace).r;

    // The contract pins `c <= 0.04045` to the linear branch while three uses
    // `c < 0.04045`, so the two take different branches at the knee; away from the knee
    // they agree to within 1.1e-11 (measured over the 8-bit grid).
    expect(ours).toBe(threshold / 12.92);
    // three takes the power branch at the knee (its test is `c < 0.04045`) with rounded
    // coefficients and lands 2.3278e-9 from the exact EOTF value; the contract declares
    // that deviation as ~2.33e-9, so the assertion brackets it instead of hiding it.
    const kneeDelta = Math.abs(theirs - ours);

    expect(kneeDelta).toBeGreaterThan(2e-9);
    expect(kneeDelta).toBeLessThan(2.6e-9);
  });

  it("linearizes a hex color exactly the way three reads it", () => {
    for (const hex of [
      "#000000",
      "#FFFFFF",
      "#336699",
      "#0AABFF",
      "#123456",
      "#8F8F8F",
      "#040404",
      "#0B0B0B",
    ] as const) {
      const ours = linearize(color(hex));
      const theirs = new Color()
        .setStyle(hex, SRGBColorSpace)
        .getRGB({ r: 0, g: 0, b: 0 }, LinearSRGBColorSpace);

      expect(Math.abs(ours.r - theirs.r)).toBeLessThan(THREE_TRANSFER_TOLERANCE);
      expect(Math.abs(ours.g - theirs.g)).toBeLessThan(THREE_TRANSFER_TOLERANCE);
      expect(Math.abs(ours.b - theirs.b)).toBeLessThan(THREE_TRANSFER_TOLERANCE);
    }
  });

  it("agrees with three on the linear value of every 8-bit grey level", () => {
    let maxDelta = 0;

    for (let value = 0; value <= 255; value += 1) {
      const hex = toHex(rgbOf({ r: value, g: value, b: value }));
      const ours = linearize(hex);
      const theirs = new Color()
        .setStyle(hex, SRGBColorSpace)
        .getRGB({ r: 0, g: 0, b: 0 }, LinearSRGBColorSpace);

      maxDelta = Math.max(
        maxDelta,
        Math.abs(ours.r - theirs.r),
        Math.abs(ours.g - theirs.g),
        Math.abs(ours.b - theirs.b),
      );
    }

    expect(maxDelta).toBeLessThan(THREE_TRANSFER_TOLERANCE);
  });
});
