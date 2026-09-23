/**
 * The voxelization settings modal: the only place the voxel count is chosen.
 *
 * `main` opens it once per import and acts on the `VoxelizeDialogOutcome` it resolves; the dialog owns no
 * project state, calls nothing, and runs no job.
 * It builds its nodes once and re-seeds every prompt — the count from `DEFAULT_VOXELS_ACROSS` and the
 * extent from `defaults()` — resolves `{ kind: 'run', cellsAcross }` when the user confirms, and
 * `{ kind: 'cancel' }` when the user cancels.
 * The prompt asks how many voxels long the model is (README D29, D41); the dimensions it prints beside the
 * field are an orientation readout, never the value handed to the job.
 *
 * The prompt is the platform's own `<dialog>`, opened with `showModal()`: the platform puts it in the top
 * layer, above every window and the HUD, dims the page behind it with `::backdrop` (index.html), and makes
 * the rest of the page inert — which is what makes this modal, and why it carries no backdrop element and
 * no `z-index` of its own. Its nodes are appended to `root` for the duration of a prompt only: a closed
 * dialog is out of the DOM entirely, so nothing of it is left on screen — or in the way of a click —
 * between prompts.
 */

import { el, fmt } from './dom.js';

/**
 * The count the prompt opens at: how many voxels long the model is. One voxel is one world unit
 * (README D41), so the count is also the model's size in the world, and — unlike a length — it does not
 * depend on the file, so every prompt starts here whatever was imported (README D29).
 */
export const DEFAULT_VOXELS_ACROSS = 96;

/**
 * The largest count the prompt accepts. The container's key space fits 512 cells per axis and a
 * payload whose extent touches both sides of the aligned lattice can occupy one cell more than the
 * nominal count, so 511 leaves the grid guard a cell of slack; `exceeds-grid` remains the backstop.
 */
const MAX_VOXELS_ACROSS = 511;

/** The values a prompt starts from; `main` derives them from the retained import's bounds. */
export type VoxelizeDialogDefaults = {
  /**
   * The per-axis extent of the import's voxelize bounds, in world units. The count is a length along the
   * longest axis, so these give the rest of the model's shape: the readout beside the field is what that
   * count makes the model's three dimensions (README D41).
   */
  extent: { readonly x: number; readonly y: number; readonly z: number };
};

/** What the user answered: how long the model is in voxels, or a dismissal to act on. */
export type VoxelizeDialogOutcome =
  | { kind: 'run'; cellsAcross: number }
  | { kind: 'cancel' };

/** One labelled field, the same shape the panel builds for its controls. */
function field(label: string, control: HTMLElement): HTMLLabelElement {
  return el('label', undefined, [el('span', { class: 'dim', text: label }), control]);
}

export class VoxelizeDialog {
  private readonly root: HTMLElement;
  private readonly defaults: () => VoxelizeDialogDefaults;
  /** The modal itself: `showModal()` is what stacks it — and the card it holds — over the page. */
  private readonly dialog: HTMLDialogElement;
  private readonly titleText: HTMLHeadingElement;
  private readonly voxelsAcrossField: HTMLLabelElement;
  private readonly voxelsAcrossInput: HTMLInputElement;
  /** The dimensions the count resolves to: an orientation readout, never what the job is given. */
  private readonly dimensionsLine: HTMLDivElement;
  private readonly voxelizeButton: HTMLButtonElement;
  /** The import's extent per axis, seeded by every `open()`; the count is read against the longest one. */
  private extent = { x: 0, y: 0, z: 0 };
  /** Resolves the pending `open()`, or `undefined` while no prompt is on screen. */
  private settle: ((outcome: VoxelizeDialogOutcome) => void) | undefined = undefined;
  private disposed = false;

  constructor(root: HTMLElement, defaults: () => VoxelizeDialogDefaults) {
    this.root = root;
    this.defaults = defaults;

    // The modal is the platform's own `<dialog>`: `showModal()` puts it in the top layer, above every
    // window and the HUD, and makes the rest of the page inert, so neither a panel control nor the viewport
    // can be reached while a prompt is up. Clicking outside the card does nothing — a prompt is answered by
    // its own buttons, so a stray click cannot discard the settings the user is choosing.
    // The prompt's events are registered here rather than on the form the card holds, whose index signature
    // would swallow `el`'s listener types. Enter is answered by the key listener and by the form's
    // submission; Escape is the platform's `cancel` and then its `close`, and both settle the prompt — the
    // second finds no resolver left — because the pair is not always delivered: a dialog that has been
    // closed and shown again is dismissed with the `cancel` alone.
    this.dialog = el('dialog', {
      on: {
        keydown: (event) => this.onKeyDown(event),
        cancel: () => this.settleWith({ kind: 'cancel' }),
        close: () => this.onDialogClose(),
        submit: (event) => this.onSubmit(event),
      },
    });
    // The card: the `section` the stylesheet already draws, sized as this modal has always been. The
    // dialog around it carries no look of its own — `index.html` resets the platform's border, padding,
    // background, and color — so the card is what reads as the modal.
    const card = el('section');
    card.style.width = '320px';
    card.style.marginBottom = '0';
    this.titleText = el('h2', { text: '' });

    // The count and the read-only length it resolves to; `syncFields()` writes that line.
    this.voxelsAcrossInput = el('input', {
      type: 'number',
      min: '1',
      max: String(MAX_VOXELS_ACROSS),
      step: '1',
      on: { input: () => this.syncFields() },
    });
    this.dimensionsLine = el('div', { class: 'dim', text: '' });
    this.voxelsAcrossField = field('Voxels across', this.voxelsAcrossInput);

    // Both buttons are the card's form's submit buttons, so the platform turns a click on either — and
    // the Enter it answers with its default button, `Voxelize` — into one `submit` event that names the
    // pressed button: `Voxelize` runs the prompt, `Cancel` dismisses it. `method="dialog"` is what keeps
    // that submission from navigating the page.
    this.voxelizeButton = el('button', { type: 'submit', text: 'Voxelize' });
    const cancelButton = el('button', { type: 'submit', text: 'Cancel' });

    const body = el('div', undefined, [
      this.voxelsAcrossField,
      this.dimensionsLine,
      el('div', { class: 'row' }, [this.voxelizeButton, cancelButton]),
    ]);
    const form = el('form', { method: 'dialog' }, [body]);
    card.append(this.titleText, form);
    this.dialog.append(card);
  }

  /**
   * Shows the modal, seeded from `defaults()`, and resolves once the user confirms or cancels. A second
   * `open()` while a prompt is up supersedes it: the pending promise settles as a cancel and the newest
   * request owns the modal, so one prompt is on screen at a time and every promise settles exactly once.
   */
  open(context: { title: string }): Promise<VoxelizeDialogOutcome> {
    if (this.disposed) throw new TypeError('VoxelizeDialog.open: the dialog has been disposed');
    this.settleWith({ kind: 'cancel' });
    this.seed();
    this.titleText.textContent = context.title;
    this.root.append(this.dialog);
    // The platform's modal: the top layer, the inert page behind it, Escape closing it, focus on the
    // card's first focusable control — the count — and that focus handed back where it was on close.
    this.dialog.showModal();
    // Focus starts in the count, so Enter or Escape answers the prompt at once.
    this.voxelsAcrossInput.focus();
    return new Promise<VoxelizeDialogOutcome>((resolve) => {
      this.settle = resolve;
    });
  }

  get isOpen(): boolean {
    return this.settle !== undefined;
  }

  /** Closes a pending prompt — resolving it as a cancel — and releases the nodes. */
  dispose(): void {
    this.settleWith({ kind: 'cancel' });
    this.disposed = true;
  }

  private seed(): void {
    const defaults = this.defaults();
    // The count is a constant seed by design: the same 96 opens whatever the model's extent is, while the
    // extent is what that count turns into a size.
    this.voxelsAcrossInput.value = String(DEFAULT_VOXELS_ACROSS);
    this.extent = defaults.extent;
    this.syncFields();
  }

  /** Writes the model's three dimensions in voxels, and enables `Voxelize` while the count is valid. */
  private syncFields(): void {
    // The read-only line beside the count: the dimensions that count resolves to, rounded because it is a
    // readout — the job gets the count itself. A count that does not parse has no dimensions yet, so the
    // line says so instead of showing stale ones.
    const voxelsAcross = this.readCount();
    this.dimensionsLine.textContent =
      voxelsAcross === undefined ? '? voxels per axis' : this.dimensionsText(voxelsAcross);
    this.voxelizeButton.disabled = voxelsAcross === undefined;
  }

  /** The extent in cells the count describes, per axis, as `[x] x [y] x [z] voxels`. */
  private dimensionsText(voxelsAcross: number): string {
    const { x, y, z } = this.extent;
    const longest = Math.max(x, y, z);
    if (!(longest > 0)) return `${voxelsAcross} voxels per axis`;
    const cell = (axis: number): string => fmt(Math.max(1, Math.round((axis / longest) * voxelsAcross)), 0);
    return `${cell(x)} \u00d7 ${cell(y)} \u00d7 ${cell(z)} voxels`;
  }

  /**
   * Enter confirms, wherever focus is inside the prompt: the count, a button, or the card the platform
   * focuses after a click on it. Escape is not handled here — it is the platform's own `cancel`, and
   * `showModal()` closing the dialog is what answers it.
   */
  private onKeyDown(event: Event): void {
    if (!(event instanceof KeyboardEvent) || event.key !== 'Enter') return;
    // `preventDefault()` keeps the key from reaching the page — and from reaching the form as well, since
    // this is the prompt's one answer to Enter: the platform's implicit submission of `Voxelize` needs
    // focus inside the form, and a click on the card can move it off onto the dialog itself.
    event.preventDefault();
    this.confirm();
  }

  /**
   * Answers the form's submission — a click on `Voxelize` or on `Cancel`, named by `submitter`. The
   * submission is prevented because this file closes the prompt, not the platform: `confirm()` leaves a
   * count that does not parse up, where a `method="dialog"` close would have dismissed it as a cancel.
   */
  private onSubmit(event: Event): void {
    event.preventDefault();
    if (event instanceof SubmitEvent && event.submitter === this.voxelizeButton) {
      this.confirm();
      return;
    }
    this.settleWith({ kind: 'cancel' });
  }

  /**
   * The platform closed the dialog without asking first, which is a dismissal all the same. A `close` is
   * delivered in a task of its own and can therefore arrive after a later prompt is already up: only a
   * dialog that is no longer `open` is the platform dismissing the prompt being awaited.
   */
  private onDialogClose(): void {
    if (!this.dialog.open) this.settleWith({ kind: 'cancel' });
  }

  /**
   * Resolves the pending prompt with the target the count describes. A field that does not parse
   * is not an answer: nothing is resolved and the prompt stays up with `Voxelize` disabled, so a
   * partial or impossible `VoxelizeTarget` can never reach the app.
   */
  private confirm(): void {
    const cellsAcross = this.readCount();
    if (cellsAcross === undefined) return;
    this.settleWith({ kind: 'run', cellsAcross });
  }

  /**
   * Settles the pending promise and takes the dialog out of the top layer and out of `root`. Closing it
   * first is what empties the top layer; the nodes go after, so nothing is left open behind them. A repeat
   * call is a no-op, which is why every path settles the same promise exactly once.
   */
  private settleWith(outcome: VoxelizeDialogOutcome): void {
    const settle = this.settle;
    if (settle === undefined) return;
    this.settle = undefined;
    this.dialog.close();
    this.dialog.remove();
    settle(outcome);
  }

  /**
   * The prompt's count, or `undefined` when the field does not describe one: a blank field, a fraction,
   * a negative, a non-finite value, or a count past the container's slack all leave `Voxelize` disabled
   * rather than reaching the job. The count is handed over exactly as typed; the display rounds, the
   * import's scale does not.
   */
  private readCount(): number | undefined {
    const voxelsAcross = Number(this.voxelsAcrossInput.value);
    if (!Number.isInteger(voxelsAcross) || voxelsAcross < 1 || voxelsAcross > MAX_VOXELS_ACROSS) {
      return undefined;
    }
    return voxelsAcross;
  }
}
