import { describe, expect, expectTypeOf, it } from "vitest";

import {
  EMPTY_BOUNDS3I,
  PALETTE_LIMIT,
  bounds3i,
  gridPosition,
  gridPositionFromKey,
  uniformVoxSnapshot,
  type Bounds3i,
  type Bounds3iError,
  type ColorHex,
  type GridPosition,
  type GridPositionError,
  type UniformVoxParts,
  type UniformVoxSnapshot,
  type UniformVoxSnapshotError,
  type VoxelScope,
  type VoxelSnapshot,
} from "../../../../src/domain/voxel/uniform/types";
import { parseHex } from "../../../../src/util/color";
import type { Aabb, Vec3 } from "../../../../src/util/math";
import {
  MAX_COORDINATE,
  MIN_COORDINATE,
  pack,
  unpack,
  type VoxelKey,
} from "../../../../src/util/packed-int";
import { expectOk } from "../../../support/expect-result";

type Entry = readonly [x: number, y: number, z: number, hex: string];

function color(input: string): ColorHex {
  return expectOk(parseHex(input));
}

function position(x: number, y: number, z: number): GridPosition {
  return expectOk(gridPosition(x, y, z));
}

function packSuccess(x: number, y: number, z: number): VoxelKey {
  return expectOk(pack(x, y, z));
}

function hexColor(index: number): string {
  return `#${index.toString(16).padStart(6, "0").toUpperCase()}`;
}

function parts(entries: readonly Entry[]): UniformVoxParts {
  const x: number[] = [];
  const y: number[] = [];
  const z: number[] = [];
  const colorIndex: number[] = [];
  const palette: ColorHex[] = [];

  for (const [px, py, pz, hex] of entries) {
    const parsed = color(hex);
    let index = palette.indexOf(parsed);

    if (index === -1) {
      index = palette.length;
      palette.push(parsed);
    }

    x.push(px);
    y.push(py);
    z.push(pz);
    colorIndex.push(index);
  }

  return { x, y, z, colorIndex, palette };
}

function voxelsOf(entries: readonly Entry[]): UniformVoxSnapshot {
  return expectOk(uniformVoxSnapshot(parts(entries)));
}

function colorsOf(snapshot: UniformVoxSnapshot): Array<ColorHex | undefined> {
  return Array.from(snapshot.colorIndex, (index) => snapshot.palette[index]);
}

function expectSameContainer(
  actual: UniformVoxSnapshot,
  expected: UniformVoxSnapshot,
): void {
  expect(actual.count).toBe(expected.count);
  expect(actual.palette).toEqual(expected.palette);
  expect(Array.from(actual.x)).toEqual(Array.from(expected.x));
  expect(Array.from(actual.y)).toEqual(Array.from(expected.y));
  expect(Array.from(actual.z)).toEqual(Array.from(expected.z));
  expect(Array.from(actual.colorIndex)).toEqual(
    Array.from(expected.colorIndex),
  );
}

const singleVoxel: UniformVoxParts = parts([[0, 0, 0, "#ff0000"]]);
const twoRedVoxels: UniformVoxParts = parts([
  [0, 0, 0, "#ff0000"],
  [1, 0, 0, "#ff0000"],
]);

describe("voxel type contract", () => {
  it("keeps grid positions and bounds distinct from math values", () => {
    expectTypeOf<Vec3>().not.toExtend<GridPosition>();
    expectTypeOf<Aabb>().not.toExtend<Bounds3i>();
    expectTypeOf<GridPosition>().toExtend<Vec3>();
    expectTypeOf<Bounds3i>().toExtend<Aabb>();
  });

  it("keeps grid positions and bounds readonly", () => {
    expectTypeOf<GridPosition>().toEqualTypeOf<
      Readonly<{ x: number; y: number; z: number }> & {
        readonly __brand: "GridPosition";
      }
    >();
    expectTypeOf<{
      x: number;
      y: number;
      z: number;
      __brand: "GridPosition";
    }>().not.toEqualTypeOf<GridPosition>();
    expectTypeOf<Bounds3i>().toEqualTypeOf<
      | Readonly<{ isEmpty: true }>
      | Readonly<{ isEmpty: false; min: GridPosition; max: GridPosition }>
    >();
    expectTypeOf<
      | { isEmpty: true }
      | { isEmpty: false; min: GridPosition; max: GridPosition }
    >().not.toEqualTypeOf<Bounds3i>();
  });

  it("pins the container and scope shapes", () => {
    expectTypeOf<UniformVoxSnapshot>().toEqualTypeOf<
      Readonly<{
        count: number;
        x: Int16Array;
        y: Int16Array;
        z: Int16Array;
        colorIndex: Uint8Array;
        palette: readonly ColorHex[];
      }>
    >();
    expectTypeOf<VoxelScope>().toEqualTypeOf<
      | Readonly<{ kind: "keys"; keys: readonly VoxelKey[] }>
      | Readonly<{ kind: "color"; color: ColorHex }>
      | Readonly<{ kind: "bounds"; bounds: Bounds3i }>
      | Readonly<{ kind: "all" }>
    >();
  });

  it("pins the record, input, error, and limit contracts", () => {
    expectTypeOf<VoxelSnapshot>().toEqualTypeOf<
      Readonly<{ position: GridPosition; color: ColorHex }>
    >();
    expectTypeOf<UniformVoxParts>().toEqualTypeOf<
      Readonly<{
        x: ArrayLike<number>;
        y: ArrayLike<number>;
        z: ArrayLike<number>;
        colorIndex: ArrayLike<number>;
        palette: readonly ColorHex[];
      }>
    >();
    // The constructor's declared input: a container can be re-canonicalized.
    expectTypeOf<UniformVoxSnapshot>().toExtend<UniformVoxParts>();
    expectTypeOf<GridPositionError>().toEqualTypeOf<
      Readonly<{ code: "invalid-coordinate"; axis: "x" | "y" | "z" }>
    >();
    expectTypeOf<Bounds3iError>().toEqualTypeOf<
      Readonly<{ code: "invalid-bounds"; axis: "x" | "y" | "z" }>
    >();
    expectTypeOf<UniformVoxSnapshotError>().toEqualTypeOf<
      | GridPositionError
      | Readonly<{
          code: "invalid-column-length";
          column: "y" | "z" | "colorIndex";
        }>
      | Readonly<{ code: "invalid-color-index"; index: number }>
      | Readonly<{ code: "palette-limit-exceeded"; limit: number }>
    >();
    // `colorIndex` is a Uint8Array, so the limit cannot grow past 256.
    expect(PALETTE_LIMIT).toBe(256);
  });
});

describe("gridPosition", () => {
  it("accepts the 16-bit boundaries", () => {
    expect(gridPosition(MIN_COORDINATE, MAX_COORDINATE, 0)).toEqual({
      ok: true,
      value: { x: MIN_COORDINATE, y: MAX_COORDINATE, z: 0 },
    });
  });

  it.each([
    [1.5, 0, 0, "x"],
    [0, -0.5, 0, "y"],
    [0, 0, Number.NaN, "z"],
    [MAX_COORDINATE + 1, 0, 0, "x"],
    [0, MIN_COORDINATE - 1, 0, "y"],
    [0, 0, Number.POSITIVE_INFINITY, "z"],
  ] as const)(
    "rejects (%s, %s, %s) on axis %s",
    (x, y, z, axis) => {
      expect(gridPosition(x, y, z)).toEqual({
        ok: false,
        error: { code: "invalid-coordinate", axis },
      });
    },
  );

  it("leaves the reported axis of several invalid axes undefined", () => {
    const result = gridPosition(1.5, 2.5, 3.5);

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("invalid-coordinate");
      // `axis` is only guaranteed to name an invalid axis.
      expect(["x", "y", "z"]).toContain(result.error.axis);
    }
  });

  it("keeps errors serializable", () => {
    const result = gridPosition(Number.NaN, Number.POSITIVE_INFINITY, 0.5);

    expect(result.ok).toBe(false);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});

describe("gridPositionFromKey", () => {
  it("matches gridPosition component by component", () => {
    const coordinates = [
      [0, 0, 0],
      [MIN_COORDINATE, MAX_COORDINATE, -1],
      [7, -9, 42],
      [MAX_COORDINATE, MIN_COORDINATE, MAX_COORDINATE],
    ] as const;

    for (const [x, y, z] of coordinates) {
      const fromKey = gridPositionFromKey(packSuccess(x, y, z));

      expect(fromKey).toEqual(expectOk(gridPosition(x, y, z)));
      expect(unpack(packSuccess(x, y, z))).toEqual([
        fromKey.x,
        fromKey.y,
        fromKey.z,
      ]);
    }
  });
});

describe("bounds3i", () => {
  it("accepts a closed range including a single voxel", () => {
    const min = position(-1, 2, 3);
    const max = position(-1, 5, 3);

    expect(bounds3i(min, max)).toEqual({
      ok: true,
      value: { isEmpty: false, min, max },
    });
    expect(bounds3i(min, min)).toEqual({
      ok: true,
      value: { isEmpty: false, min, max: min },
    });
  });

  it.each([
    ["x", 1, 0, 0],
    ["y", 0, 1, 0],
    ["z", 0, 0, 1],
  ] as const)(
    "rejects a range inverted only on axis %s",
    (axis, x, y, z) => {
      expect(bounds3i(position(x, y, z), position(0, 0, 0))).toEqual({
        ok: false,
        error: { code: "invalid-bounds", axis },
      });
    },
  );

  it("leaves the reported axis of several inverted axes undefined", () => {
    const result = bounds3i(position(1, 1, 1), position(0, 0, 0));

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("invalid-bounds");
      expect(["x", "y", "z"]).toContain(result.error.axis);
    }
  });

  it("represents the empty range without corners", () => {
    expect(EMPTY_BOUNDS3I).toEqual({ isEmpty: true });
    expect("min" in EMPTY_BOUNDS3I).toBe(false);
  });
});

describe("uniformVoxSnapshot", () => {
  it("canonicalizes unsorted input into an ascending container", () => {
    const snapshot = voxelsOf([
      [2, 0, 0, "#0000ff"],
      [0, 1, 0, "#ff0000"],
      [1, 0, 2, "#00ff00"],
    ]);

    expect(snapshot.count).toBe(3);
    expect(snapshot.x).toBeInstanceOf(Int16Array);
    expect(snapshot.colorIndex).toBeInstanceOf(Uint8Array);
    expect(Array.from(snapshot.x)).toEqual([0, 1, 2]);
    expect(Array.from(snapshot.y)).toEqual([1, 0, 0]);
    expect(Array.from(snapshot.z)).toEqual([0, 2, 0]);
    expect(snapshot.palette).toEqual(["#0000FF", "#00FF00", "#FF0000"]);
    expect(colorsOf(snapshot)).toEqual(["#FF0000", "#00FF00", "#0000FF"]);
  });

  it("orders positions by VoxelKey across signs", () => {
    const snapshot = voxelsOf([
      [MAX_COORDINATE, MAX_COORDINATE, MAX_COORDINATE, "#ff0000"],
      [0, 0, -1, "#ff0000"],
      [-1, 0, 0, "#ff0000"],
      [MIN_COORDINATE, MIN_COORDINATE, MIN_COORDINATE, "#ff0000"],
      [0, -1, 0, "#ff0000"],
    ]);

    expect(Array.from(snapshot.x)).toEqual([
      MIN_COORDINATE,
      -1,
      0,
      0,
      MAX_COORDINATE,
    ]);
    expect(Array.from(snapshot.y)).toEqual([
      MIN_COORDINATE,
      0,
      -1,
      0,
      MAX_COORDINATE,
    ]);
    expect(Array.from(snapshot.z)).toEqual([
      MIN_COORDINATE,
      0,
      0,
      -1,
      MAX_COORDINATE,
    ]);
  });

  it("keeps count, column lengths, and palette indices consistent", () => {
    const snapshot = voxelsOf([
      [0, 0, 0, "#ff0000"],
      [1, 0, 0, "#00ff00"],
      [2, 0, 0, "#ff0000"],
    ]);

    expect(snapshot.count).toBe(snapshot.x.length);
    expect(snapshot.count).toBe(snapshot.y.length);
    expect(snapshot.count).toBe(snapshot.z.length);
    expect(snapshot.count).toBe(snapshot.colorIndex.length);

    for (const index of Array.from(snapshot.colorIndex)) {
      expect(index).toBeLessThan(snapshot.palette.length);
    }
  });

  it("collapses repeated positions to the last entry, palette included", () => {
    const snapshot = voxelsOf([
      [0, 0, 0, "#ff0000"],
      [1, 0, 0, "#00ff00"],
      [0, 0, 0, "#0000ff"],
    ]);

    expect(snapshot.count).toBe(2);
    expect(Array.from(snapshot.x)).toEqual([0, 1]);
    expect(colorsOf(snapshot)).toEqual(["#0000FF", "#00FF00"]);
    // The overwritten colour must not survive in the canonical palette.
    expect(snapshot.palette).toEqual(["#0000FF", "#00FF00"]);
  });

  it("gives one container per voxel set", () => {
    const forward = voxelsOf([
      [0, 0, 0, "#ff0000"],
      [1, 2, 3, "#00ff00"],
      [-4, 0, 5, "#0000ff"],
    ]);
    const backward = voxelsOf([
      [-4, 0, 5, "#0000ff"],
      [1, 2, 3, "#00ff00"],
      [0, 0, 0, "#ff0000"],
    ]);

    expectSameContainer(backward, forward);
  });

  it("canonicalizes the palette to referenced colors only", () => {
    const snapshot = expectOk(
      uniformVoxSnapshot({
        x: [0],
        y: [0],
        z: [0],
        colorIndex: [1],
        palette: [color("#00ff00"), color("#ff0000"), color("#00FF00")],
      }),
    );

    expect(snapshot.palette).toEqual(["#FF0000"]);
    expect(colorsOf(snapshot)).toEqual(["#FF0000"]);
  });

  it("accepts typed columns and re-canonicalizes a container", () => {
    const snapshot = voxelsOf([
      [3, 1, 4, "#ff0000"],
      [-2, 0, 7, "#00ff00"],
    ]);

    expectSameContainer(expectOk(uniformVoxSnapshot(snapshot)), snapshot);
  });

  it("builds an empty container", () => {
    const snapshot = expectOk(
      uniformVoxSnapshot({ x: [], y: [], z: [], colorIndex: [], palette: [] }),
    );

    expect(snapshot.count).toBe(0);
    expect(snapshot.x).toBeInstanceOf(Int16Array);
    expect(snapshot.x.length).toBe(0);
    expect(snapshot.palette).toEqual([]);
  });

  it("holds exactly PALETTE_LIMIT referenced colors and rejects one more", () => {
    const atLimit = Array.from(
      { length: PALETTE_LIMIT },
      (_, index): Entry => [index, 0, 0, hexColor(index)],
    );

    expect(
      expectOk(uniformVoxSnapshot(parts(atLimit))).palette.length,
    ).toBe(PALETTE_LIMIT);

    const overLimit: Entry[] = [
      ...atLimit,
      [PALETTE_LIMIT, 0, 0, hexColor(PALETTE_LIMIT)],
    ];

    expect(uniformVoxSnapshot(parts(overLimit))).toEqual({
      ok: false,
      error: { code: "palette-limit-exceeded", limit: PALETTE_LIMIT },
    });
  });

  it("counts only the referenced colors against PALETTE_LIMIT", () => {
    const rawPalette = Array.from(
      { length: PALETTE_LIMIT + 44 },
      (_, index) => color(hexColor(index)),
    );
    const lastIndex = rawPalette.length - 1;

    const snapshot = expectOk(
      uniformVoxSnapshot({
        x: [0, 1],
        y: [0, 0],
        z: [0, 0],
        colorIndex: [0, lastIndex],
        palette: rawPalette,
      }),
    );

    expect(snapshot.palette).toEqual([hexColor(0), hexColor(lastIndex)]);
  });

  it("does not modify its inputs and copies their values", () => {
    const x = [2, 0];
    const y = [0, 1];
    const z = [0, 0];
    const colorIndex = [0, 1];
    const palette = [color("#ff0000"), color("#0000ff")];

    const snapshot = expectOk(
      uniformVoxSnapshot({ x, y, z, colorIndex, palette }),
    );

    expect(x).toEqual([2, 0]);
    expect(y).toEqual([0, 1]);
    expect(z).toEqual([0, 0]);
    expect(colorIndex).toEqual([0, 1]);
    expect(palette).toEqual(["#FF0000", "#0000FF"]);

    x[0] = MAX_COORDINATE;
    colorIndex[1] = 0;
    palette[1] = color("#00ff00");

    expect(Array.from(snapshot.x)).toEqual([0, 2]);
    expect(colorsOf(snapshot)).toEqual(["#0000FF", "#FF0000"]);
  });

  it.each([
    ["y", { ...singleVoxel, y: [0, 0] }],
    ["z", { ...singleVoxel, z: [0, 0] }],
    ["colorIndex", { ...singleVoxel, colorIndex: [0, 0] }],
  ] as const)(
    "rejects a %s column that disagrees on length",
    (column, input) => {
      expect(uniformVoxSnapshot(input)).toEqual({
        ok: false,
        error: { code: "invalid-column-length", column },
      });
    },
  );

  it.each([
    ["x", { ...singleVoxel, x: [MAX_COORDINATE + 1] }],
    ["y", { ...singleVoxel, y: [1.5] }],
    ["z", { ...singleVoxel, z: [Number.NaN] }],
  ] as const)(
    "rejects coordinates outside the 16-bit integer range on %s",
    (axis, input) => {
      expect(uniformVoxSnapshot(input)).toEqual({
        ok: false,
        error: { code: "invalid-coordinate", axis },
      });
    },
  );

  it.each([
    [1, { ...twoRedVoxels, colorIndex: [0, 1] }],
    [1, { ...twoRedVoxels, colorIndex: [0, 0.5] }],
    [0, { ...twoRedVoxels, colorIndex: [-1, 0] }],
  ] as const)(
    "rejects a color index that does not address the palette",
    (index, input) => {
      expect(uniformVoxSnapshot(input)).toEqual({
        ok: false,
        error: { code: "invalid-color-index", index },
      });
    },
  );

  it("leaves co-occurring coordinate and palette errors undefined", () => {
    const result = uniformVoxSnapshot({
      ...singleVoxel,
      x: [MAX_COORDINATE + 1],
      colorIndex: [-1],
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      // Either declared code is acceptable; the precedence is not promised.
      expect(["invalid-coordinate", "invalid-color-index"]).toContain(
        result.error.code,
      );
    }
  });
});
