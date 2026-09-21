/**
 * GLB import.
 *
 * Reads a GLB byte buffer into an `ImportedScene`: one `ImportedNode` per mesh node, each carrying its
 * own world matrix, its geometry (referenced, never copied) and a `ColorSource` built from the material
 * and the geometry. It also bakes the node transforms into world-space triangle soups for the voxelizer
 * and turns an imported scene into document objects.
 *
 * A stylized export's decorative outline shells are flagged rather than dropped (README D27): they are
 * kept as nodes, so the raw-mesh display and the object list still show them, but they are left out of
 * the voxelize sources and out of `voxelizeBounds` — the extent the sizes derived from an import see.
 *
 * It does not voxelize, build render meshes, or sample a texture: it reads the base color texture's
 * pixels back out of the image and hands them, with the geometry's UVs and the material's alpha cutoff,
 * to `voxels/voxelize/colorSampler.ts`, which owns the sampling rules. It owns no scene state.
 */

import type { ObjectId } from '../document/project.js';
import { Project } from '../document/project.js';
import type { ColorSource } from '../voxels/voxelize/colorSampler.js';
import type { VoxelizeSource } from '../voxels/voxelize/voxelize.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';

const GLB_MAGIC = 0x46546c67; // 'glTF'
const GLB_VERSION = 2;
const GLB_JSON_CHUNK = 0x4e4f534a; // 'JSON'
const GLB_HEADER_BYTES = 12;
const GLB_CHUNK_HEADER_BYTES = 8;
const DEFAULT_BASE_COLOR = 0xffffff;
const VERTEX_COLOR_SIZE = 3;
/** Floats per texture coordinate in the geometry's `uv` attribute. */
const UV_COMPONENT_COUNT = 2;
/** Bytes per texel in an image readback: RGBA. */
const RGBA_COMPONENT_COUNT = 4;

/** Required extensions this importer refuses instead of half-loading (README section 12). */
const UNSUPPORTED_EXTENSIONS: readonly string[] = [
  'KHR_draco_mesh_compression',
  'EXT_meshopt_compression',
];

export type ImportedNode = {
  sourceId: string;
  name: string;
  geometry: THREE.BufferGeometry;
  matrixWorld: THREE.Matrix4;
  color: ColorSource;
  sourceMesh: THREE.Mesh;
  /**
   * True for a dedicated decorative outline shell (see `isDedicatedLineOutlineMesh`). Such a node is
   * still returned — it is part of how the source model looks, so the raw-mesh display and the object
   * list keep it — but it is never voxelized and never contributes to `voxelizeBounds`.
   */
  outline: boolean;
};

export type ImportedScene = {
  root: THREE.Object3D;
  nodes: ImportedNode[];
  /** Every node's bounds, outline shells included: this is what framing has to fit, because all of them are displayed. */
  bounds: THREE.Box3;
  /** The bounds of the non-outline nodes: the extent the sizes derived from an import are allowed to see. */
  voxelizeBounds: THREE.Box3;
};

export type ImportResult =
  | { ok: true; scene: ImportedScene }
  | { ok: false; error: 'parse-failed' | 'unsupported' | 'empty'; detail: string };

/** The validated GLB container: the two JSON fields read out of it before the loader runs. */
type Container = {
  extensionsRequired: string[];
  nodeCount: number;
};

/**
 * Reads a GLB into an `ImportedScene` of world-space mesh nodes.
 *
 * The container is validated before the loader sees it (magic, version, complete chunk table, JSON
 * chunk) and every unusable case is reported as data: `'parse-failed'`, `'unsupported'`, `'empty'`.
 * A failed import returns no scene, so no document object can be left behind.
 */
export async function importGlb(data: ArrayBuffer): Promise<ImportResult> {
  const container = readContainer(data);
  if ('error' in container) {
    return { ok: false, error: 'parse-failed', detail: container.error };
  }

  const unsupported = container.extensionsRequired.filter((extension) =>
    UNSUPPORTED_EXTENSIONS.includes(extension),
  );
  if (unsupported.length > 0) {
    return {
      ok: false,
      error: 'unsupported',
      detail: `required extension${unsupported.length === 1 ? '' : 's'} not supported: ${unsupported.join(', ')}`,
    };
  }

  let gltf: GLTF;
  try {
    gltf = await parseGlb(data);
  } catch (error) {
    return { ok: false, error: 'parse-failed', detail: messageOf(error) };
  }

  const root = gltf.scene;
  root.updateMatrixWorld(true);

  const associations = gltf.parser.associations;
  const usedSourceIds = new Set<string>();
  const nodes: ImportedNode[] = [];
  let meshIndex = 0;
  let failure: string | null = null;

  // Depth-first traversal order is the node order every downstream consumer sees.
  root.traverse((object) => {
    if (failure !== null) return;
    const mesh = asMesh(object);
    if (mesh === null) return;

    const sourceId = uniqueSourceId(associations.get(mesh)?.nodes, meshIndex, usedSourceIds);
    meshIndex += 1;

    const position = mesh.geometry.getAttribute('position');
    if (position === undefined || position.count === 0) {
      failure = `mesh node ${sourceId} has no usable position attribute`;
      return;
    }

    nodes.push({
      sourceId,
      name: mesh.name,
      geometry: mesh.geometry,
      matrixWorld: mesh.matrixWorld.clone(),
      color: colorSourceOf(mesh),
      sourceMesh: mesh,
      outline: isDedicatedLineOutlineMesh(mesh),
    });
  });

  if (failure !== null) {
    return { ok: false, error: 'unsupported', detail: failure };
  }
  if (nodes.length === 0) {
    return {
      ok: false,
      error: 'empty',
      detail: `no mesh node with geometry among ${container.nodeCount} glTF nodes`,
    };
  }

  // What is displayed is the whole scene, so the world bounds cover every node; what is voxelized is
  // the non-outline nodes, so the sizes derived from the import must not see the outline shells.
  const bounds = new THREE.Box3().setFromObject(root);
  const voxelizeBounds = new THREE.Box3();
  for (const node of nodes) {
    if (!node.outline) voxelizeBounds.expandByObject(node.sourceMesh);
  }

  return { ok: true, scene: { root, nodes, bounds, voxelizeBounds } };
}

/** The material name of a dedicated outline shell, matched after trimming and lowercasing. */
const LINE_OUTLINE_MATERIAL_NAME = 'line';

/**
 * Whether a mesh is a dedicated decorative outline shell rather than part of the model's own surface.
 *
 * The rule is the material's *name* and nothing else: at least one assigned material, and every one of
 * them named exactly `line` once trimmed and lowercased (the exporter that makes these shells writes
 * `*_Line _0` meshes with a `line` material). A mesh with no material is not an outline, and neither is
 * one whose materials include anything else, however dark it renders.
 *
 * Colour is deliberately not consulted: an ordinary black part of the model — a tire, a window frame —
 * is geometry the user asked for, so inferring "outline" from a black material would delete real
 * content. The name is the only signal that says a mesh exists to be drawn around another one, and it
 * is the one the whole file agrees on (README D27, ported from shithill `54b73b6`).
 */
export function isDedicatedLineOutlineMesh(mesh: THREE.Mesh): boolean {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return (
    materials.length > 0 &&
    materials.every((material) => material.name.trim().toLowerCase() === LINE_OUTLINE_MATERIAL_NAME)
  );
}

/** One base color texture's pixels: sRGB-encoded RGBA bytes, row-major from the top-left. */
type TexturePixels = { width: number; height: number; pixels: Uint8ClampedArray };

/**
 * Base color textures already read back, keyed by the texture object: the nodes of a GLB share a
 * handful of textures, so the same image must not be rasterized and read once per node. Only successful
 * reads are cached, so a texture whose image is not readable yet is retried instead of poisoned, and
 * the key is weak, so releasing a file's meshes releases its pixels.
 */
const textureCache = new WeakMap<THREE.Texture, TexturePixels>();

/**
 * The material half of a node's color: the material's base color factor as `THREE.Color.getHex()`, or
 * `0xffffff` for a material that carries no color at all, plus the material's base color texture — its
 * `map`, which is the slot `MeshStandardMaterial` and `MeshBasicMaterial` (what `KHR_materials_unlit`
 * maps to) both use. A texture whose image cannot be read back is dropped rather than thrown, so a
 * textured material degrades to its factor (README section 9).
 *
 * The material's `alphaTest` travels with it: glTF's `alphaMode: MASK` becomes it (0.5 by default), and
 * the sampler uses it to color a texel the cutoff masks out with the texture's visible average instead
 * of deleting the voxel. It is read for every material, texture or not, because it belongs to the
 * material rather than to the map — `0` means the material has no cutoff.
 */
export function buildColorSource(material: THREE.Material): ColorSource {
  const color = materialColor(material);
  const baseColor = color === undefined ? DEFAULT_BASE_COLOR : color.getHex();
  const alphaTest = material.alphaTest;

  const map = materialMap(material);
  if (map === undefined) return { baseColor, alphaTest };
  const texture = texturePixels(map);
  return texture === undefined ? { baseColor, alphaTest } : { baseColor, alphaTest, texture };
}

/**
 * One world-space `VoxelizeSource` per imported node, in node order.
 *
 * `positions` is a fresh array with `matrixWorld` baked in, so downstream voxelization needs no
 * hierarchy (README D21); `index` is the geometry's own index, or a generated `0..n-1` one for
 * non-indexed geometry (a soup is indexed by construction).
 *
 * Outline nodes are skipped, so they never become a payload: their geometry is an inverted hull, and
 * voxelizing it would add a shell of spurious voxels and colors around the model. They stay document
 * objects without a payload, which is what the object list and the raw-mesh display want.
 */
export function buildVoxelizeSources(scene: ImportedScene): VoxelizeSource[] {
  return scene.nodes
    .filter((node) => !node.outline)
    .map((node) => ({
      sourceId: node.sourceId,
      name: node.name,
      soup: { positions: worldPositions(node), index: indexOf(node.geometry) },
      color: node.color,
    }));
}

/**
 * Creates one document object per imported node, in node order.
 *
 * The imported hierarchy is already baked into the world matrices, so every object is a root: its
 * transform is the decomposition of `matrixWorld` and its `parentId` stays null. `bySourceId` maps
 * each node's `sourceId` to the object created for it — the map `editor/ops.ts`'s
 * `applyVoxelizeResult(project, result, { attachTo })` consumes, so voxelization attaches a payload to
 * the placeholder instead of creating a duplicate object and the raw-mesh comparison source survives.
 */
export function adoptImportedScene(
  project: Project,
  scene: ImportedScene,
): { objectIds: ObjectId[]; bySourceId: ReadonlyMap<string, ObjectId> } {
  if (!(project instanceof Project)) {
    throw new TypeError('adoptImportedScene needs a Project to create objects in');
  }

  const objectIds: ObjectId[] = [];
  const bySourceId = new Map<string, ObjectId>();

  for (const node of scene.nodes) {
    const object = project.createObject({ name: node.name, representation: 'empty' });
    node.matrixWorld.decompose(object.transform.position, object.transform.quaternion, object.transform.scale);
    objectIds.push(object.id);
    bySourceId.set(node.sourceId, object.id);
  }

  return { objectIds, bySourceId };
}

/** Validates the GLB container and decodes its JSON chunk. */
function readContainer(data: ArrayBuffer): Container | { error: string } {
  if (data.byteLength < GLB_HEADER_BYTES) {
    return { error: `GLB header: buffer is ${data.byteLength} bytes, at least ${GLB_HEADER_BYTES} are required` };
  }

  const view = new DataView(data);
  const magic = view.getUint32(0, true);
  if (magic !== GLB_MAGIC) {
    return { error: `GLB header: magic 0x${magic.toString(16)} is not glTF (0x${GLB_MAGIC.toString(16)})` };
  }

  const version = view.getUint32(4, true);
  if (version !== GLB_VERSION) {
    return { error: `GLB header: version ${version} is not glTF ${GLB_VERSION}` };
  }

  const declaredLength = view.getUint32(8, true);
  if (declaredLength > data.byteLength) {
    return { error: `GLB header: declared length ${declaredLength} exceeds the buffer length ${data.byteLength}` };
  }

  let offset = GLB_HEADER_BYTES;
  let jsonChunk: { offset: number; length: number } | null = null;

  while (offset < declaredLength) {
    const headerOffset = offset;
    if (headerOffset + GLB_CHUNK_HEADER_BYTES > declaredLength) {
      return { error: `GLB chunk table: chunk header at ${headerOffset} is cut off by the declared length ${declaredLength}` };
    }
    const chunkLength = view.getUint32(headerOffset, true);
    const chunkType = view.getUint32(headerOffset + 4, true);
    offset = headerOffset + GLB_CHUNK_HEADER_BYTES;
    if (offset + chunkLength > declaredLength) {
      return { error: `GLB chunk table: chunk at ${headerOffset} claims ${chunkLength} bytes, past the declared length ${declaredLength}` };
    }
    if (jsonChunk === null && chunkType === GLB_JSON_CHUNK) {
      jsonChunk = { offset, length: chunkLength };
    }
    offset += chunkLength;
  }

  if (jsonChunk === null) {
    return { error: 'GLB chunk table: no JSON chunk' };
  }

  const text = new TextDecoder()
    .decode(new Uint8Array(data, jsonChunk.offset, jsonChunk.length))
    .replace(/\u0000+$/, '');

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { error: `GLB JSON chunk: ${messageOf(error)}` };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { error: 'GLB JSON chunk: the top-level value is not a JSON object' };
  }

  const json = parsed as Record<string, unknown>;
  const nodesField: unknown = json['nodes'];
  return {
    extensionsRequired: stringList(json['extensionsRequired']),
    nodeCount: Array.isArray(nodesField) ? nodesField.length : 0,
  };
}

/** Wraps `GLTFLoader.parse`, whose callback API carries no promise. */
function parseGlb(data: ArrayBuffer): Promise<GLTF> {
  return new Promise<GLTF>((resolve, reject) => {
    try {
      new GLTFLoader().parse(data, '', resolve, (event: unknown) => {
        reject(new Error(messageOf(event)));
      });
    } catch (error) {
      reject(new Error(messageOf(error)));
    }
  });
}

/**
 * A GLTF node index resolved to an id that is unique within one file.
 *
 * The node index comes from the parser's associations; a mesh without one (a primitive of a
 * multi-primitive node, which the loader puts under an unnamed group) falls back to its traversal
 * index, and a repeated index takes a numeric suffix, so `bySourceId` keeps exactly one entry per
 * imported node and every voxelizer output resolves through it.
 */
function uniqueSourceId(nodeIndex: number | undefined, meshIndex: number, used: Set<string>): string {
  const base = `node-${nodeIndex ?? meshIndex}`;
  if (!used.has(base)) {
    used.add(base);
    return base;
  }

  let suffix = 1;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  const sourceId = `${base}-${suffix}`;
  used.add(sourceId);
  return sourceId;
}

function asMesh(object: THREE.Object3D): THREE.Mesh | null {
  return object instanceof THREE.Mesh ? object : null;
}

/**
 * The color half of an imported node: the material factor, base color texture and cutoff plus the
 * geometry's UVs and vertex colors.
 *
 * Without a `uv` attribute the texture could never be sampled, so it is dropped instead of carrying its
 * pixels for nothing — while the factor and the material's cutoff stay, because they describe the
 * material rather than the map; and without a `color` attribute, or with `vertexColors` off, the
 * vertex-color half is simply absent, because the sampler skips a missing attribute rather than
 * treating it as an error.
 */
function colorSourceOf(mesh: THREE.Mesh): ColorSource {
  const material = Array.isArray(mesh.material) ? (mesh.material[0] ?? null) : mesh.material;
  const materialSource: ColorSource =
    material === null ? { baseColor: DEFAULT_BASE_COLOR } : buildColorSource(material);

  const uv = geometryUv(mesh.geometry);
  const source: ColorSource = uv === undefined ? withoutTexture(materialSource) : { ...materialSource, uv };
  if (material === null || material.vertexColors !== true) return source;

  const attribute = mesh.geometry.getAttribute('color');
  if (attribute === undefined) return source;

  // Per-vertex RGB with the alpha dropped, which is the `vertexColorSize = 3` form the sampler reads.
  const vertexColors = new Float32Array(attribute.count * VERTEX_COLOR_SIZE);
  for (let vertex = 0; vertex < attribute.count; vertex += 1) {
    vertexColors[vertex * VERTEX_COLOR_SIZE] = attribute.getX(vertex);
    vertexColors[vertex * VERTEX_COLOR_SIZE + 1] = attribute.getY(vertex);
    vertexColors[vertex * VERTEX_COLOR_SIZE + 2] = attribute.getZ(vertex);
  }

  return { ...source, vertexColors, vertexColorSize: VERTEX_COLOR_SIZE };
}

/** A material's color terms without its texture: pixels the source could never sample are not carried. */
function withoutTexture(source: ColorSource): ColorSource {
  const { baseColor, alphaTest } = source;
  return alphaTest === undefined ? { baseColor } : { baseColor, alphaTest };
}

/** The geometry's UV attribute copied into a fresh array of 2 floats per vertex, or undefined when it has none. */
function geometryUv(geometry: THREE.BufferGeometry): Float32Array | undefined {
  const attribute = geometry.getAttribute('uv');
  if (attribute === undefined) return undefined;

  const uv = new Float32Array(attribute.count * UV_COMPONENT_COUNT);
  for (let vertex = 0; vertex < attribute.count; vertex += 1) {
    uv[vertex * UV_COMPONENT_COUNT] = attribute.getX(vertex);
    uv[vertex * UV_COMPONENT_COUNT + 1] = attribute.getY(vertex);
  }
  return uv;
}

function materialColor(material: THREE.Material): THREE.Color | undefined {
  if (!('color' in material)) return undefined;
  const value: unknown = material.color;
  return value instanceof THREE.Color ? value : undefined;
}

/** The material's base color map, or undefined: `map` is that slot on both a standard and a basic material. */
function materialMap(material: THREE.Material): THREE.Texture | undefined {
  if (!('map' in material)) return undefined;
  const value: unknown = material.map;
  return value instanceof THREE.Texture ? value : undefined;
}

/** The texture's pixels, read back at most once per texture object. */
function texturePixels(texture: THREE.Texture): TexturePixels | undefined {
  const cached = textureCache.get(texture);
  if (cached !== undefined) return cached;

  const read = readTexturePixels(texture.image);
  if (read !== undefined) textureCache.set(texture, read);
  return read;
}

/**
 * One texture image as sRGB-encoded RGBA bytes. A decoded buffer is taken as it stands (a view over it,
 * never a copy); anything else is drawn into an offscreen canvas sized to the image and read back with
 * `getImageData`, which is the only way to reach the pixels of an image element or a bitmap. Returns
 * undefined for an image this environment cannot read — no image, no document, a size-less, short or
 * non-8-bit buffer, an image that cannot be drawn, or a readback the browser refuses — so an unreadable
 * texture is a degradation to the material's factor, never an error.
 *
 * `flipY` is not applied: `ImageData` and glTF UVs share the top-left origin, and this is the GLB path.
 */
function readTexturePixels(image: unknown): TexturePixels | undefined {
  if (image === null || typeof image !== 'object') return undefined;
  if (!('width' in image) || !('height' in image)) return undefined;

  const width: unknown = image.width;
  const height: unknown = image.height;
  if (
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return undefined;
  }

  const length = width * height * RGBA_COMPONENT_COUNT;
  if ('data' in image) {
    const data: unknown = image.data;
    if (data instanceof Uint8ClampedArray) {
      return data.length >= length ? { width, height, pixels: data } : undefined;
    }
    if (data instanceof Uint8Array) {
      return data.length >= length
        ? { width, height, pixels: new Uint8ClampedArray(data.buffer, data.byteOffset, length) }
        : undefined;
    }
    // A float or otherwise non-8-bit buffer is not an sRGB RGBA image this sampler can read.
    return undefined;
  }

  if (typeof document === 'undefined') return undefined;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) return undefined;
    // Narrowed only as far as `object`: a drawable image element or bitmap, which `drawImage` checks.
    const drawable = image as CanvasImageSource;
    context.drawImage(drawable, 0, 0);
    const { data: pixels } = context.getImageData(0, 0, width, height);
    return { width, height, pixels };
  } catch {
    // Not a drawable image, or a readback refused because the canvas was tainted by a cross-origin
    // image: unreadable, which degrades to the material's factor like every other unreadable case.
    return undefined;
  }
}

/**
 * The node's vertices in world space, in a fresh array: the caller's geometry is never touched and
 * `matrixWorld` (which holds the whole node chain) is baked in, so no consumer needs the GLB
 * hierarchy.
 */
function worldPositions(node: ImportedNode): Float32Array {
  const position = node.geometry.getAttribute('position');
  if (position === undefined) {
    throw new TypeError(`imported node ${node.sourceId} has no position attribute`);
  }

  const positions = new Float32Array(position.count * 3);
  const vertex = new THREE.Vector3();
  for (let index = 0; index < position.count; index += 1) {
    vertex.fromBufferAttribute(position, index).applyMatrix4(node.matrixWorld);
    positions[index * 3] = vertex.x;
    positions[index * 3 + 1] = vertex.y;
    positions[index * 3 + 2] = vertex.z;
  }
  return positions;
}

function indexOf(geometry: THREE.BufferGeometry): Uint32Array {
  const attribute = geometry.getIndex();
  if (attribute === null) {
    const position = geometry.getAttribute('position');
    const vertexCount = position === undefined ? 0 : position.count;
    const index = new Uint32Array(vertexCount);
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      index[vertex] = vertex;
    }
    return index;
  }

  const array = attribute.array;
  return array instanceof Uint32Array ? array : new Uint32Array(array);
}

function messageOf(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'object' && value !== null && 'message' in value) {
    const message: unknown = value.message;
    if (typeof message === 'string' && message.length > 0) return message;
  }
  return typeof value === 'string' ? value : String(value);
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const list: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string') list.push(entry);
  }
  return list;
}
