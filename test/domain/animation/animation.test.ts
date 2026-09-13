import { describe, expect, expectTypeOf, it } from "vitest";

import {
  addKeyframe,
  createDefaultAnimation,
  createTrack,
  decodeAnimation,
  deleteTrack,
  encodeAnimation,
  evaluateAnimation,
  hasTracksForNode,
  moveKeyframe,
  removeKeyframe,
  replaceKeyframe,
  setDuration,
  setLoop,
  validateAnimation,
  type AnimationDocument,
  type AnimationError,
  type AnimationEvaluation,
  type AnimationKeyframe,
  type AnimationTrack,
  type CameraFovTrack,
  type NodePositionTrack,
} from "../../../src/domain/animation/animation";
import {
  sceneNodeId,
  sceneSnapshot,
  type SceneNodeId,
  type SceneNodeSnapshotInput,
  type SceneSnapshot,
  type SceneTransform,
} from "../../../src/domain/scene/scene-types";
import {
  QUAT_IDENTITY,
  quatNormalize,
  smoothstep,
  vec3Lerp,
  type Quat,
  type Vec3,
} from "../../../src/util/math";
import type { Result } from "../../../src/util/result";

function expectOk<T, E>(result: Result<T, E>): T {
  if (!result.ok) {
    throw new Error(
      `Expected a successful result, got ${JSON.stringify(result.error)}`,
    );
  }

  return result.value;
}

function expectErr<T, E>(result: Result<T, E>): E {
  if (result.ok) {
    throw new Error("Expected a failed result");
  }

  return result.error;
}

const UNIT_TRANSFORM = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: 1, y: 1, z: 1 },
} as const;

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

/** Root with two children, used by the scene-reference tests. */
const SCENE: SceneSnapshot = expectOk(
  sceneSnapshot({
    rootNodeId: "root",
    nodes: [
      node("root", { childIds: ["n1", "n2"] }),
      node("n1", { parentId: "root" }),
      node("n2", { parentId: "root" }),
    ],
    objects: [],
  }),
);

const NODE_1: SceneNodeId = expectOk(sceneNodeId("n1"));
const NODE_2: SceneNodeId = expectOk(sceneNodeId("n2"));
const ROOT: SceneNodeId = expectOk(sceneNodeId("root"));

function document(value: unknown): AnimationDocument {
  return expectOk(decodeAnimation(value));
}

function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

function positionKeyframe(
  id: string,
  timeMs: number,
  value: Vec3,
  easing: "linear" | "smooth" = "linear",
): AnimationKeyframe<Vec3> {
  return { id, timeMs, value, easing };
}

/** Node position track in its persisted JSON shape. */
function positionTrack(
  id: string,
  nodeId: string,
  keyframes: readonly { id: string; timeMs: number; value: Vec3 }[],
): unknown {
  return {
    id,
    target: { kind: "node", nodeId },
    channel: "position",
    keyframes: keyframes.map((keyframe) => ({ ...keyframe, easing: "linear" })),
  };
}

function cameraFovTrack(value: unknown, easing: unknown = "linear"): unknown {
  return {
    id: "tc",
    target: { kind: "camera" },
    channel: "fov",
    keyframes: [{ id: "kc", timeMs: 0, value, easing }],
  };
}

function documentWith(
  durationMs: number,
  loop: boolean,
  tracks: readonly unknown[],
): unknown {
  return { version: 1, durationMs, loop, tracks };
}

/** Reads a track back out of a document, keeping assertions focused. */
function findTrack(animation: AnimationDocument, trackId: string): AnimationTrack {
  const track = animation.tracks.find((entry) => entry.id === trackId);

  if (track === undefined) {
    throw new Error(`Expected track ${trackId}`);
  }

  return track;
}

const SINGLE_TRACK_DOCUMENT = document(
  documentWith(1000, false, [
    positionTrack("t1", "n1", [{ id: "k1", timeMs: 0, value: vec3(0, 0, 0) }]),
  ]),
);

/** Same track with a second keyframe at 500ms. */
const TWO_KEYFRAME_DOCUMENT = expectOk(
  addKeyframe(SINGLE_TRACK_DOCUMENT, "t1", positionKeyframe("k2", 500, vec3(1, 1, 1))),
);

describe("type contract", () => {
  it("keeps documents and evaluations readonly with readonly arrays", () => {
    expectTypeOf<AnimationDocument["tracks"]>().toEqualTypeOf<
      readonly AnimationTrack[]
    >();
    expectTypeOf<AnimationEvaluation["nodes"]>().toEqualTypeOf<
      readonly Readonly<{
        nodeId: SceneNodeId;
        transform: Partial<SceneTransform>;
      }>[]
    >();
    expectTypeOf<AnimationTrack[]>().not.toEqualTypeOf<AnimationDocument["tracks"]>();
    expectTypeOf<{ position: undefined }>().not.toExtend<Partial<SceneTransform>>();
  });

  it("ties every channel member to its keyframe value type", () => {
    expectTypeOf<Extract<AnimationTrack, { channel: "fov" }>>().toEqualTypeOf<
      CameraFovTrack
    >();
    expectTypeOf<
      Extract<AnimationTrack, { channel: "fov" }>["keyframes"][number]["value"]
    >().toEqualTypeOf<number>();
    expectTypeOf<
      Extract<AnimationTrack, { channel: "position" }>["keyframes"][number]["value"]
    >().toEqualTypeOf<Vec3>();
    expectTypeOf<
      Extract<AnimationTrack, { channel: "rotation" }>["keyframes"][number]["value"]
    >().toEqualTypeOf<Quat>();
    expectTypeOf<NodePositionTrack["keyframes"][number]["value"]>().toEqualTypeOf<Vec3>();
  });

  it("rejects channel and value combinations the union does not have", () => {
    expectTypeOf<{
      id: string;
      target: { kind: "camera" };
      channel: "fov";
      keyframes: readonly AnimationKeyframe<Vec3>[];
    }>().not.toExtend<AnimationTrack>();
    expectTypeOf<{ x: number; y: number; z: number; w: number }>().not.toExtend<Quat>();
  });

  it("discriminates the error union by code", () => {
    const result: Result<AnimationDocument, AnimationError> = setDuration(
      TWO_KEYFRAME_DOCUMENT,
      10,
    );
    const error = expectErr(result);

    expect(error.code).toBe("duration-too-short");
    expectTypeOf<Extract<AnimationError, { code: "duration-too-short" }>>().toEqualTypeOf<
      Readonly<{ code: "duration-too-short"; durationMs: number; lastKeyframeMs: number }>
    >();
  });
});

describe("createDefaultAnimation", () => {
  it("creates the empty, persistable default document", () => {
    expect(createDefaultAnimation()).toEqual({
      version: 1,
      durationMs: 5000,
      loop: false,
      tracks: [],
    });
  });
});

describe("decodeAnimation", () => {
  it("accepts a complete V1 document and canonicalizes track order", () => {
    const animation = document(
      documentWith(1000, true, [
        positionTrack("t2", "n2", [{ id: "k2", timeMs: 0, value: vec3(1, 1, 1) }]),
        positionTrack("t1", "n1", [{ id: "k1", timeMs: 0, value: vec3(0, 0, 0) }]),
      ]),
    );

    expect(animation.tracks.map((track) => track.id)).toEqual(["t1", "t2"]);
    expect(animation.loop).toBe(true);
  });

  it("rejects a document that is not an object or misses required fields", () => {
    expect(expectErr(decodeAnimation(null)).code).toBe("invalid-animation-field");
    expect(expectErr(decodeAnimation([])).code).toBe("invalid-animation-field");
    expect(expectErr(decodeAnimation({ durationMs: 1, loop: false, tracks: [] })).code).toBe(
      "invalid-animation-field",
    );
    expect(expectErr(decodeAnimation({ version: 1, durationMs: 1, tracks: [] })).code).toBe(
      "invalid-animation-field",
    );
    expect(
      expectErr(decodeAnimation({ version: 1, durationMs: 0, loop: false, tracks: [] })).code,
    ).toBe("invalid-animation-field");
    expect(
      expectErr(decodeAnimation({ version: 1, durationMs: 1, loop: "no", tracks: [] })).code,
    ).toBe("invalid-animation-field");
    expect(
      expectErr(decodeAnimation({ version: 1, durationMs: 1, loop: false, tracks: {} })).code,
    ).toBe("invalid-animation-field");
  });

  it("rejects unknown fields instead of ignoring them", () => {
    expect(
      expectErr(
        decodeAnimation({ version: 1, durationMs: 1, loop: false, tracks: [], speed: 2 }),
      ),
    ).toEqual({ code: "invalid-animation-field", field: "speed" });

    expect(
      expectErr(
        decodeAnimation(
          documentWith(1000, false, [
            {
              ...(positionTrack("t1", "n1", [
                { id: "k1", timeMs: 0, value: vec3(0, 0, 0) },
              ]) as object),
              enabled: true,
            },
          ]),
        ),
      ),
    ).toEqual({ code: "invalid-animation-field", field: "enabled" });

    expect(
      expectErr(
        decodeAnimation(
          documentWith(1000, false, [
            {
              id: "t1",
              target: { kind: "node", nodeId: "n1" },
              channel: "position",
              keyframes: [
                { id: "k1", timeMs: 0, value: vec3(0, 0, 0), easing: "linear", tension: 1 },
              ],
            },
          ]),
        ),
      ),
    ).toEqual({ code: "invalid-animation-field", field: "keyframe.tension" });
  });

  it("reports unsupported versions separately from malformed ones", () => {
    expect(
      expectErr(decodeAnimation({ version: 2, durationMs: 1, loop: false, tracks: [] })),
    ).toEqual({ code: "unsupported-animation-version", version: 2 });
    expect(
      expectErr(decodeAnimation({ version: "1", durationMs: 1, loop: false, tracks: [] })),
    ).toEqual({ code: "invalid-animation-field", field: "version" });
  });

  it("rejects track and keyframe rule violations", () => {
    const duplicateTrackIds = documentWith(1000, false, [
      positionTrack("t1", "n1", [{ id: "k1", timeMs: 0, value: vec3(0, 0, 0) }]),
      positionTrack("t1", "n2", [{ id: "k2", timeMs: 0, value: vec3(0, 0, 0) }]),
    ]);

    expect(expectErr(decodeAnimation(duplicateTrackIds))).toEqual({
      code: "duplicate-track-id",
      trackId: "t1",
    });

    expect(expectErr(decodeAnimation(documentWith(1000, false, [positionTrack("t1", "n1", [])])))).toEqual(
      { code: "empty-track", trackId: "t1" },
    );

    expect(
      expectErr(
        decodeAnimation(
          documentWith(1000, false, [
            positionTrack("t1", "n1", [{ id: "k1", timeMs: 0, value: vec3(0, 0, 0) }]),
            positionTrack("t2", "n1", [{ id: "k2", timeMs: 0, value: vec3(0, 0, 0) }]),
          ]),
        ),
      ),
    ).toEqual({
      code: "duplicate-track-target",
      trackId: "t2",
      target: { kind: "node", nodeId: "n1" },
      channel: "position",
    });

    expect(
      expectErr(
        decodeAnimation(
          documentWith(1000, false, [
            positionTrack("t1", "n1", [
              { id: "k1", timeMs: 10, value: vec3(0, 0, 0) },
              { id: "k2", timeMs: 10, value: vec3(1, 1, 1) },
            ]),
          ]),
        ),
      ),
    ).toEqual({ code: "invalid-keyframe-time", trackId: "t1", keyframeId: "k2" });

    expect(
      expectErr(
        decodeAnimation(
          documentWith(1000, false, [
            positionTrack("t1", "n1", [{ id: "k1", timeMs: 1001, value: vec3(0, 0, 0) }]),
          ]),
        ),
      ),
    ).toEqual({ code: "invalid-keyframe-time", trackId: "t1", keyframeId: "k1" });

    expect(
      expectErr(
        decodeAnimation(
          documentWith(1000, false, [
            positionTrack("t1", "n1", [
              { id: "k1", timeMs: 0, value: vec3(0, 0, 0) },
              { id: "k1", timeMs: 5, value: vec3(1, 1, 1) },
            ]),
          ]),
        ),
      ),
    ).toEqual({ code: "duplicate-keyframe-id", trackId: "t1", keyframeId: "k1" });

    expect(
      expectErr(
        decodeAnimation(
          documentWith(1000, false, [
            {
              id: "t1",
              target: { kind: "node", nodeId: "n1" },
              channel: "position",
              keyframes: [{ id: "", timeMs: 0, value: vec3(0, 0, 0), easing: "linear" }],
            },
          ]),
        ),
      ),
    ).toEqual({ code: "invalid-animation-field", field: "keyframe.id" });
  });

  it("rejects channels that do not belong to the target", () => {
    expect(
      expectErr(
        decodeAnimation(
          documentWith(1000, false, [
            {
              id: "t1",
              target: { kind: "camera" },
              channel: "scale",
              keyframes: [{ id: "k1", timeMs: 0, value: vec3(1, 1, 1), easing: "linear" }],
            },
          ]),
        ),
      ),
    ).toEqual({ code: "invalid-track-channel", trackId: "t1", channel: "scale" });


    expect(
      expectErr(
        decodeAnimation(
          documentWith(1000, false, [
            {
              id: "t1",
              target: { kind: "node", nodeId: "n1" },
              channel: "fov",
              keyframes: [{ id: "k1", timeMs: 0, value: 0.8, easing: "linear" }],
            },
          ]),
        ),
      ),
    ).toEqual({ code: "invalid-track-channel", trackId: "t1", channel: "fov" });

    expect(
      expectErr(
        decodeAnimation(
          documentWith(1000, false, [
            {
              id: "t1",
              target: { kind: "node", nodeId: "" },
              channel: "position",
              keyframes: [{ id: "k1", timeMs: 0, value: vec3(0, 0, 0), easing: "linear" }],
            },
          ]),
        ),
      ),
    ).toEqual({ code: "invalid-track-target", trackId: "t1" });

    expect(
      expectErr(
        decodeAnimation(documentWith(1000, false, [{ id: "t1", target: { kind: "camera" } }])),
      ),
    ).toEqual({ code: "invalid-animation-field", field: "channel" });
  });

  it("rejects illegal values, easings and fov ranges per channel", () => {
    expect(expectErr(decodeAnimation(documentWith(1000, false, [cameraFovTrack(0)]))).code).toBe(
      "invalid-keyframe-value",
    );
    expect(
      expectErr(decodeAnimation(documentWith(1000, false, [cameraFovTrack(0.8, "ease-in")]))).code,
    ).toBe("invalid-keyframe-easing");

    const rotationValue = (value: unknown): unknown =>
      documentWith(1000, false, [
        {
          id: "t1",
          target: { kind: "node", nodeId: "n1" },
          channel: "rotation",
          keyframes: [{ id: "k1", timeMs: 0, value, easing: "linear" }],
        },
      ]);

    expect(expectErr(decodeAnimation(rotationValue({ x: 0, y: 0, z: 0, w: 0.5 }))).code).toBe(
      "invalid-keyframe-value",
    );
    expect(
      expectErr(decodeAnimation(rotationValue({ x: 0, y: 0, z: 0, w: 1, w2: 0 }))).code,
    ).toBe("invalid-keyframe-value");

    const scaleValue = (value: unknown): unknown =>
      documentWith(1000, false, [
        {
          id: "t1",
          target: { kind: "node", nodeId: "n1" },
          channel: "scale",
          keyframes: [{ id: "k1", timeMs: 0, value, easing: "linear" }],
        },
      ]);

    expect(expectErr(decodeAnimation(scaleValue(vec3(1, 0, 1)))).code).toBe(
      "invalid-keyframe-value",
    );

    const positionValue = (value: unknown): unknown =>
      documentWith(1000, false, [
        {
          id: "t1",
          target: { kind: "node", nodeId: "n1" },
          channel: "position",
          keyframes: [{ id: "k1", timeMs: 0, value, easing: "linear" }],
        },
      ]);

    expect(expectErr(decodeAnimation(positionValue(vec3(0, 0, Infinity)))).code).toBe(
      "invalid-keyframe-value",
    );
    expect(expectOk(decodeAnimation(positionValue(vec3(0, 0, 0)))).tracks).toHaveLength(1);
  });

  it("round-trips through encodeAnimation", () => {
    const animation = document(
      documentWith(2000, true, [
        positionTrack("t1", "n1", [
          { id: "k1", timeMs: 0, value: vec3(0, 0, 0) },
          { id: "k2", timeMs: 500, value: vec3(0, 1, 0) },
        ]),
        {
          id: "t2",
          target: { kind: "camera" },
          channel: "fov",
          keyframes: [{ id: "k3", timeMs: 0, value: 0.8, easing: "smooth" }],
        },
      ]),
    );

    expect(expectOk(decodeAnimation(encodeAnimation(animation)))).toEqual(animation);
    expect(encodeAnimation(animation)).toEqual(animation);
  });
});

describe("validateAnimation", () => {
  it("accepts an empty document, since an empty timeline is persistable", () => {
    expect(validateAnimation(createDefaultAnimation(), SCENE).ok).toBe(true);
  });

  it("rejects missing and root node targets", () => {
    expect(
      expectErr(
        validateAnimation(
          document(
            documentWith(1000, false, [
              positionTrack("t1", "ghost", [{ id: "k1", timeMs: 0, value: vec3(0, 0, 0) }]),
            ]),
          ),
          SCENE,
        ),
      ),
    ).toEqual({ code: "node-target-not-found", trackId: "t1", nodeId: "ghost" });

    expect(
      expectErr(
        validateAnimation(
          document(
            documentWith(1000, false, [
              positionTrack("t1", "root", [{ id: "k1", timeMs: 0, value: vec3(0, 0, 0) }]),
            ]),
          ),
          SCENE,
        ),
      ),
    ).toEqual({ code: "node-target-is-root", trackId: "t1", nodeId: "root" });

    expect(validateAnimation(SINGLE_TRACK_DOCUMENT, SCENE).ok).toBe(true);
  });
});

describe("hasTracksForNode", () => {
  it("lists every track bound to the node and stays empty otherwise", () => {
    const animation = document(
      documentWith(1000, false, [
        positionTrack("t1", "n1", [{ id: "k1", timeMs: 0, value: vec3(0, 0, 0) }]),
        {
          id: "t0",
          target: { kind: "node", nodeId: "n1" },
          channel: "scale",
          keyframes: [{ id: "k2", timeMs: 0, value: vec3(1, 1, 1), easing: "linear" }],
        },
        cameraFovTrack(0.8),
      ]),
    );

    expect(hasTracksForNode(animation, NODE_1)).toEqual(["t0", "t1"]);
    expect(hasTracksForNode(animation, NODE_2)).toEqual([]);
    expect(hasTracksForNode(animation, ROOT)).toEqual([]);
  });
});

describe("document edits", () => {
  it("refuses a duration shorter than the last keyframe", () => {
    expect(expectErr(setDuration(TWO_KEYFRAME_DOCUMENT, 100))).toEqual({
      code: "duration-too-short",
      durationMs: 100,
      lastKeyframeMs: 500,
    });

    expect(expectOk(setDuration(TWO_KEYFRAME_DOCUMENT, 4000)).durationMs).toBe(4000);
    expect(expectOk(setDuration(TWO_KEYFRAME_DOCUMENT, 500)).durationMs).toBe(500);
    expect(expectErr(setDuration(SINGLE_TRACK_DOCUMENT, Number.NaN)).code).toBe(
      "invalid-animation-field",
    );
  });

  it("sets loop without replacing the tracks", () => {
    const looped = setLoop(SINGLE_TRACK_DOCUMENT, true);

    expect(looped.loop).toBe(true);
    expect(SINGLE_TRACK_DOCUMENT.loop).toBe(false);
    expect(looped.tracks).toBe(SINGLE_TRACK_DOCUMENT.tracks);
  });

  it("requires the first keyframe and one track per target and channel", () => {
    const created = expectOk(
      createTrack(
        createDefaultAnimation(),
        "t1",
        { kind: "node", nodeId: NODE_1 },
        "rotation",
        { id: "k1", timeMs: 0, value: QUAT_IDENTITY, easing: "linear" },
      ),
    );

    expect(created.tracks.map((track) => track.id)).toEqual(["t1"]);
    expect(
      expectErr(
        createTrack(
          created,
          "t2",
          { kind: "node", nodeId: NODE_1 },
          "rotation",
          { id: "k2", timeMs: 0, value: QUAT_IDENTITY, easing: "linear" },
        ),
      ),
    ).toEqual({
      code: "duplicate-track-target",
      trackId: "t2",
      target: { kind: "node", nodeId: "n1" },
      channel: "rotation",
    });
    expect(
      expectErr(
        createTrack(
          created,
          "t1",
          { kind: "node", nodeId: NODE_2 },
          "position",
          { id: "k3", timeMs: 0, value: vec3(0, 0, 0), easing: "linear" },
        ),
      ),
    ).toEqual({ code: "duplicate-track-id", trackId: "t1" });
    expect(
      expectErr(
        createTrack(
          createDefaultAnimation(),
          "t1",
          { kind: "camera" },
          "scale",
          { id: "k1", timeMs: 0, value: vec3(1, 1, 1), easing: "linear" },
        ),
      ),
    ).toEqual({ code: "invalid-track-channel", trackId: "t1", channel: "scale" });
    expect(
      expectErr(
        createTrack(
          createDefaultAnimation(),
          "t1",
          { kind: "camera" },
          "fov",
          { id: "k1", timeMs: 0, value: vec3(1, 1, 1), easing: "linear" },
        ),
      ),
    ).toEqual({ code: "invalid-keyframe-value", trackId: "t1", keyframeId: "k1" });
    expect(
      expectErr(
        createTrack(
          createDefaultAnimation(),
          "t1",
          { kind: "camera" },
          "fov",
          { id: "k1", timeMs: 5001, value: 0.8, easing: "linear" },
        ),
      ),
    ).toEqual({ code: "invalid-keyframe-time", trackId: "t1", keyframeId: "k1" });
  });

  it("replaces the keyframe at an occupied time and keeps the new id", () => {
    const overwritten = expectOk(
      addKeyframe(SINGLE_TRACK_DOCUMENT, "t1", positionKeyframe("k2", 0, vec3(5, 5, 5))),
    );
    const track = findTrack(overwritten, "t1");

    expect(track.keyframes.map((keyframe) => keyframe.id)).toEqual(["k2"]);
    expect(track.keyframes[0]?.value).toEqual(vec3(5, 5, 5));

    const inserted = expectOk(
      addKeyframe(SINGLE_TRACK_DOCUMENT, "t1", positionKeyframe("k2", 500, vec3(1, 0, 0))),
    );

    expect(findTrack(inserted, "t1").keyframes.map((keyframe) => keyframe.id)).toEqual([
      "k1",
      "k2",
    ]);
    expect(SINGLE_TRACK_DOCUMENT.tracks[0]?.keyframes).toHaveLength(1);
  });

  it("keeps an id unique within its track", () => {
    expect(
      expectErr(
        addKeyframe(TWO_KEYFRAME_DOCUMENT, "t1", positionKeyframe("k1", 250, vec3(2, 2, 2))),
      ),
    ).toEqual({ code: "duplicate-keyframe-id", trackId: "t1", keyframeId: "k1" });
    expect(
      expectErr(
        addKeyframe(SINGLE_TRACK_DOCUMENT, "missing", positionKeyframe("k9", 0, vec3(0, 0, 0))),
      ),
    ).toEqual({ code: "track-not-found", trackId: "missing" });
  });

  it("refuses to move or replace a keyframe onto another keyframe's time", () => {
    expect(expectErr(moveKeyframe(TWO_KEYFRAME_DOCUMENT, "t1", "k2", 0))).toEqual({
      code: "keyframe-time-occupied",
      trackId: "t1",
      timeMs: 0,
    });
    expect(
      expectErr(
        replaceKeyframe(TWO_KEYFRAME_DOCUMENT, "t1", positionKeyframe("k2", 0, vec3(1, 1, 1))),
      ),
    ).toEqual({ code: "keyframe-time-occupied", trackId: "t1", timeMs: 0 });
    expect(
      expectErr(
        replaceKeyframe(
          TWO_KEYFRAME_DOCUMENT,
          "t1",
          positionKeyframe("k2", 2000, vec3(1, 1, 1)),
        ),
      ),
    ).toEqual({ code: "invalid-keyframe-time", trackId: "t1", keyframeId: "k2" });
    expect(
      expectErr(
        replaceKeyframe(
          TWO_KEYFRAME_DOCUMENT,
          "t1",
          positionKeyframe("k9", 250, vec3(1, 1, 1)),
        ),
      ),
    ).toEqual({ code: "keyframe-not-found", trackId: "t1", keyframeId: "k9" });
    expect(expectErr(moveKeyframe(TWO_KEYFRAME_DOCUMENT, "t1", "k9", 250))).toEqual({
      code: "keyframe-not-found",
      trackId: "t1",
      keyframeId: "k9",
    });
  });

  it("moves and replaces a keyframe while keeping its id and order", () => {
    const moved = expectOk(moveKeyframe(TWO_KEYFRAME_DOCUMENT, "t1", "k2", 900));

    expect(
      findTrack(moved, "t1").keyframes.map((keyframe) => [keyframe.id, keyframe.timeMs]),
    ).toEqual([
      ["k1", 0],
      ["k2", 900],
    ]);

    const replaced = expectOk(
      replaceKeyframe(
        TWO_KEYFRAME_DOCUMENT,
        "t1",
        positionKeyframe("k1", 250, vec3(4, 4, 4), "smooth"),
      ),
    );
    const replacedKeyframes = findTrack(replaced, "t1").keyframes;

    expect(replacedKeyframes.map((keyframe) => [keyframe.id, keyframe.timeMs])).toEqual([
      ["k1", 250],
      ["k2", 500],
    ]);
    expect(replacedKeyframes[0]?.value).toEqual(vec3(4, 4, 4));
    expect(replacedKeyframes[0]?.easing).toBe("smooth");
  });

  it("drops the track with its last keyframe", () => {
    const oneLeft = expectOk(removeKeyframe(TWO_KEYFRAME_DOCUMENT, "t1", "k1"));

    expect(oneLeft.tracks.map((track) => track.id)).toEqual(["t1"]);
    expect(expectOk(removeKeyframe(oneLeft, "t1", "k2")).tracks).toEqual([]);
    expect(expectErr(removeKeyframe(TWO_KEYFRAME_DOCUMENT, "t1", "k9"))).toEqual({
      code: "keyframe-not-found",
      trackId: "t1",
      keyframeId: "k9",
    });
    expect(expectErr(deleteTrack(TWO_KEYFRAME_DOCUMENT, "missing")).code).toBe(
      "track-not-found",
    );
    expect(expectOk(deleteTrack(TWO_KEYFRAME_DOCUMENT, "t1")).tracks).toEqual([]);
  });

  it("never mutates the document it was given", () => {
    const before = encodeAnimation(TWO_KEYFRAME_DOCUMENT);

    expectErr(setDuration(TWO_KEYFRAME_DOCUMENT, 1));
    expectErr(
      addKeyframe(TWO_KEYFRAME_DOCUMENT, "t1", positionKeyframe("k1", 900, vec3(9, 9, 9))),
    );
    expectErr(moveKeyframe(TWO_KEYFRAME_DOCUMENT, "t1", "k1", 500));
    expectErr(deleteTrack(TWO_KEYFRAME_DOCUMENT, "missing"));

    expect(encodeAnimation(TWO_KEYFRAME_DOCUMENT)).toEqual(before);
    expect(findTrack(TWO_KEYFRAME_DOCUMENT, "t1").keyframes[0]?.value).toEqual(
      vec3(0, 0, 0),
    );
  });
});

describe("evaluateAnimation", () => {
  const linear = document(
    documentWith(1000, false, [
      positionTrack("tn1", "n1", [
        { id: "k1", timeMs: 0, value: vec3(0, 0, 0) },
        { id: "k2", timeMs: 1000, value: vec3(10, 0, 0) },
      ]),
      positionTrack("tn2", "n2", [{ id: "k3", timeMs: 500, value: vec3(1, 2, 3) }]),
    ]),
  );

  it("returns one merged entry per node, sorted by nodeId, without empty channels", () => {
    const evaluation = evaluateAnimation(linear, 500);

    expect(evaluation.nodes.map((entry) => entry.nodeId)).toEqual(["n1", "n2"]);
    expect(Object.keys(evaluation.nodes[0]?.transform ?? {})).toEqual(["position"]);
    expect("scale" in (evaluation.nodes[0]?.transform ?? {})).toBe(false);
    expect("camera" in evaluation).toBe(false);
  });

  it("interpolates position linearly and reports the effective time", () => {
    const evaluation = evaluateAnimation(linear, 250);

    expect(evaluation.timeMs).toBe(250);
    expect(evaluation.nodes[0]?.transform.position).toEqual(vec3(2.5, 0, 0));
  });

  it("clamps a non-looping document to its keyframe boundaries", () => {
    expect(evaluateAnimation(linear, -10).timeMs).toBe(0);
    expect(evaluateAnimation(linear, -10).nodes[0]?.transform.position).toEqual(vec3(0, 0, 0));
    expect(evaluateAnimation(linear, 9999).nodes[0]?.transform.position).toEqual(
      vec3(10, 0, 0),
    );
    // A track whose first keyframe is at 500ms reports it for every earlier time.
    expect(evaluateAnimation(linear, 0).nodes[1]?.transform.position).toEqual(vec3(1, 2, 3));
  });

  it("wraps a looping document instead of clamping it", () => {
    const looped = setLoop(linear, true);

    expect(evaluateAnimation(looped, 1250)).toEqual(evaluateAnimation(looped, 250));
    expect(evaluateAnimation(looped, -750).timeMs).toBe(250);
    expect(evaluateAnimation(looped, 1000).timeMs).toBe(0);
  });

  it("uses util/math.smoothstep for a smooth segment", () => {
    const smooth = document(
      documentWith(1000, false, [
        {
          id: "t1",
          target: { kind: "node", nodeId: "n1" },
          channel: "position",
          keyframes: [
            { id: "k1", timeMs: 0, value: vec3(0, 0, 0), easing: "smooth" },
            { id: "k2", timeMs: 1000, value: vec3(10, 0, 0), easing: "linear" },
          ],
        },
      ]),
    );

    expect(evaluateAnimation(smooth, 250).nodes[0]?.transform.position).toEqual(
      vec3Lerp(vec3(0, 0, 0), vec3(10, 0, 0), smoothstep(0.25)),
    );
  });

  it("slerps rotations and interpolates fov on the shared timeline", () => {
    const halfTurn: Quat = quatNormalize({ x: 0, y: 1, z: 0, w: 0 });
    const camera = document(
      documentWith(1000, false, [
        {
          id: "tr",
          target: { kind: "node", nodeId: "n1" },
          channel: "rotation",
          keyframes: [
            { id: "k1", timeMs: 0, value: QUAT_IDENTITY, easing: "linear" },
            { id: "k2", timeMs: 1000, value: halfTurn, easing: "linear" },
          ],
        },
        {
          id: "tf",
          target: { kind: "camera" },
          channel: "fov",
          keyframes: [
            { id: "k3", timeMs: 0, value: 1, easing: "linear" },
            { id: "k4", timeMs: 1000, value: 2, easing: "linear" },
          ],
        },
      ]),
    );

    const evaluation = evaluateAnimation(camera, 500);
    const rotation = evaluation.nodes[0]?.transform.rotation;

    expect(rotation?.y).toBeCloseTo(Math.SQRT1_2, 10);
    expect(rotation?.w).toBeCloseTo(Math.SQRT1_2, 10);
    expect(evaluation.camera).toEqual({ fov: 1.5 });
    expect(evaluateAnimation(camera, 500)).toEqual(evaluation);
  });

  it("deep-copies boundary values so the document cannot be aliased", () => {
    const evaluation = evaluateAnimation(linear, 0);
    const authored = findTrack(linear, "tn1").keyframes[0]?.value;

    expect(evaluation.nodes[0]?.transform.position).toEqual(authored);
    expect(evaluation.nodes[0]?.transform.position).not.toBe(authored);
    expect(evaluateAnimation(linear, 0)).not.toBe(evaluation);
  });
});
