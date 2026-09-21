#!/usr/bin/env node
/**
 * Deterministic generator for the two demo GLB assets used by acceptance scenarios A and B
 * (README section 9). Build-time only: nothing under `src/` imports it, it imports nothing from
 * `src/`, and it has no third-party dependency.
 *
 *   node tools/make-demo-glb.mjs [outDir]
 *
 * `outDir` defaults to `public/` (Vite serves that directory at the site root) and is created when
 * missing. Both files are built in memory first and then written, so a failure can never leave a
 * truncated second file behind.
 *
 * Determinism: every value comes from the integer LCG below, seeded from constants. `Math.random`,
 * `Date` and `performance.now` are never called, and no transcendental function is used, so no libm
 * difference between platforms can change a byte of the output.
 *
 * The emitted glTF subset is exactly what the import path consumes: uncompressed indexed geometry
 * with POSITION, NORMAL and indices accessors, plus `pbrMetallicRoughness.baseColorFactor`,
 * `metallicFactor` and `roughnessFactor`. No `images`, `samplers` or `textures` entry is written and
 * no material references one, because color sampling in this slice reads the base color factor (and
 * vertex colors) only.
 */

import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const TOOLS_DIR = import.meta.dirname;
const REPO_ROOT = path.resolve(TOOLS_DIR, '..');
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, 'public');

const GENERATOR = 'vox-world demo asset generator';

// glTF binary constants.
const GLB_MAGIC = 0x46546c67; // 'glTF' little-endian
const GLB_VERSION = 2;
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'
const COMPONENT_FLOAT = 5126;
const COMPONENT_UINT16 = 5123;
const COMPONENT_UINT32 = 5125;
const MODE_TRIANGLES = 4;
/** Vertex count from which indices need 32 bits. */
const UINT16_VERTEX_LIMIT = 65536;

// One seed per asset, plus one for the city placement and one for the terrain detail lattice.
const ISLAND_SEED = 0x1d2f4a6b;
const BIG_SEED = 0x6b4a2f1d;
const CITY_SEED = 0x2e8f1c47;
const DETAIL_SEED_MIX = 0x5bf03635;

// Terrain extents, in meters, at 1 m cell spacing.
const CELL_SIZE = 1;
const ISLAND_CELLS = 64; // 64 x 64 quad island
const BIG_CELLS = 256; // 256 x 256 quad terrain, 256 m across
const CITY_GRID = 32; // coarse placement grid of the city blocks

// ---------------------------------------------------------------------------------------------
// Deterministic integer randomness
// ---------------------------------------------------------------------------------------------

/** One LCG step, exactly the recurrence the contract pins. */
function lcgStep(state) {
  return (state * 1664525 + 1013904223) >>> 0;
}

/**
 * Integer hash of a cell coordinate: seed and coordinates are folded into the LCG state, then two
 * LCG steps are mixed with xor-shifts. Integer-only and exactly reproducible on every platform.
 */
function hashCell(seed, x, z) {
  let state = (seed ^ ((x * 0x9e3779b1) >>> 0) ^ ((z * 0x85ebca6b) >>> 0)) >>> 0;
  state = lcgStep(state);
  state = (state ^ (state >>> 16)) >>> 0;
  state = lcgStep(state);
  return (state ^ (state >>> 15)) >>> 0;
}

/**
 * Quantizes a hash into a few integer meters: `>>> 6` is the contract's integer division `h / 64`,
 * and the remainder picks one step. Both lattices are coarse enough to keep the terrain terraced
 * instead of speckled, which keeps the wall count (and the file) small.
 */
function quantize(hash, steps) {
  return (hash >>> 6) % steps;
}

/** Island relief: 1..7 m, terraced on an 8 m lattice with a 4 m detail lattice. */
function islandHeight(ix, iz) {
  const hill = quantize(hashCell(ISLAND_SEED, ix >> 3, iz >> 3), 3);
  const detail = quantize(hashCell(ISLAND_SEED ^ DETAIL_SEED_MIX, ix >> 2, iz >> 2), 3);
  return 1 + hill * 2 + detail;
}

/** Big-terrain relief: 1..15 m, terraced on an 8 m lattice with a 4 m detail lattice. */
function bigHeight(ix, iz) {
  const hill = quantize(hashCell(BIG_SEED, ix >> 3, iz >> 3), 5);
  const detail = quantize(hashCell(BIG_SEED ^ DETAIL_SEED_MIX, ix >> 2, iz >> 2), 3);
  return 1 + hill * 3 + detail;
}

function clampCell(index, cells) {
  return index < 0 ? 0 : index >= cells ? cells - 1 : index;
}

/**
 * Highest terrain top under an axis-aligned world footprint, clamped to the slab. A node transform
 * built from this rests a prop on the ground instead of sinking it into a terrain step.
 */
function terrainTopUnder(heightOf, cells, minX, maxX, minZ, maxZ) {
  const half = cells / 2;
  const firstX = clampCell(Math.floor(minX + half), cells);
  const lastX = clampCell(Math.ceil(maxX + half) - 1, cells);
  const firstZ = clampCell(Math.floor(minZ + half), cells);
  const lastZ = clampCell(Math.ceil(maxZ + half) - 1, cells);
  let top = heightOf(firstX, firstZ);
  for (let iz = firstZ; iz <= lastZ; iz++) {
    for (let ix = firstX; ix <= lastX; ix++) {
      const height = heightOf(ix, iz);
      if (height > top) top = height;
    }
  }
  return top;
}

function islandGroundUnder(minX, maxX, minZ, maxZ) {
  return terrainTopUnder(islandHeight, ISLAND_CELLS, minX, maxX, minZ, maxZ);
}

function bigGroundUnder(minX, maxX, minZ, maxZ) {
  return terrainTopUnder(bigHeight, BIG_CELLS, minX, maxX, minZ, maxZ);
}

// ---------------------------------------------------------------------------------------------
// Geometry builders: flat number arrays, per-face normals, no smoothing pass
// ---------------------------------------------------------------------------------------------

function createMeshBuilder() {
  return { positions: [], normals: [], indices: [] };
}

/**
 * Appends one flat quad: four vertices carrying the same face normal and two counter-clockwise
 * triangles. `corner` is the first vertex, and the quad walks `corner`, `corner + u`,
 * `corner + u + v`, `corner + v`, so the face normal is `u x v` and equals `normal`.
 */
function pushFace(mesh, normal, corner, u, v) {
  const [nx, ny, nz] = normal;
  const [cx, cy, cz] = corner;
  const [ux, uy, uz] = u;
  const [vx, vy, vz] = v;
  const base = mesh.positions.length / 3;
  mesh.positions.push(
    cx, cy, cz,
    cx + ux, cy + uy, cz + uz,
    cx + ux + vx, cy + uy + vy, cz + uz + vz,
    cx + vx, cy + vy, cz + vz,
  );
  mesh.normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz, nx, ny, nz);
  mesh.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/**
 * The six faces of an axis-aligned box as `u x v === normal` bases. Each face's `u`/`v` has exactly
 * one non-zero component, so scaling it by the matching box extent keeps `u x v === normal`.
 */
const BOX_FACES = [
  { normal: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { normal: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { normal: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] },
  { normal: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { normal: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0] },
];

/** Appends a closed box from its min and max corner. */
function pushBox(mesh, min, max) {
  const extent = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  for (const face of BOX_FACES) {
    const normal = face.normal;
    const corner = [0, 0, 0];
    for (let axis = 0; axis < 3; axis++) {
      // On the normal axis the face sits on the side the normal points to; on the other two axes it
      // starts where the tangent walks away from, so the quad stays counter-clockwise from outside.
      if (normal[axis] !== 0) {
        corner[axis] = normal[axis] > 0 ? max[axis] : min[axis];
      } else {
        corner[axis] = face.u[axis] < 0 || face.v[axis] < 0 ? max[axis] : min[axis];
      }
    }
    const u = [face.u[0] * extent[0], face.u[1] * extent[1], face.u[2] * extent[2]];
    const v = [face.v[0] * extent[0], face.v[1] * extent[1], face.v[2] * extent[2]];
    pushFace(mesh, normal, corner, u, v);
  }
}

/** Appends a box given as center and size. */
function pushCenteredBox(mesh, center, size) {
  const half = [size[0] / 2, size[1] / 2, size[2] / 2];
  pushBox(
    mesh,
    [center[0] - half[0], center[1] - half[1], center[2] - half[2]],
    [center[0] + half[0], center[1] + half[1], center[2] + half[2]],
  );
}

// ---------------------------------------------------------------------------------------------
// Island scene: terrain slab, car, two trees, one rock
// ---------------------------------------------------------------------------------------------

/**
 * A closed ground slab on Y = 0: a flat top face per cell, a vertical wall wherever a neighbour is
 * lower (and against the base at the outer boundary), and a coarse underside. The surface is closed
 * (a +Y ray crosses exactly the bottom face and one top face), so surface voxelization sees a
 * solid. Height steps leave T-junctions between wall quads (coincident partial edges), which no
 * triangle/box voxelizer and no rasterizer is affected by.
 */
function buildTerrainSlab(mesh, cells, heightOf) {
  const spacing = CELL_SIZE;
  const half = (cells * spacing) / 2;
  const world = (index) => index * spacing - half;

  for (let iz = 0; iz < cells; iz++) {
    for (let ix = 0; ix < cells; ix++) {
      const height = heightOf(ix, iz);
      const x0 = world(ix);
      const z0 = world(iz);
      pushFace(mesh, [0, 1, 0], [x0, height, z0], [0, 0, spacing], [spacing, 0, 0]);
    }
  }

  for (let iz = 0; iz < cells; iz++) {
    for (let ix = 0; ix < cells; ix++) {
      const height = heightOf(ix, iz);
      const x0 = world(ix);
      const x1 = x0 + spacing;
      const z0 = world(iz);
      const z1 = z0 + spacing;
      const belowZ = iz > 0 ? heightOf(ix, iz - 1) : 0;
      const aboveZ = iz < cells - 1 ? heightOf(ix, iz + 1) : 0;
      const belowX = ix > 0 ? heightOf(ix - 1, iz) : 0;
      const aboveX = ix < cells - 1 ? heightOf(ix + 1, iz) : 0;
      if (belowZ < height) {
        pushFace(mesh, [0, 0, -1], [x1, belowZ, z0], [-spacing, 0, 0], [0, height - belowZ, 0]);
      }
      if (aboveZ < height) {
        pushFace(mesh, [0, 0, 1], [x0, aboveZ, z1], [spacing, 0, 0], [0, height - aboveZ, 0]);
      }
      if (belowX < height) {
        pushFace(mesh, [-1, 0, 0], [x0, belowX, z0], [0, 0, spacing], [0, height - belowX, 0]);
      }
      if (aboveX < height) {
        pushFace(mesh, [1, 0, 0], [x1, aboveX, z1], [0, 0, -spacing], [0, height - aboveX, 0]);
      }
    }
  }

  // The underside is a 16 x 16 grid instead of one huge quad, so a voxelizer that samples
  // triangles rather than testing triangle/box overlap still sees it.
  const block = cells / 16;
  const run = block * spacing;
  for (let iz = 0; iz < 16; iz++) {
    for (let ix = 0; ix < 16; ix++) {
      pushFace(mesh, [0, -1, 0], [world(ix * block), 0, world(iz * block)], [run, 0, 0], [0, 0, run]);
    }
  }
}

/** Car in local space, nose toward +Z, wheels touching the node's Y = 0 plane. */
function buildCar(mesh) {
  pushBox(mesh, [-1, 0.35, -2.1], [1, 0.85, 2.1]); // body
  pushBox(mesh, [-0.85, 0.85, -0.9], [0.85, 1.45, 1]); // cabin
  pushBox(mesh, [-1.2, 0, 1.05], [-0.84, 0.72, 1.65]); // front left wheel
  pushBox(mesh, [0.84, 0, 1.05], [1.2, 0.72, 1.65]); // front right wheel
  pushBox(mesh, [-1.2, 0, -1.65], [-0.84, 0.72, -1.05]); // rear left wheel
  pushBox(mesh, [0.84, 0, -1.65], [1.2, 0.72, -1.05]); // rear right wheel
}

/** Tree in local space: trunk plus canopy, base on Y = 0. */
function buildTree(mesh, canopyRadius, canopyTop) {
  const canopyBottom = canopyTop * 0.45;
  pushBox(mesh, [-0.18, 0, -0.18], [0.18, canopyBottom, 0.18]);
  pushBox(mesh, [-canopyRadius, canopyBottom, -canopyRadius], [canopyRadius, canopyTop, canopyRadius]);
}

/** Rock in local space: a low boulder with a smaller cap, base on Y = 0. */
function buildRock(mesh) {
  pushBox(mesh, [-1.3, 0, -1.1], [1.3, 0.6, 1.1]);
  pushBox(mesh, [-0.7, 0.6, -0.6], [0.7, 1.1, 0.6]);
}

function buildIslandAsset() {
  const terrain = createMeshBuilder();
  buildTerrainSlab(terrain, ISLAND_CELLS, islandHeight);
  const car = createMeshBuilder();
  buildCar(car);
  const treeA = createMeshBuilder();
  buildTree(treeA, 1.2, 3.6);
  const treeB = createMeshBuilder();
  buildTree(treeB, 0.95, 3);
  const rock = createMeshBuilder();
  buildRock(rock);

  return {
    meshes: [
      { name: 'terrain', material: 'terrain', geometry: terrain },
      { name: 'car', material: 'car', geometry: car },
      { name: 'tree-a', material: 'tree-a', geometry: treeA },
      { name: 'tree-b', material: 'tree-b', geometry: treeB },
      { name: 'rock', material: 'rock', geometry: rock },
    ],
    materials: {
      terrain: { baseColor: [0.33, 0.51, 0.27, 1], metallic: 0, roughness: 1 },
      car: { baseColor: [0.78, 0.21, 0.16, 1], metallic: 0.35, roughness: 0.5 },
      'tree-a': { baseColor: [0.2, 0.41, 0.19, 1], metallic: 0, roughness: 1 },
      'tree-b': { baseColor: [0.29, 0.52, 0.22, 1], metallic: 0, roughness: 1 },
      rock: { baseColor: [0.46, 0.45, 0.43, 1], metallic: 0, roughness: 1 },
    },
    nodes: [
      { name: 'terrain', mesh: 0 },
      // Each prop sits on the highest terrain top under its own base footprint (car: wheels, trees:
      // trunk, rock: boulder), so no node ends up buried in a terrain step.
      { name: 'car', mesh: 1, translation: [10, islandGroundUnder(8.8, 11.2, 3.9, 8.1), 6] },
      { name: 'tree-a', mesh: 2, translation: [-14, islandGroundUnder(-14.2, -13.8, -9.2, -8.8), -9] },
      { name: 'tree-b', mesh: 3, translation: [11, islandGroundUnder(10.8, 11.2, -16.2, -15.8), -16] },
      { name: 'rock', mesh: 4, translation: [-6, islandGroundUnder(-7.3, -4.7, 13.9, 16.1), 15] },
    ],
    roots: [0, 1, 2, 3, 4],
  };
}

// ---------------------------------------------------------------------------------------------
// Big scene: large terrain, city blocks, transform-only humanoid with five detachable parts
// ---------------------------------------------------------------------------------------------

/** Buildings on a coarse grid, each sunk 1 m into the ground so none of them floats. */
function buildCity(mesh) {
  const spacing = BIG_CELLS / CITY_GRID;
  const half = BIG_CELLS / 2;
  for (let gz = 0; gz < CITY_GRID; gz++) {
    for (let gx = 0; gx < CITY_GRID; gx++) {
      const hash = hashCell(CITY_SEED, gx, gz);
      if (hash % 5 !== 0) continue;
      const width = 3 + ((hash >>> 8) % 4);
      const depth = 3 + ((hash >>> 12) % 4);
      const height = 6 + ((hash >>> 16) % 24);
      const centerX = -half + (gx + 0.5) * spacing;
      const centerZ = -half + (gz + 0.5) * spacing;
      const base = bigGroundUnder(centerX - width / 2, centerX + width / 2, centerZ - depth / 2, centerZ + depth / 2) - 1;
      pushBox(
        mesh,
        [centerX - width / 2, base, centerZ - depth / 2],
        [centerX + width / 2, base + height, centerZ + depth / 2],
      );
    }
  }
}

/** Humanoid parts in the humanoid's local space, meters, feet at Y = 0. Each part is its own node. */
const HUMANOID_PARTS = [
  { name: 'torso', center: [0, 1.15, 0], size: [0.5, 0.7, 0.28] },
  { name: 'hand-left', center: [-0.44, 0.98, 0], size: [0.18, 0.18, 0.18] },
  { name: 'hand-right', center: [0.44, 0.98, 0], size: [0.18, 0.18, 0.18] },
  { name: 'foot-left', center: [-0.14, 0.07, 0], size: [0.2, 0.14, 0.34] },
  { name: 'foot-right', center: [0.14, 0.07, 0], size: [0.2, 0.14, 0.34] },
];

/** Distinct base color per humanoid part, so a detach or a mask pass is visible per part. */
const HUMANOID_PART_COLORS = {
  torso: [0.82, 0.3, 0.26, 1],
  'hand-left': [0.95, 0.74, 0.24, 1],
  'hand-right': [0.28, 0.58, 0.86, 1],
  'foot-left': [0.56, 0.36, 0.78, 1],
  'foot-right': [0.3, 0.74, 0.44, 1],
};

const HUMANOID_ORIGIN = [-60, 48];

function buildBigAsset() {
  const terrain = createMeshBuilder();
  buildTerrainSlab(terrain, BIG_CELLS, bigHeight);
  const city = createMeshBuilder();
  buildCity(city);

  const meshes = [
    { name: 'terrain', material: 'terrain', geometry: terrain },
    { name: 'city', material: 'city', geometry: city },
  ];
  const nodes = [
    { name: 'terrain', mesh: 0 },
    { name: 'city', mesh: 1 },
    {
      name: 'humanoid',
      translation: [
        HUMANOID_ORIGIN[0],
        bigGroundUnder(HUMANOID_ORIGIN[0] - 0.6, HUMANOID_ORIGIN[0] + 0.6, HUMANOID_ORIGIN[1] - 0.2, HUMANOID_ORIGIN[1] + 0.2),
        HUMANOID_ORIGIN[1],
      ],
      children: [],
    },
  ];

  for (const part of HUMANOID_PARTS) {
    const builder = createMeshBuilder();
    // The part mesh is centered on its own origin; the node transform places it inside the
    // humanoid, which is what makes each part individually selectable after import.
    pushCenteredBox(builder, [0, 0, 0], part.size);
    nodes.push({ name: part.name, mesh: meshes.length, translation: part.center });
    meshes.push({ name: part.name, material: part.name, geometry: builder });
    nodes[2].children.push(nodes.length - 1); // node 2 is the humanoid declared above
  }

  const materials = {
    terrain: { baseColor: [0.4, 0.46, 0.3, 1], metallic: 0, roughness: 1 },
    city: { baseColor: [0.62, 0.64, 0.68, 1], metallic: 0.1, roughness: 0.8 },
  };
  for (const part of HUMANOID_PARTS) {
    materials[part.name] = { baseColor: HUMANOID_PART_COLORS[part.name], metallic: 0, roughness: 0.9 };
  }

  return { meshes, materials, nodes, roots: [0, 1, 2] };
}

// ---------------------------------------------------------------------------------------------
// GLB writer
// ---------------------------------------------------------------------------------------------

function align4(value) {
  return (value + 3) & ~3;
}

/** Positions, normals and indices of one mesh as typed arrays, with the index width rule applied. */
function buildMeshData(geometry) {
  const positions = Float32Array.from(geometry.positions);
  const normals = Float32Array.from(geometry.normals);
  const vertexCount = positions.length / 3;
  if (normals.length !== positions.length) {
    throw new Error(`mesh has ${vertexCount} vertices but ${normals.length / 3} normals`);
  }
  if (geometry.indices.length % 3 !== 0) {
    throw new Error(`mesh has ${geometry.indices.length} indices, which is not a multiple of 3`);
  }
  const indices =
    vertexCount < UINT16_VERTEX_LIMIT ? Uint16Array.from(geometry.indices) : Uint32Array.from(geometry.indices);
  for (const index of indices) {
    if (index >= vertexCount) {
      throw new Error(`mesh index ${index} is outside its ${vertexCount} vertices`);
    }
  }
  return { positions, normals, indices, vertexCount };
}

/** Bounding box of a VEC3 float array, which glTF requires for POSITION accessors. */
function positionBounds(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const value = positions[i + axis];
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  }
  return { min, max };
}

/**
 * Lays the BIN chunk out first, in the order the JSON references it, and returns the JSON document
 * plus the binary payload. Key order of the document is insertion order, so it is stable.
 */
function buildGlbDocument(asset) {
  const materialNames = Object.keys(asset.materials);
  const parts = [];
  let binaryLength = 0;
  const bufferViews = [];
  const accessors = [];
  const meshes = [];

  const addBufferView = (typedArray) => {
    const byteOffset = align4(binaryLength);
    const bytes = Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
    parts.push({ byteOffset, bytes });
    binaryLength = byteOffset + bytes.byteLength;
    bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.byteLength });
    return bufferViews.length - 1;
  };

  for (const entry of asset.meshes) {
    const data = buildMeshData(entry.geometry);
    const positionView = addBufferView(data.positions);
    const normalView = addBufferView(data.normals);
    const indexView = addBufferView(data.indices);
    const bounds = positionBounds(data.positions);
    const positionAccessor = accessors.length;
    accessors.push({
      bufferView: positionView,
      componentType: COMPONENT_FLOAT,
      count: data.vertexCount,
      type: 'VEC3',
      min: bounds.min,
      max: bounds.max,
    });
    const normalAccessor = accessors.length;
    accessors.push({
      bufferView: normalView,
      componentType: COMPONENT_FLOAT,
      count: data.vertexCount,
      type: 'VEC3',
    });
    const indexAccessor = accessors.length;
    accessors.push({
      bufferView: indexView,
      componentType: data.indices instanceof Uint16Array ? COMPONENT_UINT16 : COMPONENT_UINT32,
      count: data.indices.length,
      type: 'SCALAR',
    });
    const material = materialNames.indexOf(entry.material);
    if (material < 0) {
      throw new Error(`mesh ${entry.name} references unknown material ${entry.material}`);
    }
    meshes.push({
      name: entry.name,
      primitives: [
        {
          attributes: { POSITION: positionAccessor, NORMAL: normalAccessor },
          indices: indexAccessor,
          material,
          mode: MODE_TRIANGLES,
        },
      ],
    });
  }

  // Padding bytes are part of the buffer, so bufferView offsets never point outside it.
  const binary = Buffer.alloc(align4(binaryLength));
  for (const part of parts) {
    part.bytes.copy(binary, part.byteOffset);
  }

  const nodes = asset.nodes.map((node) => {
    const record = { name: node.name };
    if (node.mesh !== undefined) record.mesh = node.mesh;
    if (node.children !== undefined) record.children = node.children.slice();
    if (node.translation !== undefined) record.translation = node.translation.slice();
    return record;
  });

  const materials = materialNames.map((name) => {
    const material = asset.materials[name];
    return {
      name,
      pbrMetallicRoughness: {
        baseColorFactor: material.baseColor.slice(),
        metallicFactor: material.metallic,
        roughnessFactor: material.roughness,
      },
    };
  });

  const document = {
    asset: { version: '2.0', generator: GENERATOR },
    scene: 0,
    scenes: [{ name: 'scene', nodes: asset.roots.slice() }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binary.byteLength }],
  };

  return { document, binary };
}

/** Serializes a document and its binary payload as a GLB: 12-byte header, JSON chunk, BIN chunk. */
function writeGlb(asset) {
  const { document, binary } = buildGlbDocument(asset);
  const json = Buffer.from(JSON.stringify(document), 'utf8');
  const jsonChunk = Buffer.concat([json, Buffer.alloc(align4(json.byteLength) - json.byteLength, 0x20)]);
  const binChunk = Buffer.concat([binary, Buffer.alloc(align4(binary.byteLength) - binary.byteLength, 0)]);

  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(GLB_VERSION, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.byteLength + 8 + binChunk.byteLength, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.byteLength, 0);
  jsonHeader.writeUInt32LE(CHUNK_JSON, 4);

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binChunk.byteLength, 0);
  binHeader.writeUInt32LE(CHUNK_BIN, 4);

  return Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk]);
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

const ASSETS = [
  { fileName: 'island.glb', build: buildIslandAsset },
  { fileName: 'big.glb', build: buildBigAsset },
];

/** Creates `dir` when missing; refuses a destination that exists as a file. */
function ensureDirectory(dir) {
  let stats = null;
  try {
    stats = statSync(dir);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (stats === null) {
    mkdirSync(dir, { recursive: true });
    return;
  }
  if (!stats.isDirectory()) {
    throw new Error(`destination exists and is not a directory: ${dir}`);
  }
}

function describeError(error) {
  if (error instanceof Error) {
    return error.code === undefined ? error.message : `${error.message} [${error.code}]`;
  }
  return String(error);
}

function main() {
  const args = process.argv.slice(2);
  if (args.length > 1) {
    process.stderr.write('usage: node tools/make-demo-glb.mjs [outDir]\n');
    return 1;
  }
  const outDir = args.length === 1 ? path.resolve(process.cwd(), args[0]) : DEFAULT_OUT_DIR;
  try {
    ensureDirectory(outDir);
    // Both files are built before either is written, so a build failure cannot leave one of them
    // half written.
    const outputs = ASSETS.map((asset) => ({
      file: path.join(outDir, asset.fileName),
      bytes: writeGlb(asset.build()),
    }));
    for (const output of outputs) {
      writeFileSync(output.file, output.bytes);
      console.log(`wrote ${output.file} (${output.bytes.byteLength} bytes)`);
    }
  } catch (error) {
    process.stderr.write(`make-demo-glb: ${describeError(error)}\n`);
    return 1;
  }
  return 0;
}

process.exitCode = main();
