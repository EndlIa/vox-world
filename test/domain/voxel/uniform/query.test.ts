import { describe, expect, expectTypeOf, it } from "vitest";

import {
  bounds,
  byColor,
  colorAt,
  count,
  has,
  indexOfKey,
  keys,
  resolveScope,
  uniqueColors,
  voxelAt,
  voxelRecords,
  withinBox,
} from "../../../../src/domain/voxel/uniform/query";
import {
  EMPTY_BOUNDS3I,
  bounds3i,
  gridPosition,
  uniformVoxSnapshot,
  type Bounds3i,
  type ColorHex,
  type UniformVoxSnapshot,
  type VoxelScope,
  type VoxelKey,
  type VoxelSnapshot,
} from "../../../../src/domain/voxel/uniform/types";
import { parseHex } from "../../../../src/util/color";
import {
  MAX_COORDINATE,
  MIN_COORDINATE,
  pack,
} from "../../../../src/util/packed-int";
import { expectOk } from "../../../support/expect-result";

type Entry = readonly [x: number, y: number, z: number, hex: string];
type Corner = readonly [x: number, y: number, z: number];

function color(input: string): ColorHex {
  return expectOk(parseHex(input));
}

function packSuccess(x: number, y: number, z: number): VoxelKey {
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

  return expectOk(uniformVoxSnapshot({ x, y, z, colorIndex, palette }));
}

function boxed(min: Corner, max: Corner): Bounds3i {
  return expectOk(
    bounds3i(
      expectOk(gridPosition(min[0], min[1], min[2])),
      expectOk(gridPosition(max[0], max[1], max[2])),
    ),
  );
}

/** 64 voxels along x with two colors, so scalar searches visit real midpoints. */
const spread: readonly Entry[] = Array.from(
  { length: 64 },
  (_, index): Entry => [
    index - 32,
    index % 3,
    0,
    index % 2 === 0 ? "#ff0000" : "#00ff00",
  ],
);

describe("query type contract", () => {
  it("pins the public query signatures", () => {
    expectTypeOf(bounds).toEqualTypeOf<
      (snapshot: UniformVoxSnapshot) => Bounds3i
    >();
    expectTypeOf(count).toEqualTypeOf<
      (snapshot: UniformVoxSnapshot) => number
    >();
    expectTypeOf(has).toEqualTypeOf<
      (snapshot: UniformVoxSnapshot, key: VoxelKey) => boolean
    >();
    expectTypeOf(indexOfKey).toEqualTypeOf<
      (snapshot: UniformVoxSnapshot, key: VoxelKey) => number
    >();
    expectTypeOf(colorAt).toEqualTypeOf<
      (snapshot: UniformVoxSnapshot, key: VoxelKey) => ColorHex | undefined
    >();
    expectTypeOf(keys).toEqualTypeOf<
      (snapshot: UniformVoxSnapshot) => Iterable<VoxelKey>
    >();
    // A box query takes the domain range, never a math `Aabb`.
    expectTypeOf(withinBox).toEqualTypeOf<
      (snapshot: UniformVoxSnapshot, bounds: Bounds3i) => Iterable<VoxelKey>
    >();
    expectTypeOf(byColor).toEqualTypeOf<
      (snapshot: UniformVoxSnapshot, color: ColorHex) => Iterable<VoxelKey>
    >();
    // The palette is handed back as-is, so the read-only view is the contract
    // that keeps callers from reordering what byColor binary-searches.
    expectTypeOf(uniqueColors).toEqualTypeOf<
      (snapshot: UniformVoxSnapshot) => readonly ColorHex[]
    >();
    expectTypeOf(resolveScope).toEqualTypeOf<
      (snapshot: UniformVoxSnapshot, scope: VoxelScope) => Iterable<VoxelKey>
    >();
    expectTypeOf(voxelAt).toEqualTypeOf<
      (snapshot: UniformVoxSnapshot, index: number) => VoxelSnapshot
    >();
    expectTypeOf(voxelRecords).toEqualTypeOf<
      (snapshot: UniformVoxSnapshot) => Iterable<VoxelSnapshot>
    >();
  });
});

describe("scalar queries", () => {
  it("counts the container", () => {
    expect(count(voxelsOf([]))).toBe(0);
    expect(count(voxelsOf(spread))).toBe(spread.length);
  });

  it("finds existing keys and rejects absent ones", () => {
    const snapshot = voxelsOf(spread);

    for (const entry of spread) {
      const key = packSuccess(entry[0], entry[1], entry[2]);

      expect(has(snapshot, key)).toBe(true);
      expect(indexOfKey(snapshot, key)).toBeGreaterThanOrEqual(0);
    }

    expect(has(snapshot, packSuccess(0, 0, 1))).toBe(false);
    expect(indexOfKey(snapshot, packSuccess(0, 0, 1))).toBe(-1);
    expect(colorAt(snapshot, packSuccess(0, 0, 1))).toBeUndefined();
  });

  it("returns the normalized color of an existing key", () => {
    const snapshot = voxelsOf([[0, 0, 0, "#ff0000"]]);

    expect(colorAt(snapshot, packSuccess(0, 0, 0))).toBe(color("#FF0000"));
  });

  it("keeps binary search consistent with the ascending container", () => {
    const snapshot = voxelsOf(spread);
    const indexes = spread.map((entry) =>
      indexOfKey(snapshot, packSuccess(entry[0], entry[1], entry[2])),
    );

    expect([...indexes].sort((left, right) => left - right)).toEqual(
      Array.from({ length: spread.length }, (_, index) => index),
    );
  });
});

describe("bounds", () => {
  it("returns the tight box of the occupied coordinates", () => {
    const snapshot = voxelsOf([
      [5, -2, 9, "#ff0000"],
      [-7, 4, 0, "#ff0000"],
      [1, 1, 1, "#ff0000"],
    ]);

    expect(bounds(snapshot)).toEqual(boxed([-7, -2, 0], [5, 4, 9]));
  });

  it("returns the empty range for an empty container", () => {
    expect(bounds(voxelsOf([]))).toEqual(EMPTY_BOUNDS3I);
  });

  it("collapses to a single position", () => {
    const snapshot = voxelsOf([[MAX_COORDINATE, MIN_COORDINATE, 0, "#ff0000"]]);

    expect(bounds(snapshot)).toEqual(
      boxed(
        [MAX_COORDINATE, MIN_COORDINATE, 0],
        [MAX_COORDINATE, MIN_COORDINATE, 0],
      ),
    );
  });
});

describe("lazy sequences", () => {
  it("yields every key in ascending order and can be iterated twice", () => {
    const snapshot = voxelsOf([
      [2, 0, 0, "#ff0000"],
      [-1, 5, 0, "#ff0000"],
      [0, 0, 3, "#ff0000"],
    ]);

    const sequence = keys(snapshot);
    const first = Array.from(sequence);
    const second = Array.from(sequence);

    expect(first).toEqual([
      packSuccess(-1, 5, 0),
      packSuccess(0, 0, 3),
      packSuccess(2, 0, 0),
    ]);
    expect(second).toEqual(first);
    expect(Array.isArray(sequence)).toBe(false);
  });

  it("keeps the box range closed, repeatable, and un-materialized", () => {
    const snapshot = voxelsOf([
      [0, 0, 0, "#ff0000"],
      [1, 0, 0, "#ff0000"],
      [2, 0, 0, "#ff0000"],
      [3, 0, 0, "#ff0000"],
    ]);

    const sequence = withinBox(snapshot, boxed([1, 0, 0], [2, 0, 0]));

    expect(Array.from(sequence)).toEqual([
      packSuccess(1, 0, 0),
      packSuccess(2, 0, 0),
    ]);
    expect(Array.from(sequence)).toEqual([
      packSuccess(1, 0, 0),
      packSuccess(2, 0, 0),
    ]);
    expect("length" in sequence).toBe(false);
  });

  it("yields nothing for an empty box or a box outside the model", () => {
    const snapshot = voxelsOf([[0, 0, 0, "#ff0000"]]);

    expect(Array.from(withinBox(snapshot, EMPTY_BOUNDS3I))).toEqual([]);
    expect(Array.from(withinBox(snapshot, boxed([5, 5, 5], [9, 9, 9])))).toEqual(
      [],
    );
  });

  it("matches colors exactly through the palette, un-materialized", () => {
    const snapshot = voxelsOf([
      [0, 0, 0, "#ff0000"],
      [1, 0, 0, "#00ff00"],
      [2, 0, 0, "#ff0000"],
    ]);

    const sequence = byColor(snapshot, color("#FF0000"));

    expect(Array.from(sequence)).toEqual([
      packSuccess(0, 0, 0),
      packSuccess(2, 0, 0),
    ]);
    expect(Array.from(sequence)).toEqual([
      packSuccess(0, 0, 0),
      packSuccess(2, 0, 0),
    ]);
    expect(Array.isArray(sequence)).toBe(false);
    expect(Array.from(byColor(snapshot, color("#0000ff")))).toEqual([]);
  });

  it("returns the palette itself without rebuilding it", () => {
    const snapshot = voxelsOf([
      [0, 0, 0, "#ff0000"],
      [1, 0, 0, "#00ff00"],
    ]);

    expect(uniqueColors(snapshot)).toBe(snapshot.palette);
  });
});

describe("resolveScope", () => {
  const snapshot = voxelsOf([
    [0, 0, 0, "#ff0000"],
    [1, 0, 0, "#00ff00"],
    [2, 0, 0, "#ff0000"],
  ]);

  it("sorts and dedupes the keys variant", () => {
    const scope: VoxelScope = {
      kind: "keys",
      keys: [
        packSuccess(2, 0, 0),
        packSuccess(0, 0, 0),
        packSuccess(2, 0, 0),
        packSuccess(1, 0, 0),
      ],
    };

    const sequence = resolveScope(snapshot, scope);

    expect(Array.from(sequence)).toEqual([
      packSuccess(0, 0, 0),
      packSuccess(1, 0, 0),
      packSuccess(2, 0, 0),
    ]);
    expect(Array.from(sequence)).toEqual([
      packSuccess(0, 0, 0),
      packSuccess(1, 0, 0),
      packSuccess(2, 0, 0),
    ]);
  });

  it("throws on a key outside the 16-bit range", () => {
    // Deliberate brand violation: the guard exists for exactly this caller bug.
    const scope: VoxelScope = {
      kind: "keys",
      keys: [(MIN_COORDINATE - 1) as VoxelKey],
    };

    expect(() => Array.from(resolveScope(snapshot, scope))).toThrow();
  });

  it("resolves an empty keys variant to nothing", () => {
    expect(Array.from(resolveScope(snapshot, { kind: "keys", keys: [] }))).toEqual(
      [],
    );
  });

  it("resolves the bounds variant through the box query", () => {
    expect(
      Array.from(
        resolveScope(snapshot, {
          kind: "bounds",
          bounds: boxed([1, 0, 0], [2, 0, 0]),
        }),
      ),
    ).toEqual([packSuccess(1, 0, 0), packSuccess(2, 0, 0)]);
  });

  it("resolves the color variant through the color query", () => {
    expect(
      Array.from(
        resolveScope(snapshot, { kind: "color", color: color("#ff0000") }),
      ),
    ).toEqual([packSuccess(0, 0, 0), packSuccess(2, 0, 0)]);
  });

  it("resolves the all variant to every key", () => {
    expect(Array.from(resolveScope(snapshot, { kind: "all" }))).toEqual(
      Array.from(keys(snapshot)),
    );
  });
});

describe("cold-path records", () => {
  it("reads the record behind an index", () => {
    const snapshot = voxelsOf([
      [4, 5, 6, "#ff0000"],
      [-1, 0, 0, "#00ff00"],
    ]);
    const index = indexOfKey(snapshot, packSuccess(-1, 0, 0));

    expect(voxelAt(snapshot, index)).toEqual({
      position: { x: -1, y: 0, z: 0 },
      color: color("#00ff00"),
    });
  });

  it("lists every record in ascending key order, repeatably", () => {
    const snapshot = voxelsOf([
      [1, 0, 0, "#00ff00"],
      [-1, 0, 0, "#ff0000"],
    ]);

    const records = voxelRecords(snapshot);
    const first = Array.from(records);
    const second = Array.from(records);

    expect(first).toEqual([
      { position: { x: -1, y: 0, z: 0 }, color: color("#FF0000") },
      { position: { x: 1, y: 0, z: 0 }, color: color("#00FF00") },
    ]);
    expect(second).toEqual(first);
  });

  it("yields no record for an empty container", () => {
    expect(Array.from(voxelRecords(voxelsOf([])))).toEqual([]);
  });
});
