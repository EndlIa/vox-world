import {
  approximatelyEqual,
  clamp,
  lerp,
  quatNormalize,
  quatSlerp,
  smoothstep,
  vec3Lerp,
  type Quat,
  type Vec3,
} from "../../util/math";
import { err, ok, type Result } from "../../util/result";
import {
  sceneNodeId,
  type SceneNodeId,
  type SceneSnapshot,
  type SceneTransform,
} from "../scene/scene-types";

/** Timeline length of a project that has never been edited. */
const DEFAULT_DURATION_MS = 5000;

type NodeTransformTarget = Readonly<{ kind: "node"; nodeId: SceneNodeId }>;
type CameraTarget = Readonly<{ kind: "camera" }>;

/** What a track can be attached to. See `AnimationTrack`. */
export type AnimationTarget = NodeTransformTarget | CameraTarget;

/** Every channel name that appears in the document, across both target kinds. */
export type AnimationChannelName = "position" | "rotation" | "scale" | "fov";

/** Channels a node track may drive; `fov` belongs to the camera alone. */
const NODE_CHANNELS: readonly AnimationChannelName[] = [
  "position",
  "rotation",
  "scale",
];

/** Channels a camera track may drive; the camera has no scale. */
const CAMERA_CHANNELS: readonly AnimationChannelName[] = [
  "position",
  "rotation",
  "fov",
];

export type AnimationKeyframe<T> = Readonly<{
  id: string;
  timeMs: number;
  value: T;
  easing: "linear" | "smooth";
}>;

/** Keyframe value as it crosses the API boundary, before the channel check. */
type AnimationChannelValue = Vec3 | Quat | number;

/** Module-internal helper; the union below is the public shape. */
type AnimationTrackOf<TTarget, TChannel, TValue> = Readonly<{
  id: string;
  target: TTarget;
  channel: TChannel;
  keyframes: readonly AnimationKeyframe<TValue>[];
}>;

export type NodePositionTrack = AnimationTrackOf<
  NodeTransformTarget,
  "position",
  Vec3
>;
export type NodeRotationTrack = AnimationTrackOf<
  NodeTransformTarget,
  "rotation",
  Quat
>;
export type NodeScaleTrack = AnimationTrackOf<NodeTransformTarget, "scale", Vec3>;
export type CameraPositionTrack = AnimationTrackOf<CameraTarget, "position", Vec3>;
export type CameraRotationTrack = AnimationTrackOf<CameraTarget, "rotation", Quat>;
export type CameraFovTrack = AnimationTrackOf<CameraTarget, "fov", number>;

export type AnimationTrack =
  | NodePositionTrack
  | NodeRotationTrack
  | NodeScaleTrack
  | CameraPositionTrack
  | CameraRotationTrack
  | CameraFovTrack;

/** Minimal camera pose the renderer consumes; `fov` is always radians. */
export type AnimationCameraPose = Readonly<{
  position: Vec3;
  rotation: Quat;
  fov: number;
}>;

/**
 * Overrides produced by one evaluation. `nodes` is sorted by `nodeId`, channels
 * of one node are merged, and a channel without an override is absent rather
 * than `undefined`.
 */
export type AnimationEvaluation = Readonly<{
  timeMs: number;
  nodes: readonly Readonly<{
    nodeId: SceneNodeId;
    transform: Partial<SceneTransform>;
  }>[];
  camera?: Partial<AnimationCameraPose>;
}>;

export type AnimationDocument = Readonly<{
  version: 1;
  durationMs: number;
  loop: boolean;
  tracks: readonly AnimationTrack[];
}>;

/**
 * Every recoverable animation failure. Structure, rule and reference codes come
 * from this module; `node-referenced-by-animation` and
 * `animation-playback-active` are produced by the application layer but belong
 * to the same vocabulary, so one `Result` channel serves every layer.
 *
 * `invalid-animation-field` names the failing field path — `"durationMs"`,
 * `"target"`, `"keyframe.id"`, an unknown key, ...
 */
export type AnimationError =
  | Readonly<{ code: "unsupported-animation-version"; version: number }>
  | Readonly<{ code: "invalid-animation-field"; field: string }>
  | Readonly<{ code: "duplicate-track-id"; trackId: string }>
  | Readonly<{ code: "invalid-track-target"; trackId: string }>
  | Readonly<{ code: "invalid-track-channel"; trackId: string; channel: string }>
  | Readonly<{
      code: "duplicate-track-target";
      trackId: string;
      target: AnimationTarget;
      channel: AnimationChannelName;
    }>
  | Readonly<{ code: "empty-track"; trackId: string }>
  | Readonly<{ code: "duplicate-keyframe-id"; trackId: string; keyframeId: string }>
  | Readonly<{ code: "invalid-keyframe-time"; trackId: string; keyframeId: string }>
  | Readonly<{ code: "invalid-keyframe-easing"; trackId: string; keyframeId: string }>
  | Readonly<{ code: "invalid-keyframe-value"; trackId: string; keyframeId: string }>
  | Readonly<{ code: "track-not-found"; trackId: string }>
  | Readonly<{ code: "keyframe-not-found"; trackId: string; keyframeId: string }>
  | Readonly<{ code: "keyframe-time-occupied"; trackId: string; timeMs: number }>
  | Readonly<{
      code: "duration-too-short";
      durationMs: number;
      lastKeyframeMs: number;
    }>
  | Readonly<{ code: "node-target-not-found"; trackId: string; nodeId: string }>
  | Readonly<{ code: "node-target-is-root"; trackId: string; nodeId: string }>
  | Readonly<{
      code: "node-referenced-by-animation";
      nodeId: string;
      trackIds: readonly string[];
    }>
  | Readonly<{ code: "animation-playback-active" }>;

/** Boundary shapes of `decodeAnimation`. Every field is re-validated here. */
type DocumentInput = Readonly<{
  version?: unknown;
  durationMs?: unknown;
  loop?: unknown;
  tracks?: unknown;
}>;
type TrackInput = Readonly<{
  id?: unknown;
  target?: unknown;
  channel?: unknown;
  keyframes?: unknown;
}>;
type KeyframeInput = Readonly<{
  id?: unknown;
  timeMs?: unknown;
  value?: unknown;
  easing?: unknown;
}>;
type TargetInput = Readonly<{ kind?: unknown; nodeId?: unknown }>;
type Vec3Input = Readonly<{ x?: unknown; y?: unknown; z?: unknown }>;
type QuatInput = Readonly<{ x?: unknown; y?: unknown; z?: unknown; w?: unknown }>;

/** Node transform channel of one evaluation pass. */
type NodeTransformChannels = {
  position?: Vec3;
  rotation?: Quat;
  scale?: Vec3;
};

/** Camera pose channel of one evaluation pass. */
type CameraPoseChannels = {
  position?: Vec3;
  rotation?: Quat;
  fov?: number;
};

/** JSON object: not `null` and not an array. Field shapes are checked one by one. */
function isJsonObject(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Unknown keys of a decoded record, sorted so the reported failure is stable. */
function unexpectedKeys(value: object, allowed: readonly string[]): readonly string[] {
  return Object.keys(value)
    .filter((key) => !allowed.includes(key))
    .sort();
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isEasing(value: unknown): value is "linear" | "smooth" {
  return value === "linear" || value === "smooth";
}

function isChannelName(value: unknown): value is AnimationChannelName {
  return (
    value === "position" ||
    value === "rotation" ||
    value === "scale" ||
    value === "fov"
  );
}

function isChannelForTarget(
  target: AnimationTarget,
  channel: AnimationChannelName,
): boolean {
  return (target.kind === "node" ? NODE_CHANNELS : CAMERA_CHANNELS).includes(channel);
}

/** Finite `{ x, y, z }` and nothing else. */
function readVec3(value: unknown): Vec3 | null {
  if (!isJsonObject(value)) {
    return null;
  }

  if (unexpectedKeys(value, ["x", "y", "z"]).length > 0) {
    return null;
  }

  const input = value as Vec3Input;
  const x = readFiniteNumber(input.x);
  const y = readFiniteNumber(input.y);
  const z = readFiniteNumber(input.z);

  if (x === null || y === null || z === null) {
    return null;
  }

  return { x, y, z };
}

/** Finite `{ x, y, z }` with no zero component: a zero scale is not invertible. */
function readNonZeroVec3(value: unknown): Vec3 | null {
  const vector = readVec3(value);

  if (vector === null) {
    return null;
  }

  if (
    approximatelyEqual(vector.x, 0) ||
    approximatelyEqual(vector.y, 0) ||
    approximatelyEqual(vector.z, 0)
  ) {
    return null;
  }

  return vector;
}

/**
 * Finite, unit-length raw quaternion. `quatNormalize` mints the brand only
 * after these checks, so damaged data is never silently repaired.
 */
function readUnitQuat(value: unknown): Quat | null {
  if (!isJsonObject(value)) {
    return null;
  }

  if (unexpectedKeys(value, ["x", "y", "z", "w"]).length > 0) {
    return null;
  }

  const input = value as QuatInput;
  const x = readFiniteNumber(input.x);
  const y = readFiniteNumber(input.y);
  const z = readFiniteNumber(input.z);
  const w = readFiniteNumber(input.w);

  if (x === null || y === null || z === null || w === null) {
    return null;
  }

  const length = Math.sqrt(x * x + y * y + z * z + w * w);

  if (!approximatelyEqual(length, 1)) {
    return null;
  }

  return quatNormalize({ x, y, z, w });
}

/** Radians, strictly positive: the unit `camera-control` and `domain/render` use. */
function readPositiveNumber(value: unknown): number | null {
  const number = readFiniteNumber(value);

  return number !== null && number > 0 ? number : null;
}

/** Runtime value check of one channel, shared by every edit entry point. */
function isValueForChannel(
  channel: AnimationChannelName,
  value: unknown,
): boolean {
  switch (channel) {
    case "position":
      return readVec3(value) !== null;
    case "scale":
      return readNonZeroVec3(value) !== null;
    case "rotation":
      return readUnitQuat(value) !== null;
    case "fov":
      return readPositiveNumber(value) !== null;
  }
}

/** Deep copy of a sampled value, so no caller aliases a document value. */
function copyVec3(vector: Vec3): Vec3 {
  return { x: vector.x, y: vector.y, z: vector.z };
}

function copyQuat(rotation: Quat): Quat {
  return quatNormalize(rotation);
}

function copyNumber(value: number): number {
  return value;
}

function compareIds(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

/** Identity of a track target for the single-track-per-target+channel rule. */
function targetKey(target: AnimationTarget, channel: AnimationChannelName): string {
  return `${target.kind}:${target.kind === "node" ? target.nodeId : ""}:${channel}`;
}

function sortTracks(tracks: readonly AnimationTrack[]): readonly AnimationTrack[] {
  return [...tracks].sort((left, right) => compareIds(left.id, right.id));
}

function sortKeyframes(
  keyframes: readonly AnimationKeyframe<AnimationChannelValue>[],
): readonly AnimationKeyframe<AnimationChannelValue>[] {
  return [...keyframes].sort((left, right) => left.timeMs - right.timeMs);
}

/**
 * Rebuilds one track of the union from widened keyframes, deep-copying values
 * and dropping every field outside the contract. Values already passed a
 * validation entry point, so a read failure here is a broken invariant.
 */
function rebuildTrack(
  id: string,
  target: AnimationTarget,
  channel: AnimationChannelName,
  keyframes: readonly AnimationKeyframe<AnimationChannelValue>[],
): AnimationTrack {
  switch (channel) {
    case "position": {
      const values = keyframes.map((keyframe) => {
        const value = readVec3(keyframe.value);

        if (value === null) {
          throw new Error("Animation position keyframe lost its vector value");
        }

        return { ...keyframe, value };
      });

      // Identical arms are intentional: the condition narrows `target` to this
      // channel variant's target type.
      return target.kind === "node"
        ? { id, target, channel, keyframes: values }
        : { id, target, channel, keyframes: values };
    }
    case "scale": {
      if (target.kind === "camera") {
        throw new Error("Camera track cannot drive scale");
      }

      const values = keyframes.map((keyframe) => {
        const value = readNonZeroVec3(keyframe.value);

        if (value === null) {
          throw new Error("Animation scale keyframe lost its vector value");
        }

        return { ...keyframe, value };
      });

      return { id, target, channel, keyframes: values };
    }
    case "rotation": {
      const values = keyframes.map((keyframe) => {
        const value = readUnitQuat(keyframe.value);

        if (value === null) {
          throw new Error("Animation rotation keyframe lost its unit quaternion");
        }

        return { ...keyframe, value };
      });

      // Identical arms are intentional: the condition narrows `target` to this
      // channel variant's target type.
      return target.kind === "node"
        ? { id, target, channel, keyframes: values }
        : { id, target, channel, keyframes: values };
    }
    case "fov": {
      if (target.kind === "node") {
        throw new Error("Node track cannot drive fov");
      }

      const values = keyframes.map((keyframe) => {
        const value = readPositiveNumber(keyframe.value);

        if (value === null) {
          throw new Error("Animation fov keyframe lost its positive number");
        }

        return { ...keyframe, value };
      });

      return { id, target, channel, keyframes: values };
    }
  }
}

/** Last keyframe time of every track, or `null` when the document has none. */
function lastKeyframeTime(document: AnimationDocument): number | null {
  let last: number | null = null;

  for (const track of document.tracks) {
    const keyframe = track.keyframes[track.keyframes.length - 1];

    if (keyframe === undefined) {
      continue;
    }

    if (last === null || keyframe.timeMs > last) {
      last = keyframe.timeMs;
    }
  }

  return last;
}

/** Value, time and easing check shared by every keyframe entry point. */
function checkKeyframe(
  trackId: string,
  channel: AnimationChannelName,
  keyframe: AnimationKeyframe<AnimationChannelValue>,
  durationMs: number,
): AnimationError | null {
  if (keyframe.id.length === 0) {
    return { code: "invalid-animation-field", field: "keyframe.id" };
  }

  if (
    !Number.isFinite(keyframe.timeMs) ||
    keyframe.timeMs < 0 ||
    keyframe.timeMs > durationMs
  ) {
    return { code: "invalid-keyframe-time", trackId, keyframeId: keyframe.id };
  }

  if (!isEasing(keyframe.easing)) {
    return { code: "invalid-keyframe-easing", trackId, keyframeId: keyframe.id };
  }

  if (!isValueForChannel(channel, keyframe.value)) {
    return { code: "invalid-keyframe-value", trackId, keyframeId: keyframe.id };
  }

  return null;
}

function decodeTrackTarget(
  value: unknown,
  trackId: string,
): Result<AnimationTarget, AnimationError> {
  if (!isJsonObject(value)) {
    return err({ code: "invalid-track-target", trackId });
  }

  const input = value as TargetInput;

  if (input.kind === "camera") {
    return unexpectedKeys(value, ["kind"]).length > 0
      ? err({ code: "invalid-track-target", trackId })
      : ok({ kind: "camera" });
  }

  if (input.kind !== "node" || unexpectedKeys(value, ["kind", "nodeId"]).length > 0) {
    return err({ code: "invalid-track-target", trackId });
  }

  const rawNodeId = readNonEmptyString(input.nodeId);

  if (rawNodeId === null) {
    return err({ code: "invalid-track-target", trackId });
  }

  const nodeId = sceneNodeId(rawNodeId);

  if (!nodeId.ok) {
    return err({ code: "invalid-track-target", trackId });
  }

  return ok({ kind: "node", nodeId: nodeId.value });
}

/** Parses keyframes with the value reader of one channel. */
function decodeKeyframes<T>(
  value: unknown,
  trackId: string,
  durationMs: number,
  readValue: (raw: unknown) => T | null,
): Result<readonly AnimationKeyframe<T>[], AnimationError> {
  if (!Array.isArray(value)) {
    return err({ code: "invalid-animation-field", field: "keyframes" });
  }

  if (value.length === 0) {
    return err({ code: "empty-track", trackId });
  }

  const entries: readonly unknown[] = value;
  const keyframes: AnimationKeyframe<T>[] = [];
  const seenIds = new Set<string>();
  let previousTimeMs = Number.NEGATIVE_INFINITY;

  for (const entry of entries) {
    if (!isJsonObject(entry)) {
      return err({ code: "invalid-animation-field", field: "keyframes[]" });
    }

    const [unknownKey] = unexpectedKeys(entry, ["id", "timeMs", "value", "easing"]);

    if (unknownKey !== undefined) {
      return err({ code: "invalid-animation-field", field: `keyframe.${unknownKey}` });
    }

    const input = entry as KeyframeInput;
    const keyframeId = readNonEmptyString(input.id);

    if (keyframeId === null) {
      return err({ code: "invalid-animation-field", field: "keyframe.id" });
    }

    if (seenIds.has(keyframeId)) {
      return err({ code: "duplicate-keyframe-id", trackId, keyframeId });
    }

    const timeMs = readFiniteNumber(input.timeMs);

    if (
      timeMs === null ||
      timeMs < 0 ||
      timeMs > durationMs ||
      timeMs <= previousTimeMs
    ) {
      return err({ code: "invalid-keyframe-time", trackId, keyframeId });
    }

    if (!isEasing(input.easing)) {
      return err({ code: "invalid-keyframe-easing", trackId, keyframeId });
    }

    const parsed = readValue(input.value);

    if (parsed === null) {
      return err({ code: "invalid-keyframe-value", trackId, keyframeId });
    }

    seenIds.add(keyframeId);
    previousTimeMs = timeMs;
    keyframes.push({ id: keyframeId, timeMs, value: parsed, easing: input.easing });
  }

  return ok(keyframes);
}

/**
 * Parses one track. The `channel` switch is what ties a channel to its keyframe
 * value type, so no assertion is needed to build the union member.
 */
function decodeTrack(
  value: unknown,
  trackId: string,
  durationMs: number,
): Result<AnimationTrack, AnimationError> {
  if (!isJsonObject(value)) {
    return err({ code: "invalid-animation-field", field: "tracks[]" });
  }

  const [unknownKey] = unexpectedKeys(value, ["id", "target", "channel", "keyframes"]);

  if (unknownKey !== undefined) {
    return err({ code: "invalid-animation-field", field: unknownKey });
  }

  const input = value as TrackInput;

  const target = decodeTrackTarget(input.target, trackId);

  if (!target.ok) {
    return target;
  }

  if (input.channel === undefined) {
    return err({ code: "invalid-animation-field", field: "channel" });
  }

  if (!isChannelName(input.channel)) {
    return err({
      code: "invalid-track-channel",
      trackId,
      channel: String(input.channel),
    });
  }

  switch (input.channel) {
    case "position": {
      const keyframes = decodeKeyframes(
        input.keyframes,
        trackId,
        durationMs,
        readVec3,
      );

      if (!keyframes.ok) {
        return keyframes;
      }

      // Identical arms are intentional: the condition narrows the target type.
      return target.value.kind === "node"
        ? ok({
            id: trackId,
            target: target.value,
            channel: input.channel,
            keyframes: keyframes.value,
          })
        : ok({
            id: trackId,
            target: target.value,
            channel: input.channel,
            keyframes: keyframes.value,
          });
    }
    case "rotation": {
      const keyframes = decodeKeyframes(
        input.keyframes,
        trackId,
        durationMs,
        readUnitQuat,
      );

      if (!keyframes.ok) {
        return keyframes;
      }

      // Identical arms are intentional: the condition narrows the target type.
      return target.value.kind === "node"
        ? ok({
            id: trackId,
            target: target.value,
            channel: input.channel,
            keyframes: keyframes.value,
          })
        : ok({
            id: trackId,
            target: target.value,
            channel: input.channel,
            keyframes: keyframes.value,
          });
    }
    case "scale": {
      if (target.value.kind === "camera") {
        return err({ code: "invalid-track-channel", trackId, channel: input.channel });
      }

      const keyframes = decodeKeyframes(
        input.keyframes,
        trackId,
        durationMs,
        readNonZeroVec3,
      );

      if (!keyframes.ok) {
        return keyframes;
      }

      return ok({
        id: trackId,
        target: target.value,
        channel: input.channel,
        keyframes: keyframes.value,
      });
    }
    case "fov": {
      if (target.value.kind === "node") {
        return err({ code: "invalid-track-channel", trackId, channel: input.channel });
      }

      const keyframes = decodeKeyframes(
        input.keyframes,
        trackId,
        durationMs,
        readPositiveNumber,
      );

      if (!keyframes.ok) {
        return keyframes;
      }

      return ok({
        id: trackId,
        target: target.value,
        channel: input.channel,
        keyframes: keyframes.value,
      });
    }
  }
}

/** Builds the default, empty animation document of a new project. */
export function createDefaultAnimation(): AnimationDocument {
  return { version: 1, durationMs: DEFAULT_DURATION_MS, loop: false, tracks: [] };
}

/**
 * Strict V1 decoder. Accepts only a complete, self-consistent document; whether
 * a `nodeId` exists is `validateAnimation`'s job. The result is canonical:
 * tracks sorted by id, keyframes in `timeMs` order.
 */
export function decodeAnimation(
  value: unknown,
): Result<AnimationDocument, AnimationError> {
  if (!isJsonObject(value)) {
    return err({ code: "invalid-animation-field", field: "document" });
  }

  const [unknownKey] = unexpectedKeys(value, [
    "version",
    "durationMs",
    "loop",
    "tracks",
  ]);

  if (unknownKey !== undefined) {
    return err({ code: "invalid-animation-field", field: unknownKey });
  }

  const input = value as DocumentInput;

  if (input.version !== 1) {
    const version = readFiniteNumber(input.version);

    return version === null
      ? err({ code: "invalid-animation-field", field: "version" })
      : err({ code: "unsupported-animation-version", version });
  }

  const durationMs = readFiniteNumber(input.durationMs);

  if (durationMs === null || durationMs <= 0) {
    return err({ code: "invalid-animation-field", field: "durationMs" });
  }

  if (typeof input.loop !== "boolean") {
    return err({ code: "invalid-animation-field", field: "loop" });
  }

  if (!Array.isArray(input.tracks)) {
    return err({ code: "invalid-animation-field", field: "tracks" });
  }

  const tracks: AnimationTrack[] = [];
  const trackIds = new Set<string>();
  const targetKeys = new Set<string>();
  const trackEntries: readonly unknown[] = input.tracks;

  for (const entry of trackEntries) {
    if (!isJsonObject(entry)) {
      return err({ code: "invalid-animation-field", field: "tracks[]" });
    }

    const trackId = readNonEmptyString((entry as TrackInput).id);

    if (trackId === null) {
      return err({ code: "invalid-animation-field", field: "id" });
    }

    if (trackIds.has(trackId)) {
      return err({ code: "duplicate-track-id", trackId });
    }

    const track = decodeTrack(entry, trackId, durationMs);

    if (!track.ok) {
      return track;
    }

    const key = targetKey(track.value.target, track.value.channel);

    if (targetKeys.has(key)) {
      return err({
        code: "duplicate-track-target",
        trackId,
        target: track.value.target,
        channel: track.value.channel,
      });
    }

    trackIds.add(trackId);
    targetKeys.add(key);
    tracks.push(track.value);
  }

  return ok({
    version: 1,
    durationMs,
    loop: input.loop,
    tracks: sortTracks(tracks),
  });
}

/**
 * Scene-relative validation: every node track must point at an existing,
 * non-root node. An empty `tracks` array is legal here — refusing to start
 * playback on an empty document belongs to the playing layers.
 */
export function validateAnimation(
  document: AnimationDocument,
  scene: SceneSnapshot,
): Result<void, AnimationError> {
  const nodeIds = new Set<string>(scene.nodes.map((node) => node.id));

  for (const track of document.tracks) {
    if (track.target.kind !== "node") {
      continue;
    }

    const nodeId: string = track.target.nodeId;

    if (!nodeIds.has(nodeId)) {
      return err({ code: "node-target-not-found", trackId: track.id, nodeId });
    }

    if (nodeId === scene.rootNodeId) {
      return err({ code: "node-target-is-root", trackId: track.id, nodeId });
    }
  }

  return ok();
}

/** Ids of every node track bound to `nodeId`; empty when nothing references it. */
export function hasTracksForNode(
  document: AnimationDocument,
  nodeId: SceneNodeId,
): readonly string[] {
  const trackIds: string[] = [];

  for (const track of document.tracks) {
    if (track.target.kind === "node" && track.target.nodeId === nodeId) {
      trackIds.push(track.id);
    }
  }

  return trackIds;
}

export function setDuration(
  document: AnimationDocument,
  durationMs: number,
): Result<AnimationDocument, AnimationError> {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return err({ code: "invalid-animation-field", field: "durationMs" });
  }

  const lastKeyframeMs = lastKeyframeTime(document);

  if (lastKeyframeMs !== null && durationMs < lastKeyframeMs) {
    return err({ code: "duration-too-short", durationMs, lastKeyframeMs });
  }

  return ok({ ...document, durationMs });
}

/** Total function: a boolean loop flag cannot fail validation. */
export function setLoop(
  document: AnimationDocument,
  enabled: boolean,
): AnimationDocument {
  return { ...document, loop: enabled };
}

export function createTrack(
  document: AnimationDocument,
  trackId: string,
  target: AnimationTarget,
  channel: AnimationChannelName,
  keyframe: AnimationKeyframe<AnimationChannelValue>,
): Result<AnimationDocument, AnimationError> {
  if (trackId.length === 0) {
    return err({ code: "invalid-animation-field", field: "id" });
  }

  if (document.tracks.some((track) => track.id === trackId)) {
    return err({ code: "duplicate-track-id", trackId });
  }

  if (!isChannelForTarget(target, channel)) {
    return err({ code: "invalid-track-channel", trackId, channel });
  }

  const key = targetKey(target, channel);

  if (document.tracks.some((track) => targetKey(track.target, track.channel) === key)) {
    return err({ code: "duplicate-track-target", trackId, target, channel });
  }

  const failure = checkKeyframe(trackId, channel, keyframe, document.durationMs);

  if (failure !== null) {
    return err(failure);
  }

  const track = rebuildTrack(trackId, target, channel, [keyframe]);

  return ok({ ...document, tracks: sortTracks([...document.tracks, track]) });
}

export function addKeyframe(
  document: AnimationDocument,
  trackId: string,
  keyframe: AnimationKeyframe<AnimationChannelValue>,
): Result<AnimationDocument, AnimationError> {
  const track = document.tracks.find((entry) => entry.id === trackId);

  if (track === undefined) {
    return err({ code: "track-not-found", trackId });
  }

  const failure = checkKeyframe(trackId, track.channel, keyframe, document.durationMs);

  if (failure !== null) {
    return err(failure);
  }

  const sameId = track.keyframes.find((entry) => entry.id === keyframe.id);

  if (sameId !== undefined && sameId.timeMs !== keyframe.timeMs) {
    return err({ code: "duplicate-keyframe-id", trackId, keyframeId: keyframe.id });
  }

  // An occupied time is replaced on insertion: the old keyframe and its id are
  // removed, the new id survives. The user-visible notice belongs to the
  // application layer, not to this module.
  const remaining = track.keyframes.filter(
    (entry) => entry.id !== keyframe.id && entry.timeMs !== keyframe.timeMs,
  );
  const updated = rebuildTrack(
    track.id,
    track.target,
    track.channel,
    sortKeyframes([...remaining, keyframe]),
  );

  return ok({
    ...document,
    tracks: document.tracks.map((entry) => (entry.id === trackId ? updated : entry)),
  });
}

export function replaceKeyframe(
  document: AnimationDocument,
  trackId: string,
  keyframe: AnimationKeyframe<AnimationChannelValue>,
): Result<AnimationDocument, AnimationError> {
  const track = document.tracks.find((entry) => entry.id === trackId);

  if (track === undefined) {
    return err({ code: "track-not-found", trackId });
  }

  if (!track.keyframes.some((entry) => entry.id === keyframe.id)) {
    return err({ code: "keyframe-not-found", trackId, keyframeId: keyframe.id });
  }

  const failure = checkKeyframe(trackId, track.channel, keyframe, document.durationMs);

  if (failure !== null) {
    return err(failure);
  }

  const occupied = track.keyframes.some(
    (entry) => entry.id !== keyframe.id && entry.timeMs === keyframe.timeMs,
  );

  if (occupied) {
    return err({ code: "keyframe-time-occupied", trackId, timeMs: keyframe.timeMs });
  }

  const updated = rebuildTrack(
    track.id,
    track.target,
    track.channel,
    sortKeyframes(
      track.keyframes.map((entry) => (entry.id === keyframe.id ? keyframe : entry)),
    ),
  );

  return ok({
    ...document,
    tracks: document.tracks.map((entry) => (entry.id === trackId ? updated : entry)),
  });
}

export function moveKeyframe(
  document: AnimationDocument,
  trackId: string,
  keyframeId: string,
  timeMs: number,
): Result<AnimationDocument, AnimationError> {
  const track = document.tracks.find((entry) => entry.id === trackId);

  if (track === undefined) {
    return err({ code: "track-not-found", trackId });
  }

  if (!track.keyframes.some((entry) => entry.id === keyframeId)) {
    return err({ code: "keyframe-not-found", trackId, keyframeId });
  }

  if (!Number.isFinite(timeMs) || timeMs < 0 || timeMs > document.durationMs) {
    return err({ code: "invalid-keyframe-time", trackId, keyframeId });
  }

  const occupied = track.keyframes.some(
    (entry) => entry.id !== keyframeId && entry.timeMs === timeMs,
  );

  if (occupied) {
    return err({ code: "keyframe-time-occupied", trackId, timeMs });
  }

  const updated = rebuildTrack(
    track.id,
    track.target,
    track.channel,
    sortKeyframes(
      track.keyframes.map((entry) =>
        entry.id === keyframeId ? { ...entry, timeMs } : entry,
      ),
    ),
  );

  return ok({
    ...document,
    tracks: document.tracks.map((entry) => (entry.id === trackId ? updated : entry)),
  });
}

/** Removing the last keyframe of a track removes the track itself. */
export function removeKeyframe(
  document: AnimationDocument,
  trackId: string,
  keyframeId: string,
): Result<AnimationDocument, AnimationError> {
  const track = document.tracks.find((entry) => entry.id === trackId);

  if (track === undefined) {
    return err({ code: "track-not-found", trackId });
  }

  if (!track.keyframes.some((entry) => entry.id === keyframeId)) {
    return err({ code: "keyframe-not-found", trackId, keyframeId });
  }

  const keyframes = track.keyframes.filter((entry) => entry.id !== keyframeId);

  if (keyframes.length === 0) {
    return ok({
      ...document,
      tracks: document.tracks.filter((entry) => entry.id !== trackId),
    });
  }

  const updated = rebuildTrack(track.id, track.target, track.channel, keyframes);

  return ok({
    ...document,
    tracks: document.tracks.map((entry) => (entry.id === trackId ? updated : entry)),
  });
}

export function deleteTrack(
  document: AnimationDocument,
  trackId: string,
): Result<AnimationDocument, AnimationError> {
  if (!document.tracks.some((track) => track.id === trackId)) {
    return err({ code: "track-not-found", trackId });
  }

  return ok({
    ...document,
    tracks: document.tracks.filter((track) => track.id !== trackId),
  });
}

/** Canonical plain-data output for the persistence boundary. */
export function encodeAnimation(document: AnimationDocument): AnimationDocument {
  const tracks = sortTracks(document.tracks).map((track) =>
    rebuildTrack(
      track.id,
      track.target,
      track.channel,
      sortKeyframes(track.keyframes),
    ),
  );

  return {
    version: 1,
    durationMs: document.durationMs,
    loop: document.loop,
    tracks,
  };
}

/** Looped time lives in `0..durationMs)`; `-0` wraps onto `0`. */
function normalizeLoopedTime(timeMs: number, durationMs: number): number {
  return ((timeMs % durationMs) + durationMs) % durationMs;
}

/**
 * Samples one track. A single keyframe, or a time outside the track's own
 * range, yields a deep copy of the boundary keyframe's value.
 */
function sampleTrack<T>(
  keyframes: readonly AnimationKeyframe<T>[],
  timeMs: number,
  interpolate: (left: T, right: T, t: number) => T,
  copy: (value: T) => T,
): T {
  const first = keyframes[0];
  const last = keyframes[keyframes.length - 1];

  // Tracks always carry at least one keyframe; no caller can feed an empty one.
  if (first === undefined || last === undefined) {
    throw new Error("Animation track lost its keyframes");
  }

  if (keyframes.length === 1 || timeMs <= first.timeMs) {
    return copy(first.value);
  }

  if (timeMs >= last.timeMs) {
    return copy(last.value);
  }

  for (let index = 0; index < keyframes.length - 1; index += 1) {
    const left = keyframes[index];
    const right = keyframes[index + 1];

    if (left === undefined || right === undefined || timeMs > right.timeMs) {
      continue;
    }

    const raw = (timeMs - left.timeMs) / (right.timeMs - left.timeMs);
    const eased = left.easing === "smooth" ? smoothstep(raw) : raw;

    return interpolate(left.value, right.value, eased);
  }

  // The two boundary branches above cover every time outside `[first, last]`.
  throw new Error("Animation interpolation found no segment");
}

/**
 * Deterministic evaluation entry point shared by playback, screenshots and
 * offline rendering. `timeMs` of the result reports the effective (normalized
 * or clamped) time that the sampled values belong to.
 */
export function evaluateAnimation(
  document: AnimationDocument,
  timeMs: number,
): AnimationEvaluation {
  const effectiveTimeMs = document.loop
    ? normalizeLoopedTime(timeMs, document.durationMs)
    : clamp(timeMs, 0, document.durationMs);

  const nodeChannels = new Map<SceneNodeId, NodeTransformChannels>();
  let cameraChannels: CameraPoseChannels = {};

  const nodeEntry = (nodeId: SceneNodeId): NodeTransformChannels => {
    const existing = nodeChannels.get(nodeId);

    if (existing !== undefined) {
      return existing;
    }

    const created: NodeTransformChannels = {};
    nodeChannels.set(nodeId, created);

    return created;
  };

  for (const track of document.tracks) {
    switch (track.channel) {
      case "position": {
        const value = sampleTrack(track.keyframes, effectiveTimeMs, vec3Lerp, copyVec3);

        if (track.target.kind === "node") {
          nodeEntry(track.target.nodeId).position = value;
        } else {
          cameraChannels = { ...cameraChannels, position: value };
        }

        break;
      }
      case "rotation": {
        const value = sampleTrack(track.keyframes, effectiveTimeMs, quatSlerp, copyQuat);

        if (track.target.kind === "node") {
          nodeEntry(track.target.nodeId).rotation = value;
        } else {
          cameraChannels = { ...cameraChannels, rotation: value };
        }

        break;
      }
      case "scale": {
        nodeEntry(track.target.nodeId).scale = sampleTrack(
          track.keyframes,
          effectiveTimeMs,
          vec3Lerp,
          copyVec3,
        );

        break;
      }
      case "fov": {
        cameraChannels = {
          ...cameraChannels,
          fov: sampleTrack(track.keyframes, effectiveTimeMs, lerp, copyNumber),
        };

        break;
      }
    }
  }

  const nodes = [...nodeChannels.entries()]
    .sort(([left], [right]) => compareIds(left, right))
    .map(([nodeId, transform]) => ({ nodeId, transform }));

  return Object.keys(cameraChannels).length === 0
    ? { timeMs: effectiveTimeMs, nodes }
    : { timeMs: effectiveTimeMs, nodes, camera: cameraChannels };
}
