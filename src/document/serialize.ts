/**
 * The file boundary of the document: the project truth as one versioned JSON document, and back (README D51).
 *
 * `toJson` reads a `Project` and writes what a file carries of it. `readJson` validates a file completely —
 * format, version, structure, hierarchy, cell payloads, keyframes, and the voxel budget — and hands back a
 * `ProjectData` for `Project.restore`, or one of the eight error literals. Nothing here throws for a value that
 * could come from a file, and nothing here writes into a project: a refused file leaves the caller's project
 * exactly as it was. It owns no project state, builds no `Project`, and touches no derived resource.
 */
import { Quaternion, Vector3 } from 'three';
import { DEFAULT_CELL_BUDGET } from '../voxels/voxelize/voxelize.js';
import { KEY_MAX, UniformGrid, isSubdivision, packKey, unpackKey } from '../voxels/uniform/grid.js';
import type { HexColor } from '../voxels/uniform/grid.js';
import { channelValueSize, trackKey } from './timeline.js';
import type { Keyframe, Timeline, TrackChannel, TrackTarget } from './timeline.js';
import { isObjectId } from './project.js';
import type {
  CameraSettings,
  ObjectId,
  Project,
  ProjectCounters,
  ProjectData,
  ProjectSettings,
  Transform,
} from './project.js';

/** The `format` field every file carries. */
export const PROJECT_FORMAT = 'vox-world-project';
/** The schema version this reader knows; a file claiming another one is refused, never guessed at. */
export const PROJECT_VERSION = 1;
/** The one cell encoding v1 writes, named inside every payload so a second one can be added additively. */
const CELL_CODEC = 'varint-keys-palette';
/** Bytes per `String.fromCharCode` call, so a multi-megabyte stream cannot blow the argument limit. */
const BINARY_CHUNK = 0x8000;
/** The largest key `packKey` produces, derived from the key space's own bound rather than written out again. */
const MAX_CELL_KEY = packKey(KEY_MAX, KEY_MAX, KEY_MAX);

export type ProjectFileError =
  | 'parse-failed'
  | 'unsupported-format'
  | 'unsupported-version'
  | 'bad-structure'
  | 'bad-hierarchy'
  | 'bad-cell'
  | 'bad-keyframe'
  | 'budget-exceeded';

export type ProjectFileResult =
  | { ok: true; data: ProjectData }
  | { ok: false; error: ProjectFileError; detail: string };

export type CellCodec = 'varint-keys-palette';

/** One object's cells as the file stores them: ascending packed keys as varint deltas, plus a palette. */
export type CellPayload = {
  subdivision: number;
  codec: CellCodec;
  cellCount: number;
  keys: string;
  palette: number[];
  indexWidth: 1 | 2;
  index: string;
};

type Failure = { ok: false; error: ProjectFileError; detail: string };
/** Either the value a reader built or the reason it refused the file. */
type Read<T> = T | Failure;

function fail(error: ProjectFileError, detail: string): Failure {
  return { ok: false, error, detail };
}

/** True for a refusal, so a reader can return what an inner read rejected as its own result. */
function failed<T>(value: Read<T>): value is Failure {
  return typeof value === 'object' && value !== null && 'ok' in value && value.ok === false;
}

/**
 * The boundary's one shape check: a plain JSON object, which is what every nested value a reader looks inside
 * has to be. Its fields stay `unknown`, and each reader names the ones it uses, so no field's type is implied
 * by this guard.
 */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A finite JSON number: the only number a vector, a time, or a color may be built from. */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += BINARY_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BINARY_CHUNK));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** LEB128 deltas of an ascending key sequence: a run of contiguous cells costs one byte per cell. */
function writeVarints(keys: readonly number[]): Uint8Array {
  const bytes: number[] = [];
  let previous = 0;
  for (const key of keys) {
    let delta = key - previous;
    previous = key;
    while (delta >= 0x80) {
      bytes.push((delta & 0x7f) | 0x80);
      delta = Math.floor(delta / 128);
    }
    bytes.push(delta);
  }
  return Uint8Array.from(bytes);
}

/**
 * The inverse, which also enforces what a cell set has to be: keys ascend strictly (a repeated or descending
 * key is a corrupt payload, not a duplicated cell), every key lands inside the packed key space, and a trailing
 * continuation byte means the stream was cut short. `undefined` is a refusal, never a partial decode.
 */
function readVarints(bytes: Uint8Array): number[] | undefined {
  const keys: number[] = [];
  let pending = 0;
  let shift = 1;
  let previous = 0;
  let first = true;
  for (const byte of bytes) {
    pending += (byte & 0x7f) * shift;
    if ((byte & 0x80) !== 0) {
      shift *= 128;
      continue;
    }
    if (!first && pending === 0) return undefined;
    const key = first ? pending : previous + pending;
    if (key < 0 || key > MAX_CELL_KEY) return undefined;
    keys.push(key);
    previous = key;
    first = false;
    pending = 0;
    shift = 1;
  }
  return shift === 1 ? keys : undefined;
}

/**
 * One grid as a payload: keys sorted ascending with each color carried along, a palette in the order the
 * cells first use a color, one palette index per cell, and both byte streams base64-encoded (README D51).
 */
export function encodeCells(grid: UniformGrid): CellPayload {
  const ordered: { key: number; color: HexColor }[] = [];
  grid.forEach((x, y, z, color) => {
    ordered.push({ key: packKey(x, y, z), color });
  });
  // The color travels with its own key: sorting the keys alone would pair them with another cell's color.
  ordered.sort((left, right) => left.key - right.key);

  const keys: number[] = [];
  const slots: number[] = [];
  const palette: number[] = [];
  const slotOf = new Map<HexColor, number>();
  for (const cell of ordered) {
    keys.push(cell.key);
    let slot = slotOf.get(cell.color);
    if (slot === undefined) {
      slot = palette.length;
      slotOf.set(cell.color, slot);
      palette.push(cell.color);
    }
    slots.push(slot);
  }

  // One byte per index covers the palettes real content produces; a wider one is what a content-specific
  // palette needs, and a fixed width would corrupt the other side of that boundary.
  const indexWidth: 1 | 2 = palette.length <= 256 ? 1 : 2;
  const index = new Uint8Array(slots.length * indexWidth);
  slots.forEach((slot, position) => {
    if (indexWidth === 1) {
      index[position] = slot;
      return;
    }
    index[position * 2] = slot & 0xff;
    index[position * 2 + 1] = (slot >>> 8) & 0xff;
  });

  return {
    subdivision: grid.subdivision,
    codec: CELL_CODEC,
    cellCount: slots.length,
    keys: toBase64(writeVarints(keys)),
    palette,
    indexWidth,
    index: toBase64(index),
  };
}

/**
 * The one grid a payload describes, or the reason it cannot. It validates before it constructs — the level, the
 * codec, the counts, the palette, the index stream, and every key — so it never returns a grid that violates
 * `UniformGrid`'s own invariants, and it builds into a local grid, which is what makes a refused payload leave
 * the caller with nothing at all.
 */
export function decodeCells(payload: unknown): { ok: true; grid: UniformGrid } | { ok: false; detail: string } {
  if (!isJsonObject(payload)) return { ok: false, detail: 'cells are not an object' };
  const subdivision = payload['subdivision'];
  if (!isFiniteNumber(subdivision) || !isSubdivision(subdivision)) {
    return { ok: false, detail: `subdivision ${String(subdivision)} is not an integer power of two >= 1` };
  }
  if (payload['codec'] !== CELL_CODEC) {
    return { ok: false, detail: `codec ${String(payload['codec'])} is not ${CELL_CODEC}` };
  }
  const cellCount = payload['cellCount'];
  if (!isFiniteNumber(cellCount) || !Number.isInteger(cellCount) || cellCount < 0) {
    return { ok: false, detail: `cellCount ${String(cellCount)} is not a non-negative integer` };
  }
  const indexWidth = payload['indexWidth'];
  if (indexWidth !== 1 && indexWidth !== 2) {
    return { ok: false, detail: `indexWidth ${String(indexWidth)} is neither 1 nor 2` };
  }
  const paletteField = payload['palette'];
  if (!Array.isArray(paletteField)) return { ok: false, detail: 'palette is not an array' };
  const palette: HexColor[] = [];
  for (const entry of paletteField) {
    if (!isFiniteNumber(entry) || !Number.isInteger(entry) || entry < 0 || entry > 0xffffff) {
      return { ok: false, detail: `palette entry ${String(entry)} is not a 0xRRGGBB integer` };
    }
    palette.push(entry);
  }
  const keysField = payload['keys'];
  const indexField = payload['index'];
  if (typeof keysField !== 'string' || typeof indexField !== 'string') {
    return { ok: false, detail: 'keys and index must be base64 strings' };
  }
  let keys: number[] | undefined;
  let index: Uint8Array;
  try {
    keys = readVarints(fromBase64(keysField));
    index = fromBase64(indexField);
  } catch (error) {
    return { ok: false, detail: `a base64 stream is malformed (${messageOf(error)})` };
  }
  if (keys === undefined) {
    return { ok: false, detail: 'the key stream is truncated, descending, or outside the key space' };
  }
  if (keys.length !== cellCount) {
    return { ok: false, detail: `${keys.length} keys for ${cellCount} cells` };
  }
  if (index.length !== cellCount * indexWidth) {
    return { ok: false, detail: `${index.length} index bytes for ${cellCount} cells at ${indexWidth} bytes each` };
  }

  const grid = UniformGrid.create(subdivision);
  for (let position = 0; position < keys.length; position += 1) {
    const key = keys[position];
    if (key === undefined) return { ok: false, detail: `no key for cell ${position}` };
    const slot =
      indexWidth === 1
        ? (index[position] ?? 0)
        : (index[position * 2] ?? 0) | ((index[position * 2 + 1] ?? 0) << 8);
    const color = palette[slot];
    if (color === undefined) {
      return { ok: false, detail: `index ${slot} leaves a palette of ${palette.length} colors` };
    }
    const [x, y, z] = unpackKey(key);
    grid.set(x, y, z, color);
  }
  return { ok: true, grid };
}

function readVector3(value: unknown): Vector3 | undefined {
  if (!Array.isArray(value) || value.length !== 3) return undefined;
  const [x, y, z] = value;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return undefined;
  return new Vector3(x, y, z);
}

function readQuaternion(value: unknown): Quaternion | undefined {
  if (!Array.isArray(value) || value.length !== 4) return undefined;
  const [x, y, z, w] = value;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z) || !isFiniteNumber(w)) return undefined;
  return new Quaternion(x, y, z, w);
}

function readTransform(value: unknown, where: string): Read<Transform> {
  if (!isJsonObject(value)) return fail('bad-structure', `${where}: transform is not an object`);
  const position = readVector3(value['position']);
  const quaternion = readQuaternion(value['quaternion']);
  const scale = readVector3(value['scale']);
  if (position === undefined || quaternion === undefined || scale === undefined) {
    return fail(
      'bad-structure',
      `${where}: transform needs a finite position[3], quaternion[4], and scale[3]`,
    );
  }
  return { position, quaternion, scale };
}

function readCamera(value: unknown): Read<CameraSettings> {
  if (!isJsonObject(value)) return fail('bad-structure', 'camera: expected an object');
  const fov = value['fov'];
  const near = value['near'];
  const far = value['far'];
  if (!isFiniteNumber(fov) || !isFiniteNumber(near) || !isFiniteNumber(far)) {
    return fail('bad-structure', 'camera: fov, near, and far must be finite numbers');
  }
  const transform = readTransform(value['transform'], 'camera');
  if (failed(transform)) return transform;
  return { fov, near, far, transform };
}

function readSettings(value: unknown): Read<ProjectSettings> {
  if (!isJsonObject(value)) return fail('bad-structure', 'settings: expected an object');
  const background = value['background'];
  const ambientIntensity = value['ambientIntensity'];
  if (!isFiniteNumber(background) || !Number.isInteger(background) || background < 0 || background > 0xffffff) {
    return fail('bad-structure', `settings: background ${String(background)} is not a 0xRRGGBB integer`);
  }
  if (!isFiniteNumber(ambientIntensity)) {
    return fail('bad-structure', `settings: ambientIntensity ${String(ambientIntensity)} is not a finite number`);
  }
  return { background, ambientIntensity };
}

function readCounters(value: unknown): Read<ProjectCounters> {
  if (!isJsonObject(value)) return fail('bad-structure', 'counters: expected an object');
  const nextId = value['nextId'];
  const maskCursor = value['maskCursor'];
  if (!isFiniteNumber(nextId) || !Number.isInteger(nextId) || nextId < 0) {
    return fail('bad-structure', `counters: nextId ${String(nextId)} is not a non-negative integer`);
  }
  if (!isFiniteNumber(maskCursor) || !Number.isInteger(maskCursor) || maskCursor < 0) {
    return fail('bad-structure', `counters: maskCursor ${String(maskCursor)} is not a non-negative integer`);
  }
  return { nextId, maskCursor };
}

/**
 * Every object of a file, with its cells, in file order. It enforces the whole object rule set: the id shape,
 * unique ids, a resolving `parentId`, a payload exactly when the representation says so, and the budget, which
 * is accumulated as the payloads decode so an oversized file is refused before the rest of it is built.
 */
function readObjects(value: unknown): Read<ProjectData['objects']> {
  if (!Array.isArray(value)) return fail('bad-structure', 'objects: expected an array');
  const objects: ProjectData['objects'] = [];
  const seen = new Set<ObjectId>();
  let totalCells = 0;
  for (const entry of value) {
    const where = `objects[${objects.length}]`;
    if (!isJsonObject(entry)) return fail('bad-structure', `${where}: expected an object`);
    const id = entry['id'];
    if (!isObjectId(id)) return fail('bad-structure', `${where}: id ${String(id)} is not obj-<n>`);
    if (seen.has(id)) return fail('bad-hierarchy', `${where}: duplicate object id`);
    seen.add(id);
    const name = entry['name'];
    if (typeof name !== 'string') return fail('bad-structure', `${id}: name is not a string`);
    const parentField = entry['parentId'];
    if (parentField !== null && typeof parentField !== 'string') {
      return fail('bad-structure', `${id}: parentId is neither null nor an object id`);
    }
    const transform = readTransform(entry['transform'], id);
    if (failed(transform)) return transform;
    const representation = entry['representation'];
    if (representation !== 'empty' && representation !== 'uniform') {
      return fail('bad-structure', `${id}: representation ${String(representation)} is neither empty nor uniform`);
    }
    const maskColor = entry['maskColor'];
    if (!isFiniteNumber(maskColor) || !Number.isInteger(maskColor) || maskColor < 0 || maskColor > 0xffffff) {
      return fail('bad-structure', `${id}: maskColor ${String(maskColor)} is not a 0xRRGGBB integer`);
    }
    const visible = entry['visible'];
    const alignToGrid = entry['alignToGrid'];
    if (typeof visible !== 'boolean' || typeof alignToGrid !== 'boolean') {
      return fail('bad-structure', `${id}: visible and alignToGrid must be booleans`);
    }
    const object: ProjectData['objects'][number] = {
      id,
      name,
      parentId: parentField === null ? null : parentField,
      transform,
      representation,
      maskColor,
      visible,
      alignToGrid,
    };
    const payload = entry['uniform'];
    if (representation === 'uniform') {
      // The declared count is what the budget is checked against, so an oversized file is refused before any
      // of its cells are built; a count that lies the other way is what `decodeCells` catches below.
      const declared = isJsonObject(payload) ? payload['cellCount'] : undefined;
      if (isFiniteNumber(declared) && declared >= 0) {
        totalCells += declared;
        if (totalCells > DEFAULT_CELL_BUDGET) {
          return fail('budget-exceeded', `${totalCells} cells exceed the budget of ${DEFAULT_CELL_BUDGET}`);
        }
      }
      const decoded = decodeCells(payload);
      if (!decoded.ok) return fail('bad-cell', `${id}: ${decoded.detail}`);
      object.uniform = decoded.grid;
    } else if (payload !== undefined) {
      return fail('bad-structure', `${id}: an empty object carries a uniform payload`);
    }
    objects.push(object);
  }

  // Hierarchy: every parent resolves, and no chain closes on itself. A cycle is a walk that never reaches a
  // root, so with at most one parent per object a chain longer than the object count has closed on itself.
  const byId = new Map<ObjectId, ProjectData['objects'][number]>();
  for (const object of objects) byId.set(object.id, object);
  for (const object of objects) {
    if (object.parentId !== null && !byId.has(object.parentId)) {
      return fail('bad-hierarchy', `${object.id}: parent ${object.parentId} is not in the file`);
    }
  }
  for (const object of objects) {
    let steps = 0;
    let current: ProjectData['objects'][number] | undefined = object;
    while (current !== undefined && current.parentId !== null) {
      steps += 1;
      if (steps > objects.length) return fail('bad-hierarchy', `${object.id}: parent chain closes on itself`);
      current = byId.get(current.parentId);
    }
  }
  return objects;
}

function readTarget(value: unknown, objectIds: ReadonlySet<ObjectId>, where: string): Read<TrackTarget> {
  if (!isJsonObject(value)) return fail('bad-keyframe', `${where}: target is not an object`);
  const kind = value['kind'];
  if (kind === 'camera') return { kind: 'camera' };
  if (kind !== 'object') {
    return fail('bad-keyframe', `${where}: target kind ${String(kind)} is neither camera nor object`);
  }
  const objectId = value['objectId'];
  if (!isObjectId(objectId) || !objectIds.has(objectId)) {
    return fail('bad-keyframe', `${where}: target object ${String(objectId)} is not in the file`);
  }
  return { kind: 'object', objectId };
}

/**
 * One keyframe, validated against the channel it belongs to. A time outside the clip is refused rather than
 * clamped: a load is not an edit, and `clampTime`'s rounding is the authoring path's rule, not the reader's.
 */
function readKeyframe(
  value: unknown,
  channel: TrackChannel,
  durationMs: number,
  ids: Set<string>,
  where: string,
): Read<Keyframe> {
  if (!isJsonObject(value)) return fail('bad-keyframe', `${where}: a keyframe is not an object`);
  const id = value['id'];
  if (typeof id !== 'string' || id.length === 0) {
    return fail('bad-keyframe', `${where}: a keyframe id is not a non-empty string`);
  }
  if (ids.has(id)) return fail('bad-keyframe', `${where}: keyframe id ${id} appears twice`);
  ids.add(id);
  const timeMs = value['timeMs'];
  if (!isFiniteNumber(timeMs) || !Number.isInteger(timeMs) || timeMs < 0 || timeMs > durationMs) {
    return fail(
      'bad-keyframe',
      `${where}: keyframe ${id} is at ${String(timeMs)}, outside the whole milliseconds of [0, ${durationMs}]`,
    );
  }
  const size = channelValueSize(channel);
  const rawValue = value['value'];
  if (!Array.isArray(rawValue) || rawValue.length !== size) {
    return fail('bad-keyframe', `${where}: keyframe ${id} needs ${size} numbers for ${channel}`);
  }
  const numbers: number[] = [];
  for (const entry of rawValue) {
    if (!isFiniteNumber(entry)) {
      return fail('bad-keyframe', `${where}: keyframe ${id} holds a non-finite value`);
    }
    numbers.push(entry);
  }
  return { id, timeMs, value: numbers };
}

function readTimeline(value: unknown, objectIds: ReadonlySet<ObjectId>): Read<Timeline> {
  if (!isJsonObject(value)) return fail('bad-structure', 'timeline: expected an object');
  const durationMs = value['durationMs'];
  const fps = value['fps'];
  if (!isFiniteNumber(durationMs) || !Number.isInteger(durationMs) || durationMs < 0) {
    return fail('bad-structure', `timeline: durationMs ${String(durationMs)} is not a non-negative integer`);
  }
  if (!isFiniteNumber(fps) || !Number.isInteger(fps) || fps < 1) {
    return fail('bad-structure', `timeline: fps ${String(fps)} is not a positive integer`);
  }
  const tracksField = value['tracks'];
  if (!Array.isArray(tracksField)) return fail('bad-structure', 'timeline: tracks is not an array');

  const tracks: Timeline['tracks'] = [];
  const pairs = new Set<string>();
  const keyframeIds = new Set<string>();
  for (const entry of tracksField) {
    const where = `tracks[${tracks.length}]`;
    if (!isJsonObject(entry)) return fail('bad-structure', `${where}: expected an object`);
    const channel = entry['channel'];
    if (channel !== 'position' && channel !== 'quaternion' && channel !== 'scale' && channel !== 'fov') {
      return fail('bad-keyframe', `${where}: channel ${String(channel)} is not one of the four`);
    }
    const interpolation = entry['interpolation'];
    if (interpolation !== 'step' && interpolation !== 'linear' && interpolation !== 'smooth') {
      return fail(
        'bad-keyframe',
        `${where}: interpolation ${String(interpolation)} is not step, linear, or smooth`,
      );
    }
    const target = readTarget(entry['target'], objectIds, where);
    if (failed(target)) return target;
    const pair = trackKey(target, channel);
    if (pairs.has(pair)) return fail('bad-keyframe', `${where}: a second track for ${pair}`);
    pairs.add(pair);
    const keyframesField = entry['keyframes'];
    if (!Array.isArray(keyframesField)) return fail('bad-keyframe', `${pair}: keyframes is not an array`);

    const keyframes: Keyframe[] = [];
    let previousTime = -1;
    for (const raw of keyframesField) {
      const keyframe = readKeyframe(raw, channel, durationMs, keyframeIds, pair);
      if (failed(keyframe)) return keyframe;
      if (keyframe.timeMs <= previousTime) {
        return fail('bad-keyframe', `${pair}: keyframe ${keyframe.id} is not after the one before it`);
      }
      previousTime = keyframe.timeMs;
      keyframes.push(keyframe);
    }
    tracks.push({ target, channel, interpolation, keyframes });
  }
  return { durationMs, fps, tracks };
}

/** The project as one JSON document: the whole truth, no derived resource, no session state (README D51). */
export function toJson(project: Project): string {
  const data = project.snapshot();
  return JSON.stringify({
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    counters: data.counters,
    settings: data.settings,
    camera: {
      fov: data.camera.fov,
      near: data.camera.near,
      far: data.camera.far,
      transform: {
        position: data.camera.transform.position.toArray(),
        quaternion: data.camera.transform.quaternion.toArray(),
        scale: data.camera.transform.scale.toArray(),
      },
    },
    objects: data.objects.map((object) => ({
      id: object.id,
      name: object.name,
      parentId: object.parentId,
      transform: {
        position: object.transform.position.toArray(),
        quaternion: object.transform.quaternion.toArray(),
        scale: object.transform.scale.toArray(),
      },
      representation: object.representation,
      maskColor: object.maskColor,
      visible: object.visible,
      alignToGrid: object.alignToGrid,
      // An empty object carries no payload; the field is absent rather than null, so a reader's own rule
      // ("a payload exactly when the representation says so") is the only thing that decides.
      ...(object.uniform === undefined ? {} : { uniform: encodeCells(object.uniform) }),
    })),
    timeline: {
      durationMs: data.timeline.durationMs,
      fps: data.timeline.fps,
      tracks: data.timeline.tracks.map((track) => ({
        target: track.target,
        channel: track.channel,
        interpolation: track.interpolation,
        keyframes: track.keyframes.map((keyframe) => ({
          id: keyframe.id,
          timeMs: keyframe.timeMs,
          value: keyframe.value,
        })),
      })),
    },
  });
}

/**
 * The `ProjectData` a file describes, or the first rule it breaks. It writes nothing anywhere, so a caller's
 * project is untouched until `Project.restore` is handed a result that passed every check here.
 */
export function readJson(text: string): ProjectFileResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return fail('parse-failed', messageOf(error));
  }
  if (!isJsonObject(parsed)) return fail('parse-failed', 'the top-level value is not a JSON object');
  if (parsed['format'] !== PROJECT_FORMAT) {
    return fail('unsupported-format', `format is ${String(parsed['format'])}, expected ${PROJECT_FORMAT}`);
  }
  if (parsed['version'] !== PROJECT_VERSION) {
    return fail('unsupported-version', `version is ${String(parsed['version'])}, this build reads ${PROJECT_VERSION}`);
  }

  const objects = readObjects(parsed['objects']);
  if (failed(objects)) return objects;
  const camera = readCamera(parsed['camera']);
  if (failed(camera)) return camera;
  const settings = readSettings(parsed['settings']);
  if (failed(settings)) return settings;
  const counters = readCounters(parsed['counters']);
  if (failed(counters)) return counters;
  const timeline = readTimeline(parsed['timeline'], new Set(objects.map((object) => object.id)));
  if (failed(timeline)) return timeline;

  return { ok: true, data: { objects, camera, settings, timeline, counters } };
}
