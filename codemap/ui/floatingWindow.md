# src/ui/floatingWindow.ts

Ring: 4 · Layer: ui · Depends on: ./dom.js

## Responsibility
One floating window: a `section` with a title bar and a body, placed over the page where its owner said, and moved by dragging its own title bar.
It owns its title, its body element, its position, and whether it is open, and nothing else: the owner fills `body`, chooses the start position,
and hears every visibility change through `onVisibilityChange`. Closing hides the window and leaves every node inside it where it is — the widget
never reads, writes, clears, or removes a control — so a reopened window shows whatever state its owner's controls were left in. It is not a
dialog: it has no backdrop, nothing is modal, and several windows are open and moved independently at once.

## Public interface
```ts
type FloatingWindowOptions = {
  title: string;                    // the name the title bar shows
  left: number; top: number;        // initial position, in viewport pixels
  onVisibilityChange(open: boolean): void;   // called on every visibility change, never for a no-op
};
class FloatingWindow {
  constructor(options: FloatingWindowOptions);
  readonly root: HTMLElement;       // the owner appends it; only raise() ever rewrites its inline z-index
  readonly body: HTMLDivElement;    // the owner's content goes here
  get isOpen(): boolean;
  open(): void;
  close(): void;                    // hiding an already hidden window changes nothing and calls nothing
  toggle(): void;
  dispose(): void;                  // removes every listener this window registered and the root from the document
}
```

## Internal logic
1. The constructor builds the whole widget once through `el`: a `section.window` holding an `h2.window-title` — a `span` with `title` plus a
   `button.window-close` whose text is `×` and whose `aria-label` is `Close` — and a `div.window-body`, which starts empty. It sets
   `hidden = true`, writes the options' `left` and `top` as inline `px`, sets an inline `z-index` of `15`, and appends nothing to the document:
   the owner appends `root`, and the panel appends it into `#panels`. The body is never populated by the widget; a window with no content is an
   empty frame.
2. It registers exactly three permanent listeners through `on`, keeping each detach function: `pointerdown` on the title bar starts a drag,
   `pointerdown` on the root raises the window, and `click` on the close button closes it. A press on the close button is inside the title bar,
   so `beginDrag` returns early for it instead of cancelling it — cancelling that pointer event would swallow the click that does the closing.
3. `open()`, `close()`, and `toggle()` all end in `setOpen(open)`: an unchanged state returns immediately, otherwise it stores the flag, writes
   `root.hidden = !open`, and calls `onVisibilityChange(open)`. Visibility is the `hidden` attribute alone: no node is created, removed, emptied,
   or re-parented, and the position is untouched, so the window's rectangle is the same when it is shown again.
4. `beginDrag(event)` ignores anything that is not a primary-button `PointerEvent`, then cancels the pointer event (so the browser starts no text
   selection drag instead of the window move), ends any drag still in flight, raises the window, and remembers `event.clientX/clientY` together
   with the root's `getBoundingClientRect()` left and top. `pointermove` and `pointerup` go on `window` — never on the canvas, and no pointer
   capture is used anywhere — so a drag that leaves the window or the viewport keeps tracking the pointer until the button is released. Each move
   calls `setPosition(startLeft + (clientX - startX), startTop + (clientY - startY))`; the release removes both listeners.
5. `setPosition(left, top)` clamps before writing. Horizontally at least `MIN_VISIBLE` (120) px of the window stays inside the viewport:
   `left ∈ [120 − width, innerWidth − 120]`. Vertically the whole title bar stays inside, measured as its bottom edge relative to the window's
   own top so borders are included: `top ∈ [0, innerHeight − barBottom]`. A drag past an edge therefore parks the window against it with its
   title bar still grabbable, and both clamped numbers are what the window keeps.
6. `raise()` puts this window above the other windows without moving anything in the DOM: it collects the siblings in the same parent that carry
   the window class, sorts them by their current inline `z-index`, renumbers them from `BASE_Z` (15), and gives this window the next step. The
   ladder is bounded by the number of windows in the parent — five in the panel — so it never reaches the voxelize modal's `z-index: 20`, and it
   stays above `#hud` (10) whatever order the windows are pressed in. Because the DOM is not touched, a press that raises a window cannot break
   the click that follows it, so `×` still closes a window that was not on top.
7. `dispose()` is idempotent: it ends the drag in flight, calls every stored detach function, empties the list, removes `root` from the document,
   and marks the window disposed and closed.

## Invariants
- The widget holds no project, session, panel, or application state. Its whole state is the title bar and body it built, the two numbers of its
  position, the open flag, and the listener detach functions.
- `open`/`close`/`toggle` never change the body: every node the owner put there is still there, unchanged, in the same order, after any number of
  closes.
- `onVisibilityChange` is called exactly once per change of visibility, with the new state, and never for a no-op (`open()` on an open window,
  `close()` on a closed one) — which is what keeps the owner's marker in step with the window.
- `root` stays in the parent the owner put it in: `raise()` only rewrites inline `z-index`, and the value it writes is always at most
  `BASE_Z + (windows in that parent) − 1`, so every window is over `#hud` (10) and under the voxelize modal (20).
- A drag's `pointermove`/`pointerup` listeners exist on `window` exactly while the pointer is down on a title bar (plus the three permanent
  listeners), and no pointer capture is ever taken.
- After any drag the window keeps at least 120 px of its width inside the viewport and its whole title bar inside the viewport. A window wider
  than the viewport can satisfy both only by staying parked at the edge the drag came from, which is what the clamp does: it takes the inner
  bound, so `left = innerWidth − 120` and the window's visible strip stays reachable.
- `dispose()` is idempotent; afterwards no listener this window registered is attached anywhere, `root` is out of the document, `isOpen` is
  false, and `open()`/`toggle()` throw.

## Errors
No `Result` and nothing is swallowed. `open()` and `toggle()` throw `TypeError` once the window has been disposed — the same refusal
`VoxelizeDialog.open` makes — because a disposed window has no listeners and no place in the document, so opening it could only lie.
`close()` and `dispose()` never throw: a stray `×` click on an already closed window, and a second `dispose()`, are ordinary no-ops. No other
path can fail: a drag with no parent to raise against simply does not raise, and a drag that produced no `pointermove` leaves the position alone.

## Dependencies
`./dom.js` — `el` for construction and `on` for the listeners it must be able to remove. Nothing else: no project, document, editor, export, or
Three.js import, no `app/`, and no CSS module — the window's look and the `MIN_VISIBLE`/`BASE_Z` facts it works with live in `index.html`
(`.window`, `.window > h2`, `.window-close`) and in its own constants.

## Tests
None, and it cannot have any: it needs a DOM, a layout, and pointer input, while vitest runs in the node environment, so it is verified by running
the app (README section 10). The walk: press a rail button and confirm one window appears holding that group's controls; drag its title bar and
confirm the window follows the pointer and that `left`/`top` changed; release and confirm the position stays; press `×` and confirm the window is
hidden, its button unmarked, and its controls still in the DOM; open two windows and confirm they open at different positions and that pressing
one puts it above the other; drag one far past each viewport edge and confirm its title bar stays fully visible and at least 120 px of the window
stays inside; and import a GLB while windows are open, confirming the voxelize modal is above them.
