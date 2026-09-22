# src/ui/modeBar.ts

Ring: 4 · Layer: ui · Depends on: `./dom.js`, `../editor/session.js`

## Responsibility
The viewport's mode switch: two buttons, `Object` and `Edit`, pinned to the bottom centre of the canvas. They are the only way to set
`EditorSession.mode`, which is what the composition root reads to decide whether the gizmo is shown and what the pointer tool reads to decide
whether a press may write voxels (README D39). It renders `session.mode` and forwards a click; it holds no state, reads no project data, and
never touches the document, the scene, or the gizmo.

## Public interface
```ts
type ModeBarContext = { session: EditorSession };
class ModeBar {
  constructor(root: HTMLElement, context: ModeBarContext);
  refresh(): void;
}
```

## Internal logic
1. The constructor builds one `<button>` per mode under `root`, in the order `Object`, `Edit` — the order the bar shows them — labels them from
   `MODE_LABELS`, and forwards each click through `session.setMode(mode)`. The `Object` button is never disabled: leaving a mode never needs a
   selection. `Edit` is (item 2). Nothing else is appended: the bar's root element is the mount point
   `index.html` places at the bottom centre of the canvas, and the bar draws no frame or background of its own.
2. `refresh()` puts `on` on the button of the mode the session is in, takes it off the other, and sets `disabled` on `Edit` while
   `session.activeObjectId` is `null` — that mode edits one object's voxels, so there is nothing to enter it for until the viewport or the
   Scene list has chosen one (README D39). The composition root calls it from its session
   listener, so the bar is a view of the session and never a second copy of it; a click that changes the mode therefore comes back as a refresh
   rather than being reflected here.
3. It stores the session and the two buttons and nothing else; like `Panels`, it registers its listeners through `el`'s `on` and they live for
   the page lifetime, so there is no `dispose`.

## Invariants
- Exactly one button carries `on` after every `refresh()`, and it is the one whose mode equals `session.mode`.
- `Edit` is `disabled` exactly while the session has no active object, and `Object` never is. The rule holds on both sides of an entry: the
  session leaves `edit` mode when the active object is cleared (`EditorSession.setActiveObject`), so the bar never shows a disabled `Edit`
  button as the selected mode.
- The bar is read-and-forward only: it calls `session.setMode` and reads `session.mode`, and touches no other module, no document value, and no
  element outside the subtree it built.
- Two buttons, created once in the constructor: `refresh()` never creates, removes, or re-orders a node, so the DOM is identical after any
  number of refreshes.

## Errors
None. `setMode` takes a closed union and validates nothing, so neither a click nor a refresh can fail; a disabled `Edit` button simply
delivers no click.

## Dependencies
- `./dom.js` — `el` for the two buttons.
- `../editor/session.js` — `EditorSession` for the mode it renders and sets, and `EditorMode` for the union itself.
- No `app/` import, no Three.js import, and no `document/` or `three-runtime/` import: the bar knows only the session.

## Tests
None, like the rest of `ui/`: vitest runs in the node environment without a DOM. Verified by running the app — the bar sits at the bottom centre
of the canvas with `Object` on at startup and `Edit` disabled, because nothing is active yet; clicking a model enables `Edit`, clicking it takes
the gizmo away and gives the canvas back to the Edit group's tools, and the highlighted button follows every switch; deleting the active object
while in `Edit` mode returns the bar to `Object` with `Edit` disabled again (README §10).
