/**
 * Read-only status readout: active object, representation, edit resolution, selection summary,
 * frame and frame rate, and the picked leaf's detail. Every displayed value comes from the last
 * `update` argument - the HUD queries nothing.
 */

import { el, fmt } from './dom.js';
import type { Representation } from '../document/project.js';
import type { EditResolution } from '../editor/session.js';
import type { LeafId } from '../voxels/octree/leafId.js';
import type { HexColor } from '../voxels/uniform/grid.js';

export type HudState = {
  activeObjectName: string | null;
  representation: Representation | null;
  editResolution: EditResolution | null;
  selectionText: string;
  frame: number;
  fps: number;
  leaf: { leafId: LeafId; depth: number; size: number; occupied: boolean; color: HexColor } | null;
};

const ABSENT = '\u2014';

function resolutionText(resolution: EditResolution | null): string {
  if (resolution === null) return ABSENT;
  if (resolution.representation === 'empty') return 'empty';
  if (resolution.representation === 'uniform') {
    return resolution.voxelSize === undefined ? 'uniform' : `uniform ${fmt(resolution.voxelSize)} m`;
  }
  return resolution.leafSize === undefined ? 'octree' : `octree ${fmt(resolution.leafSize)} m`;
}

export class Hud {
  private readonly activeObject: HTMLSpanElement;
  private readonly representation: HTMLSpanElement;
  private readonly editResolution: HTMLSpanElement;
  private readonly selection: HTMLSpanElement;
  private readonly frame: HTMLSpanElement;
  private readonly leafId: HTMLSpanElement;
  private readonly leafDepth: HTMLSpanElement;
  private readonly leafSize: HTMLSpanElement;
  private readonly leafOccupied: HTMLSpanElement;
  private readonly leafColor: HTMLSpanElement;

  constructor(root: HTMLElement) {
    this.activeObject = el('span');
    this.representation = el('span');
    this.editResolution = el('span');
    this.selection = el('span');
    this.frame = el('span');
    this.leafId = el('span');
    this.leafDepth = el('span');
    this.leafSize = el('span');
    this.leafOccupied = el('span');
    this.leafColor = el('span');

    const container = el('div', { class: 'hud' }, [
      row('object', this.activeObject),
      row('representation', this.representation),
      row('resolution', this.editResolution),
      row('selection', this.selection),
      row('playhead', this.frame),
      row('leaf', this.leafId),
      row('leaf depth', this.leafDepth),
      row('leaf size', this.leafSize),
      row('leaf occupancy', this.leafOccupied),
      row('leaf color', this.leafColor),
    ]);
    root.append(container);
  }

  update(state: HudState): void {
    const leaf = state.leaf;
    this.activeObject.textContent = state.activeObjectName ?? ABSENT;
    this.representation.textContent = state.representation ?? ABSENT;
    this.editResolution.textContent = resolutionText(state.editResolution);
    this.selection.textContent = state.selectionText;
    this.frame.textContent = `frame ${fmt(state.frame, 0)} \u00b7 ${fmt(state.fps, 0)} fps`;
    this.leafId.textContent = leaf === null ? ABSENT : leaf.leafId;
    this.leafDepth.textContent = leaf === null ? ABSENT : fmt(leaf.depth, 0);
    this.leafSize.textContent = leaf === null ? ABSENT : `${fmt(leaf.size)} m`;
    this.leafOccupied.textContent = leaf === null ? ABSENT : leaf.occupied ? 'occupied' : 'empty';
    this.leafColor.textContent = leaf === null ? ABSENT : `#${leaf.color.toString(16).padStart(6, '0')}`;
  }
}

function row(label: string, value: HTMLSpanElement): HTMLDivElement {
  const labelSpan = el('span', { text: `${label} ` });
  // The page styles `#hud b` for labels; a span keeps the row a label span plus a value span.
  labelSpan.style.color = 'var(--text)';
  return el('div', undefined, [labelSpan, value]);
}
