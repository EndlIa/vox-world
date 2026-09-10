export type Vec3 = Readonly<{
  x: number;
  y: number;
  z: number;
}>;

export type Mat4 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export type Quat = Readonly<{
  x: number;
  y: number;
  z: number;
  w: number;
}> & {
  readonly __brand: "Quat";
};

export type Plane = Readonly<{
  normal: Vec3;
  constant: number;
}> & {
  readonly __brand: "Plane";
};

export type Aabb =
  | Readonly<{ isEmpty: true }>
  | Readonly<{ isEmpty: false; min: Vec3; max: Vec3 }>;

export type Ray = Readonly<{
  origin: Vec3;
  direction: Vec3;
}>;

export const EPSILON = 1e-6;

export const VEC3_ZERO: Vec3 = { x: 0, y: 0, z: 0 };

export const MAT4_IDENTITY: Mat4 = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

export const QUAT_IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 } as Quat;

export const EMPTY_AABB: Aabb = { isEmpty: true };

export function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }

  if (value > max) {
    return max;
  }

  return value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpClamped(a: number, b: number, t: number): number {
  return lerp(a, b, clamp(t, 0, 1));
}

export function smoothstep(t: number): number {
  const clamped = clamp(t, 0, 1);

  return clamped * clamped * (3 - 2 * clamped);
}

export function approximatelyEqual(
  a: number,
  b: number,
  epsilon = EPSILON,
): boolean {
  return Math.abs(a - b) <= epsilon;
}

export function vec3Add(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
    z: a.z + b.z,
  };
}

export function vec3Subtract(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  };
}

export function vec3Scale(vector: Vec3, scalar: number): Vec3 {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
    z: vector.z * scalar,
  };
}

export function vec3Dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function vec3Cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function vec3LengthSquared(vector: Vec3): number {
  return vec3Dot(vector, vector);
}

export function vec3Length(vector: Vec3): number {
  return Math.sqrt(vec3LengthSquared(vector));
}

export function vec3Distance(a: Vec3, b: Vec3): number {
  return vec3Length(vec3Subtract(a, b));
}

/**
 * Largest absolute component of a vector.
 *
 * Used as the zero-vector test in the normalization helpers instead of the
 * vector length: the length comes from squared components, which overflow to
 * `Infinity` for huge finite inputs and underflow to `0` for tiny finite
 * inputs, while the largest absolute component stays finite and nonzero for
 * every finite nonzero vector.
 */
function vec3MaxAbsComponent(vector: Vec3): number {
  return Math.max(Math.abs(vector.x), Math.abs(vector.y), Math.abs(vector.z));
}

/**
 * Inverse length of components already divided by their largest absolute value:
 * `1 / sqrt(x² + y² + z² + w²)`.
 *
 * Every normalizing constructor scales by the largest absolute component first,
 * which keeps the components inside `[-1, 1]` so this squared sum cannot
 * overflow for any finite nonzero input; that is what preserves the unit
 * postcondition at `1e200` and `1e-200` magnitudes. Callers exclude the zero
 * input before dividing.
 */
function inverseScaledLength(
  x: number,
  y: number,
  z: number,
  w: number,
): number {
  return 1 / Math.sqrt(x * x + y * y + z * z + w * w);
}

/**
 * Unit vector, or `null` for the zero vector.
 *
 * `vec3Normalize` maps that degenerate input to `VEC3_ZERO`; the constructors
 * that must report it as `null` share this path instead of testing for zero a
 * second time.
 */
function normalizeOrNull(vector: Vec3): Vec3 | null {
  const maxComponent = vec3MaxAbsComponent(vector);

  if (maxComponent === 0) {
    return null;
  }

  const scaledX = vector.x / maxComponent;
  const scaledY = vector.y / maxComponent;
  const scaledZ = vector.z / maxComponent;
  const inverse = inverseScaledLength(scaledX, scaledY, scaledZ, 0);

  return {
    x: scaledX * inverse,
    y: scaledY * inverse,
    z: scaledZ * inverse,
  };
}

export function vec3Normalize(vector: Vec3): Vec3 {
  return normalizeOrNull(vector) ?? VEC3_ZERO;
}

export function vec3Lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t),
  };
}

export function vec3LerpClamped(a: Vec3, b: Vec3, t: number): Vec3 {
  return vec3Lerp(a, b, clamp(t, 0, 1));
}

export function vec3Equals(
  a: Vec3,
  b: Vec3,
  epsilon = EPSILON,
): boolean {
  return (
    approximatelyEqual(a.x, b.x, epsilon) &&
    approximatelyEqual(a.y, b.y, epsilon) &&
    approximatelyEqual(a.z, b.z, epsilon)
  );
}

export function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const [
    a00, a01, a02, a03,
    a10, a11, a12, a13,
    a20, a21, a22, a23,
    a30, a31, a32, a33,
  ] = a;
  const [
    b00, b01, b02, b03,
    b10, b11, b12, b13,
    b20, b21, b22, b23,
    b30, b31, b32, b33,
  ] = b;

  return [
    a00 * b00 + a10 * b01 + a20 * b02 + a30 * b03,
    a01 * b00 + a11 * b01 + a21 * b02 + a31 * b03,
    a02 * b00 + a12 * b01 + a22 * b02 + a32 * b03,
    a03 * b00 + a13 * b01 + a23 * b02 + a33 * b03,
    a00 * b10 + a10 * b11 + a20 * b12 + a30 * b13,
    a01 * b10 + a11 * b11 + a21 * b12 + a31 * b13,
    a02 * b10 + a12 * b11 + a22 * b12 + a32 * b13,
    a03 * b10 + a13 * b11 + a23 * b12 + a33 * b13,
    a00 * b20 + a10 * b21 + a20 * b22 + a30 * b23,
    a01 * b20 + a11 * b21 + a21 * b22 + a31 * b23,
    a02 * b20 + a12 * b21 + a22 * b22 + a32 * b23,
    a03 * b20 + a13 * b21 + a23 * b22 + a33 * b23,
    a00 * b30 + a10 * b31 + a20 * b32 + a30 * b33,
    a01 * b30 + a11 * b31 + a21 * b32 + a31 * b33,
    a02 * b30 + a12 * b31 + a22 * b32 + a32 * b33,
    a03 * b30 + a13 * b31 + a23 * b32 + a33 * b33,
  ];
}

export function mat4Compose(
  position: Vec3,
  rotation: Quat,
  scale: Vec3,
): Mat4 {
  const matrix = quatToMat4(rotation);

  return [
    matrix[0] * scale.x,
    matrix[1] * scale.x,
    matrix[2] * scale.x,
    0,
    matrix[4] * scale.y,
    matrix[5] * scale.y,
    matrix[6] * scale.y,
    0,
    matrix[8] * scale.z,
    matrix[9] * scale.z,
    matrix[10] * scale.z,
    0,
    position.x,
    position.y,
    position.z,
    1,
  ];
}

export function mat4Invert(matrix: Mat4): Mat4 | null {
  const [
    n11, n21, n31, n41,
    n12, n22, n32, n42,
    n13, n23, n33, n43,
    n14, n24, n34, n44,
  ] = matrix;

  const t11 =
    n23 * n34 * n42 -
    n24 * n33 * n42 +
    n24 * n32 * n43 -
    n22 * n34 * n43 -
    n23 * n32 * n44 +
    n22 * n33 * n44;
  const t12 =
    n14 * n33 * n42 -
    n13 * n34 * n42 -
    n14 * n32 * n43 +
    n12 * n34 * n43 +
    n13 * n32 * n44 -
    n12 * n33 * n44;
  const t13 =
    n13 * n24 * n42 -
    n14 * n23 * n42 +
    n14 * n22 * n43 -
    n12 * n24 * n43 -
    n13 * n22 * n44 +
    n12 * n23 * n44;
  const t14 =
    n14 * n23 * n32 -
    n13 * n24 * n32 -
    n14 * n22 * n33 +
    n12 * n24 * n33 +
    n13 * n22 * n34 -
    n12 * n23 * n34;

  const determinant = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14;

  if (determinant === 0) {
    return null;
  }

  const determinantInverse = 1 / determinant;

  return [
    t11 * determinantInverse,
    (n24 * n33 * n41 -
      n23 * n34 * n41 -
      n24 * n31 * n43 +
      n21 * n34 * n43 +
      n23 * n31 * n44 -
      n21 * n33 * n44) *
      determinantInverse,
    (n22 * n34 * n41 -
      n24 * n32 * n41 +
      n24 * n31 * n42 -
      n21 * n34 * n42 -
      n22 * n31 * n44 +
      n21 * n32 * n44) *
      determinantInverse,
    (n23 * n32 * n41 -
      n22 * n33 * n41 -
      n23 * n31 * n42 +
      n21 * n33 * n42 +
      n22 * n31 * n43 -
      n21 * n32 * n43) *
      determinantInverse,
    t12 * determinantInverse,
    (n13 * n34 * n41 -
      n14 * n33 * n41 +
      n14 * n31 * n43 -
      n11 * n34 * n43 -
      n13 * n31 * n44 +
      n11 * n33 * n44) *
      determinantInverse,
    (n14 * n32 * n41 -
      n12 * n34 * n41 -
      n14 * n31 * n42 +
      n11 * n34 * n42 +
      n12 * n31 * n44 -
      n11 * n32 * n44) *
      determinantInverse,
    (n12 * n33 * n41 -
      n13 * n32 * n41 +
      n13 * n31 * n42 -
      n11 * n33 * n42 -
      n12 * n31 * n43 +
      n11 * n32 * n43) *
      determinantInverse,
    t13 * determinantInverse,
    (n14 * n23 * n41 -
      n13 * n24 * n41 -
      n14 * n21 * n43 +
      n11 * n24 * n43 +
      n13 * n21 * n44 -
      n11 * n23 * n44) *
      determinantInverse,
    (n12 * n24 * n41 -
      n14 * n22 * n41 +
      n14 * n21 * n42 -
      n11 * n24 * n42 -
      n12 * n21 * n44 +
      n11 * n22 * n44) *
      determinantInverse,
    (n13 * n22 * n41 -
      n12 * n23 * n41 -
      n13 * n21 * n42 +
      n11 * n23 * n42 +
      n12 * n21 * n43 -
      n11 * n22 * n43) *
      determinantInverse,
    t14 * determinantInverse,
    (n13 * n24 * n31 -
      n14 * n23 * n31 +
      n14 * n21 * n33 -
      n11 * n24 * n33 -
      n13 * n21 * n34 +
      n11 * n23 * n34) *
      determinantInverse,
    (n14 * n22 * n31 -
      n12 * n24 * n31 -
      n14 * n21 * n32 +
      n11 * n24 * n32 +
      n12 * n21 * n34 -
      n11 * n22 * n34) *
      determinantInverse,
    (n12 * n23 * n31 -
      n13 * n22 * n31 +
      n13 * n21 * n32 -
      n11 * n23 * n32 -
      n12 * n21 * n33 +
      n11 * n22 * n33) *
      determinantInverse,
  ];
}

export function mat4TransformPoint(matrix: Mat4, point: Vec3): Vec3 {
  const { x, y, z } = point;
  const inverseW =
    1 /
    (matrix[3] * x +
      matrix[7] * y +
      matrix[11] * z +
      matrix[15]);

  return {
    x:
      (matrix[0] * x +
        matrix[4] * y +
        matrix[8] * z +
        matrix[12]) *
      inverseW,
    y:
      (matrix[1] * x +
        matrix[5] * y +
        matrix[9] * z +
        matrix[13]) *
      inverseW,
    z:
      (matrix[2] * x +
        matrix[6] * y +
        matrix[10] * z +
        matrix[14]) *
      inverseW,
  };
}

export function mat4TransformDirection(
  matrix: Mat4,
  direction: Vec3,
): Vec3 {
  const { x, y, z } = direction;

  return {
    x: matrix[0] * x + matrix[4] * y + matrix[8] * z,
    y: matrix[1] * x + matrix[5] * y + matrix[9] * z,
    z: matrix[2] * x + matrix[6] * y + matrix[10] * z,
  };
}

export function mat4Equals(
  a: Mat4,
  b: Mat4,
  epsilon = EPSILON,
): boolean {
  for (let index = 0; index < 16; index += 1) {
    const aValue = a[index];
    const bValue = b[index];

    if (
      aValue === undefined ||
      bValue === undefined ||
      !approximatelyEqual(aValue, bValue, epsilon)
    ) {
      return false;
    }
  }

  return true;
}

export function quatNormalize(
  rotation: Readonly<{ x: number; y: number; z: number; w: number }>,
): Quat {
  const maxComponent = Math.max(
    vec3MaxAbsComponent(rotation),
    Math.abs(rotation.w),
  );

  if (maxComponent === 0) {
    return QUAT_IDENTITY;
  }

  const scaledX = rotation.x / maxComponent;
  const scaledY = rotation.y / maxComponent;
  const scaledZ = rotation.z / maxComponent;
  const scaledW = rotation.w / maxComponent;
  const inverse = inverseScaledLength(scaledX, scaledY, scaledZ, scaledW);

  return {
    x: scaledX * inverse,
    y: scaledY * inverse,
    z: scaledZ * inverse,
    w: scaledW * inverse,
  } as Quat;
}

export function quatMultiply(a: Quat, b: Quat): Quat {
  return {
    x: a.x * b.w + a.w * b.x + a.y * b.z - a.z * b.y,
    y: a.y * b.w + a.w * b.y + a.z * b.x - a.x * b.z,
    z: a.z * b.w + a.w * b.z + a.x * b.y - a.y * b.x,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  } as Quat;
}

export function quatConjugate(rotation: Quat): Quat {
  return {
    x: -rotation.x,
    y: -rotation.y,
    z: -rotation.z,
    w: rotation.w,
  } as Quat;
}

export function quatFromAxisAngle(
  axis: Vec3,
  radians: number,
): Quat | null {
  const normalizedAxis = normalizeOrNull(axis);

  if (normalizedAxis === null) {
    return null;
  }

  const halfRadians = radians / 2;
  const sine = Math.sin(halfRadians);

  return {
    x: normalizedAxis.x * sine,
    y: normalizedAxis.y * sine,
    z: normalizedAxis.z * sine,
    w: Math.cos(halfRadians),
  } as Quat;
}

export function quatToMat4(rotation: Quat): Mat4 {
  const { x, y, z, w } = rotation;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;

  return [
    1 - (yy + zz),
    xy + wz,
    xz - wy,
    0,
    xy - wz,
    1 - (xx + zz),
    yz + wx,
    0,
    xz + wy,
    yz - wx,
    1 - (xx + yy),
    0,
    0,
    0,
    0,
    1,
  ];
}

export function quatRotateVec3(rotation: Quat, vector: Vec3): Vec3 {
  const quaternionVector = {
    x: rotation.x,
    y: rotation.y,
    z: rotation.z,
  };
  const firstCross = vec3Cross(quaternionVector, vector);
  const secondCross = vec3Cross(quaternionVector, firstCross);

  return {
    x: vector.x + 2 * (rotation.w * firstCross.x + secondCross.x),
    y: vector.y + 2 * (rotation.w * firstCross.y + secondCross.y),
    z: vector.z + 2 * (rotation.w * firstCross.z + secondCross.z),
  };
}

export function quatSlerp(a: Quat, b: Quat, t: number): Quat {
  let targetX = b.x;
  let targetY = b.y;
  let targetZ = b.z;
  let targetW = b.w;
  let cosine =
    a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;

  if (cosine < 0) {
    cosine = -cosine;
    targetX = -targetX;
    targetY = -targetY;
    targetZ = -targetZ;
    targetW = -targetW;
  }

  if (cosine > 1) {
    cosine = 1;
  }

  if (1 - cosine <= EPSILON) {
    return quatNormalize({
      x: lerp(a.x, targetX, t),
      y: lerp(a.y, targetY, t),
      z: lerp(a.z, targetZ, t),
      w: lerp(a.w, targetW, t),
    });
  }

  const angle = Math.acos(cosine);
  const sine = Math.sin(angle);
  const weightA = Math.sin((1 - t) * angle) / sine;
  const weightB = Math.sin(t * angle) / sine;

  return quatNormalize({
    x: a.x * weightA + targetX * weightB,
    y: a.y * weightA + targetY * weightB,
    z: a.z * weightA + targetZ * weightB,
    w: a.w * weightA + targetW * weightB,
  });
}

export function quatEquals(
  a: Quat,
  b: Quat,
  epsilon = EPSILON,
): boolean {
  return (
    approximatelyEqual(a.x, b.x, epsilon) &&
    approximatelyEqual(a.y, b.y, epsilon) &&
    approximatelyEqual(a.z, b.z, epsilon) &&
    approximatelyEqual(a.w, b.w, epsilon)
  );
}

export function planeNormalize(
  plane: Readonly<{ normal: Vec3; constant: number }>,
): Plane | null {
  const maxComponent = vec3MaxAbsComponent(plane.normal);

  if (maxComponent === 0) {
    return null;
  }

  const scaledX = plane.normal.x / maxComponent;
  const scaledY = plane.normal.y / maxComponent;
  const scaledZ = plane.normal.z / maxComponent;
  const inverse = inverseScaledLength(scaledX, scaledY, scaledZ, 0);

  // |normal| = maxComponent * scaledLength, so scaling the constant by both
  // factors keeps it relative to the unit normal without overflow.
  return {
    normal: {
      x: scaledX * inverse,
      y: scaledY * inverse,
      z: scaledZ * inverse,
    },
    constant: (plane.constant * inverse) / maxComponent,
  } as Plane;
}

export function planeFromPointNormal(
  point: Vec3,
  normal: Vec3,
): Plane | null {
  const normalizedNormal = normalizeOrNull(normal);

  if (normalizedNormal === null) {
    return null;
  }

  return {
    normal: normalizedNormal,
    constant: -vec3Dot(normalizedNormal, point),
  } as Plane;
}

export function planeDistanceToPoint(plane: Plane, point: Vec3): number {
  return vec3Dot(plane.normal, point) + plane.constant;
}

export function planeProjectPoint(plane: Plane, point: Vec3): Vec3 {
  const distance = planeDistanceToPoint(plane, point);

  return vec3Subtract(point, vec3Scale(plane.normal, distance));
}

export function planeIntersectRay(
  ray: Ray,
  plane: Plane,
  tMax?: number,
): number | null {
  const denominator = vec3Dot(plane.normal, ray.direction);

  if (denominator === 0) {
    return null;
  }

  const t = -planeDistanceToPoint(plane, ray.origin) / denominator;

  if (t < 0 || (tMax !== undefined && t > tMax)) {
    return null;
  }

  return t;
}

export function aabbFromPoints(points: readonly Vec3[]): Aabb {
  let initialized = false;
  let minX = 0;
  let minY = 0;
  let minZ = 0;
  let maxX = 0;
  let maxY = 0;
  let maxZ = 0;

  for (const point of points) {
    if (!initialized) {
      minX = point.x;
      minY = point.y;
      minZ = point.z;
      maxX = point.x;
      maxY = point.y;
      maxZ = point.z;
      initialized = true;
      continue;
    }

    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    minZ = Math.min(minZ, point.z);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
    maxZ = Math.max(maxZ, point.z);
  }

  if (!initialized) {
    return EMPTY_AABB;
  }

  return {
    isEmpty: false,
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
  };
}

export function aabbUnion(a: Aabb, b: Aabb): Aabb {
  if (a.isEmpty) {
    return b;
  }

  if (b.isEmpty) {
    return a;
  }

  return {
    isEmpty: false,
    min: {
      x: Math.min(a.min.x, b.min.x),
      y: Math.min(a.min.y, b.min.y),
      z: Math.min(a.min.z, b.min.z),
    },
    max: {
      x: Math.max(a.max.x, b.max.x),
      y: Math.max(a.max.y, b.max.y),
      z: Math.max(a.max.z, b.max.z),
    },
  };
}

export function aabbExpand(aabb: Aabb, point: Vec3): Aabb {
  if (aabb.isEmpty) {
    return {
      isEmpty: false,
      min: { x: point.x, y: point.y, z: point.z },
      max: { x: point.x, y: point.y, z: point.z },
    };
  }

  return {
    isEmpty: false,
    min: {
      x: Math.min(aabb.min.x, point.x),
      y: Math.min(aabb.min.y, point.y),
      z: Math.min(aabb.min.z, point.z),
    },
    max: {
      x: Math.max(aabb.max.x, point.x),
      y: Math.max(aabb.max.y, point.y),
      z: Math.max(aabb.max.z, point.z),
    },
  };
}

export function aabbContainsPoint(
  aabb: Aabb,
  point: Vec3,
  epsilon = EPSILON,
): boolean {
  if (aabb.isEmpty) {
    return false;
  }

  return (
    point.x >= aabb.min.x - epsilon &&
    point.x <= aabb.max.x + epsilon &&
    point.y >= aabb.min.y - epsilon &&
    point.y <= aabb.max.y + epsilon &&
    point.z >= aabb.min.z - epsilon &&
    point.z <= aabb.max.z + epsilon
  );
}

export function aabbIntersects(
  a: Aabb,
  b: Aabb,
  epsilon = EPSILON,
): boolean {
  if (a.isEmpty || b.isEmpty) {
    return false;
  }

  return (
    a.min.x <= b.max.x + epsilon &&
    a.max.x + epsilon >= b.min.x &&
    a.min.y <= b.max.y + epsilon &&
    a.max.y + epsilon >= b.min.y &&
    a.min.z <= b.max.z + epsilon &&
    a.max.z + epsilon >= b.min.z
  );
}

export function aabbCenter(aabb: Aabb): Vec3 | null {
  if (aabb.isEmpty) {
    return null;
  }

  return {
    x: (aabb.min.x + aabb.max.x) / 2,
    y: (aabb.min.y + aabb.max.y) / 2,
    z: (aabb.min.z + aabb.max.z) / 2,
  };
}

export function aabbSize(aabb: Aabb): Vec3 | null {
  if (aabb.isEmpty) {
    return null;
  }

  return {
    x: aabb.max.x - aabb.min.x,
    y: aabb.max.y - aabb.min.y,
    z: aabb.max.z - aabb.min.z,
  };
}

export function rayIntersectAabb(
  ray: Ray,
  aabb: Aabb,
  tMax?: number,
): number | null {
  if (aabb.isEmpty) {
    return null;
  }

  let minimum = -Infinity;
  let maximum = Infinity;

  const updateSlab = (
    origin: number,
    direction: number,
    min: number,
    max: number,
  ): boolean => {
    if (direction === 0) {
      return origin >= min && origin <= max;
    }

    const inverseDirection = 1 / direction;
    let near = (min - origin) * inverseDirection;
    let far = (max - origin) * inverseDirection;

    if (near > far) {
      const swap = near;
      near = far;
      far = swap;
    }

    minimum = Math.max(minimum, near);
    maximum = Math.min(maximum, far);

    return minimum <= maximum;
  };

  if (
    !updateSlab(
      ray.origin.x,
      ray.direction.x,
      aabb.min.x,
      aabb.max.x,
    ) ||
    !updateSlab(
      ray.origin.y,
      ray.direction.y,
      aabb.min.y,
      aabb.max.y,
    ) ||
    !updateSlab(
      ray.origin.z,
      ray.direction.z,
      aabb.min.z,
      aabb.max.z,
    ) ||
    maximum < 0
  ) {
    return null;
  }

  const result = minimum >= 0 ? minimum : maximum;

  if (tMax !== undefined && result > tMax) {
    return null;
  }

  return result;
}
