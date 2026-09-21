/**
 * One sparse editable octree container in octree local space: a root box `[0, rootSize]^3`, a maximum
 * depth, and leaves carrying `occupied`, `color`, and an optional `label`.
 *
 * The class owns allocation-time writes (`insertAtDepth`), `split`, `merge`, `removeLeaf`, painting,
 * depth-first iteration, and leaf-box math. Object identity, transforms, and hierarchy belong to
 * `document`; this container is never a scene graph, and it is not a `Mesh`.
 */

import { Vector3 } from 'three';
import type { Matrix4 } from 'three';
import type { HexColor } from '../uniform/grid.js';
import { OCTANT_COUNT, childLeafIds, decodeLeafId, encodeLeafId, octantOf, parentLeafId } from './leafId.js';
import type { LeafId } from './leafId.js';

export type LeafAttrs = { occupied: boolean; color: HexColor; label?: string };
export type LeafBox = { center: Vector3; size: number; depth: number };

type LeafNode = { kind: 'leaf'; attrs: LeafAttrs };
type BranchNode = { kind: 'branch'; children: LeafId[] };
type Node = LeafNode | BranchNode;

/** The single root node's id; an empty container is a root leaf with `occupied: false`. */
const ROOT_ID: LeafId = '0:';
/** Color of a leaf that carries no appearance yet, matching `THREE.Color`'s default. */
const DEFAULT_COLOR: HexColor = 0xffffff;

/** Copies the attrs, omitting `label` when it is absent so the copy cannot alias or widen it. */
function cloneAttrs(attrs: LeafAttrs): LeafAttrs {
  return attrs.label === undefined
    ? { occupied: attrs.occupied, color: attrs.color }
    : { occupied: attrs.occupied, color: attrs.color, label: attrs.label };
}

function attrsEqual(a: LeafAttrs, b: LeafAttrs): boolean {
  return a.occupied === b.occupied && a.color === b.color && a.label === b.label;
}

/** The integer min-corner cell a leaf path addresses, coarsest digit first. */
function coordinateOfPath(path: readonly number[]): [number, number, number] {
  const depth = path.length;
  let x = 0;
  let y = 0;
  let z = 0;
  for (const [level, digit] of path.entries()) {
    const shift = depth - 1 - level;
    x |= (digit & 1) << shift;
    y |= ((digit >> 1) & 1) << shift;
    z |= ((digit >> 2) & 1) << shift;
  }
  return [x, y, z];
}

function assertInRange(value: number, name: string, limit: number): void {
  if (!Number.isInteger(value) || value < 0 || value >= limit) {
    throw new RangeError(`${name} must be an integer in [0, ${limit}), got ${value}`);
  }
}

export class Octree {
  static create(opts: { rootSize: number; maxDepth: number }): Octree {
    const { rootSize, maxDepth } = opts;
    if (!Number.isFinite(rootSize) || rootSize <= 0) {
      throw new RangeError(`rootSize must be a finite positive number, got ${rootSize}`);
    }
    if (!Number.isInteger(maxDepth) || maxDepth < 0) {
      throw new RangeError(`maxDepth must be a non-negative integer, got ${maxDepth}`);
    }
    return new Octree(rootSize, maxDepth);
  }

  readonly rootSize: number;
  readonly maxDepth: number;

  /** Every node lives here: a leaf carries attrs, a branch carries 1..8 child ids, never both. */
  private readonly nodes = new Map<LeafId, Node>();
  private leafTotal = 0;
  private occupiedTotal = 0;

  private constructor(rootSize: number, maxDepth: number) {
    this.rootSize = rootSize;
    this.maxDepth = maxDepth;
    this.nodes.set(ROOT_ID, { kind: 'leaf', attrs: { occupied: false, color: DEFAULT_COLOR } });
    this.leafTotal = 1;
  }

  get leafCount(): number {
    return this.leafTotal;
  }

  get occupiedLeafCount(): number {
    return this.occupiedTotal;
  }

  /** Edge length of a depth-`depth` leaf: `rootSize / 2^depth`. */
  leafSize(depth: number): number {
    if (!Number.isInteger(depth) || depth < 0 || depth > this.maxDepth) {
      throw new RangeError(`depth must be an integer in [0, ${this.maxDepth}], got ${depth}`);
    }
    return this.rootSize / 2 ** depth;
  }

  hasLeaf(id: LeafId): boolean {
    const node = this.lookup(id);
    return node !== undefined && node.kind === 'leaf';
  }

  getLeaf(id: LeafId): LeafAttrs | undefined {
    const node = this.lookup(id);
    return node !== undefined && node.kind === 'leaf' ? node.attrs : undefined;
  }

  /** Writes attrs onto an existing leaf; a branch or absent id is a `TypeError`. */
  setLeaf(id: LeafId, attrs: LeafAttrs): void {
    const node = this.lookup(id);
    if (node === undefined || node.kind !== 'leaf') {
      throw new TypeError(`setLeaf: "${id}" does not name an existing leaf`);
    }
    this.assignAttrs(node, attrs);
  }

  /** Deletes the leaf node and prunes every branch left without children; the root is never removed. */
  removeLeaf(id: LeafId): boolean {
    const node = this.lookup(id);
    if (node === undefined || node.kind !== 'leaf' || id === ROOT_ID) return false;
    this.nodes.delete(id);
    this.leafTotal -= 1;
    if (node.attrs.occupied) this.occupiedTotal -= 1;
    this.pruneUpward(id);
    return true;
  }

  paintLeaf(id: LeafId, color: HexColor): boolean {
    const node = this.lookup(id);
    if (node === undefined || node.kind !== 'leaf') return false;
    node.attrs = { ...node.attrs, color };
    return true;
  }

  setLabel(id: LeafId, label: string | undefined): boolean {
    const node = this.lookup(id);
    if (node === undefined || node.kind !== 'leaf') return false;
    node.attrs =
      label === undefined
        ? { occupied: node.attrs.occupied, color: node.attrs.color }
        : { ...node.attrs, label };
    return true;
  }

  /** Replaces the leaf with eight children that inherit its attrs, so volume and look are unchanged. */
  split(
    id: LeafId,
  ): { ok: true; children: LeafId[] } | { ok: false; error: 'missing' | 'branch' | 'max-depth' } {
    const { depth } = decodeLeafId(id);
    const node = this.nodes.get(id);
    if (node === undefined) return { ok: false, error: 'missing' };
    if (node.kind === 'branch') return { ok: false, error: 'branch' };
    if (depth >= this.maxDepth) return { ok: false, error: 'max-depth' };
    return { ok: true, children: this.splitLeafNode(id, node) };
  }

  /** The inverse of `split`; it refuses rather than discarding a difference between the children. */
  merge(
    id: LeafId,
  ): { ok: true } | { ok: false; error: 'missing' | 'branch' | 'incomplete' | 'incompatible' } {
    decodeLeafId(id);
    const node = this.nodes.get(id);
    if (node === undefined) return { ok: false, error: 'missing' };
    if (node.kind === 'leaf' || node.children.length < OCTANT_COUNT) {
      return { ok: false, error: 'incomplete' };
    }
    const childAttrs: LeafAttrs[] = [];
    for (const childId of node.children) {
      // Invariant: every child id held by a branch names an existing node.
      const child = this.nodes.get(childId)!;
      if (child.kind === 'branch') return { ok: false, error: 'branch' };
      childAttrs.push(child.attrs);
    }
    const common = childAttrs[0];
    if (common === undefined) return { ok: false, error: 'incomplete' };
    for (const attrs of childAttrs) {
      if (!attrsEqual(common, attrs)) return { ok: false, error: 'incompatible' };
    }
    for (const childId of node.children) {
      this.nodes.delete(childId);
    }
    this.nodes.set(id, { kind: 'leaf', attrs: cloneAttrs(common) });
    this.leafTotal -= OCTANT_COUNT - 1;
    if (common.occupied) this.occupiedTotal -= OCTANT_COUNT - 1;
    return { ok: true };
  }

  /**
   * Writes attrs at the requested depth. The walk splits leaves on the way down, and when the target
   * is already covered by finer leaves it descends into them and writes attrs in full instead of
   * allocating a duplicate — the container's only overlap-resolution rule, so no cell is covered
   * twice and no existing leaf is removed or renumbered.
   */
  insertAtDepth(cell: readonly [number, number, number], depth: number, attrs: LeafAttrs): void {
    if (!Number.isInteger(depth) || depth < 0 || depth > this.maxDepth) {
      throw new RangeError(`depth must be an integer in [0, ${this.maxDepth}], got ${depth}`);
    }
    const limit = 2 ** depth;
    assertInRange(cell[0], 'cell x', limit);
    assertInRange(cell[1], 'cell y', limit);
    assertInRange(cell[2], 'cell z', limit);
    let currentId: LeafId = ROOT_ID;
    const path: number[] = [];
    for (let level = 0; level < depth; level += 1) {
      // Invariant: every id on the path below the root names an existing node, because a branch only
      // ever holds ids of nodes created by a split.
      const node = this.nodes.get(currentId)!;
      if (node.kind === 'leaf') this.splitLeafNode(currentId, node);
      const shift = depth - 1 - level;
      path.push(octantOf((cell[0] >> shift) & 1, (cell[1] >> shift) & 1, (cell[2] >> shift) & 1));
      // The digit rule is octantOf's and the id format is encodeLeafId's: a child id extends the
      // parent's digits under the next depth prefix.
      currentId = encodeLeafId(level + 1, path);
    }
    const target = this.nodes.get(currentId)!;
    if (target.kind === 'leaf') {
      this.assignAttrs(target, attrs);
      return;
    }
    this.writeAttrsUnder(currentId, attrs);
  }

  /** Local-space box of an existing leaf: center, edge length, and its own depth. */
  leafBox(id: LeafId): LeafBox {
    const { depth, path } = decodeLeafId(id);
    const node = this.nodes.get(id);
    if (node === undefined || node.kind !== 'leaf') {
      throw new TypeError(`leafBox: "${id}" does not name an existing leaf`);
    }
    const size = this.leafSize(depth);
    const [x, y, z] = coordinateOfPath(path);
    return {
      center: new Vector3((x + 0.5) * size, (y + 0.5) * size, (z + 0.5) * size),
      size,
      depth,
    };
  }

  /** Depth-first in octant order `0..7`, visiting leaves only, never branches. */
  forEachLeaf(cb: (id: LeafId, attrs: LeafAttrs) => void): void {
    this.visit(ROOT_ID, cb, false);
  }

  forEachOccupiedLeaf(cb: (id: LeafId, attrs: LeafAttrs) => void): void {
    this.visit(ROOT_ID, cb, true);
  }

  /** Applies the world matrix to the leaf center and returns the point, not a size. */
  transformLeafToWorld(id: LeafId, matrix: Matrix4): Vector3 {
    return this.leafBox(id).center.applyMatrix4(matrix);
  }

  /**
   * The id format lives in `./leafId.js`: a malformed id throws its `TypeError` here instead of
   * being reported as a missing node.
   */
  private lookup(id: LeafId): Node | undefined {
    decodeLeafId(id);
    return this.nodes.get(id);
  }

  private assignAttrs(node: LeafNode, attrs: LeafAttrs): void {
    if (node.attrs.occupied !== attrs.occupied) {
      this.occupiedTotal += attrs.occupied ? 1 : -1;
    }
    node.attrs = cloneAttrs(attrs);
  }

  private splitLeafNode(id: LeafId, node: LeafNode): LeafId[] {
    const children = childLeafIds(id);
    for (const childId of children) {
      this.nodes.set(childId, { kind: 'leaf', attrs: cloneAttrs(node.attrs) });
    }
    this.nodes.set(id, { kind: 'branch', children });
    this.leafTotal += OCTANT_COUNT - 1;
    if (node.attrs.occupied) this.occupiedTotal += OCTANT_COUNT - 1;
    return children;
  }

  /** Writes attrs onto every leaf below a branch node, allocating nothing. */
  private writeAttrsUnder(id: LeafId, attrs: LeafAttrs): void {
    // Invariant: every child id held by a branch names an existing node.
    const node = this.nodes.get(id)!;
    if (node.kind === 'leaf') {
      this.assignAttrs(node, attrs);
      return;
    }
    for (const childId of node.children) {
      this.writeAttrsUnder(childId, attrs);
    }
  }

  private visit(
    id: LeafId,
    cb: (id: LeafId, attrs: LeafAttrs) => void,
    occupiedOnly: boolean,
  ): void {
    // Invariant: every child id held by a branch names an existing node, and the root always exists.
    const node = this.nodes.get(id)!;
    if (node.kind === 'leaf') {
      if (!occupiedOnly || node.attrs.occupied) cb(id, node.attrs);
      return;
    }
    for (const childId of node.children) {
      this.visit(childId, cb, occupiedOnly);
    }
  }

  /** Deletes every branch left with no children after a leaf removal, down from the leaf upward. */
  private pruneUpward(fromId: LeafId): void {
    let childId = fromId;
    let parent = parentLeafId(childId);
    while (parent !== null) {
      const parentNode = this.nodes.get(parent);
      if (parentNode === undefined || parentNode.kind !== 'branch') return;
      const index = parentNode.children.indexOf(childId);
      if (index >= 0) parentNode.children.splice(index, 1);
      if (parentNode.children.length > 0) return;
      if (parent === ROOT_ID) {
        // The root is never removed: an emptied container is expressed by the root leaf again.
        this.nodes.set(ROOT_ID, { kind: 'leaf', attrs: { occupied: false, color: DEFAULT_COLOR } });
        this.leafTotal += 1;
        return;
      }
      this.nodes.delete(parent);
      childId = parent;
      parent = parentLeafId(childId);
    }
  }
}
