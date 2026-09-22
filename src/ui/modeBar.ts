/**
 * The viewport's mode switch: two buttons at the bottom centre of the canvas that choose what a press does.
 * `Object` transforms whole objects through the gizmo, `Edit` works on the active object's voxels with the tool
 * the Edit group has active.
 *
 * It renders `session.mode` and forwards a click through the session setter; it owns no state, reads no project
 * data, and never touches the document or the scene — the gizmo the object mode shows is the composition root's
 * business, and the tools the edit mode uses are the Edit group's.
 *
 * `Edit` is disabled while no object is active: that mode edits one object's voxels, so there is nothing to enter
 * it for until the viewport or the Scene list has chosen one. Every other button is always live, `Object` included —
 * leaving a mode never needs a selection.
 */

import type { EditorMode, EditorSession } from '../editor/session.js';
import { el } from './dom.js';

/** The label each mode's button carries; the modes themselves are listed in the order the bar shows them. */
const MODE_LABELS: Record<EditorMode, string> = { object: 'Object', edit: 'Edit' };

/** The bar's buttons, in display order. */
const MODES: readonly EditorMode[] = ['object', 'edit'];

export type ModeBarContext = {
  session: EditorSession;
};

export class ModeBar {
  private readonly session: EditorSession;
  private readonly buttons: Map<EditorMode, HTMLButtonElement> = new Map();

  constructor(root: HTMLElement, context: ModeBarContext) {
    this.session = context.session;
    for (const mode of MODES) {
      const button = el('button', {
        text: MODE_LABELS[mode],
        on: { click: () => context.session.setMode(mode) },
      });
      this.buttons.set(mode, button);
      root.append(button);
    }
    this.refresh();
  }

  /**
   * Puts `on` on the mode the session is in, and takes `Edit` off the table while no object is active. The
   * composition root calls this whenever the session changed, so the bar is a view of the session and never a
   * second copy of it — including for the disable, which follows `session.activeObjectId`.
   */
  refresh(): void {
    for (const [mode, button] of this.buttons) {
      button.classList.toggle('on', this.session.mode === mode);
      button.disabled = mode === 'edit' && this.session.activeObjectId === null;
    }
  }
}
