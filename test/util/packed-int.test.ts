import { describe, expect, it } from "vitest";

import {
  MAX_COORDINATE,
  MIN_COORDINATE,
  boundsCheck,
  compare,
  neighbor,
  pack,
  unpack,
  type VoxelKey,
} from "../../src/util/packed-int";

function packSuccess(x: number, y: number, z: number): VoxelKey {
  const result = pack(x, y, z);

  if (!result.ok) {
    throw new Error(`Expected pack to succeed: ${JSON.stringify(result.error)}`);
  }

  return result.value;
}

describe("packed-int", () => {
  it("supports signed 16-bit coordinate boundaries", () => {
    expect(pack(MIN_COORDINATE, MIN_COORDINATE, MIN_COORDINATE)).toEqual({
      ok: true,
      value: 0,
    });
    expect(pack(MAX_COORDINATE, MAX_COORDINATE, MAX_COORDINATE)).toEqual({
      ok: true,
      value: 281474976710655,
    });
    expect(
      unpack(packSuccess(MIN_COORDINATE, 0, MAX_COORDINATE)),
    ).toEqual([MIN_COORDINATE, 0, MAX_COORDINATE]);
  });

  it("encodes negative coordinates with a bias offset", () => {
    const xBits = 65536 * 65536;

    expect(packSuccess(MIN_COORDINATE, MIN_COORDINATE, MIN_COORDINATE)).toBe(0);
    expect(packSuccess(-1, MIN_COORDINATE, MIN_COORDINATE)).toBe(32767 * xBits);
    expect(packSuccess(0, MIN_COORDINATE, MIN_COORDINATE)).toBe(32768 * xBits);
    expect(packSuccess(1, MIN_COORDINATE, MIN_COORDINATE)).toBe(32769 * xBits);
    expect(packSuccess(MAX_COORDINATE, MIN_COORDINATE, MIN_COORDINATE)).toBe(
      65535 * xBits,
    );
    expect(packSuccess(-1, 0, 0)).toBeLessThan(packSuccess(0, 0, 0));
    expect(packSuccess(0, 0, 0)).toBeLessThan(packSuccess(1, 0, 0));
  });

  it("packs all 48 bits exactly without truncation", () => {
    const key = packSuccess(MAX_COORDINATE, MAX_COORDINATE, MAX_COORDINATE);

    expect(key).toBe(2 ** 48 - 1);
    expect(Number.isSafeInteger(key)).toBe(true);
    expect(packSuccess(-1, 0, 0)).toBeGreaterThan(2 ** 32);
    expect(packSuccess(-1, 0, 0)).toBe(((32767 * 65536) + 32768) * 65536 + 32768);
  });

  it("round-trips representative and boundary coordinates", () => {
    const coordinates = [
      [MIN_COORDINATE, MIN_COORDINATE, MIN_COORDINATE],
      [MIN_COORDINATE, -1, 1],
      [-1, MAX_COORDINATE, MIN_COORDINATE],
      [0, 0, 0],
      [1, -1, 1],
      [MAX_COORDINATE, MAX_COORDINATE, MAX_COORDINATE],
    ] as const;

    for (const [x, y, z] of coordinates) {
      expect(unpack(packSuccess(x, y, z))).toEqual([x, y, z]);
    }
  });

  it("compares packed keys in x, y, z lexicographic order", () => {
    expect(
      compare(
        packSuccess(-1, MAX_COORDINATE, MAX_COORDINATE),
        packSuccess(0, MIN_COORDINATE, MIN_COORDINATE),
      ),
    ).toBe(-1);
    expect(
      compare(
        packSuccess(0, -1, MAX_COORDINATE),
        packSuccess(0, 0, MIN_COORDINATE),
      ),
    ).toBe(-1);
    expect(
      compare(
        packSuccess(0, 0, -1),
        packSuccess(0, 0, 0),
      ),
    ).toBe(-1);
    expect(
      compare(
        packSuccess(1, 0, 0),
        packSuccess(0, MAX_COORDINATE, MAX_COORDINATE),
      ),
    ).toBe(1);
    expect(
      compare(
        packSuccess(1, 2, 3),
        packSuccess(1, 2, 3),
      ),
    ).toBe(0);
  });

  it("rejects invalid coordinate inputs", () => {
    expect(pack(Number.NaN, 0, 0)).toEqual({
      ok: false,
      error: {
        code: "invalid_coordinate",
        axis: "x",
        value: Number.NaN,
      },
    });
    expect(pack(0, Number.POSITIVE_INFINITY, 0)).toEqual({
      ok: false,
      error: {
        code: "invalid_coordinate",
        axis: "y",
        value: Number.POSITIVE_INFINITY,
      },
    });
    expect(pack(0, 0, 1.5)).toEqual({
      ok: false,
      error: {
        code: "invalid_coordinate",
        axis: "z",
        value: 1.5,
      },
    });
    expect(pack(Number.MAX_SAFE_INTEGER + 1, 0, 0)).toEqual({
      ok: false,
      error: {
        code: "invalid_coordinate",
        axis: "x",
        value: Number.MAX_SAFE_INTEGER + 1,
      },
    });
  });

  it("rejects out-of-range coordinates with details", () => {
    expect(pack(MIN_COORDINATE - 1, 0, 0)).toEqual({
      ok: false,
      error: {
        code: "coordinate_out_of_range",
        axis: "x",
        value: MIN_COORDINATE - 1,
        min: MIN_COORDINATE,
        max: MAX_COORDINATE,
      },
    });
    expect(pack(0, MAX_COORDINATE + 1, 0)).toEqual({
      ok: false,
      error: {
        code: "coordinate_out_of_range",
        axis: "y",
        value: MAX_COORDINATE + 1,
        min: MIN_COORDINATE,
        max: MAX_COORDINATE,
      },
    });
  });

  it("checks bounds without clamping or throwing", () => {
    expect(boundsCheck(MIN_COORDINATE, 0, MAX_COORDINATE)).toBe(true);
    expect(boundsCheck(MIN_COORDINATE - 1, 0, 0)).toBe(false);
    expect(boundsCheck(0, MAX_COORDINATE + 1, 0)).toBe(false);
    expect(boundsCheck(0, 0, 1.5)).toBe(false);
    expect(boundsCheck(Number.NaN, 0, 0)).toBe(false);
    expect(boundsCheck(0, Number.POSITIVE_INFINITY, 0)).toBe(false);
    expect(boundsCheck(Number.MAX_SAFE_INTEGER + 1, 0, 0)).toBe(false);
  });

  it("moves a key by a delta on each axis", () => {
    expect(neighbor(packSuccess(0, 0, 0), "x", 1)).toEqual({
      ok: true,
      value: packSuccess(1, 0, 0),
    });
    expect(neighbor(packSuccess(0, 0, 0), "y", -1)).toEqual({
      ok: true,
      value: packSuccess(0, -1, 0),
    });
    expect(neighbor(packSuccess(0, 0, 0), "z", 2)).toEqual({
      ok: true,
      value: packSuccess(0, 0, 2),
    });
    expect(neighbor(packSuccess(1, 2, 3), "x", 0)).toEqual({
      ok: true,
      value: packSuccess(1, 2, 3),
    });
  });

  it("rejects invalid neighbor deltas", () => {
    const key = packSuccess(0, 0, 0);

    expect(neighbor(key, "x", Number.NaN)).toEqual({
      ok: false,
      error: {
        code: "invalid_delta",
        value: Number.NaN,
      },
    });
    expect(neighbor(key, "x", Number.POSITIVE_INFINITY)).toEqual({
      ok: false,
      error: {
        code: "invalid_delta",
        value: Number.POSITIVE_INFINITY,
      },
    });
    expect(neighbor(key, "x", 1.5)).toEqual({
      ok: false,
      error: {
        code: "invalid_delta",
        value: 1.5,
      },
    });
    expect(neighbor(key, "x", Number.MAX_SAFE_INTEGER + 1)).toEqual({
      ok: false,
      error: {
        code: "invalid_delta",
        value: Number.MAX_SAFE_INTEGER + 1,
      },
    });
  });

  it("does not wrap around when a neighbor crosses a coordinate boundary", () => {
    expect(neighbor(packSuccess(MIN_COORDINATE, 0, 0), "x", -1)).toEqual({
      ok: false,
      error: {
        code: "coordinate_out_of_range",
        axis: "x",
        value: MIN_COORDINATE - 1,
        min: MIN_COORDINATE,
        max: MAX_COORDINATE,
      },
    });
    expect(neighbor(packSuccess(0, MAX_COORDINATE, 0), "y", 1)).toEqual({
      ok: false,
      error: {
        code: "coordinate_out_of_range",
        axis: "y",
        value: MAX_COORDINATE + 1,
        min: MIN_COORDINATE,
        max: MAX_COORDINATE,
      },
    });
    expect(neighbor(packSuccess(0, 0, MIN_COORDINATE), "z", -1)).toEqual({
      ok: false,
      error: {
        code: "coordinate_out_of_range",
        axis: "z",
        value: MIN_COORDINATE - 1,
        min: MIN_COORDINATE,
        max: MAX_COORDINATE,
      },
    });
    expect(neighbor(packSuccess(0, 0, MAX_COORDINATE), "z", 1)).toEqual({
      ok: false,
      error: {
        code: "coordinate_out_of_range",
        axis: "z",
        value: MAX_COORDINATE + 1,
        min: MIN_COORDINATE,
        max: MAX_COORDINATE,
      },
    });
  });
});
