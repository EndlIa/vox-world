import { err, ok, type Result } from "./result";

export type ColorHex = string & {
  readonly __brand: "ColorHex";
};

export type Rgb = Readonly<{
  r: number;
  g: number;
  b: number;
}>;

export type LinearRgb = Readonly<{
  r: number;
  g: number;
  b: number;
}>;

export type ColorParseError = Readonly<{
  code: "invalid_hex";
  input: string;
}>;

export type ColorChannelError = Readonly<{
  code: "invalid_rgb_channel";
  channel: "r" | "g" | "b";
  value: number;
}>;

export type ColorScalarError = Readonly<{
  code: "invalid_srgb_channel";
  value: number;
}>;

export type ColorError =
  | ColorParseError
  | ColorChannelError
  | ColorScalarError;

const HEX_PATTERN = /^#?[0-9a-fA-F]{6}$/;

function invalidChannel(
  channel: "r" | "g" | "b",
  value: number,
): Result<never, ColorChannelError> {
  return err({
    code: "invalid_rgb_channel",
    channel,
    value,
  });
}

function isValidChannel(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 255;
}

function channelToHex(value: number): string {
  return value.toString(16).padStart(2, "0").toUpperCase();
}

function srgbChannelToLinear(channel: number): number {
  if (channel <= 0.04045) {
    return channel / 12.92;
  }

  return Math.pow((channel + 0.055) / 1.055, 2.4);
}

export function parseHex(
  input: string,
): Result<ColorHex, ColorParseError> {
  if (!HEX_PATTERN.test(input)) {
    return err({
      code: "invalid_hex",
      input,
    });
  }

  const digits = input.startsWith("#") ? input.slice(1) : input;

  return ok(`#${digits.toUpperCase()}` as ColorHex);
}

export function toHex(
  rgb: Rgb,
): Result<ColorHex, ColorChannelError> {
  if (!isValidChannel(rgb.r)) {
    return invalidChannel("r", rgb.r);
  }

  if (!isValidChannel(rgb.g)) {
    return invalidChannel("g", rgb.g);
  }

  if (!isValidChannel(rgb.b)) {
    return invalidChannel("b", rgb.b);
  }

  return ok(
    `#${channelToHex(rgb.r)}${channelToHex(rgb.g)}${channelToHex(rgb.b)}` as ColorHex,
  );
}

export function srgbToLinear(
  channel: number,
): Result<number, ColorScalarError> {
  if (!Number.isFinite(channel) || channel < 0 || channel > 1) {
    return err({
      code: "invalid_srgb_channel",
      value: channel,
    });
  }

  return ok(srgbChannelToLinear(channel));
}

export function linearize(color: ColorHex): LinearRgb {
  const r = Number.parseInt(color.slice(1, 3), 16) / 255;
  const g = Number.parseInt(color.slice(3, 5), 16) / 255;
  const b = Number.parseInt(color.slice(5, 7), 16) / 255;

  return {
    r: srgbChannelToLinear(r),
    g: srgbChannelToLinear(g),
    b: srgbChannelToLinear(b),
  };
}

export function equals(a: ColorHex, b: ColorHex): boolean {
  return a === b;
}
