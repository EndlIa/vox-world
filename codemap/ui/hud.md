# src/ui/hud.ts

Ring: 4 · Layer: ui · Depends on: ./dom.js, ../editor/session.js, ../document/project.js

## Responsibility
A read-only status readout: the active object, its representation type, the current edit resolution — the active object's size in voxels per axis
(README D41) — a selection summary, and the current frame and frame rate. It renders a value it is handed and queries nothing — it never touches the project, the picker, or the mirror — because all of that arrives
through `HudState`.

## Public interface
```ts
type HudState = {
  activeObjectName: string | null; representation: 'empty' | 'uniform' | null;
  editResolution: EditResolution | null; selectionText: string; frame: number; fps: number;
};
class Hud {
  constructor(root: HTMLElement);
  update(state: HudState): void;
}
```

## Internal logic
1. The constructor builds one `<div class="hud">` under `root`, one row per field, each row a label `<span>` plus a value `<span>`. No control is
   interactive, no listener is registered, and no state is stored beyond those element references.
2. `update(state)` writes `textContent` of each value span from `state`. `innerHTML` is never used, so an imported node name cannot inject markup
   into the page.
3. Rows rendered: active object name (`—` when `state.activeObjectName === null`); representation type (`empty` | `uniform`, `—` when
   null); edit resolution — `empty` for a transform-only object, the object's occupied size per axis in cells from
   `EditResolution.cells` as `uniform <x>×<y>×<z>` (e.g. `uniform 24×20×97`), `uniform` alone when the resolution carries no
   `cells`, `—` when null; the selection summary taken verbatim from `state.selectionText`; and `frame <frame> · <fps> fps`.
   The resolution is a size in cells, not a length in metres: one cell is one world unit (README D41).
4. Number formatting goes through `fmt`: the frame, the fps, and each count of the resolution row are rendered with `fmt(value, 0)`,
   and that is the whole of it — every value shown is either text the app handed over or a number `fmt` renders.
5. `frame` and `fps` are display values the app computes from `playback.time` and `project.timeline.fps`, and `selectionText` is the app's rendering
   of the session selection; the HUD does not derive, round, or clamp any of them.

## Invariants
- Read-only: the HUD registers no listener, calls no mutator, and reads no module state; every displayed value comes from the last `HudState`
  argument.
- Representation is one of `empty`, `uniform` or absent; edit resolution is shown for the active object only, and is `—` when
  `session.resolutionOf` had nothing to report.
- The resolution row reports a size, never a length: it is `EditResolution.cells` — the object's occupied extent per axis, in
  cells — printed as integers joined by `×`, so `uniform 24×20×97` is 24 cells along x, 20 along y and 97 along z. One cell
  is one world unit (README D41), so the row is a size in the same unit the panel's object rows and the voxelize dialog use,
  not a metre value.
- `update` is a pure render: identical state produces identical text, and calling it twice changes nothing.
- The HUD appends exactly one container under `root` and owns only that subtree.

## Errors
None. The HUD cannot fail and never throws: missing values arrive as `null` and render as `—`, and no value it shows is parsed or computed, so no
parse or range error is possible.

## Dependencies
- `./dom.js` — `el` for the container, rows, and value spans, and `fmt` for the numbers.
- `../editor/session.js` — `EditResolution` for the resolution row's typing.
- `../document/project.js` — `Representation`, the owner of the `'empty' | 'uniform'` union that the brief spells out inline in
  `HudState`.
- No `app/` import, no outer-ring import, and no Three.js import.

## Tests
None. The HUD needs a DOM and vitest runs in the node environment; it is verified by running the app — select an object and confirm its name,
representation, and resolution appear — the demo cube at boot must read `uniform 4×4×4`, and the object an import just adopted must read
`empty` until the dialog is confirmed — drag a box and confirm the selection summary follows it, and watch the playhead row while playback runs.
