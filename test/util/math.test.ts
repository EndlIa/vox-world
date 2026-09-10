import { describe, expect, expectTypeOf, it } from "vitest";
import * as THREE from "three";

import * as math from "../../src/util/math";

// The contract treats a zero axis as degenerate (returns null). Every case here
// uses a non-zero axis; the zero axis has its own regression test.
function axisRotation(axis: math.Vec3, radians: number): math.Quat {
  const rotation = math.quatFromAxisAngle(axis, radians);

  if (rotation === null) {
    throw new Error(`Expected a non-zero axis, got ${JSON.stringify(axis)}`);
  }

  return rotation;
}

// The contract treats a zero normal as degenerate (returns null); every normal
// used in this file is non-zero.
function unitPlane(normal: math.Vec3, constant: number): math.Plane {
  const plane = math.planeNormalize({ normal, constant });

  if (plane === null) {
    throw new Error(`Expected a non-zero normal, got ${JSON.stringify(normal)}`);
  }

  return plane;
}

describe("math scalar functions", () => {
  it("clamps, interpolates, and smooths values", () => {
    expect(math.clamp(-1, 0, 10)).toBe(0);
    expect(math.clamp(4, 0, 10)).toBe(4);
    expect(math.clamp(11, 0, 10)).toBe(10);
    expect(math.lerp(10, 20, 1.5)).toBe(25);
    expect(math.lerpClamped(10, 20, 1.5)).toBe(20);
    expect(math.smoothstep(-1)).toBe(0);
    expect(math.smoothstep(0.5)).toBe(0.5);
    expect(math.smoothstep(2)).toBe(1);
  });

  it("compares numbers with an optional epsilon", () => {
    expect(math.approximatelyEqual(1, 1 + math.EPSILON)).toBe(true);
    expect(math.approximatelyEqual(1, 1.001)).toBe(false);
    expect(math.approximatelyEqual(1, 1.001, 0.001)).toBe(true);
  });
});

describe("vec3", () => {
  it("performs vector arithmetic", () => {
    const a = { x: 1, y: 2, z: 3 };
    const b = { x: 4, y: 5, z: 6 };

    expect(math.vec3Add(a, b)).toEqual({ x: 5, y: 7, z: 9 });
    expect(math.vec3Subtract(b, a)).toEqual({ x: 3, y: 3, z: 3 });
    expect(math.vec3Scale(a, 2)).toEqual({ x: 2, y: 4, z: 6 });
    expect(math.vec3Dot(a, b)).toBe(32);
    expect(math.vec3Cross(a, b)).toEqual({ x: -3, y: 6, z: -3 });
  });

  it("measures and normalizes vectors", () => {
    const vector = { x: 3, y: 4, z: 0 };

    expect(math.vec3LengthSquared(vector)).toBe(25);
    expect(math.vec3Length(vector)).toBe(5);
    expect(math.vec3Distance(vector, math.VEC3_ZERO)).toBe(5);
    const normalized = math.vec3Normalize(vector);

    expect(normalized.x).toBeCloseTo(0.6);
    expect(normalized.y).toBeCloseTo(0.8);
    expect(normalized.z).toBe(0);
    expect(math.vec3Normalize(math.VEC3_ZERO)).toBe(math.VEC3_ZERO);
  });

  it("interpolates and compares vectors", () => {
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 10, y: 20, z: 30 };

    expect(math.vec3Lerp(a, b, 0.5)).toEqual({ x: 5, y: 10, z: 15 });
    expect(math.vec3LerpClamped(a, b, 2)).toEqual(b);
    expect(math.vec3Equals(a, { x: math.EPSILON, y: 0, z: 0 })).toBe(
      true,
    );
    expect(math.vec3Equals(a, { x: 0.001, y: 0, z: 0 })).toBe(false);
  });

  it("keeps the unit postcondition at extreme finite magnitudes", () => {
    expect(math.vec3Normalize({ x: 1e200, y: 0, z: 0 })).toEqual({
      x: 1,
      y: 0,
      z: 0,
    });
    expect(math.vec3Normalize({ x: 1e-200, y: 0, z: 0 })).toEqual({
      x: 1,
      y: 0,
      z: 0,
    });

    const diagonal = math.vec3Normalize({ x: 1e200, y: 1e200, z: 0 });

    expect(math.vec3Length(diagonal)).toBeCloseTo(1, 15);
    expect(diagonal.x).toBeCloseTo(Math.SQRT1_2, 15);
    expect(diagonal.y).toBeCloseTo(Math.SQRT1_2, 15);
  });
});

describe("mat4", () => {
  const translation = (x: number, y: number, z: number): math.Mat4 => [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    x, y, z, 1,
  ];

  const scale = (x: number, y: number, z: number): math.Mat4 => [
    x, 0, 0, 0,
    0, y, 0, 0,
    0, 0, z, 0,
    0, 0, 0, 1,
  ];

  it("multiplies column-major matrices as A times B", () => {
    const matrix = math.mat4Multiply(
      translation(1, 2, 3),
      scale(2, 3, 4),
    );

    expect(math.mat4TransformPoint(matrix, { x: 1, y: 1, z: 1 })).toEqual({
      x: 3,
      y: 5,
      z: 7,
    });
  });

  it("composes translation, rotation, and scale", () => {
    const rotation = axisRotation(
      { x: 0, y: 0, z: 1 },
      Math.PI / 2,
    );
    const matrix = math.mat4Compose(
      { x: 1, y: 2, z: 3 },
      rotation,
      { x: 2, y: 1, z: 1 },
    );
    const transformed = math.mat4TransformPoint(matrix, {
      x: 1,
      y: 0,
      z: 0,
    });

    expect(transformed.x).toBeCloseTo(1);
    expect(transformed.y).toBeCloseTo(4);
    expect(transformed.z).toBeCloseTo(3);
  });

  it("inverts matrices and rejects singular matrices", () => {
    const matrix = math.mat4Compose(
      { x: 3, y: -2, z: 5 },
      axisRotation(
        { x: 1, y: 2, z: 3 },
        Math.PI / 3,
      ),
      { x: 2, y: 3, z: 4 },
    );
    const inverse = math.mat4Invert(matrix);

    expect(inverse).not.toBeNull();

    if (inverse !== null) {
      expect(math.mat4Equals(math.mat4Multiply(matrix, inverse), math.MAT4_IDENTITY)).toBe(
        true,
      );
    }

    expect(math.mat4Invert(scale(1, 0, 1))).toBeNull();
  });

  it("transforms points and directions differently", () => {
    const matrix = translation(10, 20, 30);

    expect(
      math.mat4TransformPoint(matrix, { x: 1, y: 2, z: 3 }),
    ).toEqual({ x: 11, y: 22, z: 33 });
    expect(
      math.mat4TransformDirection(matrix, { x: 1, y: 2, z: 3 }),
    ).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("compares all matrix elements", () => {
    expect(math.mat4Equals(math.MAT4_IDENTITY, math.MAT4_IDENTITY)).toBe(
      true,
    );
    expect(
      math.mat4Equals(math.MAT4_IDENTITY, translation(0, 0, 0)),
    ).toBe(true);
    expect(
      math.mat4Equals(math.MAT4_IDENTITY, translation(1, 0, 0)),
    ).toBe(false);
  });
});

describe("quat", () => {
  it("normalizes quaternions and handles zero", () => {
    expect(math.quatNormalize({ x: 0, y: 0, z: 0, w: 0 })).toBe(
      math.QUAT_IDENTITY,
    );
    expect(math.quatNormalize({ x: 0, y: 0, z: 0, w: 2 })).toEqual(
      math.QUAT_IDENTITY,
    );
  });

  it("multiplies and conjugates rotations", () => {
    const quarterTurn = axisRotation(
      { x: 0, y: 0, z: 1 },
      Math.PI / 2,
    );
    const halfTurn = math.quatMultiply(quarterTurn, quarterTurn);
    const rotated = math.quatRotateVec3(halfTurn, {
      x: 1,
      y: 0,
      z: 0,
    });

    expect(rotated.x).toBeCloseTo(-1);
    expect(rotated.y).toBeCloseTo(0);
    expect(rotated.z).toBeCloseTo(0);
    const conjugate = math.quatConjugate(quarterTurn);

    expect(conjugate.x).toBeCloseTo(0);
    expect(conjugate.y).toBeCloseTo(0);
    expect(conjugate.z).toBeCloseTo(-quarterTurn.z);
    expect(conjugate.w).toBeCloseTo(quarterTurn.w);
  });

  it("constructs rotations from normalized axes", () => {
    const rotation = axisRotation(
      { x: 0, y: 0, z: 5 },
      Math.PI / 2,
    );
    const matrix = math.quatToMat4(rotation);
    const rotated = math.quatRotateVec3(rotation, {
      x: 1,
      y: 0,
      z: 0,
    });

    expect(math.mat4TransformPoint(matrix, { x: 1, y: 0, z: 0 })).toEqual(
      rotated,
    );
    expect(rotated.x).toBeCloseTo(0);
    expect(rotated.y).toBeCloseTo(1);
    expect(rotated.z).toBeCloseTo(0);
  });

  it("returns null for a zero axis instead of a non-unit quaternion", () => {
    // The direction is undefined (rule 1); without returning null this would yield
    // a quaternion whose length is not 1 (rule 3).
    expect(math.quatFromAxisAngle(math.VEC3_ZERO, Math.PI / 2)).toBeNull();
  });

  it("keeps branded values as plain serializable data", () => {
    // The brand exists only at the type level. If the factory started writing a
    // `__brand` field, that field would travel through project files and Worker
    // messages, so this must keep it out.
    const quaternion = math.quatNormalize({ x: 1, y: 2, z: 3, w: 4 });
    const plane = unitPlane({ x: 0, y: 2, z: 0 }, -4);

    expect(JSON.parse(JSON.stringify(quaternion))).toEqual({
      x: quaternion.x,
      y: quaternion.y,
      z: quaternion.z,
      w: quaternion.w,
    });
    expect(JSON.parse(JSON.stringify(plane))).toEqual({
      normal: {
        x: plane.normal.x,
        y: plane.normal.y,
        z: plane.normal.z,
      },
      constant: plane.constant,
    });

    const brandedValues: readonly object[] = [
      math.QUAT_IDENTITY,
      math.quatNormalize({ x: 1, y: 2, z: 3, w: 4 }),
      math.quatMultiply(quaternion, quaternion),
      math.quatConjugate(quaternion),
      axisRotation({ x: 0, y: 0, z: 1 }, Math.PI / 2),
      plane,
      unitPlane({ x: 0, y: 0, z: 1 }, -1),
    ];

    for (const value of brandedValues) {
      expect(Object.hasOwn(value, "__brand")).toBe(false);
    }
  });

  it("slerps along the shortest arc", () => {
    const identity = math.QUAT_IDENTITY;
    const longWay = axisRotation(
      { x: 0, y: 0, z: 1 },
      (3 * Math.PI) / 2,
    );
    const halfway = math.quatSlerp(identity, longWay, 0.5);
    const rotated = math.quatRotateVec3(halfway, {
      x: 1,
      y: 0,
      z: 0,
    });

    expect(rotated.x).toBeCloseTo(Math.SQRT1_2);
    expect(rotated.y).toBeCloseTo(-Math.SQRT1_2);
    expect(rotated.z).toBeCloseTo(0);
  });

  it("does not treat opposite quaternions as equal", () => {
    expect(
      math.quatEquals(
        math.QUAT_IDENTITY,
        math.quatNormalize({ x: 0, y: 0, z: 0, w: -1 }),
      ),
    ).toBe(false);
  });

  it("keeps the unit postcondition for extreme finite axes and quaternions", () => {
    const reference = axisRotation({ x: 1, y: 0, z: 0 }, Math.PI / 2);

    expect(axisRotation({ x: 1e200, y: 0, z: 0 }, Math.PI / 2)).toEqual(reference);
    expect(axisRotation({ x: 1e-200, y: 0, z: 0 }, Math.PI / 2)).toEqual(reference);

    expect(math.quatNormalize({ x: 1e200, y: 0, z: 0, w: 0 })).toEqual({
      x: 1,
      y: 0,
      z: 0,
      w: 0,
    });
    expect(math.quatNormalize({ x: 0, y: 0, z: 0, w: 1e200 })).toEqual({
      x: 0,
      y: 0,
      z: 0,
      w: 1,
    });

    const diagonal = math.quatNormalize({ x: 1e200, y: 1e200, z: 0, w: 0 });

    expect(
      Math.hypot(diagonal.x, diagonal.y, diagonal.z, diagonal.w),
    ).toBeCloseTo(1, 15);
  });
});

describe("plane", () => {
  it("normalizes planes and projects points", () => {
    const plane = math.planeNormalize({
      normal: { x: 0, y: 2, z: 0 },
      constant: -4,
    });

    expect(plane).toEqual({
      normal: { x: 0, y: 1, z: 0 },
      constant: -2,
    });

    if (plane !== null) {
      expect(
        math.planeDistanceToPoint(plane, { x: 0, y: 5, z: 0 }),
      ).toBe(3);
      expect(
        math.planeProjectPoint(plane, { x: 4, y: 5, z: 6 }),
      ).toEqual({ x: 4, y: 2, z: 6 });
    }
  });

  it("creates planes from a point and normal", () => {
    expect(
      math.planeFromPointNormal(
        { x: 0, y: 2, z: 0 },
        { x: 0, y: 5, z: 0 },
      ),
    ).toEqual({
      normal: { x: 0, y: 1, z: 0 },
      constant: -2,
    });
    expect(
      math.planeFromPointNormal(
        math.VEC3_ZERO,
        math.VEC3_ZERO,
      ),
    ).toBeNull();
  });

  it("intersects rays with planes", () => {
    const plane = unitPlane({ x: 0, y: 1, z: 0 }, -2);

    expect(
      math.planeIntersectRay(
        {
          origin: { x: 0, y: 5, z: 0 },
          direction: { x: 0, y: -2, z: 0 },
        },
        plane,
      ),
    ).toBe(1.5);
    expect(
      math.planeIntersectRay(
        {
          origin: { x: 0, y: 2, z: 0 },
          direction: { x: 1, y: 0, z: 0 },
        },
        plane,
      ),
    ).toBeNull();
    expect(
      math.planeIntersectRay(
        {
          origin: { x: 0, y: 5, z: 0 },
          direction: { x: 0, y: -1, z: 0 },
        },
        plane,
        3,
      ),
    ).toBe(3);
    expect(
      math.planeIntersectRay(
        {
          origin: { x: 0, y: 5, z: 0 },
          direction: { x: 0, y: -1, z: 0 },
        },
        plane,
        2.9,
      ),
    ).toBeNull();
  });

  it("keeps the unit postcondition for extreme finite planes", () => {
    expect(
      math.planeNormalize({
        normal: { x: 1e200, y: 0, z: 0 },
        constant: 1e200,
      }),
    ).toEqual({
      normal: { x: 1, y: 0, z: 0 },
      constant: 1,
    });

    const fromPoint = math.planeFromPointNormal(
      { x: 0, y: 0, z: 0 },
      { x: 1e200, y: 1e200, z: 0 },
    );

    expect(fromPoint).not.toBeNull();

    if (fromPoint !== null) {
      expect(math.vec3Length(fromPoint.normal)).toBeCloseTo(1, 15);
      expect(fromPoint.normal.x).toBeCloseTo(Math.SQRT1_2, 15);
      expect(fromPoint.normal.y).toBeCloseTo(Math.SQRT1_2, 15);
      expect(fromPoint.constant).toBeCloseTo(0, 15);
    }
  });
});

describe("aabb", () => {
  const bounds: math.Aabb = {
    isEmpty: false,
    min: { x: -1, y: -2, z: -3 },
    max: { x: 1, y: 2, z: 3 },
  };

  it("builds and expands bounds from points", () => {
    expect(math.aabbFromPoints([])).toBe(math.EMPTY_AABB);
    expect(
      math.aabbFromPoints([
        { x: 2, y: -1, z: 4 },
        { x: -3, y: 5, z: 1 },
      ]),
    ).toEqual({
      isEmpty: false,
      min: { x: -3, y: -1, z: 1 },
      max: { x: 2, y: 5, z: 4 },
    });
    expect(
      math.aabbExpand(math.EMPTY_AABB, { x: 1, y: 2, z: 3 }),
    ).toEqual({
      isEmpty: false,
      min: { x: 1, y: 2, z: 3 },
      max: { x: 1, y: 2, z: 3 },
    });
  });

  it("unions bounds and handles empty operands", () => {
    const other: math.Aabb = {
      isEmpty: false,
      min: { x: 0, y: 0, z: 0 },
      max: { x: 4, y: 5, z: 6 },
    };

    expect(math.aabbUnion(math.EMPTY_AABB, other)).toBe(other);
    expect(math.aabbUnion(bounds, math.EMPTY_AABB)).toBe(bounds);
    expect(math.aabbUnion(bounds, other)).toEqual({
      isEmpty: false,
      min: { x: -1, y: -2, z: -3 },
      max: { x: 4, y: 5, z: 6 },
    });
  });

  it("uses closed intervals for containment and intersection", () => {
    expect(
      math.aabbContainsPoint(bounds, { x: 1, y: 2, z: 3 }),
    ).toBe(true);
    expect(
      math.aabbContainsPoint(bounds, { x: 1.001, y: 0, z: 0 }),
    ).toBe(false);
    expect(
      math.aabbContainsPoint(
        bounds,
        { x: 1.001, y: 0, z: 0 },
        0.001,
      ),
    ).toBe(true);
    expect(
      math.aabbIntersects(
        bounds,
        {
          isEmpty: false,
          min: { x: 1.001, y: 0, z: 0 },
          max: { x: 2, y: 1, z: 1 },
        },
      ),
    ).toBe(false);
    expect(
      math.aabbIntersects(
        bounds,
        {
          isEmpty: false,
          min: { x: 1.001, y: 0, z: 0 },
          max: { x: 2, y: 1, z: 1 },
        },
        0.001,
      ),
    ).toBe(true);
    expect(math.aabbIntersects(math.EMPTY_AABB, bounds)).toBe(false);
  });

  it("computes centers and sizes", () => {
    expect(math.aabbCenter(bounds)).toEqual({ x: 0, y: 0, z: 0 });
    expect(math.aabbSize(bounds)).toEqual({ x: 2, y: 4, z: 6 });
    expect(math.aabbCenter(math.EMPTY_AABB)).toBeNull();
    expect(math.aabbSize(math.EMPTY_AABB)).toBeNull();
  });
});

describe("rayIntersectAabb", () => {
  const bounds: math.Aabb = {
    isEmpty: false,
    min: { x: 1, y: -1, z: -1 },
    max: { x: 3, y: 1, z: 1 },
  };

  it("returns the entry parameter for an outside origin", () => {
    expect(
      math.rayIntersectAabb(
        {
          origin: { x: 0, y: 0, z: 0 },
          direction: { x: 2, y: 0, z: 0 },
        },
        bounds,
      ),
    ).toBe(0.5);
  });

  it("returns the exit parameter for an inside origin", () => {
    expect(
      math.rayIntersectAabb(
        {
          origin: { x: 2, y: 0, z: 0 },
          direction: { x: 1, y: 0, z: 0 },
        },
        bounds,
      ),
    ).toBe(1);
  });

  it("counts boundary touches and tMax hits", () => {
    expect(
      math.rayIntersectAabb(
        {
          origin: { x: 0, y: 0, z: 0 },
          direction: { x: 1, y: 0, z: 0 },
        },
        bounds,
        1,
      ),
    ).toBe(1);
    expect(
      math.rayIntersectAabb(
        {
          origin: { x: 0, y: 0, z: 0 },
          direction: { x: 1, y: 0, z: 0 },
        },
        bounds,
        0.999,
      ),
    ).toBeNull();
  });

  it("returns null for misses, backward hits, and empty bounds", () => {
    expect(
      math.rayIntersectAabb(
        {
          origin: { x: 0, y: 0, z: 0 },
          direction: { x: -1, y: 0, z: 0 },
        },
        bounds,
      ),
    ).toBeNull();
    expect(
      math.rayIntersectAabb(
        {
          origin: { x: 0, y: 2, z: 0 },
          direction: { x: 1, y: 0, z: 0 },
        },
        bounds,
      ),
    ).toBeNull();
    expect(
      math.rayIntersectAabb(
        {
          origin: { x: 0, y: 0, z: 0 },
          direction: { x: 1, y: 0, z: 0 },
        },
        math.EMPTY_AABB,
      ),
    ).toBeNull();
  });
});

describe("math constants", () => {
  it("exports the documented identity values", () => {
    expect(math.EPSILON).toBe(1e-6);
    expect(math.VEC3_ZERO).toEqual({ x: 0, y: 0, z: 0 });
    expect(math.MAT4_IDENTITY).toEqual([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]);
    expect(math.QUAT_IDENTITY).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    expect(math.EMPTY_AABB).toEqual({ isEmpty: true });
  });
});

describe("Three.js alignment", () => {
  const sampleVectors: readonly math.Vec3[] = [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 1, y: 2, z: 3 },
    { x: -2, y: 0.5, z: 4 },
    { x: 3, y: -7, z: 0.25 },
    { x: -0.5, y: -1.5, z: 2.5 },
    { x: 10, y: 10, z: 10 },
  ];

  const sampleScalars: readonly number[] = [2, -1.5, 0, 0.25, 7];

  const sampleParameters: readonly number[] = [
    -0.5, 0, 0.25, 0.5, 0.75, 1, 1.5,
  ];

  const identity = new THREE.Quaternion();
  const quarterTurn = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 0, 1),
    Math.PI / 2,
  );
  const halfTurn = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    Math.PI,
  );
  const obliqueTurn = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 2, 3).normalize(),
    2.4,
  );

  const composedA = math.mat4Compose(
    { x: 1, y: -2, z: 3 },
    toMathQuaternion(quarterTurn),
    { x: 2, y: 3, z: 4 },
  );
  const composedB = math.mat4Compose(
    { x: -4, y: 0, z: 0.5 },
    toMathQuaternion(obliqueTurn),
    { x: 0.5, y: 1, z: -2 },
  );
  const rotationMatrix = math.quatToMat4(toMathQuaternion(halfTurn));

  const sampleMatrices: readonly math.Mat4[] = [
    math.MAT4_IDENTITY,
    composedA,
    composedB,
    rotationMatrix,
  ];

  const sampleQuaternions: readonly math.Quat[] = [
    math.QUAT_IDENTITY,
    toMathQuaternion(quarterTurn),
    toMathQuaternion(halfTurn),
    toMathQuaternion(obliqueTurn),
  ];

  const boundsA: math.Aabb = {
    isEmpty: false,
    min: { x: -1, y: -2, z: -3 },
    max: { x: 1, y: 2, z: 3 },
  };
  const boundsB: math.Aabb = {
    isEmpty: false,
    min: { x: 0, y: 0, z: 0 },
    max: { x: 4, y: 5, z: 6 },
  };
  const degenerateBounds: math.Aabb = {
    isEmpty: false,
    min: { x: 2, y: 2, z: 2 },
    max: { x: 2, y: 2, z: 2 },
  };
  const sampleAabbs: readonly math.Aabb[] = [
    math.EMPTY_AABB,
    boundsA,
    boundsB,
    degenerateBounds,
  ];

  const expansionPoints: readonly math.Vec3[] = [
    { x: 0, y: 0, z: 0 },
    { x: 5, y: -5, z: 1.5 },
    { x: 1, y: 2, z: 3 },
  ];

  const probePoints: readonly math.Vec3[] = [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 2, z: 3 },
    { x: -1, y: -2, z: -3 },
    { x: 1.001, y: 0, z: 0 },
    { x: -1.001, y: 0, z: 0 },
    { x: 4, y: 5, z: 6 },
    { x: -4, y: -5, z: -6 },
    { x: 2, y: 2, z: 2 },
  ];

  function toVector(vector: math.Vec3): THREE.Vector3 {
    return new THREE.Vector3(vector.x, vector.y, vector.z);
  }

  function toMathVector(vector: THREE.Vector3): math.Vec3 {
    return { x: vector.x, y: vector.y, z: vector.z };
  }

  function toQuaternion(rotation: math.Quat): THREE.Quaternion {
    return new THREE.Quaternion(
      rotation.x,
      rotation.y,
      rotation.z,
      rotation.w,
    );
  }

  function toMathQuaternion(rotation: THREE.Quaternion): math.Quat {
    return math.quatNormalize({
      x: rotation.x,
      y: rotation.y,
      z: rotation.z,
      w: rotation.w,
    });
  }

  function toMatrix(matrix: math.Mat4): THREE.Matrix4 {
    return new THREE.Matrix4().fromArray(matrix);
  }

  function toBox3(aabb: math.Aabb): THREE.Box3 {
    return aabb.isEmpty
      ? new THREE.Box3().makeEmpty()
      : new THREE.Box3(toVector(aabb.min), toVector(aabb.max));
  }

  function expectVectorsClose(
    actual: math.Vec3,
    expected: THREE.Vector3,
  ): void {
    expect(actual.x).toBeCloseTo(expected.x, 12);
    expect(actual.y).toBeCloseTo(expected.y, 12);
    expect(actual.z).toBeCloseTo(expected.z, 12);
  }

  function expectQuaternionsClose(
    actual: math.Quat,
    expected: THREE.Quaternion,
  ): void {
    expect(actual.x).toBeCloseTo(expected.x, 12);
    expect(actual.y).toBeCloseTo(expected.y, 12);
    expect(actual.z).toBeCloseTo(expected.z, 12);
    expect(actual.w).toBeCloseTo(expected.w, 12);
  }

  function expectMatricesClose(
    actual: math.Mat4,
    expected: THREE.Matrix4,
  ): void {
    for (let index = 0; index < 16; index += 1) {
      expect(actual[index] ?? Number.NaN).toBeCloseTo(
        expected.elements[index] ?? Number.NaN,
        12,
      );
    }
  }

  function expectAabbsClose(actual: math.Aabb, expected: THREE.Box3): void {
    expect(actual.isEmpty).toBe(expected.isEmpty());

    if (actual.isEmpty || expected.isEmpty()) {
      return;
    }

    expectVectorsClose(actual.min, expected.min);
    expectVectorsClose(actual.max, expected.max);
  }

  it("matches Vector3 add, subtract, scale, dot, and cross", () => {
    for (const a of sampleVectors) {
      const threeA = toVector(a);

      for (const b of sampleVectors) {
        const threeB = toVector(b);

        expectVectorsClose(
          math.vec3Add(a, b),
          new THREE.Vector3().addVectors(threeA, threeB),
        );
        expectVectorsClose(
          math.vec3Subtract(a, b),
          new THREE.Vector3().subVectors(threeA, threeB),
        );
        expect(math.vec3Dot(a, b)).toBeCloseTo(threeA.dot(threeB), 12);
        expectVectorsClose(
          math.vec3Cross(a, b),
          new THREE.Vector3().crossVectors(threeA, threeB),
        );
      }

      for (const scalar of sampleScalars) {
        expectVectorsClose(
          math.vec3Scale(a, scalar),
          threeA.clone().multiplyScalar(scalar),
        );
      }
    }
  });

  it("matches Vector3 length, lengthSq, distanceTo, and normalize", () => {
    for (const a of sampleVectors) {
      const threeA = toVector(a);

      expect(math.vec3Length(a)).toBeCloseTo(threeA.length(), 12);
      expect(math.vec3LengthSquared(a)).toBeCloseTo(threeA.lengthSq(), 12);
      expectVectorsClose(math.vec3Normalize(a), threeA.clone().normalize());

      for (const b of sampleVectors) {
        expect(math.vec3Distance(a, b)).toBeCloseTo(
          threeA.distanceTo(toVector(b)),
          12,
        );
      }
    }

    // Zero vector: the contract returns the zero vector, and three's normalize
    // does the same.
    expectVectorsClose(
      math.vec3Normalize(math.VEC3_ZERO),
      new THREE.Vector3().normalize(),
    );
  });

  it("matches Vector3 lerpVectors and clamped interpolation", () => {
    for (const a of sampleVectors) {
      const threeA = toVector(a);

      for (const b of sampleVectors) {
        const threeB = toVector(b);

        for (const t of sampleParameters) {
          expectVectorsClose(
            math.vec3Lerp(a, b, t),
            new THREE.Vector3().lerpVectors(threeA, threeB, t),
          );
          expectVectorsClose(
            math.vec3LerpClamped(a, b, t),
            new THREE.Vector3().lerpVectors(
              threeA,
              threeB,
              THREE.MathUtils.clamp(t, 0, 1),
            ),
          );
        }
      }
    }
  });

  it("matches per-component epsilon equality for vec3Equals", () => {
    const cases: readonly (readonly [math.Vec3, math.Vec3, number])[] = [
      [{ x: 1, y: 2, z: 3 }, { x: 1, y: 2, z: 3 }, math.EPSILON],
      [
        { x: 1, y: 2, z: 3 },
        { x: 1 + 1e-7, y: 2 - 1e-7, z: 3 + 1e-7 },
        math.EPSILON,
      ],
      [{ x: 0, y: 0, z: 0 }, { x: math.EPSILON, y: 0, z: 0 }, math.EPSILON],
      [{ x: 1, y: 2, z: 3 }, { x: 1, y: 2, z: 3.001 }, math.EPSILON],
      [{ x: 1, y: 2, z: 3 }, { x: 1, y: 2, z: 3.001 }, 0.001],
      [{ x: -2, y: 0.5, z: 4 }, { x: -2, y: 0.5, z: 4 }, 0],
    ];

    for (const [a, b, epsilon] of cases) {
      // The per-component delta is computed by three; the epsilon test itself is
      // the semantics the contract pins down.
      const delta = new THREE.Vector3().subVectors(toVector(b), toVector(a));
      const expected =
        Math.abs(delta.x) <= epsilon &&
        Math.abs(delta.y) <= epsilon &&
        Math.abs(delta.z) <= epsilon;

      expect(math.vec3Equals(a, b, epsilon)).toBe(expected);
    }

    // The contract's vec3Equals uses epsilon; THREE.Vector3.equals is exact.
    expect(
      math.vec3Equals({ x: 0, y: 0, z: 0 }, { x: math.EPSILON, y: 0, z: 0 }),
    ).toBe(true);
    expect(
      new THREE.Vector3(0, 0, 0).equals(
        new THREE.Vector3(math.EPSILON, 0, 0),
      ),
    ).toBe(false);
  });

  it("matches Matrix4 multiplication", () => {
    for (const a of sampleMatrices) {
      for (const b of sampleMatrices) {
        expectMatricesClose(
          math.mat4Multiply(a, b),
          new THREE.Matrix4().multiplyMatrices(toMatrix(a), toMatrix(b)),
        );
      }
    }

    // A * B means applying B first, then A.
    const point = { x: 1, y: 2, z: 3 };

    expectVectorsClose(
      math.mat4TransformPoint(math.mat4Multiply(composedA, composedB), point),
      toVector(point)
        .applyMatrix4(toMatrix(composedB))
        .applyMatrix4(toMatrix(composedA)),
    );
  });

  it("matches Matrix4.compose for axis-aligned and oblique transforms", () => {
    const cases: readonly (readonly [
      math.Vec3,
      THREE.Quaternion,
      math.Vec3,
    ])[] = [
      [{ x: 0, y: 0, z: 0 }, identity, { x: 1, y: 1, z: 1 }],
      [{ x: 1, y: 2, z: 3 }, identity, { x: 2, y: 1, z: 1 }],
      [{ x: 1, y: 2, z: 3 }, quarterTurn, { x: 2, y: 1, z: 1 }],
      [{ x: -4, y: 0, z: 0.5 }, obliqueTurn, { x: 0.5, y: 1, z: -2 }],
      [{ x: 0, y: -1.5, z: 7 }, halfTurn, { x: 3, y: 3, z: 3 }],
    ];

    for (const [position, rotation, scale] of cases) {
      const composed = math.mat4Compose(
        position,
        toMathQuaternion(rotation),
        scale,
      );
      const threeComposed = new THREE.Matrix4().compose(
        toVector(position),
        rotation,
        toVector(scale),
      );

      expectMatricesClose(composed, threeComposed);

      // Observe the composition through point transforms, not just element
      // equality.
      const point = new THREE.Vector3(1, -2, 0.5);

      expectVectorsClose(
        math.mat4TransformPoint(composed, toMathVector(point)),
        point.clone().applyMatrix4(threeComposed),
      );
    }
  });

  it("matches Matrix4.invert on composed non-trivial matrices", () => {
    for (const matrix of sampleMatrices) {
      const inverse = math.mat4Invert(matrix);

      expect(inverse).not.toBeNull();

      if (inverse !== null) {
        expectMatricesClose(inverse, toMatrix(matrix).invert());
      }
    }

    const singular: math.Mat4 = [
      1, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];

    // The contract returns null when the matrix is not invertible; three's invert
    // returns an all-zero matrix.
    expect(math.mat4Invert(singular)).toBeNull();
    expect(
      toMatrix(singular)
        .invert()
        .elements.every((value) => value === 0),
    ).toBe(true);
  });

  it("matches Vector3.applyMatrix4 including the perspective divide", () => {
    for (const matrix of sampleMatrices) {
      const threeMatrix = toMatrix(matrix);

      for (const point of sampleVectors) {
        expectVectorsClose(
          math.mat4TransformPoint(matrix, point),
          toVector(point).applyMatrix4(threeMatrix),
        );
      }
    }

    // The perspective matrix makes the homogeneous w differ from 1, so both sides
    // must perform the same perspective divide.
    const perspective = new THREE.Matrix4().makePerspective(
      -1,
      1,
      1,
      -1,
      1,
      10,
    );
    const projected = new THREE.Vector3(0.5, 0.25, -5);
    const homogeneous = new THREE.Vector4(
      projected.x,
      projected.y,
      projected.z,
      1,
    ).applyMatrix4(perspective);

    expect(homogeneous.w).not.toBeCloseTo(1, 12);

    // A perspective matrix cannot be built through the math.ts API; its column-major
    // layout matches THREE.Matrix4.
    const perspectiveMath: math.Mat4 = perspective.elements;

    expectVectorsClose(
      math.mat4TransformPoint(perspectiveMath, toMathVector(projected)),
      projected.clone().applyMatrix4(perspective),
    );
  });

  it("matches the matrix linear part for mat4TransformDirection", () => {
    const axisDirections: readonly math.Vec3[] = [
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 },
    ];
    const directions: readonly math.Vec3[] = [
      ...axisDirections,
      { x: 2, y: -1, z: 3 },
      { x: 0.5, y: 0.5, z: 0.5 },
    ];

    for (const matrix of sampleMatrices) {
      const linear = new THREE.Matrix3().setFromMatrix4(toMatrix(matrix));

      for (const direction of directions) {
        expectVectorsClose(
          math.mat4TransformDirection(matrix, direction),
          toVector(direction).applyMatrix3(linear),
        );
      }
    }

    // Rotation matrix and non-unit directions: compare only the 3x3 linear part
    // (applyMatrix3 does not normalize).
    for (const direction of axisDirections) {
      expectVectorsClose(
        math.mat4TransformDirection(rotationMatrix, direction),
        toVector(direction).transformDirection(toMatrix(rotationMatrix)),
      );
    }

    // The contract states that mat4TransformDirection does not normalize its result;
    // THREE.Vector3.transformDirection normalizes the result.
    expect(
      math.mat4TransformDirection(math.MAT4_IDENTITY, { x: 2, y: 0, z: 0 }),
    ).toEqual({ x: 2, y: 0, z: 0 });
    expect(
      new THREE.Vector3(2, 0, 0)
        .transformDirection(new THREE.Matrix4())
        .toArray(),
    ).toEqual([1, 0, 0]);
  });

  it("matches per-element epsilon equality for mat4Equals", () => {
    const translation = (x: number, y: number, z: number): math.Mat4 => [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      x, y, z, 1,
    ];

    const cases: readonly (readonly [math.Mat4, math.Mat4, number])[] = [
      [math.MAT4_IDENTITY, translation(0, 0, 0), math.EPSILON],
      [math.MAT4_IDENTITY, translation(1e-7, 0, 0), math.EPSILON],
      [math.MAT4_IDENTITY, translation(1e-4, 0, 0), math.EPSILON],
      [composedA, composedA, 0],
      [composedA, composedB, math.EPSILON],
      [composedA, composedA, math.EPSILON],
    ];

    for (const [a, b, epsilon] of cases) {
      // The element deltas come from three's element array; the epsilon comparison
      // is the semantics the contract pins down.
      const aElements = toMatrix(a).elements;
      const bElements = toMatrix(b).elements;
      const expected = aElements.every(
        (value, index) =>
          Math.abs(value - (bElements[index] ?? Number.NaN)) <= epsilon,
      );

      expect(math.mat4Equals(a, b, epsilon)).toBe(expected);
    }
  });

  it("compares quaternions with an epsilon where three compares exactly", () => {
    // vec3Equals, mat4Equals and quatEquals all use EPSILON; three's equals methods
    // compare components exactly, which would make "did this rotation change"
    // almost always true after matrix composition.
    const nudged = math.quatNormalize({ x: 1e-7, y: 0, z: 0, w: 1 });

    expect(math.quatEquals(math.QUAT_IDENTITY, nudged)).toBe(true);
    expect(math.quatEquals(math.QUAT_IDENTITY, nudged, 0)).toBe(false);
    expect(toQuaternion(math.QUAT_IDENTITY).equals(toQuaternion(nudged))).toBe(false);
  });

  it("matches Quaternion axis-angle construction and normalization", () => {
    const axes: readonly math.Vec3[] = [
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: -2, y: 3, z: 0.5 },
    ];
    const angles: readonly number[] = [
      0,
      Math.PI / 6,
      Math.PI / 2,
      Math.PI,
      2 * Math.PI,
      -Math.PI / 3,
    ];

    for (const axis of axes) {
      const unitAxis = toVector(axis).normalize();

      for (const angle of angles) {
        expectQuaternionsClose(
          axisRotation(axis, angle),
          new THREE.Quaternion().setFromAxisAngle(unitAxis, angle),
        );
      }
    }

    // The contract requires quatFromAxisAngle to normalize the axis first;
    // THREE.Quaternion.setFromAxisAngle requires the caller to pass a unit axis.
    const scaledAxis = axisRotation(
      { x: 0, y: 0, z: 5 },
      Math.PI / 2,
    );
    const threeScaledAxis = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 5),
      Math.PI / 2,
    );

    expectQuaternionsClose(
      scaledAxis,
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 0, 1),
        Math.PI / 2,
      ),
    );
    expect(threeScaledAxis.z / scaledAxis.z).toBeCloseTo(5, 12);
    expect(threeScaledAxis.w).toBeCloseTo(scaledAxis.w, 12);

    // Zero axis: this module returns null; three produces a length-0.7071
    // quaternion for the same input, exactly the shape the contract forbids
    // (rule 3), so aligning with it is not an option.
    const threeZeroAxis = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 0),
      Math.PI / 2,
    );

    expect(math.quatFromAxisAngle(math.VEC3_ZERO, Math.PI / 2)).toBeNull();
    expect(
      Math.hypot(
        threeZeroAxis.x,
        threeZeroAxis.y,
        threeZeroAxis.z,
        threeZeroAxis.w,
      ),
    ).not.toBeCloseTo(1, 6);

    const unnormalized = [
      { x: 0, y: 0, z: 0, w: 2 },
      { x: 1, y: 2, z: 3, w: 4 },
      { x: -3, y: 0.5, z: 0, w: 0.25 },
    ];

    for (const rotation of unnormalized) {
      expectQuaternionsClose(
        math.quatNormalize(rotation),
        new THREE.Quaternion(
          rotation.x,
          rotation.y,
          rotation.z,
          rotation.w,
        ).normalize(),
      );
    }

    expect(math.quatNormalize({ x: 0, y: 0, z: 0, w: 0 })).toBe(
      math.QUAT_IDENTITY,
    );
  });

  it("matches Quaternion multiplication and conjugation", () => {
    for (const a of sampleQuaternions) {
      expectQuaternionsClose(
        math.quatConjugate(a),
        toQuaternion(a).clone().conjugate(),
      );

      for (const b of sampleQuaternions) {
        expectQuaternionsClose(
          math.quatMultiply(a, b),
          toQuaternion(a).clone().multiply(toQuaternion(b)),
        );
      }
    }
  });

  it("matches rotation matrices and quaternion-vector rotation", () => {
    for (const rotation of sampleQuaternions) {
      expectMatricesClose(
        math.quatToMat4(rotation),
        new THREE.Matrix4().makeRotationFromQuaternion(toQuaternion(rotation)),
      );

      for (const vector of sampleVectors) {
        expectVectorsClose(
          math.quatRotateVec3(rotation, vector),
          toVector(vector).applyQuaternion(toQuaternion(rotation)),
        );
      }
    }

    // Composed rotation: quatMultiply(a, b) applies b first, then a.
    const vector = { x: 1, y: 2, z: 3 };

    expectVectorsClose(
      math.quatRotateVec3(
        math.quatMultiply(
          toMathQuaternion(quarterTurn),
          toMathQuaternion(obliqueTurn),
        ),
        vector,
      ),
      toVector(vector)
        .applyQuaternion(obliqueTurn)
        .applyQuaternion(quarterTurn),
    );
  });

  it("matches Quaternion.slerp including t outside [0, 1]", () => {
    const longWay = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      (3 * Math.PI) / 2,
    );
    const nearParallelEnd = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      1e-7,
    );
    const negatedQuarterTurn = math.quatNormalize({
      x: -quarterTurn.x,
      y: -quarterTurn.y,
      z: -quarterTurn.z,
      w: -quarterTurn.w,
    });

    const pairs: readonly (readonly [math.Quat, math.Quat])[] = [
      [math.QUAT_IDENTITY, toMathQuaternion(quarterTurn)],
      [math.QUAT_IDENTITY, toMathQuaternion(longWay)],
      [toMathQuaternion(quarterTurn), toMathQuaternion(obliqueTurn)],
      [toMathQuaternion(quarterTurn), negatedQuarterTurn],
      [toMathQuaternion(identity), toMathQuaternion(nearParallelEnd)],
    ];

    for (const [a, b] of pairs) {
      for (const t of [-0.25, 0, 0.25, 0.5, 0.75, 1, 1.25]) {
        expectQuaternionsClose(
          math.quatSlerp(a, b, t),
          toQuaternion(a).clone().slerp(toQuaternion(b), t),
        );
      }
    }
  });

  it("keeps the parameterization difference inside the documented band", () => {
    // Sample the band in dot space so the endpoints are the exact extremes: three
    // switches branches at dot = 0.9995 and this module at dot = 1 - EPSILON.
    const bandLow = 0.9995;                // three's nlerp threshold
    const bandHigh = 1 - 2 * math.EPSILON; // 2*EPSILON inside this module's slerp threshold; far below three's 0.9995
    let maxDelta = 0;
    let minDelta = Infinity;
    let extrapolatedMaxDelta = 0;

    for (let step = 0; step <= 64; step += 1) {
      const cosine = bandLow + (bandHigh - bandLow) * (step / 64);
      const target = math.quatNormalize({ x: Math.sqrt(1 - cosine * cosine), y: 0, z: 0, w: cosine });

      for (const t of [0.25, 0.75]) {
        const ours = math.quatSlerp(math.QUAT_IDENTITY, target, t);
        const theirs = toQuaternion(math.QUAT_IDENTITY).clone().slerp(toQuaternion(target), t);
        const delta = Math.max(Math.abs(ours.x - theirs.x), Math.abs(ours.y - theirs.y), Math.abs(ours.z - theirs.z), Math.abs(ours.w - theirs.w));

        maxDelta = Math.max(maxDelta, delta);
        minDelta = Math.min(minDelta, delta);
      }

      for (const t of [-0.25, 1.25]) {
        const ours = math.quatSlerp(math.QUAT_IDENTITY, target, t);
        const theirs = toQuaternion(math.QUAT_IDENTITY).clone().slerp(toQuaternion(target), t);
        extrapolatedMaxDelta = Math.max(extrapolatedMaxDelta, Math.abs(ours.x - theirs.x), Math.abs(ours.y - theirs.y), Math.abs(ours.z - theirs.z), Math.abs(ours.w - theirs.w));
      }
    }

    // Their parameterizations only differ inside the band: at dot = 0.9995 three lerps
    // while this module slerps (4.94e-7); the difference decays as dot grows, reaching
    // 1.25e-10 at dot = 1 - 2e-6.
    expect(maxDelta).toBeGreaterThan(4e-7);
    expect(maxDelta).toBeLessThan(6e-7);
    expect(minDelta).toBeGreaterThan(1e-11);
    expect(minDelta).toBeLessThan(1e-9);
    expect(extrapolatedMaxDelta).toBeLessThan(3e-6);
  });

  it("switches to nlerp at its own threshold, not at three's", () => {
    // 1 - dot = 5e-7 is below this module's EPSILON and above three's 0.9995 threshold,
    // so both implementations lerp: the results must coincide.
    const belowHalfAngle = Math.acos(1 - 5e-7);
    const belowTarget = math.quatNormalize({ x: Math.sin(belowHalfAngle), y: 0, z: 0, w: Math.cos(belowHalfAngle) });

    expectQuaternionsClose(
      math.quatSlerp(math.QUAT_IDENTITY, belowTarget, 0.25),
      toQuaternion(math.QUAT_IDENTITY).clone().slerp(toQuaternion(belowTarget), 0.25),
    );

    // 1 - dot = 2e-6 is above this module's EPSILON but below three's threshold, so this
    // module slerps while three lerps (measured 1.25e-10 at the x component).
    const aboveHalfAngle = Math.acos(1 - 2e-6);
    const aboveTarget = math.quatNormalize({ x: Math.sin(aboveHalfAngle), y: 0, z: 0, w: Math.cos(aboveHalfAngle) });
    const aboveOurs = math.quatSlerp(math.QUAT_IDENTITY, aboveTarget, 0.25);
    const aboveTheirs = toQuaternion(math.QUAT_IDENTITY).clone().slerp(toQuaternion(aboveTarget), 0.25);
    const aboveDelta = Math.abs(aboveOurs.x - aboveTheirs.x);

    expect(aboveDelta).toBeGreaterThan(1e-11);
    expect(aboveDelta).toBeLessThan(1e-9);
  });

  it("matches Plane construction, normalization, distance, projection", () => {
    const fromPointCases: readonly (readonly [math.Vec3, math.Vec3])[] = [
      [{ x: 0, y: 2, z: 0 }, { x: 0, y: 1, z: 0 }],
      [{ x: 3, y: -1, z: 2 }, { x: 0, y: 0, z: 1 }],
      [{ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }],
      [{ x: -2, y: 4, z: 1 }, { x: 0, y: 5, z: 0 }],
    ];

    for (const [point, normal] of fromPointCases) {
      const plane = math.planeFromPointNormal(point, normal);

      expect(plane).not.toBeNull();

      if (plane !== null) {
        // The contract requires planeFromPointNormal to normalize the normal;
        // THREE.Plane.setFromNormalAndCoplanarPoint requires a unit normal.
        const threePlane = new THREE.Plane().setFromNormalAndCoplanarPoint(
          toVector(normal).normalize(),
          toVector(point),
        );

        expectVectorsClose(plane.normal, threePlane.normal);
        expect(plane.constant).toBeCloseTo(threePlane.constant, 12);
      }
    }

    expect(
      math.planeFromPointNormal(math.VEC3_ZERO, math.VEC3_ZERO),
    ).toBeNull();

    const planeCases = [
      { normal: { x: 0, y: 2, z: 0 }, constant: -4 },
      { normal: { x: 1, y: 1, z: 1 }, constant: 3 },
      { normal: { x: -3, y: 0.5, z: 2 }, constant: -0.25 },
    ];

    for (const plane of planeCases) {
      const normalized = math.planeNormalize(plane);

      expect(normalized).not.toBeNull();

      if (normalized !== null) {
        const threeNormalized = new THREE.Plane(
          toVector(plane.normal),
          plane.constant,
        ).normalize();

        expectVectorsClose(normalized.normal, threeNormalized.normal);
        expect(normalized.constant).toBeCloseTo(threeNormalized.constant, 12);
      }
    }

    expect(
      math.planeNormalize({ normal: math.VEC3_ZERO, constant: 1 }),
    ).toBeNull();

    const unitNormal = new THREE.Vector3(1, 2, 3).normalize();
    const mathPlane = unitPlane(toMathVector(unitNormal), -0.5);
    const threePlane = new THREE.Plane(unitNormal, -0.5);

    for (const point of sampleVectors) {
      expect(math.planeDistanceToPoint(mathPlane, point)).toBeCloseTo(
        threePlane.distanceToPoint(toVector(point)),
        12,
      );
      expectVectorsClose(
        math.planeProjectPoint(mathPlane, point),
        threePlane.projectPoint(toVector(point), new THREE.Vector3()),
      );
    }
  });

  it("matches Ray.intersectPlane including parallel rays", () => {
    const mathPlane = unitPlane({ x: 0, y: 1, z: 0 }, -2);
    const threePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -2);

    const hitRays: readonly math.Ray[] = [
      { origin: { x: 0, y: 5, z: 0 }, direction: { x: 0, y: -2, z: 0 } },
      { origin: { x: 0, y: 5, z: 0 }, direction: { x: 0, y: -1, z: 0 } },
      { origin: { x: 1, y: -3.5, z: 2 }, direction: { x: 0, y: 4, z: 0 } },
    ];

    for (const ray of hitRays) {
      const t = math.planeIntersectRay(ray, mathPlane);
      const threePoint = new THREE.Ray(
        toVector(ray.origin),
        toVector(ray.direction),
      ).intersectPlane(threePlane, new THREE.Vector3());

      expect(t).not.toBeNull();
      expect(threePoint).not.toBeNull();

      if (t !== null && threePoint !== null) {
        // The contract returns the scalar t; three returns the intersection point,
        // so origin + t * direction must land on that same point.
        expectVectorsClose(
          toMathVector(threePoint),
          new THREE.Vector3()
            .copy(toVector(ray.direction))
            .multiplyScalar(t)
            .add(toVector(ray.origin)),
        );
      }
    }

    const tMaxRay: math.Ray = {
      origin: { x: 0, y: 5, z: 0 },
      direction: { x: 0, y: -2, z: 0 },
    };

    // t === tMax still counts as a hit.
    expect(math.planeIntersectRay(tMaxRay, mathPlane, 1.5)).toBeCloseTo(
      1.5,
      12,
    );
    expect(math.planeIntersectRay(tMaxRay, mathPlane, 1.4999)).toBeNull();

    const awayRay: math.Ray = {
      origin: { x: 0, y: 5, z: 0 },
      direction: { x: 0, y: 1, z: 0 },
    };

    expect(math.planeIntersectRay(awayRay, mathPlane)).toBeNull();
    expect(
      new THREE.Ray(
        toVector(awayRay.origin),
        toVector(awayRay.direction),
      ).intersectPlane(threePlane, new THREE.Vector3()),
    ).toBeNull();

    const parallelRay: math.Ray = {
      origin: { x: 0, y: 5, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
    };

    expect(math.planeIntersectRay(parallelRay, mathPlane)).toBeNull();
    expect(
      new THREE.Ray(
        toVector(parallelRay.origin),
        toVector(parallelRay.direction),
      ).intersectPlane(threePlane, new THREE.Vector3()),
    ).toBeNull();

    // The ray lies in the plane itself: the contract rejects every parallel ray
    // with null, while three returns the origin.
    const coplanarRay: math.Ray = {
      origin: { x: 0, y: 2, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
    };

    expect(math.planeIntersectRay(coplanarRay, mathPlane)).toBeNull();
    expect(
      new THREE.Ray(
        toVector(coplanarRay.origin),
        toVector(coplanarRay.direction),
      )
        .intersectPlane(threePlane, new THREE.Vector3())
        ?.toArray(),
    ).toEqual([0, 2, 0]);
  });

  it("matches Ray.intersectBox for hits, misses, and empty boxes", () => {
    const bounds: math.Aabb = {
      isEmpty: false,
      min: { x: 1, y: -1, z: -1 },
      max: { x: 3, y: 1, z: 1 },
    };
    const threeBounds = new THREE.Box3(
      new THREE.Vector3(1, -1, -1),
      new THREE.Vector3(3, 1, 1),
    );

    const hitRays: readonly math.Ray[] = [
      { origin: { x: 0, y: 0, z: 0 }, direction: { x: 2, y: 0, z: 0 } },
      { origin: { x: 2, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } },
      { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0.5, y: 0, z: 0 } },
      { origin: { x: 1, y: 0, z: 0 }, direction: { x: -1, y: 0, z: 0 } },
      { origin: { x: 1, y: 1, z: 1 }, direction: { x: 1, y: 0, z: 0 } },
    ];

    for (const ray of hitRays) {
      const t = math.rayIntersectAabb(ray, bounds);
      const threePoint = new THREE.Ray(
        toVector(ray.origin),
        toVector(ray.direction),
      ).intersectBox(threeBounds, new THREE.Vector3());

      expect(t).not.toBeNull();
      expect(threePoint).not.toBeNull();

      if (t !== null && threePoint !== null) {
        // An origin outside the box returns the entry parameter, an origin inside
        // returns the exit parameter: both sides must land on the same point.
        expectVectorsClose(
          toMathVector(threePoint),
          new THREE.Vector3()
            .copy(toVector(ray.direction))
            .multiplyScalar(t)
            .add(toVector(ray.origin)),
        );
      }
    }

    const missRays: readonly math.Ray[] = [
      { origin: { x: 0, y: 2, z: 0 }, direction: { x: 1, y: 0, z: 0 } },
      { origin: { x: 0, y: 0, z: 0 }, direction: { x: -1, y: 0, z: 0 } },
      { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 1, z: 0 } },
    ];

    for (const ray of missRays) {
      expect(math.rayIntersectAabb(ray, bounds)).toBeNull();
      expect(
        new THREE.Ray(
          toVector(ray.origin),
          toVector(ray.direction),
        ).intersectBox(threeBounds, new THREE.Vector3()),
      ).toBeNull();
    }

    const entryRay: math.Ray = {
      origin: { x: 0, y: 0, z: 0 },
      direction: { x: 2, y: 0, z: 0 },
    };

    // t === tMax still counts as a hit.
    expect(math.rayIntersectAabb(entryRay, bounds, 0.5)).toBeCloseTo(0.5, 12);
    expect(math.rayIntersectAabb(entryRay, bounds, 0.4999)).toBeNull();

    // Empty AABB: the contract returns null, and three's empty box misses too.
    const emptyRay: math.Ray = {
      origin: { x: 0, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
    };

    expect(math.rayIntersectAabb(emptyRay, math.EMPTY_AABB)).toBeNull();
    expect(
      new THREE.Ray(
        toVector(emptyRay.origin),
        toVector(emptyRay.direction),
      ).intersectBox(new THREE.Box3().makeEmpty(), new THREE.Vector3()),
    ).toBeNull();
  });

  it("matches Box3 for aabbFromPoints, aabbUnion, and aabbExpand", () => {
    const pointSets: readonly (readonly math.Vec3[])[] = [
      [],
      [{ x: 1, y: 1, z: 1 }],
      [
        { x: 2, y: -1, z: 4 },
        { x: -3, y: 5, z: 1 },
        { x: 0.5, y: 0.5, z: -2 },
      ],
    ];

    for (const points of pointSets) {
      expectAabbsClose(
        math.aabbFromPoints(points),
        new THREE.Box3().setFromPoints(points.map(toVector)),
      );
    }

    for (const a of sampleAabbs) {
      for (const b of sampleAabbs) {
        // three's union mutates its receiver, so take a fresh Box3 every time.
        expectAabbsClose(math.aabbUnion(a, b), toBox3(a).union(toBox3(b)));
      }

      for (const point of expansionPoints) {
        expectAabbsClose(
          math.aabbExpand(a, point),
          toBox3(a).expandByPoint(toVector(point)),
        );
      }
    }
  });

  it("matches Box3 for containment, intersection, center, and size", () => {
    for (const aabb of sampleAabbs) {
      for (const point of probePoints) {
        for (const epsilon of [0, 0.001, 0.01]) {
          // The contract's epsilon widens both ends of the closed interval, which
          // is equivalent to expanding the Box3 outward.
          expect(math.aabbContainsPoint(aabb, point, epsilon)).toBe(
            toBox3(aabb)
              .clone()
              .expandByScalar(epsilon)
              .containsPoint(toVector(point)),
          );
        }
      }

      for (const other of sampleAabbs) {
        for (const epsilon of [0, 0.001, 0.01]) {
          expect(math.aabbIntersects(aabb, other, epsilon)).toBe(
            toBox3(aabb)
              .clone()
              .expandByScalar(epsilon)
              .intersectsBox(toBox3(other)),
          );
        }
      }

      const center = math.aabbCenter(aabb);
      const size = math.aabbSize(aabb);
      const threeCenter = toBox3(aabb).getCenter(new THREE.Vector3());
      const threeSize = toBox3(aabb).getSize(new THREE.Vector3());

      if (aabb.isEmpty) {
        // The contract returns null for an empty AABB; three's getCenter/getSize
        // return the zero vector.
        expect(center).toBeNull();
        expect(size).toBeNull();
        expect(threeCenter.toArray()).toEqual([0, 0, 0]);
        expect(threeSize.toArray()).toEqual([0, 0, 0]);
        continue;
      }

      expect(center).not.toBeNull();
      expect(size).not.toBeNull();

      if (center !== null && size !== null) {
        expectVectorsClose(center, threeCenter);
        expectVectorsClose(size, threeSize);
      }
    }
  });
});

describe("math type contract", () => {
  it("exposes plain readonly data types", () => {
    expectTypeOf<math.Vec3>().toEqualTypeOf<
      Readonly<{ x: number; y: number; z: number }>
    >();
    // Quat must carry the brand: a bare literal is not assignable. This is the only
    // place where the compiler can defend the "always a unit quaternion" invariant.
    expectTypeOf<math.Quat>().toExtend<
      Readonly<{ x: number; y: number; z: number; w: number }>
    >();
    expectTypeOf<
      Readonly<{ x: number; y: number; z: number; w: number }>
    >().not.toExtend<math.Quat>();
    // Plane must carry the brand: a bare literal is not assignable. This defends
    // the "always a unit normal" invariant.
    expectTypeOf<math.Plane>().toExtend<
      Readonly<{ normal: math.Vec3; constant: number }>
    >();
    expectTypeOf<
      Readonly<{ normal: math.Vec3; constant: number }>
    >().not.toExtend<math.Plane>();
    expectTypeOf<math.Ray>().toEqualTypeOf<
      Readonly<{ origin: math.Vec3; direction: math.Vec3 }>
    >();
  });
});
