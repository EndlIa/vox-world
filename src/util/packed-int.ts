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

const COORDINATE_BITS = 65536;
const COORDINATE_Y_AND_Z_BITS = 4294967296;

function isCoordinate(value: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    value >= MIN_COORDINATE &&
    value <= MAX_COORDINATE
  );
}

function validateCoordinate(
  value: number,
  axis: "x" | "y" | "z",
): PackedIntError | undefined {
  if (!Number.isSafeInteger(value)) {
    return {
      code: "invalid_coordinate",
      axis,
      value,
    };
  }

  if (value < MIN_COORDINATE || value > MAX_COORDINATE) {
    return {
      code: "coordinate_out_of_range",
      axis,
      value,
      min: MIN_COORDINATE,
      max: MAX_COORDINATE,
    };
  }

  return undefined;
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

  return ok(
    (((x + 32768) * COORDINATE_BITS + (y + 32768)) * COORDINATE_BITS +
      (z + 32768)) as VoxelKey,
  );
}

export function unpack(
  key: VoxelKey,
): readonly [number, number, number] {
  const z = key % COORDINATE_BITS;
  const y = Math.floor(key / COORDINATE_BITS) % COORDINATE_BITS;
  const x = Math.floor(key / COORDINATE_Y_AND_Z_BITS) % COORDINATE_BITS;

  return [
    x - 32768,
    y - 32768,
    z - 32768,
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
  return isCoordinate(x) && isCoordinate(y) && isCoordinate(z);
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

  if (!boundsCheck(nextX, nextY, nextZ)) {
    return err({
      code: "coordinate_out_of_range",
      axis,
      value: nextValue,
      min: MIN_COORDINATE,
      max: MAX_COORDINATE,
    });
  }

  return pack(nextX, nextY, nextZ);
}
