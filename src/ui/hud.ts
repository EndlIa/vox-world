/**
 * Read-only status readout: active object, representation, edit resolution, selection summary,
 * and the current frame and frame rate. Every displayed value comes from the last `update` argument
 * - the HUD queries nothing.
 */

import { el, fmt } from './dom.js';
import type { Representation } from '../document/project.js';
import type { EditResolution } from '../editor/session.js';

export type HudState = {
  activeObjectName: string | null;
  representation: Representation | null;
  editResolution: EditResolution | null;
  selectionText: string;
  frame: number;
  fps: number;
};

const ABSENT = '\u2014';

function resolutionText(resolution: EditResolution | null): string {
  if (resolution === null) return ABSENT;
  if (resolution.representation === 'empty') return 'empty';
  if (resolution.cells === undefined) return 'uniform';
  return `uniform ${resolution.cells.map((count) => fmt(count, 0)).join('\u00d7')}`;
}

export class Hud {
  private readonly activeObject: HTMLSpanElement;
  private readonly representation: HTMLSpanElement;
  private readonly editResolution: HTMLSpanElement;
  private readonly selection: HTMLSpanElement;
  private readonly frame: HTMLSpanElement;

  constructor(root: HTMLElement) {
    this.activeObject = el('span');
    this.representation = el('span');
    this.editResolution = el('span');
    this.selection = el('span');
    this.frame = el('span');

    const container = el('div', { class: 'hud' }, [
      row('object', this.activeObject),
      row('representation', this.representation),
      row('resolution', this.editResolution),
      row('selection', this.selection),
      row('playhead', this.frame),
    ]);
    root.append(container);
  }

  update(state: HudState): void {
    this.activeObject.textContent = state.activeObjectName ?? ABSENT;
    this.representation.textContent = state.representation ?? ABSENT;
    this.editResolution.textContent = resolutionText(state.editResolution);
    this.selection.textContent = state.selectionText;
    this.frame.textContent = `frame ${fmt(state.frame, 0)} \u00b7 ${fmt(state.fps, 0)} fps`;
  }
}

function row(label: string, value: HTMLSpanElement): HTMLDivElement {
  const labelSpan = el('span', { text: `${label} ` });
  // The page styles `#hud b` for labels; a span keeps the row a label span plus a value span.
  labelSpan.style.color = 'var(--text)';
  return el('div', undefined, [labelSpan, value]);
}
