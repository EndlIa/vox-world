/**
 * Plain DOM helpers shared by every panel: element construction, listener registration that returns
 * its own detach function, and locale-independent number formatting. No state, no caches, no imports.
 */

/**
 * Creates a detached element. `class`, `text`, and `on` are handled specially; every other key is
 * assigned onto the element as a property, which is what the parameter type keeps checked.
 * `null` and `undefined` values are skipped, so an optional value can be passed straight through.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Partial<HTMLElementTagNameMap[K]> & {
    class?: string;
    text?: string;
    on?: Record<string, EventListener>;
  },
  children?: (Node | string)[],
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);

  if (props !== undefined) {
    const { class: className, text, on: listeners, ...rest } = props;
    if (className !== undefined && className !== null) element.className = className;
    if (text !== undefined && text !== null) element.textContent = text;
    if (listeners !== undefined && listeners !== null) {
      for (const type of Object.keys(listeners)) {
        const listener = listeners[type];
        if (listener !== undefined) on(element, type, listener);
      }
    }
    // Own keys of `rest` are element properties; the props type is what keeps the callers honest.
    const settings: Record<string, unknown> = {};
    Object.assign(settings, rest);
    for (const key of Object.keys(settings)) {
      const value = settings[key];
      if (value === undefined || value === null) continue;
      Object.assign(element, { [key]: value });
    }
  }

  if (children !== undefined) element.append(...children);

  return element;
}

/** Registers one listener and returns a closure that removes exactly that listener. */
export function on<T extends EventTarget>(
  target: T,
  type: string,
  handler: (event: Event) => void,
): () => void {
  target.addEventListener(type, handler);
  return () => {
    target.removeEventListener(type, handler);
  };
}

/**
 * Locale-independent number text: non-finite input stringifies, everything else is `toFixed`, so the
 * decimal separator is always `.` regardless of the browser locale.
 */
export function fmt(value: number, digits?: number): string {
  if (!Number.isFinite(value)) return String(value);
  return value.toFixed(digits ?? 3);
}
