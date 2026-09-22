/**
 * The timeline widget: transport controls, scrub bar, keyframe markers, duration and frame-rate
 * inputs, and add, move, and delete actions against the active object and the output camera. It edits
 * authoring data through the mutators of `document/timeline.ts`, delegates seeking to `onScrub`, and
 * asks the app to rebuild the clip through `onEdited`; it never touches the mixer.
 */

import { el, fmt } from './dom.js';
import {
  addKeyframe,
  findTrack,
  moveKeyframe,
  removeKeyframe,
  setInterpolation,
  sortKeyframes,
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
  onScrub(time: number): void;
  onEdited(): void;
};

const OBJECT_CHANNELS: readonly TrackChannel[] = ['position', 'quaternion', 'scale'];
const CAMERA_CHANNELS: readonly TrackChannel[] = ['position', 'quaternion', 'scale', 'fov'];
const INTERPOLATIONS: readonly Interpolation[] = ['step', 'linear', 'smooth'];

const MARKER_COLOR = 'var(--accent)';

export class TimelinePanel {
  private readonly context: TimelineContext;
  private readonly scrub: HTMLInputElement;
  private readonly timeReadout: HTMLSpanElement;
  private readonly durationInput: HTMLInputElement;
  private readonly fpsInput: HTMLInputElement;
  private readonly targetSelect: HTMLSelectElement;
  private readonly targetObjectOption: HTMLOptionElement;
  private readonly channelSelect: HTMLSelectElement;
  private readonly interpolationSelect: HTMLSelectElement;
  private readonly addButton: HTMLButtonElement;
  private readonly moveButton: HTMLButtonElement;
  private readonly deleteButton: HTMLButtonElement;
  private readonly markerLayer: HTMLDivElement;
  private readonly keyframeList: HTMLDivElement;
  private readonly message: HTMLDivElement;
  private selectedIndex: number | null = null;

  constructor(root: HTMLElement, context: TimelineContext) {
    this.context = context;

    const playButton = el('button', { text: 'play', on: { click: () => context.playback.play() } });
    const pauseButton = el('button', { text: 'pause', on: { click: () => context.playback.pause() } });
    const stopButton = el('button', { text: 'stop', on: { click: () => context.playback.stop() } });
    const loopInput = el('input', {
      type: 'checkbox',
      title: 'loop',
      on: {
        change: () => {
          context.playback.setLoop(loopInput.checked);
        },
      },
    });

    this.scrub = el('input', {
      type: 'range',
      min: '0',
      step: '1',
      value: '0',
      on: { input: () => context.onScrub(Number(this.scrub.value)) },
    });
    this.scrub.style.width = '100%';
    this.timeReadout = el('span', { class: 'dim', text: '0.000 s' });

    this.durationInput = el('input', { type: 'number', min: '0', step: '0.1', on: { change: () => this.writeDuration() } });
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

    this.addButton = el('button', { text: 'add', on: { click: () => this.addKeyframeAtPlayhead() } });
    this.moveButton = el('button', { text: 'move', on: { click: () => this.moveSelectedKeyframe() } });
    this.deleteButton = el('button', { text: 'delete', on: { click: () => this.deleteSelectedKeyframe() } });

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
      el('div', { class: 'row' }, [playButton, pauseButton, stopButton, loopInput, this.timeReadout]),
      el('div', { class: 'row' }, [scrubWrap]),
      el('div', { class: 'row' }, [
        this.field('duration', this.durationInput),
        this.field('fps', this.fpsInput),
        this.field('target', this.targetSelect),
        this.field('channel', this.channelSelect),
        this.field('interpolation', this.interpolationSelect),
        this.addButton,
        this.moveButton,
        this.deleteButton,
      ]),
      this.keyframeList,
      this.message,
    ]);
    root.append(panel);
    this.refresh();
  }

  /** Moves the playhead display only: no seek, no playback state, no `onScrub`. */
  setTime(time: number): void {
    const duration = this.context.playback.duration;
    const clamped = Math.min(Math.max(time, 0), Math.max(duration, 0));
    const value = String(clamped);
    if (this.scrub.value !== value) this.scrub.value = value;
    this.timeReadout.textContent = `${fmt(clamped)} s`;
  }

  refresh(): void {
    const { project, session } = this.context;
    const timeline = project.timeline;
    const active = session.activeObjectId === null ? undefined : project.get(session.activeObjectId);
    this.targetObjectOption.text = active === undefined ? 'active object (none)' : `active object: ${active.name}`;

    this.durationInput.value = String(timeline.duration);
    this.fpsInput.value = String(timeline.fps);
    this.scrub.max = String(timeline.duration);
    this.scrub.step = String(timeline.fps > 0 ? 1 / timeline.fps : 1);

    const target = this.readTarget();
    const channel = this.renderChannelSelect(target);
    const track =
      target === undefined || channel === undefined ? undefined : findTrack(timeline, target, channel);
    this.interpolationSelect.value = track?.interpolation ?? 'linear';
    this.interpolationSelect.disabled = track === undefined;

    const keyframes = track?.keyframes ?? [];
    if (this.selectedIndex !== null && this.selectedIndex >= keyframes.length) this.selectedIndex = null;

    const rows: HTMLButtonElement[] = [];
    const markers: HTMLSpanElement[] = [];
    keyframes.forEach((keyframe, index) => {
      const selected = index === this.selectedIndex;
      const row = el('button', {
        class: 'kf',
        text: `#${index} t=${fmt(keyframe.time)} v=[${keyframe.value.map((component) => fmt(component)).join(', ')}]`,
        on: {
          click: () => {
            this.selectedIndex = index;
            this.refresh();
          },
        },
      });
      row.style.display = 'block';
      row.style.width = '100%';
      row.style.textAlign = 'left';
      row.classList.toggle('on', selected);
      rows.push(row);

      const marker = el('span');
      marker.style.position = 'absolute';
      marker.style.top = '0';
      marker.style.width = '2px';
      marker.style.height = '100%';
      marker.style.background = MARKER_COLOR;
      marker.style.left = `${timeline.duration > 0 ? (keyframe.time / timeline.duration) * 100 : 0}%`;
      markers.push(marker);
    });
    this.keyframeList.replaceChildren(...rows);
    this.markerLayer.replaceChildren(...markers);

    const hasTrack = target !== undefined && channel !== undefined;
    const hasSelection = hasTrack && this.selectedIndex !== null;
    this.addButton.disabled = !hasTrack;
    this.moveButton.disabled = !hasSelection;
    this.deleteButton.disabled = !hasSelection;
    this.setTime(this.context.playback.time);
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
    const result = addKeyframe(this.context.project.timeline, target, channel, this.context.playback.time, value);
    if (!result.ok) {
      this.message.textContent = result.error;
      return;
    }
    this.message.textContent = '';
    this.refresh();
    this.context.onEdited();
  }

  private moveSelectedKeyframe(): void {
    const index = this.selectedIndex;
    const target = this.readTarget();
    const channel = this.readChannel();
    if (index === null || target === undefined || channel === undefined) return;
    const time = this.context.playback.time;
    if (!moveKeyframe(this.context.project.timeline, target, channel, index, time)) {
      this.refresh();
      return;
    }
    sortKeyframes(this.context.project.timeline);
    this.selectedIndex = this.indexAtTime(target, channel, time);
    this.refresh();
    this.context.onEdited();
  }

  private indexAtTime(target: TrackTarget, channel: TrackChannel, time: number): number | null {
    const keyframes = findTrack(this.context.project.timeline, target, channel)?.keyframes;
    if (keyframes === undefined) return null;
    const index = keyframes.findIndex((keyframe) => keyframe.time === time);
    return index < 0 ? null : index;
  }

  private deleteSelectedKeyframe(): void {
    const index = this.selectedIndex;
    const target = this.readTarget();
    const channel = this.readChannel();
    if (index === null || target === undefined || channel === undefined) return;
    if (!removeKeyframe(this.context.project.timeline, target, channel, index)) {
      this.refresh();
      return;
    }
    this.selectedIndex = null;
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
    const duration = Number(this.durationInput.value);
    if (Number.isFinite(duration) && duration >= 0) {
      this.context.project.timeline.duration = duration;
      this.refresh();
      this.context.onEdited();
      return;
    }
    this.refresh();
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
