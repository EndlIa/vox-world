/**
 * One floating window: a bordered `section` with a title bar and a body, placed over the page and moved by
 * dragging its title bar. It owns its title, its body element, its position, and whether it is open, and
 * nothing else: the owner fills `body`, chooses where the window starts, and hears about every visibility
 * change through `onVisibilityChange`.
 *
 * Closing hides the window and leaves every node where it is, so a reopened window shows whatever state its
 * controls were left in. This widget never reads, writes, or clears a control.
 *
 * The listeners it adds to the page while a drag is in flight (`pointermove`, `pointerup`) and the ones it
 * adds to its own nodes are exactly what `dispose()` removes.
 */

import { el, on } from './dom.js';

/** How much of a window stays inside the viewport horizontally while it is dragged. */
const MIN_VISIBLE = 120;

/** The `z-index` of an unpressed window: over `#hud` (10) and under the voxelize modal (20). */
const BASE_Z = 15;

/** The class every window carries, which is also how `raise()` finds the ones it stacks against. */
const WINDOW_CLASS = 'window';

export type FloatingWindowOptions = {
  /** The name the title bar shows. */
  title: string;
  /** The window's initial left edge, in viewport pixels. */
  left: number;
  /** The window's initial top edge, in viewport pixels. */
  top: number;
  /** Called with the new state on every change of visibility, and never for a no-op. */
  onVisibilityChange(open: boolean): void;
};

export class FloatingWindow {
  /** The owner appends this element; only `raise()` ever moves it, and it stays under the same parent. */
  readonly root: HTMLElement;
  /** The owner's content goes here; the widget lays it out and scrolls it. */
  readonly body: HTMLDivElement;
  private readonly titleBar: HTMLHeadingElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly onVisibilityChange: (open: boolean) => void;
  private readonly detach: (() => void)[] = [];
  private left: number;
  private top: number;
  private opened = false;
  private disposed = false;
  /** Ends the drag in flight; present exactly while the pointer is down on the title bar. */
  private endDrag: (() => void) | undefined = undefined;

  constructor(options: FloatingWindowOptions) {
    this.onVisibilityChange = options.onVisibilityChange;
    this.left = options.left;
    this.top = options.top;

    this.closeButton = el('button', { class: 'window-close', text: '\u00d7' });
    this.closeButton.setAttribute('aria-label', 'Close');
    this.titleBar = el('h2', { class: 'window-title' }, [el('span', { text: options.title }), this.closeButton]);
    this.body = el('div', { class: 'window-body' });
    this.root = el('section', { class: WINDOW_CLASS }, [this.titleBar, this.body]);
    this.root.hidden = true;
    this.root.style.left = `${this.left}px`;
    this.root.style.top = `${this.top}px`;
    this.root.style.zIndex = String(BASE_Z);

    // A press anywhere in the window raises it — not only a press on the title bar — so a window covered in
    // the middle comes forward when it is grabbed there too.
    this.detach.push(
      on(this.titleBar, 'pointerdown', (event) => this.beginDrag(event)),
      on(this.root, 'pointerdown', () => this.raise()),
      on(this.closeButton, 'click', () => this.close()),
    );
  }

  get isOpen(): boolean {
    return this.opened;
  }

  open(): void {
    if (this.disposed) throw new TypeError('FloatingWindow.open: the window has been disposed');
    this.setOpen(true);
  }

  /** Hides the window; hiding an already hidden window changes nothing and calls nothing. */
  close(): void {
    this.setOpen(false);
  }

  toggle(): void {
    if (this.disposed) throw new TypeError('FloatingWindow.toggle: the window has been disposed');
    this.setOpen(!this.opened);
  }

  /** Removes every listener this window registered and takes it out of the document. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.endDrag?.();
    for (const detach of this.detach) detach();
    this.detach.length = 0;
    this.root.remove();
    this.opened = false;
  }

  private setOpen(open: boolean): void {
    if (this.opened === open) return;
    this.opened = open;
    this.root.hidden = !open;
    this.onVisibilityChange(open);
  }

  /**
   * Drags the window with the pointer. The move and release listeners go on `window`, so a drag that leaves
   * the window, or the viewport, keeps tracking the pointer until the button is released; nothing is ever
   * captured on the canvas.
   */
  private beginDrag(event: Event): void {
    if (!(event instanceof PointerEvent)) return;
    // The close button is inside the title bar: pressing it closes, it never starts a drag, and cancelling
    // the pointer event here would swallow the click that does the closing.
    if (event.button !== 0 || event.target === this.closeButton) return;
    // The press moves the window itself, so the browser must not start a text selection drag instead.
    event.preventDefault();
    this.endDrag?.();
    this.raise();
    const startX = event.clientX;
    const startY = event.clientY;
    const rect = this.root.getBoundingClientRect();
    const startLeft = rect.left;
    const startTop = rect.top;
    const move = (moveEvent: Event): void => {
      if (!(moveEvent instanceof PointerEvent)) return;
      this.setPosition(startLeft + moveEvent.clientX - startX, startTop + moveEvent.clientY - startY);
    };
    const detachMove = on(window, 'pointermove', move);
    const stop = (): void => {
      detachMove();
      detachUp();
      this.endDrag = undefined;
    };
    const detachUp = on(window, 'pointerup', stop);
    this.endDrag = stop;
  }

  /**
   * Places the window, clamped so the whole title bar and `MIN_VISIBLE` pixels of the window stay inside the
   * viewport: a drag past an edge parks the window against it instead of pushing it out of reach.
   */
  private setPosition(left: number, top: number): void {
    const rect = this.root.getBoundingClientRect();
    // The title bar's bottom edge measured from the window's top, so the whole bar — border included —
    // is what stays inside the viewport whatever the window's box is made of.
    const barBottom = this.titleBar.getBoundingClientRect().bottom - rect.top;
    const maxLeft = window.innerWidth - MIN_VISIBLE;
    const minLeft = MIN_VISIBLE - rect.width;
    const maxTop = window.innerHeight - barBottom;
    this.left = Math.min(maxLeft, Math.max(minLeft, left));
    this.top = Math.min(maxTop, Math.max(0, top));
    this.root.style.left = `${this.left}px`;
    this.root.style.top = `${this.top}px`;
  }

  /**
   * Puts this window above the other windows: every window in the same parent is renumbered in its current
   * stacking order and this one takes the highest step. The ladder is bounded by the number of windows in
   * the parent, so it stays under the voxelize modal's `z-index: 20` however often a window is raised.
   */
  private raise(): void {
    const parent = this.root.parentElement;
    if (parent === null) return;
    const windows: HTMLElement[] = [];
    for (const child of parent.children) {
      if (child !== this.root && child instanceof HTMLElement && child.classList.contains(WINDOW_CLASS)) {
        windows.push(child);
      }
    }
    windows.sort((a, b) => Number(a.style.zIndex) - Number(b.style.zIndex));
    let z = BASE_Z;
    for (const element of windows) element.style.zIndex = String(z++);
    this.root.style.zIndex = String(z);
  }
}
