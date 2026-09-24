import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Project } from '../src/document/project.js';
import { addKeyframe } from '../src/document/timeline.js';
import {
  PROJECT_FORMAT,
  PROJECT_VERSION,
  decodeCells,
  encodeCells,
  readJson,
  toJson,
} from '../src/document/serialize.js';
import { KEY_MAX, KEY_MIN, UniformGrid, packKey } from '../src/voxels/uniform/grid.js';
import { DEFAULT_CELL_BUDGET } from '../src/voxels/voxelize/voxelize.js';

/** The cells of a grid as a coordinate-to-color map, so a right count with a wrong pairing cannot pass. */
function cellMap(grid: UniformGrid): Map<string, number> {
  const cells = new Map<string, number>();
  grid.forEach((x, y, z, color) => cells.set(`${x},${y},${z}`, color));
  return cells;
}

/** One indexed entry of a fixture or a parsed file: `undefined` is a broken fixture, never a valid input. */
function entry<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`fixture: no entry ${index}`);
  return item;
}

/** A varint stream of `values`, for hand-built payloads the writer would never produce. */
function varintBytes(values: readonly number[]): string {
  const bytes: number[] = [];
  for (const value of values) {
    let rest = value;
    while (rest >= 0x80) {
      bytes.push((rest & 0x7f) | 0x80);
      rest = Math.floor(rest / 128);
    }
    bytes.push(rest);
  }
  return btoa(String.fromCharCode(...bytes));
}

/** One payload as a mutable record, so a single field can be broken without rebuilding the rest. */
function broken(payload: object): Record<string, unknown> {
  return { ...payload };
}

function oneProject(): Project {
  const project = new Project();
  const group = project.createObject({ name: 'group', representation: 'empty' });
  const grid = UniformGrid.create(2);
  grid.set(0, 0, 0, 0x112233);
  grid.set(1, 0, 0, 0x445566);
  grid.set(1, 1, 0, 0x112233);
  const part = project.createVoxelObject({
    name: 'part',
    parentId: group.id,
    maskColor: 0x778899,
    payload: { kind: 'uniform', grid },
    position: new Vector3(2, 0, -1),
  });
  project.camera.fov = 55;
  project.timeline.durationMs = 2000;
  project.timeline.fps = 25;
  addKeyframe(project.timeline, { kind: 'object', objectId: part.id }, 'position', 500, [1, 0, -1]);
  addKeyframe(project.timeline, { kind: 'camera' }, 'fov', 1000, [70]);
  return project;
}

/** The file a project writes, parsed so a single field can be broken before the reader sees it. */
type FileDocument = {
  format: unknown;
  version: unknown;
  counters: { nextId: number; maskCursor: number };
  settings: unknown;
  camera: unknown;
  objects: Record<string, unknown>[];
  timeline: { durationMs: number; fps: number; tracks: Record<string, unknown>[] };
};

function fileOf(project: Project): FileDocument {
  return JSON.parse(toJson(project)) as FileDocument;
}

function keyframesOf(file: FileDocument): Record<string, unknown>[] {
  const keyframes = entry(file.timeline.tracks, 0)['keyframes'];
  if (!Array.isArray(keyframes)) throw new Error('fixture: the track carries no keyframe array');
  return keyframes as Record<string, unknown>[];
}

describe('encodeCells / decodeCells', () => {
  it('round-trips a unit-lattice grid cell for cell', () => {
    const grid = UniformGrid.create();
    grid.set(0, 0, 0, 0xabcdef);
    grid.set(3, -2, 5, 0x010203);
    grid.set(-4, 0, 1, 0xabcdef);

    const decoded = decodeCells(encodeCells(grid));

    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.grid.subdivision).toBe(1);
    expect(decoded.grid.size).toBe(3);
    expect(cellMap(decoded.grid)).toEqual(cellMap(grid));
  });

  it('round-trips a subdivided grid with its level', () => {
    const grid = UniformGrid.create(8);
    grid.set(-1, 0, 2, 0x00ff00);
    grid.set(7, 7, 7, 0x123456);

    const decoded = decodeCells(encodeCells(grid));

    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.grid.subdivision).toBe(8);
    expect(decoded.grid.cellSize).toBe(0.125);
    expect(cellMap(decoded.grid)).toEqual(cellMap(grid));
  });

  it('round-trips an empty grid', () => {
    const payload = encodeCells(UniformGrid.create(4));

    expect(payload.cellCount).toBe(0);
    const decoded = decodeCells(payload);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.grid.size).toBe(0);
    expect(decoded.grid.bounds()).toBeNull();
    expect(decoded.grid.subdivision).toBe(4);
  });

  it('keeps negative coordinates and both key-space ends', () => {
    const grid = UniformGrid.create();
    grid.set(KEY_MIN, KEY_MIN, KEY_MIN, 0x111111);
    grid.set(KEY_MAX, KEY_MAX, KEY_MAX, 0x222222);
    grid.set(0, -1, 1, 0x333333);

    const decoded = decodeCells(encodeCells(grid));

    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(cellMap(decoded.grid)).toEqual(cellMap(grid));
    expect(decoded.grid.getColor(KEY_MIN, KEY_MIN, KEY_MIN)).toBe(0x111111);
    expect(decoded.grid.getColor(KEY_MAX, KEY_MAX, KEY_MAX)).toBe(0x222222);
  });

  it('builds a palette in first-use order and widens the index past 256 colors', () => {
    const narrow = UniformGrid.create();
    narrow.set(1, 0, 0, 0x0000ff);
    narrow.set(0, 0, 0, 0xff0000);
    narrow.set(2, 0, 0, 0x0000ff);
    const narrowPayload = encodeCells(narrow);

    // Keys ascend, so the palette follows the ascending cells rather than the insertion order.
    expect(narrowPayload.palette).toEqual([0xff0000, 0x0000ff]);
    expect(narrowPayload.indexWidth).toBe(1);

    const wide = UniformGrid.create();
    for (let index = 0; index < 300; index += 1) wide.set(index, 0, 0, index + 1);
    const widePayload = encodeCells(wide);

    expect(widePayload.palette.length).toBe(300);
    expect(widePayload.indexWidth).toBe(2);
    const decoded = decodeCells(widePayload);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(cellMap(decoded.grid)).toEqual(cellMap(wide));
  });

  it('delta-encodes a non-contiguous cell set', () => {
    const contiguous = UniformGrid.create();
    for (let x = 0; x < 32; x += 1) contiguous.set(x, 0, 0, 0xffffff);
    const spread = UniformGrid.create();
    for (let x = 0; x < 32; x += 1) spread.set(x * 16, 0, 0, 0xffffff);

    const contiguousPayload = encodeCells(contiguous);
    const spreadPayload = encodeCells(spread);

    // Both hold 32 cells; the gaps are what a delta stream has to pay for, and nothing else about them differs.
    expect(spreadPayload.cellCount).toBe(contiguousPayload.cellCount);
    expect(spreadPayload.keys.length).toBeGreaterThan(contiguousPayload.keys.length);
    const decoded = decodeCells(spreadPayload);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(cellMap(decoded.grid)).toEqual(cellMap(spread));
  });

  it('rejects a key outside the key space', () => {
    const payload = {
      subdivision: 1,
      codec: 'varint-keys-palette',
      cellCount: 1,
      keys: varintBytes([packKey(KEY_MAX, KEY_MAX, KEY_MAX) + 1]),
      palette: [0xffffff],
      indexWidth: 1,
      index: btoa(String.fromCharCode(0)),
    };

    const decoded = decodeCells(payload);

    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.detail).toContain('key space');
  });

  it('rejects a subdivision that is not a power of two', () => {
    const decoded = decodeCells({ ...encodeCells(UniformGrid.create()), subdivision: 3 });

    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.detail).toContain('subdivision');
  });

  it('rejects an index stream shorter than the cell count', () => {
    const grid = UniformGrid.create();
    grid.set(0, 0, 0, 0xffffff);
    grid.set(1, 0, 0, 0xffffff);

    const decoded = decodeCells({ ...encodeCells(grid), index: btoa(String.fromCharCode(0)) });

    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.detail).toContain('index bytes');
  });

  it('rejects an index that leaves the palette', () => {
    const grid = UniformGrid.create();
    grid.set(0, 0, 0, 0xffffff);

    const decoded = decodeCells({ ...encodeCells(grid), index: btoa(String.fromCharCode(3)) });

    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.detail).toContain('palette');
  });

  it('rejects a repeated key', () => {
    // Two cells whose second delta is zero: the same key twice, which is a corrupt payload rather than a
    // duplicated cell, because one container holds one coordinate once.
    const payload = broken(encodeCells(UniformGrid.create()));
    Object.assign(payload, {
      cellCount: 2,
      keys: varintBytes([packKey(0, 0, 0), 0]),
      palette: [0xffffff],
      indexWidth: 1,
      index: btoa(String.fromCharCode(0, 0)),
    });

    const decoded = decodeCells(payload);

    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.detail).toContain('key stream');
  });
});

describe('toJson / readJson', () => {
  it('round-trips a project through restore, keeping keyframe ids and the counters', () => {
    const source = oneProject();
    const objectIds = [...source.objects.keys()];
    const loadedKeyframes = source.timeline.tracks.flatMap((track) =>
      track.keyframes.map((keyframe) => keyframe.id),
    );

    const result = readJson(toJson(source));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const target = new Project();
    target.restore(result.data);

    expect(target.snapshot()).toEqual(source.snapshot());
    // The counters a file carries are what keeps the next minted id clear of everything loaded.
    const minted = target.createObject({ name: 'after load', representation: 'empty' });
    expect(objectIds).not.toContain(minted.id);
    const added = addKeyframe(target.timeline, { kind: 'camera' }, 'fov', 1500, [80]);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(loadedKeyframes).not.toContain(added.keyframe.id);
  });

  it('reports parse-failed', () => {
    expect(readJson('not json at all')).toMatchObject({ ok: false, error: 'parse-failed' });
    expect(readJson('   ')).toMatchObject({ ok: false, error: 'parse-failed' });
    expect(readJson('[1, 2, 3]')).toMatchObject({ ok: false, error: 'parse-failed' });
  });

  it('reports unsupported-format', () => {
    const file = fileOf(oneProject());
    file.format = 'another-tool';

    expect(readJson(JSON.stringify(file))).toMatchObject({ ok: false, error: 'unsupported-format' });
    expect(PROJECT_FORMAT).toBe('vox-world-project');
  });

  it('reports unsupported-version', () => {
    const file = fileOf(oneProject());
    file.version = PROJECT_VERSION + 1;

    expect(readJson(JSON.stringify(file))).toMatchObject({ ok: false, error: 'unsupported-version' });
  });

  it('reports bad-structure', () => {
    const file = fileOf(oneProject());
    file.camera = null;

    expect(readJson(JSON.stringify(file))).toMatchObject({ ok: false, error: 'bad-structure' });
  });

  it('reports bad-hierarchy for a dangling parent', () => {
    const file = fileOf(oneProject());
    entry(file.objects, 1)['parentId'] = 'obj-99';

    expect(readJson(JSON.stringify(file))).toMatchObject({ ok: false, error: 'bad-hierarchy' });
  });

  it('reports bad-hierarchy for a cycle', () => {
    const file = fileOf(oneProject());
    const first = entry(file.objects, 0);
    const second = entry(file.objects, 1);
    first['parentId'] = second['id'];
    second['parentId'] = first['id'];

    expect(readJson(JSON.stringify(file))).toMatchObject({
      ok: false,
      error: 'bad-hierarchy',
      detail: expect.stringContaining('closes'),
    });
  });

  it('reports bad-cell for an unusable payload', () => {
    const file = fileOf(oneProject());
    entry(file.objects, 1)['uniform'] = { ...encodeCells(UniformGrid.create()), subdivision: 3 };

    expect(readJson(JSON.stringify(file))).toMatchObject({ ok: false, error: 'bad-cell' });
  });

  it('reports bad-keyframe for a wrong value length', () => {
    const file = fileOf(oneProject());
    entry(keyframesOf(file), 0)['value'] = [1, 0];

    expect(readJson(JSON.stringify(file))).toMatchObject({ ok: false, error: 'bad-keyframe' });
  });

  it('reports bad-keyframe for a time past the duration', () => {
    const file = fileOf(oneProject());
    entry(keyframesOf(file), 0)['timeMs'] = file.timeline.durationMs + 1;

    expect(readJson(JSON.stringify(file))).toMatchObject({ ok: false, error: 'bad-keyframe' });
  });

  it('reports bad-keyframe for a track on a missing object', () => {
    const file = fileOf(oneProject());
    entry(file.timeline.tracks, 0)['target'] = { kind: 'object', objectId: 'obj-99' };

    expect(readJson(JSON.stringify(file))).toMatchObject({ ok: false, error: 'bad-keyframe' });
  });

  it('reports budget-exceeded', () => {
    const file = fileOf(oneProject());
    const payload = entry(file.objects, 1)['uniform'];
    if (typeof payload !== 'object' || payload === null) throw new Error('fixture: no payload');
    (payload as Record<string, unknown>)['cellCount'] = DEFAULT_CELL_BUDGET + 1;

    expect(readJson(JSON.stringify(file))).toMatchObject({ ok: false, error: 'budget-exceeded' });
  });

  it('leaves the open project untouched when a file is refused', () => {
    const project = oneProject();
    const before = project.snapshot();

    const file = fileOf(project);
    file.version = PROJECT_VERSION + 1;
    expect(readJson(JSON.stringify(file)).ok).toBe(false);
    expect(readJson(toJson(project).slice(0, 40)).ok).toBe(false);

    expect(project.snapshot()).toEqual(before);
  });
});
