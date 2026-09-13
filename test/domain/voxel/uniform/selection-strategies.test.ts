import { describe, expect, expectTypeOf, it } from "vitest";

import {
  resolveSelection,
  type SelectionResolution,
  type SelectionStrategy,
} from "../../../../src/domain/voxel/uniform/selection-strategies";
import {
  EMPTY_BOUNDS3I,
  bounds3i,
  gridPosition,
  uniformVoxSnapshot,
  type Bounds3i,
  type ColorHex,
  type UniformVoxParts,
  type UniformVoxSnapshot,
} from "../../../../src/domain/voxel/uniform/types";
import { parseHex } from "../../../../src/util/color";
import { pack, type VoxelKey } from "../../../../src/util/packed-int";
import type { Result } from "../../../../src/util/result";

type Entry = readonly [x: number, y: number, z: number, hex: string];
type Corner = readonly [x: number, y: number, z: number];

function expectOk<T, E>(result: Result<T, E>): T {
  if (!result.ok) {
    throw new Error(`Expected success: ${JSON.stringify(result.error)}`);
  }

  return result.value;
}

function color(input: string): ColorHex {
  return expectOk(parseHex(input));
}

function keyOf(x: number, y: number, z: number): VoxelKey {
  return expectOk(pack(x, y, z));
}

function voxelsOf(entries: readonly Entry[]): UniformVoxSnapshot {
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

  const parts: UniformVoxParts = { x, y, z, colorIndex, palette };

  return expectOk(uniformVoxSnapshot(parts));
}

function boxed(min: Corner, max: Corner): Bounds3i {
  return expectOk(
    bounds3i(
      expectOk(gridPosition(min[0], min[1], min[2])),
      expectOk(gridPosition(max[0], max[1], max[2])),
    ),
  );
}

const snapshot = voxelsOf([
  [0, 0, 0, "#ff0000"],
  [1, 0, 0, "#00ff00"],
  [2, 0, 0, "#ff0000"],
  [3, 0, 0, "#00ff00"],
]);

describe("selection type contract", () => {
  it("pins the live strategy variants and resolution shape", () => {
    expectTypeOf<SelectionStrategy>().toEqualTypeOf<
      | Readonly<{ kind: "box"; bounds: Bounds3i }>
      | Readonly<{
          kind: "rectangle";
          projectedKeys: readonly VoxelKey[];
          surfaceKeys: readonly VoxelKey[];
          bypass: boolean;
        }>
      | Readonly<{ kind: "color"; color: ColorHex }>
    >();
    expectTypeOf<SelectionResolution>().toEqualTypeOf<
      Readonly<{ keys: readonly VoxelKey[] }>
    >();
  });
});

describe("box strategy", () => {
  it("returns existing voxels inside the closed range", () => {
    const resolution = resolveSelection(
      { kind: "box", bounds: boxed([1, 0, 0], [2, 0, 0]) },
      snapshot,
    );

    expect(resolution.keys).toEqual([keyOf(1, 0, 0), keyOf(2, 0, 0)]);
  });

  it("returns nothing for an empty or disjoint range", () => {
    expect(
      resolveSelection({ kind: "box", bounds: EMPTY_BOUNDS3I }, snapshot).keys,
    ).toEqual([]);
    expect(
      resolveSelection(
        { kind: "box", bounds: boxed([9, 0, 0], [12, 0, 0]) },
        snapshot,
      ).keys,
    ).toEqual([]);
  });
});

describe("color strategy", () => {
  it("returns the exact color group in ascending order", () => {
    expect(
      resolveSelection({ kind: "color", color: color("#ff0000") }, snapshot)
        .keys,
    ).toEqual([keyOf(0, 0, 0), keyOf(2, 0, 0)]);
  });

  it("returns nothing for a color the object does not use", () => {
    expect(
      resolveSelection({ kind: "color", color: color("#0000ff") }, snapshot)
        .keys,
    ).toEqual([]);
  });
});

describe("rectangle strategy", () => {
  const projectedKeys = [
    keyOf(2, 0, 0),
    keyOf(0, 0, 0),
    keyOf(2, 0, 0),
    keyOf(9, 0, 0),
  ];

  it("intersects with surface keys when bypass is off", () => {
    const resolution = resolveSelection(
      {
        kind: "rectangle",
        projectedKeys,
        surfaceKeys: [keyOf(0, 0, 0), keyOf(5, 0, 0)],
        bypass: false,
      },
      snapshot,
    );

    expect(resolution.keys).toEqual([keyOf(0, 0, 0)]);
  });

  it("keeps the whole projected depth when bypass is on", () => {
    const resolution = resolveSelection(
      {
        kind: "rectangle",
        projectedKeys,
        surfaceKeys: [],
        bypass: true,
      },
      snapshot,
    );

    // Empty positions stay in the set: Add writes into empty space.
    expect(resolution.keys).toEqual([
      keyOf(0, 0, 0),
      keyOf(2, 0, 0),
      keyOf(9, 0, 0),
    ]);
  });

  it("returns nothing when no key is projected", () => {
    expect(
      resolveSelection(
        {
          kind: "rectangle",
          projectedKeys: [],
          surfaceKeys: [keyOf(0, 0, 0)],
          bypass: false,
        },
        snapshot,
      ).keys,
    ).toEqual([]);
  });
});
