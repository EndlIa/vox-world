# src/ui/dom.ts

Ring: 4 · Layer: ui · Depends on: none

## Responsibility
Three small plain-DOM helpers shared by every panel: element construction, event registration that
returns its own detach function, and locale-independent number formatting. It holds no state,
declares no data type, and is not a widget toolkit or a component system.

## Public interface
```ts
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Partial<HTMLElementTagNameMap[K]> & {
  class?: string; text?: string; on?: Record<string, EventListener> }, children?: (Node | string)[]): HTMLElementTagNameMap[K];
function on<T extends EventTarget>(target: T, type: string, handler: (event: Event) => void): () => void;
function fmt(value: number, digits?: number): string;
```

## Internal logic
`el`
1. `document.createElement(tag)`.
2. `class` → `element.className`, `text` → `element.textContent`, each `on` entry → `on(element,
   type, listener)`. `null` and `undefined` values are skipped, so a caller can pass an optional value
   straight through.
3. Every remaining key is assigned onto the element as a property (`style`, `value`, `type`,
   `checked`, `disabled`, `hidden`, `title`, `min`, `max`, `step`, `placeholder`). The
   `Partial<HTMLElementTagNameMap[K]>` parameter type is what keeps this assignment checked, so no
   attribute table and no string-keyed setter exists here.
4. Children are appended in order; a `string` becomes a `Text` node, a `Node` is appended as is.
5. The element is returned detached — `el` never appends to `document.body`; the caller owns placement.

`on`
1. `target.addEventListener(type, handler)`.
2. Return a closure that calls `target.removeEventListener(type, handler)`. Removing twice is
   harmless, which is what makes composed detach functions safe in panels.

`fmt`
1. Non-finite input → `String(value)` (`"NaN"`, `"Infinity"`), so a display row never renders `""`.
2. Otherwise `value.toFixed(digits ?? 3)`.
3. No `toLocaleString`, no thousands separators, no unit suffix: the decimal separator is always `"."`
   regardless of the browser locale, so panel text and screenshots stay stable.

## Invariants
- No module-level mutable state, no caches, no registration of listeners other than the ones `el` and
  `on` are asked for.
- The element returned by `el` is not in the document; its parent is the caller's decision.
- The closure returned by `on` removes exactly the one listener registered by that call, and only that
  one.
- `fmt` output uses `"."` as its decimal separator in every locale, and its output depends only on
  `value` and `digits`.

## Errors
Nothing returns a `Result`. An unknown tag name, a property that the tag does not implement, or a
`digits` outside `toFixed`'s accepted range throws `TypeError`/`RangeError` from the DOM or from
`toFixed`; those are programmer errors and propagate unchanged.

## Dependencies
None — page globals (`document`, `EventTarget`, `Node`) only. Every panel can import this file without
pulling in project, editor, animation, or Three.js code, which is why it sits at the bottom of `ui`.

## Tests
None. `fmt` is pure and would run under the node test environment, but the brief's test inventory
(section 4) covers rings 0/1 only; DOM behavior is verified by running the app (README section 10).
