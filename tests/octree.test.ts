import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import { Octree } from '../src/voxels/octree/octree.js';
import type { LeafAttrs, LeafBox } from '../src/voxels/octree/octree.js';
import { childLeafIds, decodeLeafId, encodeLeafId, octantOf, parentLeafId } from '../src/voxels/octree/leafId.js';
import type { LeafId } from '../src/voxels/octree/leafId.js';

/** A fresh fixture: the local root box is `[0, 8]^3`. */
function newTree(maxDepth = 3): Octree {
  return Octree.create({ rootSize: 8, maxDepth });
}

function splitOrThrow(tree: Octree, id: LeafId): LeafId[] {
  const result = tree.split(id);
  if (!result.ok) throw new Error(`split(${id}) failed: ${result.error}`);
  return result.children;
}

/** Observable container state, so "refuses" can be checked as "changed nothing". */
function snapshot(tree: Octree): string {
  const parts = [`leaves=${tree.leafCount}`, `occupied=${tree.occupiedLeafCount}`];
  tree.forEachLeaf((id, attrs) => {
    parts.push(`${id}:${attrs.occupied ? 'o' : 'f'}:${attrs.color}:${attrs.label ?? '-'}`);
  });
  return parts.join('|');
}

function expectSplitRefusal(tree: Octree, id: LeafId, error: string): void {
  const before = snapshot(tree);
  expect(tree.split(id)).toEqual({ ok: false, error });
  expect(snapshot(tree)).toBe(before);
}

function expectMergeRefusal(tree: Octree, id: LeafId, error: string): void {
  const before = snapshot(tree);
  expect(tree.merge(id)).toEqual({ ok: false, error });
  expect(snapshot(tree)).toBe(before);
}

function occupiedVolume(tree: Octree): number {
  let total = 0;
  tree.forEachOccupiedLeaf((id) => {
    total += tree.leafBox(id).size ** 3;
  });
  return total;
}

function leafIds(tree: Octree): LeafId[] {
  const ids: LeafId[] = [];
  tree.forEachLeaf((id) => {
    ids.push(id);
  });
  return ids;
}

describe('leaf id encoding', () => {
  it('round-trips a root-to-leaf path', () => {
    expect(encodeLeafId(0, [])).toBe('0:');
    expect(decodeLeafId('0:')).toEqual({ depth: 0, path: [] });
    const paths: [number, number[]][] = [
      [1, [5]],
      [3, [0, 1, 2]],
      [4, [7, 7, 7, 0]],
    ];
    for (const [depth, path] of paths) {
      const id = encodeLeafId(depth, path);
      expect(id).toBe(`${depth}:${path.join('')}`);
      expect(decodeLeafId(id)).toEqual({ depth, path });
      expect(decodeLeafId(id).path).not.toBe(path);
    }
    expect(() => encodeLeafId(-1, [])).toThrow(RangeError);
    expect(() => encodeLeafId(2, [1])).toThrow(RangeError);
    expect(() => encodeLeafId(1, [8])).toThrow(RangeError);
  });

  it('returns null parent at the root and eight children in octant order', () => {
    expect(parentLeafId('0:')).toBeNull();
    expect(childLeafIds('0:')).toEqual([
      '1:0',
      '1:1',
      '1:2',
      '1:3',
      '1:4',
      '1:5',
      '1:6',
      '1:7',
    ]);
    const id = encodeLeafId(2, [1, 5]);
    const children = childLeafIds(id);
    expect(children).toHaveLength(8);
    expect(children[0]).toBe('3:150');
    expect(children[7]).toBe('3:157');
    for (const [octant, child] of children.entries()) {
      expect(child).toBe(`3:15${octant}`);
      expect(parentLeafId(child)).toBe(id);
    }
    expect(parentLeafId(encodeLeafId(4, [0, 1, 2, 3]))).toBe(encodeLeafId(3, [0, 1, 2]));
  });

  it('derives the octant from coordinate parity for negative and positive triples', () => {
    expect(octantOf(0, 0, 0)).toBe(0);
    expect(octantOf(1, 0, 0)).toBe(1);
    expect(octantOf(0, 1, 0)).toBe(2);
    expect(octantOf(0, 0, 1)).toBe(4);
    expect(octantOf(1, 1, 1)).toBe(7);
    expect(octantOf(-1, 0, 0)).toBe(1);
    expect(octantOf(0, -1, 0)).toBe(2);
    expect(octantOf(0, 0, -1)).toBe(4);
    expect(octantOf(-1, -1, -1)).toBe(7);
    expect(octantOf(-3, -2, -1)).toBe(5);
    expect(octantOf(2, 4, 6)).toBe(0);
  });

  it('throws TypeError on a malformed id', () => {
    const malformed = ['', '0', '3:08', '3:01', 'x:1', '2:1x', '-1:0', '1:8'];
    for (const id of malformed) {
      expect(() => decodeLeafId(id)).toThrow(TypeError);
    }
  });
});

describe('split', () => {
  it('gives the eight children the parent occupied, color, and label', () => {
    const tree = newTree();
    const attrs: LeafAttrs = { occupied: true, color: 0x3366cc, label: 'crate' };
    tree.insertAtDepth([0, 0, 0], 1, attrs);
    const parent = encodeLeafId(1, [0]);
    const children = splitOrThrow(tree, parent);
    expect(children).toHaveLength(8);
    for (const child of children) {
      expect(tree.hasLeaf(child)).toBe(true);
      expect(tree.getLeaf(child)).toEqual(attrs);
    }
    expect(tree.hasLeaf(parent)).toBe(false);
    expect(tree.getLeaf(parent)).toBeUndefined();
    expect(tree.leafCount).toBe(15);
    expect(tree.occupiedLeafCount).toBe(8);

    const first = children[0];
    if (first === undefined) throw new Error('split returned no children');
    expect(tree.paintLeaf(first, 0x000000)).toBe(true);
    expect(tree.getLeaf(first)).toEqual({ occupied: true, color: 0x000000, label: 'crate' });
    for (const child of children.slice(1)) {
      expect(tree.getLeaf(child)).toEqual(attrs);
    }
  });

  it('halves the edge and keeps the occupied volume', () => {
    const tree = newTree();
    tree.insertAtDepth([0, 0, 0], 0, { occupied: true, color: 0x77aa11 });
    const parentBox = tree.leafBox('0:');
    expect(parentBox.size).toBe(8);
    const volumeBefore = occupiedVolume(tree);
    expect(volumeBefore).toBe(512);

    const children = splitOrThrow(tree, '0:');
    expect(children).toHaveLength(8);
    expect(tree.leafCount).toBe(8);
    expect(occupiedVolume(tree)).toBe(volumeBefore);

    const boxes: LeafBox[] = [];
    for (const child of children) {
      expect(tree.getLeaf(child)).toEqual({ occupied: true, color: 0x77aa11 });
      const box = tree.leafBox(child);
      boxes.push(box);
      expect(box.depth).toBe(1);
      expect(box.size).toBe(parentBox.size / 2);
      expect(box.size).toBe(tree.leafSize(1));
    }
    const centers = boxes.map((box) => box.center.x).sort((a, b) => a - b);
    expect(centers).toEqual([2, 2, 2, 2, 6, 6, 6, 6]);
    for (const [index, a] of boxes.entries()) {
      for (const [other, b] of boxes.entries()) {
        if (other <= index) continue;
        const disjoint =
          Math.abs(a.center.x - b.center.x) >= a.size ||
          Math.abs(a.center.y - b.center.y) >= a.size ||
          Math.abs(a.center.z - b.center.z) >= a.size;
        expect(disjoint).toBe(true);
      }
    }
  });

  it('reports missing, branch, and max-depth without mutating', () => {
    const tree = newTree();
    expectSplitRefusal(tree, encodeLeafId(2, [0, 1]), 'missing');
    expect(() => tree.split('nonsense')).toThrow(TypeError);
    splitOrThrow(tree, '0:');
    expectSplitRefusal(tree, '0:', 'branch');

    const shallow = newTree(1);
    splitOrThrow(shallow, '0:');
    expectSplitRefusal(shallow, '1:0', 'max-depth');
    expect(shallow.hasLeaf('1:0')).toBe(true);
  });
});

describe('merge', () => {
  it('restores the parent from eight compatible leaves', () => {
    const tree = newTree();
    const attrs: LeafAttrs = { occupied: true, color: 0x123456, label: 'a' };
    tree.insertAtDepth([0, 0, 0], 0, attrs);
    const before = snapshot(tree);
    expect(tree.leafCount).toBe(1);
    splitOrThrow(tree, '0:');
    expect(tree.leafCount).toBe(8);
    expect(tree.occupiedLeafCount).toBe(8);

    expect(tree.merge('0:')).toEqual({ ok: true });
    expect(tree.hasLeaf('0:')).toBe(true);
    expect(tree.getLeaf('0:')).toEqual(attrs);
    expect(tree.leafCount).toBe(1);
    expect(tree.occupiedLeafCount).toBe(1);
    expect(snapshot(tree)).toBe(before);
    for (const child of childLeafIds('0:')) {
      expect(tree.hasLeaf(child)).toBe(false);
      expect(tree.getLeaf(child)).toBeUndefined();
    }
  });

  it('refuses incomplete and incompatible children without mutating', () => {
    const leafOnly = newTree();
    expectMergeRefusal(leafOnly, '0:', 'incomplete');
    expectMergeRefusal(leafOnly, encodeLeafId(1, [2]), 'missing');

    const short = newTree();
    splitOrThrow(short, '0:');
    expect(short.removeLeaf('1:3')).toBe(true);
    expectMergeRefusal(short, '0:', 'incomplete');

    const painted = newTree();
    splitOrThrow(painted, '0:');
    expect(painted.paintLeaf('1:3', 0x00ff00)).toBe(true);
    expectMergeRefusal(painted, '0:', 'incompatible');

    const labelled = newTree();
    splitOrThrow(labelled, '0:');
    expect(labelled.setLabel('1:5', 'hand')).toBe(true);
    expectMergeRefusal(labelled, '0:', 'incompatible');

    const occupancy = newTree();
    splitOrThrow(occupancy, '0:');
    const sibling = occupancy.getLeaf('1:0');
    if (sibling === undefined) throw new Error('split produced no child leaf');
    occupancy.setLeaf('1:7', { occupied: !sibling.occupied, color: sibling.color });
    expectMergeRefusal(occupancy, '0:', 'incompatible');

    const nested = newTree();
    splitOrThrow(nested, '0:');
    splitOrThrow(nested, '1:3');
    expectMergeRefusal(nested, '0:', 'branch');
  });
});

describe('insertAtDepth', () => {
  it('splits occupied leaves on the way down', () => {
    const tree = newTree();
    const coarse: LeafAttrs = { occupied: true, color: 0x111111 };
    tree.insertAtDepth([0, 0, 0], 1, coarse);
    expect(tree.leafCount).toBe(8);
    expect(tree.getLeaf(encodeLeafId(1, [0]))).toEqual(coarse);

    const fine: LeafAttrs = { occupied: true, color: 0x222222 };
    tree.insertAtDepth([0, 0, 0], 3, fine);
    expect(tree.hasLeaf(encodeLeafId(1, [0]))).toBe(false);
    expect(tree.hasLeaf(encodeLeafId(2, [0, 0]))).toBe(false);
    expect(tree.getLeaf(encodeLeafId(3, [0, 0, 0]))).toEqual(fine);
    expect(tree.getLeaf(encodeLeafId(2, [0, 1]))).toEqual(coarse);
    expect(tree.getLeaf(encodeLeafId(3, [0, 0, 1]))).toEqual(coarse);
    expect(tree.leafCount).toBe(22);
    expect(tree.occupiedLeafCount).toBe(15);
    expect(occupiedVolume(tree)).toBe(4 ** 3);

    expect(() => tree.insertAtDepth([0, 0, 0], 4, fine)).toThrow(RangeError);
    expect(() => tree.insertAtDepth([8, 0, 0], 3, fine)).toThrow(RangeError);
    expect(() => tree.insertAtDepth([-1, 0, 0], 3, fine)).toThrow(RangeError);
  });

  it('paints finer leaves instead of duplicating them', () => {
    const tree = newTree();
    tree.insertAtDepth([0, 0, 0], 3, { occupied: true, color: 0xff0000 });
    expect(tree.leafCount).toBe(22);
    const siblingBefore = tree.getLeaf('1:1');
    expect(siblingBefore?.occupied).toBe(false);

    const overwrite: LeafAttrs = { occupied: true, color: 0x00ff00 };
    tree.insertAtDepth([0, 0, 0], 1, overwrite);
    expect(tree.leafCount).toBe(22);
    expect(tree.occupiedLeafCount).toBe(15);
    const repainted = [
      '2:01',
      '2:02',
      '2:03',
      '2:04',
      '2:05',
      '2:06',
      '2:07',
      '3:000',
      '3:001',
      '3:002',
      '3:003',
      '3:004',
      '3:005',
      '3:006',
      '3:007',
    ];
    for (const leafId of repainted) {
      expect(tree.getLeaf(leafId)).toEqual(overwrite);
    }
    for (const leafId of ['1:1', '1:2', '1:3', '1:4', '1:5', '1:6', '1:7']) {
      expect(tree.getLeaf(leafId)).toEqual(siblingBefore);
    }
    expect(occupiedVolume(tree)).toBe(4 ** 3);
  });

  it('never makes one node both a leaf and a branch', () => {
    const tree = newTree();
    tree.insertAtDepth([3, 5, 6], 3, { occupied: true, color: 0xabcdef, label: 'rock' });
    // a coarse write uses the target depth's coordinate space: (3, 5, 6) at depth 3 is (0, 1, 1) at depth 1
    tree.insertAtDepth([0, 1, 1], 1, { occupied: false, color: 0xffffff });

    const ids = leafIds(tree);
    expect(tree.leafCount).toBe(22);
    expect(tree.leafCount).toBe(ids.length);
    for (const id of ids) {
      expect(tree.hasLeaf(id)).toBe(true);
      expect(tree.getLeaf(id)).toBeDefined();
      const parent = parentLeafId(id);
      if (parent === null) continue;
      expect(tree.hasLeaf(parent)).toBe(false);
      expect(tree.getLeaf(parent)).toBeUndefined();
      expect(tree.split(parent)).toEqual({ ok: false, error: 'branch' });
    }

    const branch = encodeLeafId(1, [6]);
    expect(tree.hasLeaf(branch)).toBe(false);
    expect(tree.removeLeaf(branch)).toBe(false);
    expect(tree.paintLeaf(branch, 0x000000)).toBe(false);
    expect(tree.setLabel(branch, 'x')).toBe(false);
    expect(() => tree.setLeaf(branch, { occupied: false, color: 0 })).toThrow(TypeError);
    expect(() => tree.leafBox(branch)).toThrow(TypeError);
  });
});

describe('removeLeaf and pruning', () => {
  it('prunes branches that lose their last child but never the root', () => {
    const tree = newTree();
    expect(tree.removeLeaf('0:')).toBe(false);
    expect(tree.hasLeaf('0:')).toBe(true);
    expect(tree.leafCount).toBe(1);

    tree.insertAtDepth([0, 0, 0], 3, { occupied: true, color: 0x123456 });
    expect(tree.leafCount).toBe(22);
    expect(tree.removeLeaf(encodeLeafId(3, [0, 0, 0]))).toBe(true);
    expect(tree.hasLeaf(encodeLeafId(2, [0, 0]))).toBe(false);
    expect(tree.getLeaf(encodeLeafId(2, [0, 0]))).toBeUndefined();
    expect(tree.leafCount).toBe(21);
    expect(tree.hasLeaf(encodeLeafId(2, [0, 1]))).toBe(true);
    expect(tree.occupiedLeafCount).toBe(0);

    const emptied = newTree();
    emptied.insertAtDepth([0, 0, 0], 1, { occupied: true, color: 0x445566 });
    for (const child of childLeafIds('0:')) {
      expect(emptied.removeLeaf(child)).toBe(true);
    }
    expect(emptied.hasLeaf('0:')).toBe(true);
    expect(emptied.getLeaf('0:')?.occupied).toBe(false);
    expect(emptied.leafCount).toBe(1);
    expect(emptied.occupiedLeafCount).toBe(0);
    expect(emptied.removeLeaf('0:')).toBe(false);
  });

  it('returns false for a missing leaf', () => {
    const tree = newTree();
    expect(tree.removeLeaf(encodeLeafId(2, [0, 1]))).toBe(false);
    expect(tree.paintLeaf(encodeLeafId(2, [0, 1]), 0xff0000)).toBe(false);
    expect(tree.setLabel(encodeLeafId(2, [0, 1]), 'x')).toBe(false);

    tree.insertAtDepth([1, 1, 1], 1, { occupied: true, color: 0x0000ff });
    expect(tree.removeLeaf(encodeLeafId(1, [0]))).toBe(true);
    expect(tree.removeLeaf(encodeLeafId(1, [0]))).toBe(false);
    expect(tree.leafCount).toBe(7);
    expect(tree.occupiedLeafCount).toBe(1);
    expect(tree.getLeaf(encodeLeafId(1, [7]))).toEqual({ occupied: true, color: 0x0000ff });
  });
});

describe('traversal and geometry', () => {
  it('visits leaves depth-first in octant order 0..7', () => {
    const tree = newTree();
    expect(leafIds(tree)).toEqual(['0:']);
    tree.insertAtDepth([1, 1, 1], 1, { occupied: true, color: 0x111111 });
    tree.insertAtDepth([0, 0, 0], 3, { occupied: true, color: 0x222222 });
    expect(leafIds(tree)).toEqual([
      '3:000',
      '3:001',
      '3:002',
      '3:003',
      '3:004',
      '3:005',
      '3:006',
      '3:007',
      '2:01',
      '2:02',
      '2:03',
      '2:04',
      '2:05',
      '2:06',
      '2:07',
      '1:1',
      '1:2',
      '1:3',
      '1:4',
      '1:5',
      '1:6',
      '1:7',
    ]);
    expect(tree.leafCount).toBe(22);

    const occupied: LeafId[] = [];
    tree.forEachOccupiedLeaf((id) => {
      occupied.push(id);
    });
    expect(occupied).toEqual(['3:000', '1:7']);
    expect(tree.occupiedLeafCount).toBe(occupied.length);
  });

  it('reports each leaf box center and edge in local space', () => {
    const tree = newTree();
    expect(tree.rootSize).toBe(8);
    expect(tree.maxDepth).toBe(3);
    const root = tree.leafBox('0:');
    expect(root.depth).toBe(0);
    expect(root.size).toBe(8);
    expect(root.center.toArray()).toEqual([4, 4, 4]);

    tree.insertAtDepth([3, 5, 6], 3, { occupied: true, color: 0xffffff });
    // cell (3, 5, 6) has octant path 6, 5, 3 from the coarsest level down
    const id = encodeLeafId(3, [6, 5, 3]);
    expect(tree.hasLeaf(id)).toBe(true);
    const box = tree.leafBox(id);
    expect(box.depth).toBe(3);
    expect(box.size).toBe(1);
    expect(box.size).toBe(tree.leafSize(box.depth));
    expect(box.center.toArray()).toEqual([3.5, 5.5, 6.5]);
    expect(tree.leafSize(0)).toBe(8);
    expect(() => tree.leafSize(4)).toThrow(RangeError);
    expect(() => tree.leafSize(-1)).toThrow(RangeError);

    for (const leafId of leafIds(tree)) {
      const leafBox = tree.leafBox(leafId);
      expect(leafBox.size).toBe(tree.leafSize(leafBox.depth));
      expect(leafBox.depth).toBe(decodeLeafId(leafId).depth);
    }

    const matrix = new Matrix4().makeTranslation(10, -2, 0.5);
    const world = tree.transformLeafToWorld(id, matrix);
    expect(world).toBeInstanceOf(Vector3);
    expect(world.toArray()).toEqual([13.5, 3.5, 7]);
  });
});
