# src/voxels/octree/leafId.ts

Ring: 0 · Layer: voxels/octree · Depends on: nothing (plain string and number helpers, no Three.js)

## Responsibility
The textual identity of an octree leaf: encode, decode, and navigate the root-to-leaf path of octant
indices. It owns no tree and no budget; it is the one place where the `LeafId` string format is
defined, so every other module treats ids as opaque strings.

## Public interface
```ts
type LeafId = string;                       // "<depth>:<digits>", root leaf is "0:"
const OCTANT_COUNT = 8;
function encodeLeafId(depth: number, path: readonly number[]): LeafId;
function decodeLeafId(id: LeafId): { depth: number; path: number[] };   // throws TypeError on malformed
function parentLeafId(id: LeafId): LeafId | null;                       // null for the root
function childLeafIds(id: LeafId): LeafId[];                            // 8 ids, octant order 0..7
function octantOf(x: number, y: number, z: number): number;             // one coordinate triple
```

## Internal logic
1. Format: `"<depth>:<digit>..."` — the decimal depth, a colon, then exactly `depth` decimal digits,
   each in `0..7` and equal to the octant taken at that level. The root leaf is `"0:"` (depth 0, empty
   digit string).
2. `encodeLeafId(depth, path)` is `` `${depth}:${path.join('')}` `` after validation; it does not
   normalize or pad.
3. `decodeLeafId` splits on the first colon, parses the depth, requires `digits.length === depth`, and
   returns `{ depth, path }` with `path` as a fresh `number[]`. Malformed input — missing colon,
   non-numeric or negative depth, a non-digit, a digit above 7, or a digit count other than `depth` —
   throws `TypeError`.
4. `parentLeafId` returns `null` for `"0:"`; otherwise it drops the last digit and decrements the
   depth, giving `"<depth-1>:<digits without last>"`.
5. `childLeafIds` returns the eight ids `"<depth+1>:<digits><k>"` for `k` in `0..7`, in octant order.
6. `octantOf(x, y, z) = (x & 1) | ((y & 1) << 1) | ((z & 1) << 2)` — the parity of the triple, so it
   is correct for the negative uniform coordinates as well as the non-negative octree ones. It is the
   single source of the digit rule used when descending or when addressing a child.
7. Identity is positional, never allocated: a leaf's id is derived from its path, so splitting leaf
   `"3:012"` produces `"4:0120"` … `"4:0127"` and every child id extends its parent's digits. The
   parent id keeps its meaning (the region that contained the children) but no longer names a leaf.

## Invariants
- `decodeLeafId(encodeLeafId(d, p))` returns `{ depth: d, path: p }` for every `d >= 0` and every
  `p` of length `d` with digits in `0..7`; the strings are canonical, so equal paths give equal ids.
- `encodeLeafId(0, []) === "0:"`, `parentLeafId("0:") === null`, and
  `parentLeafId(encodeLeafId(d + 1, p)) === encodeLeafId(d, p.slice(0, d))`.
- `childLeafIds(id).length === OCTANT_COUNT === 8`, the `k`-th entry is the child reached by the
  octant index `k`, and `parentLeafId(childLeafIds(id)[k]) === id` for every `k`.
- Ids are stable across splits: a child id is its parent id with one appended digit, and no split,
  merge, or removal ever renumbers an existing id.
- A leaf id string never exceeds `maxDepth` digits, because the tree never exceeds its maximum depth.

## Errors
- `decodeLeafId` throws `TypeError` for every malformed string, including `""`, `"0"`, `"3:08"`,
  `"3:01"` (wrong length), and `"x:1"`. The message states the offending id.
- `parentLeafId`, `childLeafIds`, and `encodeLeafId` propagate that `TypeError`; they never return
  `null` or a shortened id to paper over malformed input.
- `encodeLeafId` throws `RangeError` when `depth` is not a non-negative integer, when
  `path.length !== depth`, or when an entry is not an integer in `0..OCTANT_COUNT - 1`. These are
  programmer errors; no error literal is involved.

## Dependencies
None. `LeafId` is declared here and imported by `./octree.js`, `document/project.ts`,
`document/detach.ts`, `three-runtime/picking.ts`, `three-runtime/scene.ts`, `editor/session.ts`, and
`editor/ops.ts`; none of them may re-declare or reinterpret the format.

## Tests
`tests/octree.test.ts`: root round-trip `"0:"`, encode/decode round-trip at several depths,
`parentLeafId`/`childLeafIds` agreement, `octantOf` parity for negative and positive triples, and
`TypeError` on the malformed strings listed above. (Ring-0 leaf-id rules are small enough to live in
the octree suite rather than a file of their own.)
