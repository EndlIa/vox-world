import type { ColorHex } from "../../../util/color";
import { boundsCheck, pack, unpack, type VoxelKey } from "../../../util/packed-int";
import { err, ok, type Result } from "../../../util/result";

export type { ColorHex } from "../../../util/color";
export type { VoxelKey } from "../../../util/packed-int";

/** Largest palette a container can address: `colorIndex` is a `Uint8Array`. */
export const PALETTE_LIMIT = 256;

/**
 * Validated integer voxel coordinate, one entry per axis.
 *
 * The brand keeps general math values out: `Vec3` may hold any finite number,
 * while voxel positions are integers inside `MIN_COORDINATE..MAX_COORDINATE`.
 */
export type GridPosition = Readonly<{
  x: number;
  y: number;
  z: number;
}> & {
  readonly __brand: "GridPosition";
};

/**
 * Closed integer range. The empty state is exclusive and carries no corners, so
 * no `Infinity` sentinel is ever needed.
 */
export type Bounds3i =
  | Readonly<{ isEmpty: true }>
  | Readonly<{ isEmpty: false; min: GridPosition; max: GridPosition }>;

/**
 * Unvalidated columns accepted by `uniformVoxSnapshot`. Entries sharing an index
 * describe one voxel, whose color is `palette[colorIndex[index]]`. Plain arrays
 * and typed arrays are both accepted, and a `UniformVoxSnapshot` satisfies this
 * shape, so a container can be re-canonicalized.
 */
export type UniformVoxParts = Readonly<{
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  z: ArrayLike<number>;
  colorIndex: ArrayLike<number>;
  palette: readonly ColorHex[];
}>;

/**
 * SoA voxel container for one `SceneObject`: coordinates ascend by `VoxelKey`,
 * positions are unique, `count` matches every column, and every `colorIndex`
 * addresses `palette`. Only `uniformVoxSnapshot` produces containers.
 */
export type UniformVoxSnapshot = Readonly<{
  count: number;
  x: Int16Array;
  y: Int16Array;
  z: Int16Array;
  colorIndex: Uint8Array;
  palette: readonly ColorHex[];
}>;

/** Cold-path view of a single voxel; never a storage form. */
export type VoxelSnapshot = Readonly<{
  position: GridPosition;
  color: ColorHex;
}>;

/**
 * The only vocabulary for naming voxels inside one object. Scopes are plain,
 * serializable data: interaction inputs such as screen rectangles or bridge
 * paths are resolved by upper layers into one of these variants.
 */
export type VoxelScope =
  | Readonly<{ kind: "keys"; keys: readonly VoxelKey[] }>
  | Readonly<{ kind: "color"; color: ColorHex }>
  | Readonly<{ kind: "bounds"; bounds: Bounds3i }>
  | Readonly<{ kind: "all" }>;

export type GridPositionError = Readonly<{
  code: "invalid-coordinate";
  axis: "x" | "y" | "z";
}>;

export type Bounds3iError = Readonly<{
  code: "invalid-bounds";
  axis: "x" | "y" | "z";
}>;

export type UniformVoxSnapshotError =
  | GridPositionError
  | Readonly<{
      code: "invalid-column-length";
      column: "y" | "z" | "colorIndex";
    }>
  | Readonly<{ code: "invalid-color-index"; index: number }>
  | Readonly<{ code: "palette-limit-exceeded"; limit: number }>;

/** The canonical empty range. */
export const EMPTY_BOUNDS3I: Bounds3i = { isEmpty: true };

/**
 * Brands coordinates that are already known valid. This is the only assertion in
 * the module: the validating constructor and the proven key path are the only
 * callers.
 */
function brandGridPosition(x: number, y: number, z: number): GridPosition {
  return { x, y, z } as GridPosition;
}

/**
 * Builds the error for coordinates `pack` already rejected, naming the first
 * invalid axis in x → y → z order. Each probe isolates one coordinate by holding
 * the other two at valid zeros, because `pack` does not promise a multi-axis
 * error order; once x and y are valid the rejected axis must be z.
 */
function invalidCoordinate(x: number, y: number): GridPositionError {
  if (!boundsCheck(x, 0, 0)) {
    return { code: "invalid-coordinate", axis: "x" };
  }

  if (!boundsCheck(y, 0, 0)) {
    return { code: "invalid-coordinate", axis: "y" };
  }

  return { code: "invalid-coordinate", axis: "z" };
}

/**
 * Proven path: the key already carries 16-bit coordinates, produced by `pack`,
 * by `unpack`, or by decoding that applied the same range check.
 */
export function gridPositionFromKey(key: VoxelKey): GridPosition {
  const [x, y, z] = unpack(key);

  return brandGridPosition(x, y, z);
}

/**
 * Proven path for container coordinates: `uniformVoxSnapshot` validated every
 * column before building the container, so element `index` is always a valid
 * grid position. Callers obtain `index` from `query.indexOfKey` or from
 * container iteration; it must be inside `count`.
 */
export function gridPositionFromSnapshot(
  snapshot: UniformVoxSnapshot,
  index: number,
): GridPosition {
  const x = snapshot.x[index];
  const y = snapshot.y[index];
  const z = snapshot.z[index];

  // The container and its columns are built together, so a missing element means
  // a writer broke the container invariants.
  if (x === undefined || y === undefined || z === undefined) {
    throw new Error("Voxel snapshot column is shorter than its count");
  }

  return brandGridPosition(x, y, z);
}

/**
 * Validating entry point for `GridPosition`. Reports the first invalid axis in
 * x → y → z order; the raw value is left out of the error so nothing
 * unserializable (`NaN`, `Infinity`) can cross a worker or persistence boundary.
 */
export function gridPosition(
  x: number,
  y: number,
  z: number,
): Result<GridPosition, GridPositionError> {
  const key = pack(x, y, z);

  if (!key.ok) {
    return err(invalidCoordinate(x, y));
  }

  return ok(gridPositionFromKey(key.value));
}

/**
 * Validating entry point for `Bounds3i`. Both corners are already validated
 * positions, so only the closed-range order is checked; the first inverted axis
 * in x → y → z order is reported.
 */
export function bounds3i(
  min: GridPosition,
  max: GridPosition,
): Result<Bounds3i, Bounds3iError> {
  if (min.x > max.x) {
    return err({ code: "invalid-bounds", axis: "x" });
  }

  if (min.y > max.y) {
    return err({ code: "invalid-bounds", axis: "y" });
  }

  if (min.z > max.z) {
    return err({ code: "invalid-bounds", axis: "z" });
  }

  return ok({ isEmpty: false, min, max });
}

/**
 * Builds the canonical container for one object from unvalidated columns.
 *
 * Columns are validated in input order (coordinates before the color index of
 * the same entry), repeated positions collapse to the last entry, and the
 * palette becomes the referenced colors in ascending string order with
 * `colorIndex` remapped. Inputs are never modified.
 */
export function uniformVoxSnapshot(
  parts: UniformVoxParts,
): Result<UniformVoxSnapshot, UniformVoxSnapshotError> {
  const inputCount = parts.x.length;

  if (parts.y.length !== inputCount) {
    return err({ code: "invalid-column-length", column: "y" });
  }

  if (parts.z.length !== inputCount) {
    return err({ code: "invalid-column-length", column: "z" });
  }

  if (parts.colorIndex.length !== inputCount) {
    return err({ code: "invalid-column-length", column: "colorIndex" });
  }

  // Later entries overwrite earlier ones, so a repeated position keeps the color
  // written last.
  const colorsByKey = new Map<VoxelKey, ColorHex>();

  for (let index = 0; index < inputCount; index += 1) {
    const x = parts.x[index];
    const y = parts.y[index];
    const z = parts.z[index];
    const rawColorIndex = parts.colorIndex[index];

    // Lengths were checked above, so a missing element means the ArrayLike
    // misreported its length or holds a hole: a caller bug, not input to report.
    if (
      x === undefined ||
      y === undefined ||
      z === undefined ||
      rawColorIndex === undefined
    ) {
      throw new Error("Voxel parts column is shorter than its declared length");
    }

    const key = pack(x, y, z);

    if (!key.ok) {
      return err(invalidCoordinate(x, y));
    }

    const color = parts.palette[rawColorIndex];

    // Absent covers every unusable index: fractional, negative, out of range, or
    // a palette hole.
    if (color === undefined) {
      return err({ code: "invalid-color-index", index });
    }

    colorsByKey.set(key.value, color);
  }

  const usedColors = new Set(colorsByKey.values());

  if (usedColors.size > PALETTE_LIMIT) {
    return err({ code: "palette-limit-exceeded", limit: PALETTE_LIMIT });
  }

  const palette = [...usedColors].sort();
  const paletteIndexByColor = new Map(
    palette.map((color, index): readonly [ColorHex, number] => [color, index]),
  );

  const entries = [...colorsByKey.entries()].sort(
    ([left], [right]) => left - right,
  );
  const count = entries.length;
  const x = new Int16Array(count);
  const y = new Int16Array(count);
  const z = new Int16Array(count);
  const colorIndex = new Uint8Array(count);

  for (const [position, entry] of entries.entries()) {
    const [key, color] = entry;
    const [keyX, keyY, keyZ] = unpack(key);
    const paletteIndex = paletteIndexByColor.get(color);

    // The palette was derived from these colors, so a missing index means the
    // container invariant was broken by a writer.
    if (paletteIndex === undefined) {
      throw new Error("Voxel palette index is missing for a referenced color");
    }

    x[position] = keyX;
    y[position] = keyY;
    z[position] = keyZ;
    colorIndex[position] = paletteIndex;
  }

  return ok({ count, x, y, z, colorIndex, palette });
}
