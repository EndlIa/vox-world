import { describe, expect, expectTypeOf, it } from "vitest";

import {
  equals,
  linearize,
  parseHex,
  srgbToLinear,
  toHex,
  type ColorChannelError,
  type ColorHex,
  type ColorScalarError,
  type LinearRgb,
  type Rgb,
} from "../../src/util/color";
import type { Result } from "../../src/util/result";

function expectOk<T, E>(result: Result<T, E>): T {
  expect(result.ok).toBe(true);

  if (!result.ok) {
    throw new Error(`Expected a successful result, got ${JSON.stringify(result.error)}`);
  }

  return result.value;
}

function color(input: string): ColorHex {
  return expectOk(parseHex(input));
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

describe("toHex", () => {
  it.each([
    [{ r: 0, g: 0, b: 0 }, "#000000"],
    [{ r: 255, g: 255, b: 255 }, "#FFFFFF"],
    [{ r: 10, g: 171, b: 255 }, "#0AABFF"],
    [{ r: 1, g: 2, b: 3 }, "#010203"],
  ])("encodes %j as %s", (rgb, expected) => {
    expect(toHex(rgb)).toEqual({ ok: true, value: expected });
  });

  it.each<
    {
      channel: ColorChannelError["channel"];
      rgb: Rgb;
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
      expect(toHex(rgb)).toEqual({
        ok: false,
        error: {
          code: "invalid_rgb_channel",
          channel,
          value,
        },
      });
    },
  );

  it("does not mutate or clamp the input channels", () => {
    const rgb: Rgb = { r: 18, g: 52, b: 86 };
    const before = { ...rgb };

    expect(toHex(rgb)).toEqual({ ok: true, value: "#123456" });
    expect(rgb).toEqual(before);
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
      const error: ColorScalarError = result.error;

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
});

describe("equals", () => {
  it("compares normalized colors exactly", () => {
    expect(equals(color("#ffaa00"), color("FFAA00"))).toBe(true);
    expect(equals(color("#FFAA00"), color("#FFAA01"))).toBe(false);
    expect(equals(color("#000000"), color("#FFFFFF"))).toBe(false);
  });
});

describe("immutability", () => {
  it("exposes readonly channel types without runtime freezing", () => {
    expectTypeOf<Rgb>().toEqualTypeOf<
      Readonly<{ r: number; g: number; b: number }>
    >();
    expectTypeOf<LinearRgb>().toEqualTypeOf<
      Readonly<{ r: number; g: number; b: number }>
    >();

    const linearized = linearize(color("#123456"));

    expect(Object.isFrozen(linearized)).toBe(false);
    expect(linearize(color("#123456"))).not.toBe(linearized);
  });
});
