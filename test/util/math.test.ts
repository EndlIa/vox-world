import { describe, expect, it } from "vitest";

import * as math from "../../src/util/math";

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
    const rotation = math.quatFromAxisAngle(
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
      math.quatFromAxisAngle(
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
    const quarterTurn = math.quatFromAxisAngle(
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
    const rotation = math.quatFromAxisAngle(
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

  it("slerps along the shortest arc", () => {
    const identity = math.QUAT_IDENTITY;
    const longWay = math.quatFromAxisAngle(
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
      math.quatEquals(math.QUAT_IDENTITY, {
        x: 0,
        y: 0,
        z: 0,
        w: -1,
      }),
    ).toBe(false);
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
    const plane = { normal: { x: 0, y: 1, z: 0 }, constant: -2 };

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
