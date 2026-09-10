import { err, ok, type Result } from "./result";

export const MIN_COORDINATE = -32768;
export const MAX_COORDINATE = 32767;

export type VoxelKey = number & {
  readonly __brand: "VoxelKey";
};

export type PackedIntError =
  | {
      readonly code: "invalid_coordinate";
      readonly axis: "x" | "y" | "z";
      readonly value: number;
    }
  | {
      readonly code: "coordinate_out_of_range";
      readonly axis: "x" | "y" | "z";
      readonly value: number;
      readonly min: number;
      readonly max: number;
    }
  | {
      readonly code: "invalid_delta";
      readonly value: number;
    };

/** Bias that maps the signed 16-bit range onto `[0, 65535]`. */
const COORDINATE_BIAS = MAX_COORDINATE + 1;
const COORDINATE_BITS = 65536;
const COORDINATE_Y_AND_Z_BITS = COORDINATE_BITS * COORDINATE_BITS;

type CoordinateStatus = "valid" | "not_integer" | "out_of_range";

/**
 * Single owner of the coordinate rule: a safe integer inside the signed 16-bit
 * range. Consumers map the status onto their own shape, boolean or error.
 */
function coordinateStatus(value: number): CoordinateStatus {
  if (!Number.isSafeInteger(value)) {
    return "not_integer";
  }

  if (value < MIN_COORDINATE || value > MAX_COORDINATE) {
    return "out_of_range";
  }

  return "valid";
}

function validateCoordinate(
  value: number,
  axis: "x" | "y" | "z",
): PackedIntError | undefined {
  const status = coordinateStatus(value);

  if (status === "valid") {
    return undefined;
  }

  if (status === "not_integer") {
    return {
      code: "invalid_coordinate",
      axis,
      value,
    };
  }

  return {
    code: "coordinate_out_of_range",
    axis,
    value,
    min: MIN_COORDINATE,
    max: MAX_COORDINATE,
  };
}

/** Packs already validated coordinates; the only place the layout is written. */
function computeKey(x: number, y: number, z: number): VoxelKey {
  return (
    ((x + COORDINATE_BIAS) * COORDINATE_BITS + (y + COORDINATE_BIAS)) *
      COORDINATE_BITS +
    (z + COORDINATE_BIAS)
  ) as VoxelKey;
}

export function pack(
  x: number,
  y: number,
  z: number,
): Result<VoxelKey, PackedIntError> {
  const xError = validateCoordinate(x, "x");

  if (xError !== undefined) {
    return err(xError);
  }

  const yError = validateCoordinate(y, "y");

  if (yError !== undefined) {
    return err(yError);
  }

  const zError = validateCoordinate(z, "z");

  if (zError !== undefined) {
    return err(zError);
  }

  return ok(computeKey(x, y, z));
}

export function unpack(
  key: VoxelKey,
): readonly [number, number, number] {
  const z = key % COORDINATE_BITS;
  const y = Math.floor(key / COORDINATE_BITS) % COORDINATE_BITS;
  const x = Math.floor(key / COORDINATE_Y_AND_Z_BITS) % COORDINATE_BITS;

  return [
    x - COORDINATE_BIAS,
    y - COORDINATE_BIAS,
    z - COORDINATE_BIAS,
  ] as const;
}

export function compare(a: VoxelKey, b: VoxelKey): -1 | 0 | 1 {
  if (a < b) {
    return -1;
  }

  if (a > b) {
    return 1;
  }

  return 0;
}

export function boundsCheck(x: number, y: number, z: number): boolean {
  return (
    coordinateStatus(x) === "valid" &&
    coordinateStatus(y) === "valid" &&
    coordinateStatus(z) === "valid"
  );
}

export function neighbor(
  key: VoxelKey,
  axis: "x" | "y" | "z",
  delta: number,
): Result<VoxelKey, PackedIntError> {
  if (!Number.isSafeInteger(delta)) {
    return err({
      code: "invalid_delta",
      value: delta,
    });
  }

  if (delta === 0) {
    return ok(key);
  }

  const [x, y, z] = unpack(key);
  let nextX = x;
  let nextY = y;
  let nextZ = z;
  let nextValue: number;

  switch (axis) {
    case "x":
      nextValue = x + delta;
      nextX = nextValue;
      break;
    case "y":
      nextValue = y + delta;
      nextY = nextValue;
      break;
    case "z":
      nextValue = z + delta;
      nextZ = nextValue;
      break;
    default: {
      const unreachable: never = axis;

      throw new Error(`Unsupported axis: ${String(unreachable)}`);
    }
  }

  // The moved axis is the only coordinate that can fail: the other two come from
  // a valid `VoxelKey`. A sum that leaves the safe integer range still reports
  // `coordinate_out_of_range`, not `invalid_coordinate`, because both inputs the
  // caller supplied (`key`, `delta`) were valid.
  if (coordinateStatus(nextValue) !== "valid") {
    return err({
      code: "coordinate_out_of_range",
      axis,
      value: nextValue,
      min: MIN_COORDINATE,
      max: MAX_COORDINATE,
    });
  }

  return ok(computeKey(nextX, nextY, nextZ));
}
