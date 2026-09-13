import { describe, expect, expectTypeOf, it } from "vitest";

import {
  sceneNodeId,
  sceneObjectId,
  sceneSnapshot,
  type SceneNodeId,
  type SceneNodeSnapshot,
  type SceneNodeSnapshotInput,
  type SceneObjectId,
  type SceneObjectSnapshot,
  type SceneObjectSnapshotInput,
  type SceneSnapshot,
  type SceneSnapshotInput,
  type SceneTransform,
  type SceneTransformInput,
  type SceneValidationError,
} from "../../../src/domain/scene/scene-types";
import {
  uniformVoxSnapshot,
  type UniformVoxSnapshot,
} from "../../../src/domain/voxel/uniform/types";
import { QUAT_IDENTITY, type Quat, type Vec3 } from "../../../src/util/math";
import type { Result } from "../../../src/util/result";
import { expectErr, expectOk } from "../../support/expect-result";

const EMPTY_VOXELS = expectOk(
  uniformVoxSnapshot({ x: [], y: [], z: [], colorIndex: [], palette: [] }),
);

const UNIT_TRANSFORM: SceneTransformInput = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: 1, y: 1, z: 1 },
};

function node(
  id: string,
  overrides: Partial<SceneNodeSnapshotInput> = {},
): SceneNodeSnapshotInput {
  return {
    id,
    parentId: overrides.parentId ?? null,
    childIds: overrides.childIds ?? [],
    name: overrides.name ?? id,
    transform: overrides.transform ?? UNIT_TRANSFORM,
    visible: overrides.visible ?? true,
    sceneObjectId: overrides.sceneObjectId ?? null,
  };
}

function object(id: string): SceneObjectSnapshotInput {
  return { id, voxels: EMPTY_VOXELS };
}

function scene(
  rootNodeId: string,
  nodes: readonly SceneNodeSnapshotInput[],
  objects: readonly SceneObjectSnapshotInput[] = [],
): SceneSnapshotInput {
  return { rootNodeId, nodes, objects };
}

function transformWith(overrides: Partial<SceneTransformInput>): SceneTransformInput {
  return { ...UNIT_TRANSFORM, ...overrides };
}

describe("sceneSnapshot", () => {
  it("canonicalizes node and object order while keeping childIds order", () => {
    const boundObject = object("o1");
    const input = scene(
      "b",
      [
        node("z", { parentId: "b", sceneObjectId: "o2" }),
        node("a", { parentId: "b", sceneObjectId: "o1" }),
        node("b", { childIds: ["z", "a"] }),
      ],
      [object("o2"), boundObject],
    );

    const snapshot = expectOk(sceneSnapshot(input));

    expect(snapshot.rootNodeId).toBe("b");
    expect(snapshot.nodes.map((entry) => entry.id)).toEqual(["a", "b", "z"]);
    expect(snapshot.objects.map((entry) => entry.id)).toEqual(["o1", "o2"]);
    expect(snapshot.nodes[1]?.childIds).toEqual(["z", "a"]);
    expect(snapshot.nodes[1]?.parentId).toBeNull();
    expect(snapshot.objects[0]?.voxels).toBe(boundObject.voxels);
  });

  it("produces the same canonical snapshot for any input order", () => {
    const nodes = [
      node("b", { childIds: ["a", "c"] }),
      node("a", { parentId: "b", sceneObjectId: "o1" }),
      node("c", { parentId: "b", sceneObjectId: "o2" }),
    ];

    const forward = expectOk(sceneSnapshot(scene("b", nodes, [object("o1"), object("o2")])));
    const reversed = expectOk(
      sceneSnapshot(scene("b", [...nodes].reverse(), [object("o2"), object("o1")])),
    );

    expect(reversed).toEqual(forward);
  });

  it("accepts a root-only scene and passes the root rotation through unchanged", () => {
    const input = scene("root", [
      node("root", {
        transform: transformWith({ rotation: { x: 0, y: 0, z: 0, w: -1 } }),
      }),
    ]);

    const snapshot = expectOk(sceneSnapshot(input));

    expect(snapshot.nodes).toHaveLength(1);
    expect(snapshot.objects).toEqual([]);
    expect(snapshot.nodes[0]?.transform.rotation).toEqual({
      x: 0,
      y: 0,
      z: 0,
      w: -1,
    });
  });

  it("mints the identity rotation as a unit quaternion", () => {
    const snapshot = expectOk(sceneSnapshot(scene("root", [node("root")])));

    expect(snapshot.nodes[0]?.transform.rotation).toEqual(QUAT_IDENTITY);
  });

  it("never modifies its input", () => {
    const root = Object.freeze(node("b", { childIds: ["a"] }));
    const child = Object.freeze(node("a", { parentId: "b", sceneObjectId: "o1" }));
    const nodes = Object.freeze([root, child]);
    const objects = Object.freeze([Object.freeze(object("o1"))]);
    const before = structuredClone({ nodes, objects });

    expectOk(sceneSnapshot({ rootNodeId: "b", nodes, objects }));

    expect({ nodes, objects }).toEqual(before);
  });
});

describe("sceneSnapshot identity checks", () => {
  it.each([
    ["an empty root id", scene("", [node("")])],
    [
      "an empty node id",
      scene("b", [node("b", { childIds: [""] }), node("", { parentId: "b" })]),
    ],
    [
      "an empty object id",
      scene(
        "b",
        [node("b", { childIds: ["a"] }), node("a", { parentId: "b", sceneObjectId: "" })],
        [{ id: "", voxels: EMPTY_VOXELS }],
      ),
    ],
  ] as const)("rejects %s", (_label, input) => {
    expect(expectErr(sceneSnapshot(input))).toEqual({ code: "empty-id" });
  });

  it("rejects repeated node and object ids", () => {
    const repeatedNodes = scene("b", [
      node("b"),
      node("a", { parentId: "b" }),
      node("a", { parentId: "b" }),
    ]);

    expect(expectErr(sceneSnapshot(repeatedNodes))).toEqual({
      code: "duplicate-node-id",
      nodeId: "a",
    });

    const repeatedObjects = scene("b", [node("b")], [object("o1"), object("o1")]);

    expect(expectErr(sceneSnapshot(repeatedObjects))).toEqual({
      code: "duplicate-object-id",
      sceneObjectId: "o1",
    });
  });
});

describe("sceneSnapshot root checks", () => {
  it("requires the root to exist", () => {
    expect(expectErr(sceneSnapshot(scene("ghost", [])))).toEqual({
      code: "root-missing",
    });
  });

  it("requires a null parent, a null binding and the unit transform", () => {
    const withParent = scene("b", [
      node("b", { parentId: "b", childIds: ["b"] }),
    ]);

    expect(expectErr(sceneSnapshot(withParent))).toEqual({
      code: "root-invalid",
      nodeId: "b",
    });

    const withBinding = scene("b", [node("b", { sceneObjectId: "o1" })], [object("o1")]);

    expect(expectErr(sceneSnapshot(withBinding))).toEqual({
      code: "root-invalid",
      nodeId: "b",
    });

    const withScale = scene("b", [
      node("b", { transform: transformWith({ scale: { x: 2, y: 1, z: 1 } }) }),
    ]);

    expect(expectErr(sceneSnapshot(withScale))).toEqual({
      code: "root-invalid",
      nodeId: "b",
    });
  });
});

describe("sceneSnapshot structure checks", () => {
  it("requires every non-root node to reference an existing parent", () => {
    // A node without a parent is necessarily also unreachable from the root,
    // so these two inputs trigger `cycle` as well. Which code wins is
    // unspecified (codemap/src/domain/scene/scene-types.md); the assertions
    // below only pin the current behavior, not a contract.
    const withoutParent = scene("b", [node("b"), node("a")]);

    expect(expectErr(sceneSnapshot(withoutParent))).toEqual({
      code: "parent-missing",
      nodeId: "a",
    });

    const unknownParent = scene("b", [node("b"), node("a", { parentId: "ghost" })]);

    expect(expectErr(sceneSnapshot(unknownParent))).toEqual({
      code: "parent-not-found",
      nodeId: "a",
      parentId: "ghost",
    });
  });

  it("requires every child link to name an existing node", () => {
    const input = scene("b", [node("b", { childIds: ["ghost"] })]);

    expect(expectErr(sceneSnapshot(input))).toEqual({
      code: "child-not-found",
      nodeId: "b",
      childId: "ghost",
    });
  });

  it("rejects a repeated child entry", () => {
    const input = scene("b", [
      node("b", { childIds: ["a", "a"] }),
      node("a", { parentId: "b" }),
    ]);

    expect(expectErr(sceneSnapshot(input))).toEqual({
      code: "duplicate-child",
      nodeId: "b",
      childId: "a",
    });
  });

  it("requires parent and child lists to agree in both directions", () => {
    const childPointsElsewhere = scene("b", [
      node("b", { childIds: ["a"] }),
      node("a", { parentId: "c" }),
      node("c", { parentId: "b" }),
    ]);

    expect(expectErr(sceneSnapshot(childPointsElsewhere))).toEqual({
      code: "parent-child-mismatch",
      nodeId: "b",
      childId: "a",
    });

    const parentOmitsChild = scene("b", [
      node("b", { childIds: ["a"] }),
      node("a", { parentId: "b" }),
      node("c", { parentId: "b" }),
    ]);

    expect(expectErr(sceneSnapshot(parentOmitsChild))).toEqual({
      code: "parent-child-mismatch",
      nodeId: "b",
      childId: "c",
    });
  });

  it("rejects nodes that sit on a parent cycle", () => {
    const input = scene("b", [
      node("b"),
      node("a", { parentId: "x", childIds: ["x"] }),
      node("x", { parentId: "a", childIds: ["a"] }),
    ]);

    expect(expectErr(sceneSnapshot(input))).toEqual({ code: "cycle", nodeId: "a" });
  });
});

describe("sceneSnapshot object binding checks", () => {
  it("requires a bound object to exist", () => {
    const input = scene("b", [
      node("b", { childIds: ["a"] }),
      node("a", { parentId: "b", sceneObjectId: "ghost" }),
    ]);

    expect(expectErr(sceneSnapshot(input))).toEqual({
      code: "object-not-found",
      nodeId: "a",
      sceneObjectId: "ghost",
    });
  });

  it("requires every object to be bound by exactly one node", () => {
    const unbound = scene("b", [node("b")], [object("o1")]);

    expect(expectErr(sceneSnapshot(unbound))).toEqual({
      code: "object-unbound",
      sceneObjectId: "o1",
    });

    const multiplyBound = scene(
      "b",
      [
        node("b", { childIds: ["a", "c"] }),
        node("a", { parentId: "b", sceneObjectId: "o1" }),
        node("c", { parentId: "b", sceneObjectId: "o1" }),
      ],
      [object("o1")],
    );

    expect(expectErr(sceneSnapshot(multiplyBound))).toEqual({
      code: "object-multiply-bound",
      sceneObjectId: "o1",
      nodeIds: ["a", "c"],
    });
  });

  it("reports multiply bound node ids in ascending order", () => {
    const reversed = scene(
      "b",
      [
        node("b", { childIds: ["c", "a"] }),
        node("c", { parentId: "b", sceneObjectId: "o1" }),
        node("a", { parentId: "b", sceneObjectId: "o1" }),
      ],
      [object("o1")],
    );

    expect(expectErr(sceneSnapshot(reversed))).toEqual({
      code: "object-multiply-bound",
      sceneObjectId: "o1",
      nodeIds: ["a", "c"],
    });
  });

  it("keeps a bound node a leaf", () => {
    const input = scene(
      "b",
      [
        node("b", { childIds: ["a"] }),
        node("a", { parentId: "b", sceneObjectId: "o1", childIds: ["c"] }),
        node("c", { parentId: "a" }),
      ],
      [object("o1")],
    );

    expect(expectErr(sceneSnapshot(input))).toEqual({
      code: "leaf-node-has-children",
      nodeId: "a",
    });
  });
});

describe("sceneSnapshot transform checks", () => {
  function errorFor(transform: SceneTransformInput): SceneValidationError {
    const input = scene("b", [
      node("b", { childIds: ["a"] }),
      node("a", { parentId: "b", transform }),
    ]);

    return expectErr(sceneSnapshot(input));
  }

  it.each([
    [
      "non-finite position",
      transformWith({ position: { x: Number.NaN, y: 0, z: 0 } }),
      "position",
    ],
    [
      "non-unit rotation",
      transformWith({ rotation: { x: 0, y: 0, z: 0, w: 2 } }),
      "rotation",
    ],
    [
      "zero-length rotation",
      transformWith({ rotation: { x: 0, y: 0, z: 0, w: 0 } }),
      "rotation",
    ],
    [
      "non-finite scale",
      transformWith({ scale: { x: 1, y: Number.POSITIVE_INFINITY, z: 1 } }),
      "scale",
    ],
    [
      "zero scale component",
      transformWith({ scale: { x: 0, y: 1, z: 1 } }),
      "scale",
    ],
    // The contract treats a component within EPSILON of zero as zero, so a
    // formally invertible but near-singular scale is rejected too.
    [
      "scale component within EPSILON of zero",
      transformWith({ scale: { x: 1e-7, y: 1, z: 1 } }),
      "scale",
    ],
  ] as const)("rejects %s", (_label, transform, channel) => {
    expect(errorFor(transform)).toEqual({
      code: "invalid-transform",
      nodeId: "a",
      channel,
    });
  });

  it("accepts a scale component above the zero tolerance", () => {
    const input = scene("b", [
      node("b", { childIds: ["a"] }),
      node("a", {
        parentId: "b",
        transform: transformWith({ scale: { x: 2e-6, y: 1, z: 1 } }),
      }),
    ]);

    const snapshot = expectOk(sceneSnapshot(input));
    const child = snapshot.nodes.find((entry) => entry.id === "a");

    expect(child?.transform.scale).toEqual({ x: 2e-6, y: 1, z: 1 });
  });

  it("reports the first failing channel in position, rotation, scale order", () => {
    expect(
      errorFor(
        transformWith({
          position: { x: 0, y: Number.NaN, z: 0 },
          scale: { x: 0, y: 0, z: 0 },
        }),
      ),
    ).toEqual({ code: "invalid-transform", nodeId: "a", channel: "position" });
  });
});

describe("scene identities", () => {
  it("mints identities from any non-empty string and rejects the empty one", () => {
    expect(expectOk(sceneNodeId("n1"))).toBe("n1");
    expect(expectErr(sceneNodeId(""))).toEqual({ code: "empty-id" });
    expect(expectOk(sceneObjectId("o1"))).toBe("o1");
    expect(expectErr(sceneObjectId(""))).toEqual({ code: "empty-id" });
  });
});

describe("scene-types type contract", () => {
  it("keeps node, object, snapshot and quaternion brands apart", () => {
    expectTypeOf<string>().not.toExtend<SceneNodeId>();
    expectTypeOf<string>().not.toExtend<SceneObjectId>();
    expectTypeOf<SceneObjectId>().not.toExtend<SceneNodeId>();
    expectTypeOf<SceneSnapshotInput>().not.toExtend<SceneSnapshot>();
    expectTypeOf<SceneSnapshot>().toExtend<SceneSnapshotInput>();
    expectTypeOf<SceneTransformInput["rotation"]>().not.toExtend<Quat>();
    expectTypeOf(expectOk(sceneNodeId("n1"))).toEqualTypeOf<SceneNodeId>();
    expectTypeOf(expectOk(sceneObjectId("o1"))).toEqualTypeOf<SceneObjectId>();
    expectTypeOf(expectOk(sceneSnapshot(scene("b", [node("b")])))).toEqualTypeOf<
      SceneSnapshot
    >();
    expectTypeOf(sceneSnapshot).toEqualTypeOf<
      (input: SceneSnapshotInput) => Result<SceneSnapshot, SceneValidationError>
    >();
  });

  it("keeps the snapshot object types readonly", () => {
    expectTypeOf<{
      position: Vec3;
      rotation: Quat;
      scale: Vec3;
    }>().not.toEqualTypeOf<SceneTransform>();
    expectTypeOf<{
      id: SceneNodeId;
      parentId: SceneNodeId | null;
      childIds: readonly SceneNodeId[];
      name: string;
      transform: SceneTransform;
      visible: boolean;
      sceneObjectId: SceneObjectId | null;
    }>().not.toEqualTypeOf<SceneNodeSnapshot>();
    expectTypeOf<{
      id: SceneObjectId;
      voxels: UniformVoxSnapshot;
    }>().not.toEqualTypeOf<SceneObjectSnapshot>();
    expectTypeOf<{
      rootNodeId: SceneNodeId;
      nodes: readonly SceneNodeSnapshot[];
      objects: readonly SceneObjectSnapshot[];
    }>().not.toEqualTypeOf<SceneSnapshot>();
  });

  it("pins the nullability, container and transform of a snapshot node", () => {
    expectTypeOf<SceneNodeSnapshot["id"]>().toEqualTypeOf<SceneNodeId>();
    expectTypeOf<SceneObjectSnapshot["id"]>().toEqualTypeOf<SceneObjectId>();
    expectTypeOf<SceneSnapshot["rootNodeId"]>().toEqualTypeOf<SceneNodeId>();
    expectTypeOf<SceneNodeSnapshot["parentId"]>().toEqualTypeOf<SceneNodeId | null>();
    expectTypeOf<SceneNodeSnapshot["sceneObjectId"]>().toEqualTypeOf<SceneObjectId | null>();
    expectTypeOf<SceneNodeSnapshot["childIds"]>().toEqualTypeOf<readonly SceneNodeId[]>();
    expectTypeOf<SceneObjectSnapshot["voxels"]>().toEqualTypeOf<UniformVoxSnapshot>();
    expectTypeOf<SceneTransform["rotation"]>().toEqualTypeOf<Quat>();
    expectTypeOf<SceneTransformInput["rotation"]>().toEqualTypeOf<
      Readonly<{ x: number; y: number; z: number; w: number }>
    >();
    expectTypeOf<SceneSnapshot["nodes"]>().toEqualTypeOf<
      readonly SceneNodeSnapshot[]
    >();
  });

  it("closes the validation error set", () => {
    expectTypeOf<SceneValidationError["code"]>().toEqualTypeOf<
      | "empty-id"
      | "duplicate-node-id"
      | "duplicate-object-id"
      | "root-missing"
      | "root-invalid"
      | "parent-missing"
      | "parent-not-found"
      | "child-not-found"
      | "duplicate-child"
      | "parent-child-mismatch"
      | "cycle"
      | "object-not-found"
      | "object-unbound"
      | "object-multiply-bound"
      | "leaf-node-has-children"
      | "invalid-transform"
    >();
  });
});
