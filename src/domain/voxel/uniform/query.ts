import type { ColorHex } from "../../../util/color";
import {
  boundsCheck,
  pack,
  unpack,
  type VoxelKey,
} from "../../../util/packed-int";
import {
  EMPTY_BOUNDS3I,
  gridPosition,
  gridPositionFromSnapshot,
  type Bounds3i,
  type UniformVoxSnapshot,
  type VoxelScope,
  type VoxelSnapshot,
} from "./types";

/**
 * Shared empty sequence for scopes that address no voxel: an empty range, or a
 * color and key set that matches nothing.
 */
const EMPTY_KEYS: Iterable<VoxelKey> = {
  *[Symbol.iterator]() {},
};

/**
 * Reads one container element. Container indices stay inside `count`, so a
 * missing element means a writer broke the container invariants rather than a
 * recoverable input error.
 */
function columnValue(column: Int16Array | Uint8Array, index: number): number {
  const value = column[index];

  if (value === undefined) {
    throw new Error("Voxel snapshot column is shorter than its count");
  }

  return value;
}

/**
 * Rebuilds the `VoxelKey` of the container element at `index`. `VoxelKey` only
 * comes from `pack`, and the container validated these coordinates, so a failure
 * here means a writer broke the container invariants.
 */
function keyAt(snapshot: UniformVoxSnapshot, index: number): VoxelKey {
  const key = pack(
    columnValue(snapshot.x, index),
    columnValue(snapshot.y, index),
    columnValue(snapshot.z, index),
  );

  if (!key.ok) {
    throw new Error("Voxel snapshot holds a coordinate outside the 16-bit range");
  }

  return key.value;
}

/** Color of the container element at `index`; the palette is canonical. */
function colorAtIndex(snapshot: UniformVoxSnapshot, index: number): ColorHex {
  const color = snapshot.palette[columnValue(snapshot.colorIndex, index)];

  if (color === undefined) {
    throw new Error("Voxel snapshot color index does not address its palette");
  }

  return color;
}

/**
 * Binary search over `[0, length)`. `compare(index)` must report -1 before the
 * target, 0 at it, and 1 after it, following the sequence's ascending order.
 * Returns the matching index, or -1 when the target is absent.
 */
function binarySearch(
  length: number,
  compare: (index: number) => -1 | 0 | 1,
): number {
  let low = 0;
  let high = length - 1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const order = compare(middle);

    if (order === 0) {
      return middle;
    }

    if (order < 0) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return -1;
}

/** Position of `color` in the canonical palette, or -1 when it is absent. */
function indexOfColor(palette: readonly ColorHex[], color: ColorHex): number {
  return binarySearch(palette.length, (index) => {
    const candidate = palette[index];

    if (candidate === undefined) {
      throw new Error("Voxel palette is shorter than its length");
    }

    if (candidate === color) {
      return 0;
    }

    return candidate < color ? -1 : 1;
  });
}

/** Tight occupied box of the container; `EMPTY_BOUNDS3I` when it is empty. */
export function bounds(snapshot: UniformVoxSnapshot): Bounds3i {
  if (snapshot.count === 0) {
    return EMPTY_BOUNDS3I;
  }

  // The container is key-sorted, so its ends give the lexicographic extremes,
  // not the per-axis ones; without a spatial index the tight box needs a scan.
  let minX = columnValue(snapshot.x, 0);
  let minY = columnValue(snapshot.y, 0);
  let minZ = columnValue(snapshot.z, 0);
  let maxX = minX;
  let maxY = minY;
  let maxZ = minZ;

  for (let index = 1; index < snapshot.count; index += 1) {
    const x = columnValue(snapshot.x, index);
    const y = columnValue(snapshot.y, index);
    const z = columnValue(snapshot.z, index);

    if (x < minX) {
      minX = x;
    }

    if (y < minY) {
      minY = y;
    }

    if (z < minZ) {
      minZ = z;
    }

    if (x > maxX) {
      maxX = x;
    }

    if (y > maxY) {
      maxY = y;
    }

    if (z > maxZ) {
      maxZ = z;
    }
  }

  const min = gridPosition(minX, minY, minZ);
  const max = gridPosition(maxX, maxY, maxZ);

  // Both corners come from container coordinates, which the constructor already
  // validated, so a failure here means a writer broke the container invariants.
  if (!min.ok || !max.ok) {
    throw new Error("Voxel snapshot holds a coordinate outside the 16-bit range");
  }

  return { isEmpty: false, min: min.value, max: max.value };
}

export function count(snapshot: UniformVoxSnapshot): number {
  return snapshot.count;
}

/**
 * Binary-searches the container. Positions are compared per axis in x → y → z
 * order, which is the container's ascending `VoxelKey` order.
 */
export function indexOfKey(
  snapshot: UniformVoxSnapshot,
  key: VoxelKey,
): number {
  const [x, y, z] = unpack(key);

  return binarySearch(snapshot.count, (index) => {
    const middleX = columnValue(snapshot.x, index);
    const middleY = columnValue(snapshot.y, index);
    const middleZ = columnValue(snapshot.z, index);

    if (middleX === x && middleY === y && middleZ === z) {
      return 0;
    }

    const precedes =
      middleX < x ||
      (middleX === x && middleY < y) ||
      (middleX === x && middleY === y && middleZ < z);

    return precedes ? -1 : 1;
  });
}

export function has(snapshot: UniformVoxSnapshot, key: VoxelKey): boolean {
  return indexOfKey(snapshot, key) !== -1;
}

export function colorAt(
  snapshot: UniformVoxSnapshot,
  key: VoxelKey,
): ColorHex | undefined {
  const index = indexOfKey(snapshot, key);

  if (index === -1) {
    return undefined;
  }

  return colorAtIndex(snapshot, index);
}

/** All local keys in ascending order. Repeatable; no `length`. */
export function keys(snapshot: UniformVoxSnapshot): Iterable<VoxelKey> {
  return {
    *[Symbol.iterator]() {
      for (let index = 0; index < snapshot.count; index += 1) {
        yield keyAt(snapshot, index);
      }
    },
  };
}

/** Existing voxels inside the closed range. Repeatable; no `length`. */
export function withinBox(
  snapshot: UniformVoxSnapshot,
  bounds: Bounds3i,
): Iterable<VoxelKey> {
  if (bounds.isEmpty) {
    return EMPTY_KEYS;
  }

  const { min, max } = bounds;

  return {
    *[Symbol.iterator]() {
      for (let index = 0; index < snapshot.count; index += 1) {
        const x = columnValue(snapshot.x, index);
        const y = columnValue(snapshot.y, index);
        const z = columnValue(snapshot.z, index);

        if (
          x < min.x ||
          x > max.x ||
          y < min.y ||
          y > max.y ||
          z < min.z ||
          z > max.z
        ) {
          continue;
        }

        yield keyAt(snapshot, index);
      }
    },
  };
}

/** Voxels of one exact color, located through the canonical palette. */
export function byColor(
  snapshot: UniformVoxSnapshot,
  color: ColorHex,
): Iterable<VoxelKey> {
  const paletteIndex = indexOfColor(snapshot.palette, color);

  if (paletteIndex === -1) {
    return EMPTY_KEYS;
  }

  return {
    *[Symbol.iterator]() {
      for (let index = 0; index < snapshot.count; index += 1) {
        if (columnValue(snapshot.colorIndex, index) === paletteIndex) {
          yield keyAt(snapshot, index);
        }
      }
    },
  };
}

/** The canonical palette itself, without rebuilding or reordering it. */
export function uniqueColors(snapshot: UniformVoxSnapshot): readonly ColorHex[] {
  return snapshot.palette;
}

/**
 * Sorts and dedupes caller-supplied local keys. A key outside the 16-bit
 * coordinate range cannot address this object's grid: that is a caller contract
 * error, so it throws instead of being silently dropped. Cross-object keys are
 * indistinguishable by value and stay the caller's responsibility.
 */
function resolveKeys(candidates: readonly VoxelKey[]): Iterable<VoxelKey> {
  const sorted = [...candidates].sort((left, right) => left - right);
  const addresses: VoxelKey[] = [];

  for (const key of sorted) {
    const [x, y, z] = unpack(key);

    if (!boundsCheck(x, y, z)) {
      throw new Error("Voxel scope key is outside the 16-bit coordinate range");
    }

    if (addresses[addresses.length - 1] !== key) {
      addresses.push(key);
    }
  }

  return addresses;
}

/** The single resolver for `VoxelScope`: keys, color, closed box, or all. */
export function resolveScope(
  snapshot: UniformVoxSnapshot,
  scope: VoxelScope,
): Iterable<VoxelKey> {
  switch (scope.kind) {
    case "keys":
      return resolveKeys(scope.keys);
    case "color":
      return byColor(snapshot, scope.color);
    case "bounds":
      return withinBox(snapshot, scope.bounds);
    case "all":
      return keys(snapshot);
    default: {
      const unreachable: never = scope;

      throw new Error(`Unsupported voxel scope: ${String(unreachable)}`);
    }
  }
}

/** Cold-path record view; `index` comes from `indexOfKey`. */
export function voxelAt(
  snapshot: UniformVoxSnapshot,
  index: number,
): VoxelSnapshot {
  return {
    position: gridPositionFromSnapshot(snapshot, index),
    color: colorAtIndex(snapshot, index),
  };
}

/** Records of every voxel in ascending key order. Repeatable; no `length`. */
export function voxelRecords(
  snapshot: UniformVoxSnapshot,
): Iterable<VoxelSnapshot> {
  return {
    *[Symbol.iterator]() {
      for (let index = 0; index < snapshot.count; index += 1) {
        yield voxelAt(snapshot, index);
      }
    },
  };
}
