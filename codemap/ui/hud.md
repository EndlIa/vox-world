# src/ui/hud.ts

Ring: 4 · Layer: ui · Depends on: ./dom.js, ../editor/session.js, ../document/project.js, ../voxels/octree/leafId.js, ../voxels/uniform/grid.js

## Responsibility
A read-only status readout: the active object, its representation type, the current edit resolution, a selection summary, the current frame and frame
rate, and the picked leaf's depth, size, occupancy, and color. It renders a value it is handed and queries nothing — it never touches the octree, the
project, the picker, or the mirror — because all of that arrives through `HudState`.

## Public interface
```ts
type HudState = {
  activeObjectName: string | null; representation: 'empty' | 'uniform' | 'octree' | null;
  editResolution: EditResolution | null; selectionText: string; frame: number; fps: number;
  leaf: { leafId: LeafId; depth: number; size: number; occupied: boolean; color: HexColor } | null;
};
class Hud {
  constructor(root: HTMLElement);
  update(state: HudState): void;
}
```

## Internal logic
1. The constructor builds one `<div class="hud">` under `root`, one row per field, each row a label `<span>` plus a value `<span>`; the leaf block is
   a small sub-list of its own. No control is interactive, no listener is registered, and no state is stored beyond those element references.
2. `update(state)` writes `textContent` of each value span from `state`. `innerHTML` is never used, so an imported node name or a leaf label cannot
   inject markup into the page.
3. Rows rendered: active object name (`—` when `state.activeObjectName === null`); representation type (`empty` | `uniform` | `octree`, `—` when
   null); edit resolution — `empty` for a transform-only object, `uniform <voxelSize> m` or `octree <leafSize> m` from `EditResolution`, `—` when
   null; the selection summary taken verbatim from `state.selectionText`; and `frame <frame> · <fps> fps`.
4. Leaf block, rendered whenever `state.leaf !== null`: `leafId`, `depth`, `size` in meters, `occupied` / `empty` from `occupied`, and the appearance
   color as `#rrggbb` (`'#' + color.toString(16).padStart(6, '0')`). When `state.leaf` is null the block shows `—`, so the row never disappears and
   the layout never jumps.
5. Number formatting goes through `fmt`; `depth` is an integer and is rendered with `fmt(depth, 0)`, so no trailing decimals appear.
6. `frame` and `fps` are display values the app computes from `playback.time` and `project.timeline.fps`, and `leaf` is the app's mapping of the last
   pick (octree leaf inspected at `leafId`); the HUD does not derive, round, or clamp any of them.

## Invariants
- Read-only: the HUD registers no listener, calls no mutator, and reads no module state; every displayed value comes from the last `HudState`
  argument.
- The four SRS leaf-inspection values — depth, size, occupancy, and color — are all displayed whenever `state.leaf` is present, and they come from
  `HudState.leaf` alone: the HUD never calls `Picker.pick`, `Octree.getLeaf`/`leafBox`, or any mirror accessor.
- Representation is one of `empty`, `uniform`, `octree` or absent; edit resolution is shown for the active object only, and is `—` when
  `session.resolutionOf` had nothing to report.
- `update` is a pure render: identical state produces identical text, and calling it twice changes nothing.
- The HUD appends exactly one container under `root` and owns only that subtree.

## Errors
None. The HUD cannot fail and never throws: missing values arrive as `null` and render as `—`, and the color is formatted from an unsigned hex number,
so no parse or range error is possible.

## Dependencies
- `./dom.js` — `el` for the container, rows, and value spans.
- `../editor/session.js` — `EditResolution` for the resolution row's typing.
- `../document/project.js` — `Representation`, the owner of the `'empty' | 'uniform' | 'octree'` union that the brief spells out inline in
  `HudState`.
- `../voxels/octree/leafId.js` — `LeafId` for `HudState.leaf`; `../voxels/uniform/grid.js` — `HexColor` for its color field.
- No `app/` import, no outer-ring import, and no Three.js import.

## Tests
None. The HUD needs a DOM and vitest runs in the node environment; it is verified by running the app — pick a leaf and confirm depth, size, occupancy,
and color appear, then split, merge, and paint it and confirm the values follow.
