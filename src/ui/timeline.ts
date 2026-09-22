/**
 * The timeline widget: transport, scrub bar, keyframe markers, duration and frame-rate inputs, and the
 * keyframe list with its add, retime, seek, and delete actions against the active object and the output camera.
 * It edits authoring data through the mutators of `document/timeline.ts`, delegates seeking to `onScrub`, and
 * asks the app to rebuild the clip through `onEdited`; it never touches the mixer.
 *
 * Times are whole milliseconds throughout, which is the unit the authoring data is in too (README D45), so the
 * widget never converts: the panel reads and writes `timeMs` and the clip is the only place that becomes seconds.
 *
 * Its host is the bar along the bottom of the page, which starts collapsed: whether the bar is on screen is the
 * app's flag, and `setVisible` is the view of it, the way `setTime` is the view of the playhead (README D44).
 */

import { el, fmt } from './dom.js';
import {
  addKeyframe,
  findTrack,
  maxKeyframeTime,
  moveKeyframe,
  removeKeyframe,
  setDuration,
  setInterpolation,
  type Interpolation,
  type TrackChannel,
  type TrackTarget,
} from '../document/timeline.js';
import type { Project } from '../document/project.js';
import type { Playback } from '../animation/playback.js';
import type { EditorSession } from '../editor/session.js';

export type TimelineContext = {
  project: Project;
  playback: Playback;
  session: EditorSession;
  /** Seeks the playhead to an absolute time in milliseconds; the app clamps it onto the clip. */
  onScrub(timeMs: number): void;
  onEdited(): void;
};

const OBJECT_CHANNELS: readonly TrackChannel[] = ['position', 'quaternion', 'scale'];
const CAMERA_CHANNELS: readonly TrackChannel[] = ['position', 'quaternion', 'scale', 'fov'];
const INTERPOLATIONS: readonly Interpolation[] = ['step', 'linear', 'smooth'];

const MARKER_COLOR = 'var(--accent)';

export class TimelinePanel {
  private readonly context: TimelineContext;
  private readonly root: HTMLElement;
  private readonly playToggle: HTMLButtonElement;
  private readonly scrub: HTMLInputElement;
  private readonly timeReadout: HTMLSpanElement;
  private readonly timeInput: HTMLInputElement;
  private readonly durationInput: HTMLInputElement;
  private readonly fpsInput: HTMLInputElement;
  private readonly targetSelect: HTMLSelectElement;
  private readonly targetObjectOption: HTMLOptionElement;
  private readonly channelSelect: HTMLSelectElement;
  private readonly interpolationSelect: HTMLSelectElement;
  private readonly addButton: HTMLButtonElement;
  private readonly markerLayer: HTMLDivElement;
  private readonly keyframeList: HTMLDivElement;
  private readonly message: HTMLDivElement;

  constructor(root: HTMLElement, context: TimelineContext) {
    this.context = context;
    this.root = root;

    // One toggle rather than three buttons: the label is the state, `setTime` keeps it in step with the transport
    // every frame, and going back to the start is what the scrub bar is for (README D45).
    this.playToggle = el('button', {
      text: 'play',
      title: 'play or pause the clip',
      on: {
        click: () => {
          if (context.playback.playing) context.playback.pause();
          else context.playback.play();
        },
      },
    });
    const loopInput = el('input', {
      type: 'checkbox',
      on: {
        change: () => {
          context.playback.setLoop(loopInput.checked);
        },
      },
    });
    // The word is what says what the box is for — it is the only control in this row whose meaning is not in its own
    // text — and wrapping the box in the label is what makes the word itself toggle it. `flex: 0 0 auto` keeps the pair
    // at its natural width, so the time readout keeps the rest of the row.
    const loopField = el('label', undefined, [el('span', { class: 'dim', text: 'loop' }), loopInput]);
    loopField.style.flex = '0 0 auto';

    this.scrub = el('input', {
      type: 'range',
      min: '0',
      step: '1',
      value: '0',
      on: { input: () => context.onScrub(Number(this.scrub.value)) },
    });
    this.scrub.style.width = '100%';
    this.scrub.style.flex = '1 1 auto';
    this.timeReadout = el('span', { class: 'dim', text: '0 ms' });

    // The exact time, which is the one thing a range input cannot be precise about: whole milliseconds, the same
    // unit as the keyframe rows (README D45).
    this.timeInput = el('input', {
      type: 'number',
      min: '0',
      step: '1',
      value: '0',
      title: 'exact animation time in milliseconds',
      on: { change: () => context.onScrub(Number(this.timeInput.value)) },
    });

    this.durationInput = el('input', {
      type: 'number',
      min: '0',
      step: '100',
      on: { change: () => this.writeDuration() },
    });
    this.fpsInput = el('input', { type: 'number', min: '1', step: '1', on: { change: () => this.writeFps() } });

    this.targetObjectOption = el('option', { value: 'object', text: 'active object' });
    this.targetSelect = el('select', { on: { change: () => this.refresh() } }, [
      this.targetObjectOption,
      el('option', { value: 'camera', text: 'camera' }),
    ]);
    this.channelSelect = el('select', { on: { change: () => this.refresh() } });
    this.interpolationSelect = el(
      'select',
      { on: { change: () => this.writeInterpolation() } },
      INTERPOLATIONS.map((mode) => el('option', { value: mode, text: mode })),
    );

    this.addButton = el('button', {
      text: 'add',
      title: 'key the current value at the playhead',
      on: { click: () => this.addKeyframeAtPlayhead() },
    });

    this.markerLayer = el('div');
    this.markerLayer.style.position = 'absolute';
    this.markerLayer.style.inset = '0';
    this.markerLayer.style.pointerEvents = 'none';
    const scrubWrap = el('div');
    scrubWrap.style.position = 'relative';
    scrubWrap.style.flex = '1 1 auto';
    scrubWrap.append(this.scrub, this.markerLayer);

    this.keyframeList = el('div');
    this.message = el('div');
    this.message.style.color = '#ff8a8a';

    const panel = el('div', undefined, [
      el('div', { class: 'row' }, [this.playToggle, loopField, this.timeReadout]),
      el('div', { class: 'row' }, [scrubWrap, this.field('time (ms)', this.timeInput)]),
      el('div', { class: 'row' }, [
        this.field('duration (ms)', this.durationInput),
        this.field('fps', this.fpsInput),
        this.field('target', this.targetSelect),
        this.field('channel', this.channelSelect),
        this.field('interpolation', this.interpolationSelect),
        this.addButton,
      ]),
      this.keyframeList,
      this.message,
    ]);
    root.append(panel);
    this.refresh();
  }

  /**
   * Moves the playhead display only: no seek, no playback state, no `onScrub`. It also keeps the play toggle's label
   * on the transport it reports, because the render loop is what calls this and a press is not the only thing that
   * starts or stops playback.
   */
  setTime(timeMs: number): void {
    const durationMs = this.context.project.timeline.durationMs;
    const clamped = Math.min(Math.max(Math.round(timeMs), 0), Math.max(durationMs, 0));
    const value = String(clamped);
    if (this.scrub.value !== value) this.scrub.value = value;
    this.timeReadout.textContent = `${fmt(clamped, 0)} ms`;
    // The exact-time field follows the playhead, except while it is the field being typed into.
    if (document.activeElement !== this.timeInput) this.timeInput.value = value;
    const playing = this.context.playback.playing;
    const label = playing ? 'pause' : 'play';
    if (this.playToggle.textContent !== label) this.playToggle.textContent = label;
  }

  /**
   * Shows or hides the whole widget, the bar included. The app owns the flag and the rail's `Animation` button is
   * what flips it, so this only writes the host: the panel neither reads the flag nor decides anything about it.
   */
  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  refresh(): void {
    const { project, session } = this.context;
    const timeline = project.timeline;
    const active = session.activeObjectId === null ? undefined : project.get(session.activeObjectId);
    this.targetObjectOption.text = active === undefined ? 'active object (none)' : `active object: ${active.name}`;

    this.durationInput.value = String(timeline.durationMs);
    // The duration cannot cut the clip short: its floor is the latest keyframe anywhere in the timeline, and
    // `setDuration` clamps anyway if a keyframe ever lands past it (README D45).
    this.durationInput.min = String(maxKeyframeTime(timeline));
    this.fpsInput.value = String(timeline.fps);
    this.scrub.max = String(timeline.durationMs);
    // One millisecond per step: the playhead is addressed in the same unit the keyframes are stored in.
    this.scrub.step = '1';

    const target = this.readTarget();
    const channel = this.renderChannelSelect(target);
    const track =
      target === undefined || channel === undefined ? undefined : findTrack(timeline, target, channel);
    this.interpolationSelect.value = track?.interpolation ?? 'linear';
    this.interpolationSelect.disabled = track === undefined;

    const keyframes = track?.keyframes ?? [];
    const rows: HTMLDivElement[] = [];
    const markers: HTMLSpanElement[] = [];
    if (target !== undefined && channel !== undefined) {
      for (const keyframe of keyframes) {
        rows.push(this.keyframeRow(timeline.durationMs, target, channel, keyframe));

        const marker = el('span');
        marker.style.position = 'absolute';
        marker.style.top = '0';
        marker.style.width = '2px';
        marker.style.height = '100%';
        marker.style.background = MARKER_COLOR;
        marker.style.left = `${timeline.durationMs > 0 ? (keyframe.timeMs / timeline.durationMs) * 100 : 0}%`;
        markers.push(marker);
      }
    }
    this.keyframeList.replaceChildren(...rows);
    this.markerLayer.replaceChildren(...markers);

    // `add` needs a resolved target and channel, not an existing track: the first keyframe of a channel is what
    // creates its track.
    this.addButton.disabled = target === undefined || channel === undefined;
    this.setTime(Math.round(this.context.playback.time * 1000));
  }

  /**
   * One keyframe: seek to it, retime it in place, delete it. Each row acts on its own keyframe by id, so a rebuild
   * that reorders the list cannot make a press land on a neighbour (README D45).
   */
  private keyframeRow(
    durationMs: number,
    target: TrackTarget,
    channel: TrackChannel,
    keyframe: { id: string; timeMs: number; value: number[] },
  ): HTMLDivElement {
    const row = el('div', { class: 'kf-row' });
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '4px';
    row.style.width = '100%';

    const seek = el('button', {
      text: 'key',
      title: 'move the playhead to this keyframe',
      on: { click: () => this.context.onScrub(keyframe.timeMs) },
    });
    const timeField = el('input', {
      type: 'number',
      min: '0',
      max: String(durationMs),
      step: '1',
      value: String(keyframe.timeMs),
      title: 'keyframe time in milliseconds',
      on: { change: () => this.writeKeyframeTime(target, channel, keyframe.id, timeField) },
    });
    const remove = el('button', {
      text: 'delete',
      title: 'remove this keyframe',
      on: { click: () => this.deleteKeyframe(target, channel, keyframe.id) },
    });
    const value = el('span', {
      class: 'dim',
      text: `v=[${keyframe.value.map((component) => fmt(component)).join(', ')}]`,
    });
    row.append(seek, timeField, remove, value);
    return row;
  }

  private field(label: string, control: HTMLElement): HTMLLabelElement {
    return el('label', undefined, [el('span', { class: 'dim', text: label }), control]);
  }

  private readTarget(): TrackTarget | undefined {
    if (this.targetSelect.value === 'camera') return { kind: 'camera' };
    const objectId = this.context.session.activeObjectId;
    return objectId === null ? undefined : { kind: 'object', objectId };
  }

  /** Narrows the select's string back to a channel; `CAMERA_CHANNELS` is the superset of both cases. */
  private readChannel(): TrackChannel | undefined {
    const value = this.channelSelect.value;
    for (const channel of CAMERA_CHANNELS) if (channel === value) return channel;
    return undefined;
  }

  private renderChannelSelect(target: TrackTarget | undefined): TrackChannel | undefined {
    const channels = target !== undefined && target.kind === 'camera' ? CAMERA_CHANNELS : OBJECT_CHANNELS;
    const previous = this.channelSelect.value;
    this.channelSelect.replaceChildren(...channels.map((channel) => el('option', { value: channel, text: channel })));
    this.channelSelect.value = channels.some((channel) => channel === previous) ? previous : channels[0] ?? 'position';
    return this.readChannel();
  }

  private authoringValue(target: TrackTarget, channel: TrackChannel): number[] | undefined {
    if (channel === 'fov') {
      return target.kind === 'camera' ? [this.context.project.camera.fov] : undefined;
    }
    const transform =
      target.kind === 'camera' ? this.context.project.camera.transform : this.context.project.get(target.objectId)?.transform;
    if (transform === undefined) return undefined;
    // An aligned object's keyframes land on the lattice (README D42) even while its live placement is a
    // sampled one, which interpolation between two cells is free to produce.
    if (channel === 'position') {
      const position = this.context.project.keyframePosition(target, transform.position);
      return [position.x, position.y, position.z];
    }
    if (channel === 'quaternion') {
      return [transform.quaternion.x, transform.quaternion.y, transform.quaternion.z, transform.quaternion.w];
    }
    return [transform.scale.x, transform.scale.y, transform.scale.z];
  }

  private addKeyframeAtPlayhead(): void {
    const target = this.readTarget();
    const channel = this.readChannel();
    if (target === undefined || channel === undefined) return;
    const value = this.authoringValue(target, channel);
    if (value === undefined) return;
    // The playhead is seconds (the clip's unit) and the authoring time is milliseconds; this rounds to the
    // millisecond the seek landed on, which is as close as the clip can be sampled anyway.
    const timeMs = Math.round(this.context.playback.time * 1000);
    const result = addKeyframe(this.context.project.timeline, target, channel, timeMs, value);
    if (!result.ok) {
      this.message.textContent = result.error;
      return;
    }
    this.message.textContent = '';
    this.refresh();
    this.context.onEdited();
  }

  /**
   * Retimes one keyframe from its row's field. A refused move — that millisecond already holds a keyframe, or the
   * row went stale — changes nothing, and the rebuild puts the field back to what the clip holds (README D45).
   */
  private writeKeyframeTime(
    target: TrackTarget,
    channel: TrackChannel,
    id: string,
    field: HTMLInputElement,
  ): void {
    const timeMs = Number(field.value);
    if (!Number.isFinite(timeMs) || !moveKeyframe(this.context.project.timeline, target, channel, id, timeMs)) {
      this.refresh();
      return;
    }
    this.refresh();
    this.context.onEdited();
  }

  private deleteKeyframe(target: TrackTarget, channel: TrackChannel, id: string): void {
    if (!removeKeyframe(this.context.project.timeline, target, channel, id)) {
      this.refresh();
      return;
    }
    this.refresh();
    this.context.onEdited();
  }

  private writeInterpolation(): void {
    const target = this.readTarget();
    const channel = this.readChannel();
    const mode = INTERPOLATIONS.find((interpolation) => interpolation === this.interpolationSelect.value);
    if (target === undefined || channel === undefined || mode === undefined) return;
    if (setInterpolation(this.context.project.timeline, target, channel, mode)) this.context.onEdited();
    this.refresh();
  }

  private writeDuration(): void {
    const durationMs = Number(this.durationInput.value);
    if (!Number.isFinite(durationMs)) {
      this.refresh();
      return;
    }
    // The field's own `min` is the latest keyframe; the model clamps every keyframe as well, so a duration that
    // ever does come in short drags the clip onto it instead of losing the keyframes (README D45).
    setDuration(this.context.project.timeline, durationMs);
    this.refresh();
    this.context.onEdited();
  }

  private writeFps(): void {
    const fps = Number(this.fpsInput.value);
    if (Number.isFinite(fps) && fps > 0) {
      this.context.project.timeline.fps = fps;
      this.refresh();
      this.context.onEdited();
      return;
    }
    this.refresh();
  }
}
