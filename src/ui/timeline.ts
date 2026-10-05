/**
 * The timeline widget: one transport toggle, a scrub bar carrying the selected target's key markers, the exact time,
 * duration and frame-rate inputs, and one target-aware key list. The `target` select is the bar's single subject
 * switch: the active object, whose keyframes the object controls and the list act on, or one camera take, whose keys
 * the list shows and edits and whose structure the `Copy take`, `Delete take`, and `Cut here` buttons change.
 *
 * The camera is still no track here — `document/camera.ts` owns it and the carrier authors a shot — but a camera take
 * is a first-class target of the bar: selecting one makes it the preview/editor take (a switch the app owns), so the
 * viewport, the `Camera` group, and the keys listed here all describe the same plan. The take's keys are listed and
 * marked because the widget is the only place a key can be seen, seeked to, retimed, or removed at all.
 *
 * It edits timeline keyframes through the pure mutators of `document/timeline.ts` and reports camera key edits and
 * take-structure actions through the context callbacks the app implements; it delegates seeking to `onScrub` and asks
 * the app to rebuild the clip through `onEdited`; it never touches the mixer.
 *
 * Times are whole milliseconds throughout, which is the unit the authoring data is in too, so the widget never
 * converts: the panel reads and writes `timeMs` and the clip is the only place that becomes seconds.
 *
 * Its host is the bar along the bottom of the page, which starts collapsed: whether the bar is on screen is the app's
 * flag, and `setVisible` is the view of it, the way `setTime` is the view of the playhead.
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
import type { ObjectId, Project } from '../document/project.js';
import { activeTake, type CameraKey, type CameraSegment } from '../document/camera.js';
import type { Playback } from '../animation/playback.js';
import type { EditorSession } from '../editor/session.js';

/**
 * What the bar is showing: the active object's track, or one camera take. It is the widget's explicit target state —
 * the camera case names a take by id, so a take rename never moves the selection — while the take itself is the app's
 * preview/editor take, because selecting a camera target is a take switch.
 */
export type TimelineTarget =
  | { kind: 'object'; objectId: ObjectId }
  | { kind: 'camera'; takeId: string };

export type TimelineContext = {
  project: Project;
  playback: Playback;
  session: EditorSession;
  /** Seeks the playhead to an absolute time in milliseconds; the app clamps it onto the clip. */
  onScrub(timeMs: number): void;
  onEdited(): void;
  /**
   * Writes the clip's length. The app owns the write because the length is not the timeline's alone: a take's
   * segments tile the clip, so the camera has to be retimed with it.
   */
  setDuration(durationMs: number): void;
  /**
   * Switches the take the bar shows and the clip previews: the selected camera take *is* the preview/editor take, so
   * the app owns the switch — it re-reads the shot, the path, and the panel with it. Returns false when a run is in
   * flight, because the preview take is refused during playback; the bar then leaves its target where it was rather
   * than showing a take the viewport is not previewing.
   */
  setActiveTake(takeId: string): boolean;
  /** Copies the take the bar shows and switches to the copy; the app owns it, as it owns every take switch. */
  copyTake(): void;
  /** Deletes the take the bar shows; the model refuses the last one, so the button is disabled instead. */
  deleteTake(): void;
  /** Splits the shot the playhead is in; the app owns the write and the re-read that follows it. */
  cutAtPlayhead(): void;
  /**
   * Retimes one camera key of one segment. The app owns it for the same reason it owns the length: a key that moved
   * changes the shot the playhead resolves, so the frame, the drawn path and the panel are re-read with it. The model
   * clamps the time into the segment and refuses a collision, so a refused move changes nothing.
   */
  moveCameraKey(takeId: string, segmentId: string, keyId: string, timeMs: number): void;
  /** Removes one camera key. The model refuses the last key of a segment, so the row disables that button. */
  removeCameraKey(takeId: string, segmentId: string, keyId: string): void;
  /**
   * Starts or pauses playback. The app owns the transport because a run of the clip changes the viewport too
   * so the widget reports the press and reads `playback.playing` back for its label.
   */
  onTransport(): void;
};

const OBJECT_CHANNELS: readonly TrackChannel[] = ['position', 'quaternion', 'scale'];
const INTERPOLATIONS: readonly Interpolation[] = ['step', 'linear', 'smooth'];

/** The target-select value that names the active object; a camera take's value is `take:<id>`. */
const OBJECT_TARGET = 'object';
const TAKE_TARGET_PREFIX = 'take:';

const MARKER_COLOR = 'var(--accent)';
/** Camera keys are not object keyframes: a second colour is what tells the two apart on the same bar. */
const CAMERA_MARKER_COLOR = 'var(--text)';

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
  private readonly channelSelect: HTMLSelectElement;
  private readonly interpolationSelect: HTMLSelectElement;
  private readonly addButton: HTMLButtonElement;
  /** The object-only controls, the camera-only controls, and the one list both targets render into. */
  private readonly objectControls: HTMLDivElement;
  private readonly cameraControls: HTMLDivElement;
  private readonly copyTakeButton: HTMLButtonElement;
  private readonly deleteTakeButton: HTMLButtonElement;
  private readonly cutButton: HTMLButtonElement;
  private readonly markerLayer: HTMLDivElement;
  private readonly keyframeList: HTMLDivElement;
  private readonly message: HTMLDivElement;
  /**
   * Which target the bar shows. The camera case holds no take id of its own: the preview/editor take *is* the app's
   * active take, so the select and the list are read back from it, and a take switch anywhere else moves them with it.
   */
  private targetKind: 'object' | 'camera' = 'object';

  constructor(root: HTMLElement, context: TimelineContext) {
    this.context = context;
    this.root = root;

    // One toggle rather than three buttons: the label is the state, `setTime` keeps it in step with the transport
    // every frame, and going back to the start is what the scrub bar is for.
    this.playToggle = el('button', {
      text: 'play',
      title: 'play or pause the clip',
      on: { click: () => context.onTransport() },
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
    // unit as the keyframe rows.
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

    // The subject switch: the active object, or one camera take. Its options are rebuilt on every `refresh()` from the
    // project's takes, because a take can be copied or deleted under it.
    this.targetSelect = el('select', { on: { change: () => this.writeTarget() } });
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

    // Take structure belongs to the take, so its three commands sit with the bar that shows one, not in the `Camera`
    // group that aims the shot.
    this.copyTakeButton = el('button', {
      text: 'Copy take',
      title: 'copy this take and switch to the copy, leaving the original alone',
      on: { click: () => context.copyTake() },
    });
    this.deleteTakeButton = el('button', {
      text: 'Delete take',
      title: 'delete this take; the project always keeps one',
      on: { click: () => context.deleteTake() },
    });
    this.cutButton = el('button', {
      text: 'Cut here',
      title: 'split the shot at the playhead: the later half holds its own state from that instant on',
      on: { click: () => context.cutAtPlayhead() },
    });
    // The two control rows are exclusive: which one is on screen is which target the bar shows, so a camera target
    // never offers the channel or interpolation of an object track, and an object target never offers a cut.
    this.objectControls = el('div', { class: 'row' }, [
      this.field('channel', this.channelSelect),
      this.field('interpolation', this.interpolationSelect),
      this.addButton,
    ]);
    this.cameraControls = el('div', { class: 'row' }, [
      this.copyTakeButton,
      this.deleteTakeButton,
      this.cutButton,
    ]);

    this.markerLayer = el('div');
    this.markerLayer.style.position = 'absolute';
    this.markerLayer.style.inset = '0';
    this.markerLayer.style.pointerEvents = 'none';
    const scrubWrap = el('div');
    scrubWrap.style.position = 'relative';
    scrubWrap.style.flex = '1 1 auto';
    scrubWrap.append(this.scrub, this.markerLayer);

    this.keyframeList = el('div');
    // The list is capped and scrolls: a bar of rows that grew with every keyframe would otherwise eat the
    // viewport it sits under. It is the one content region for both targets — object keyframes or a take's camera
    // keys — so the bar never carries a second, always-visible camera list beside the track's.
    this.keyframeList.style.maxHeight = '100px';
    this.keyframeList.style.overflowY = 'auto';
    this.message = el('div');
    this.message.style.color = '#ff8a8a';

    const panel = el('div', undefined, [
      el('div', { class: 'row' }, [this.playToggle, loopField, this.timeReadout]),
      el('div', { class: 'row' }, [scrubWrap, this.field('time (ms)', this.timeInput)]),
      el('div', { class: 'row' }, [
        this.field('duration (ms)', this.durationInput),
        this.field('fps', this.fpsInput),
        this.field('target', this.targetSelect),
      ]),
      this.objectControls,
      this.cameraControls,
      this.keyframeList,
      this.message,
    ]);
    root.append(panel);
    this.refresh();
  }

  /**
   * Moves the playhead display only: no seek, no playback state, no `onScrub`. It snaps to whole milliseconds as it
   * writes the fields, which is the one place this widget rounds a time — nothing it hands to the document is
   * quantized. It also keeps the play toggle's label
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
    const { project, session, playback } = this.context;
    const timeline = project.timeline;
    const active = session.activeObjectId === null ? undefined : project.get(session.activeObjectId);
    const takes = project.camera.takes;
    const previewTake = activeTake(project.camera);
    // A camera target with no take to show — a camera that lost every take — falls back to the object instead of
    // rendering an empty select value.
    if (this.targetKind === 'camera' && previewTake === undefined) this.targetKind = 'object';
    const cameraTarget = this.targetKind === 'camera' && previewTake !== undefined;

    // The target select lists the active object plus one option per take; the camera option's value is the take's id,
    // so the preview take is what its selection reads back to.
    const targetOptions: HTMLOptionElement[] = [
      el('option', {
        value: OBJECT_TARGET,
        text: active === undefined ? 'active object (none)' : `active object: ${active.name}`,
      }),
    ];
    for (const take of takes) {
      targetOptions.push(el('option', { value: `${TAKE_TARGET_PREFIX}${take.id}`, text: `camera: ${take.name}` }));
    }
    this.targetSelect.replaceChildren(...targetOptions);
    this.targetSelect.value =
      this.targetKind === 'camera' && previewTake !== undefined
        ? `${TAKE_TARGET_PREFIX}${previewTake.id}`
        : OBJECT_TARGET;

    this.durationInput.value = String(timeline.durationMs);
    // The duration cannot cut the clip short: its floor is the latest keyframe anywhere in the timeline, and
    // `setDuration` clamps anyway if a keyframe ever lands past it.
    this.durationInput.min = String(maxKeyframeTime(timeline));
    this.fpsInput.value = String(timeline.fps);
    this.scrub.max = String(timeline.durationMs);
    // One millisecond per step: the playhead is addressed in the same unit the keyframes are stored in.
    this.scrub.step = '1';

    this.objectControls.hidden = cameraTarget;
    this.cameraControls.hidden = !cameraTarget;

    const rows: HTMLDivElement[] = [];
    const markers: HTMLSpanElement[] = [];
    if (this.targetKind === 'camera' && previewTake !== undefined) {
      // The camera keys come from the shown take's segments, never from a track: they are listed and marked whatever
      // the object selects hold, because this list is the only place a camera key can be seen, seeked to, retimed, or
      // removed at all.
      for (const segment of previewTake.segments) {
        for (const key of segment.keys) {
          rows.push(this.cameraKeyRow(previewTake.segments.length, segment, key));
          markers.push(this.marker(key.timeMs, timeline.durationMs, CAMERA_MARKER_COLOR));
        }
      }
      // A run owns the shot and the takes for its length, so the structure commands wait; the app refuses them too,
      // which this only mirrors.
      this.copyTakeButton.disabled = playback.playing;
      this.deleteTakeButton.disabled = playback.playing || takes.length < 2;
      this.cutButton.disabled = playback.playing;
    } else {
      const resolved = this.readTarget();
      const target = resolved?.kind === 'object' ? resolved : undefined;
      const channel = this.renderChannelSelect(target);
      const track =
        target === undefined || channel === undefined ? undefined : findTrack(timeline, target, channel);
      this.interpolationSelect.value = track?.interpolation ?? 'linear';
      this.interpolationSelect.disabled = track === undefined;

      if (target !== undefined && channel !== undefined) {
        for (const keyframe of track?.keyframes ?? []) {
          rows.push(this.keyframeRow(timeline.durationMs, target, channel, keyframe));
          markers.push(this.marker(keyframe.timeMs, timeline.durationMs, MARKER_COLOR));
        }
      }
      // `add` needs a resolved target and channel, not an existing track: the first keyframe of a channel is what
      // creates its track.
      this.addButton.disabled = target === undefined || channel === undefined;
    }
    this.keyframeList.replaceChildren(...rows);
    this.markerLayer.replaceChildren(...markers);

    this.setTime(Math.round(playback.time * 1000));
  }

  /** One marker on the scrub bar, placed at the key's fraction of the clip; object keys and camera keys both use it. */
  private marker(timeMs: number, durationMs: number, color: string): HTMLSpanElement {
    const marker = el('span');
    marker.style.position = 'absolute';
    marker.style.top = '0';
    marker.style.width = '2px';
    marker.style.height = '100%';
    marker.style.background = color;
    marker.style.left = `${durationMs > 0 ? (timeMs / durationMs) * 100 : 0}%`;
    return marker;
  }

  /**
   * One keyframe: seek to it, retime it in place, delete it. Each row acts on its own keyframe by id, so a rebuild
   * that reorders the list cannot make a press land on a neighbour.
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

  /**
   * One camera key: seek to it, retime it inside its own shot, remove it. The row addresses its key and its segment by
   * id, so a rebuild that reorders the list — a retime sorts the segment — cannot make a press land on a neighbour. The
   * time field is bounded by the segment, not by the clip: a key outside its own shot could never be read, and the model
   * refuses a time that already holds another key rather than stacking two states on one instant. Both mutations are
   * disabled while a run is in flight, which is the app's own refusal mirrored.
   */
  private cameraKeyRow(
    segmentCount: number,
    segment: CameraSegment,
    key: CameraKey,
  ): HTMLDivElement {
    const playing = this.context.playback.playing;
    const row = el('div', { class: 'kf-row' });
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '4px';
    row.style.width = '100%';

    const seek = el('button', {
      text: 'key',
      title: 'move the playhead to this camera key',
      on: { click: () => this.context.onScrub(key.timeMs) },
    });
    const timeField = el('input', {
      type: 'number',
      min: String(segment.startMs),
      max: String(segment.endMs),
      step: '1',
      value: String(key.timeMs),
      title: 'camera key time in milliseconds, inside its own shot',
      disabled: playing,
      on: { change: () => this.writeCameraKeyTime(segment.id, key.id, timeField) },
    });
    const remove = el('button', {
      text: 'delete',
      title: 'remove this camera key',
      on: { click: () => this.deleteCameraKey(segment.id, key.id) },
    });
    // The model refuses the last key of a segment — a shot has to resolve for the whole of its range — so the row says
    // so instead of offering a button that cannot act.
    remove.disabled = playing || segment.keys.length <= 1;
    // A take of several shots names the one the key is in: the row's own shot is what bounds its time, and which shot a
    // key belongs to is otherwise nowhere on screen.
    const pose = `p=[${fmt(key.position.x)}, ${fmt(key.position.y)}, ${fmt(key.position.z)}]`;
    const value = el('span', {
      class: 'dim',
      text: segmentCount > 1 ? `${segment.name} · ${pose}` : pose,
    });
    row.append(seek, timeField, remove, value);
    return row;
  }

  private field(label: string, control: HTMLElement): HTMLLabelElement {
    return el('label', undefined, [el('span', { class: 'dim', text: label }), control]);
  }

  /**
   * What the bar is showing, resolved from its target state: the preview take for a camera target, else the active
   * object, or `undefined` while neither a take nor an active object resolves.
   */
  private readTarget(): TimelineTarget | undefined {
    if (this.targetKind === 'camera') {
      const take = activeTake(this.context.project.camera);
      if (take !== undefined) return { kind: 'camera', takeId: take.id };
    }
    const objectId = this.context.session.activeObjectId;
    return objectId === null ? undefined : { kind: 'object', objectId };
  }

  /**
   * Acts on the target select. Choosing a camera take is a preview/editor take switch, which the app owns; a run
   * refuses it, so the bar's target stays where it was and `refresh()` puts the select back to the take actually
   * previewed. Choosing the object writes no camera state at all.
   */
  private writeTarget(): void {
    const value = this.targetSelect.value;
    if (value === OBJECT_TARGET) {
      this.targetKind = 'object';
      this.refresh();
      return;
    }
    if (!value.startsWith(TAKE_TARGET_PREFIX)) {
      this.refresh();
      return;
    }
    const takeId = value.slice(TAKE_TARGET_PREFIX.length);
    if (takeId.length > 0 && this.context.setActiveTake(takeId)) this.targetKind = 'camera';
    this.refresh();
  }

  /** Narrows the select's string back to one of the object channels. */
  private readChannel(): TrackChannel | undefined {
    const value = this.channelSelect.value;
    for (const channel of OBJECT_CHANNELS) if (channel === value) return channel;
    return undefined;
  }

  private renderChannelSelect(target: TrackTarget | undefined): TrackChannel | undefined {
    const channels = OBJECT_CHANNELS;
    const previous = this.channelSelect.value;
    this.channelSelect.replaceChildren(...channels.map((channel) => el('option', { value: channel, text: channel })));
    this.channelSelect.value = channels.some((channel) => channel === previous) ? previous : channels[0] ?? 'position';
    return this.readChannel();
  }

  private authoringValue(target: TrackTarget, channel: TrackChannel): number[] | undefined {
    // A key records the object the session has selected, which can be seen moving; a camera key is authored through the
    // carrier, so no channel here reaches it.
    const transform = this.context.project.get(target.objectId)?.transform;
    if (transform === undefined) return undefined;
    // An aligned object's keyframes land on the lattice even while its live placement is a
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
    const resolved = this.readTarget();
    const target = resolved?.kind === 'object' ? resolved : undefined;
    const channel = this.readChannel();
    if (target === undefined || channel === undefined) return;
    const value = this.authoringValue(target, channel);
    if (value === undefined) return;
    // The playhead is seconds (the clip's unit) and the authoring time is milliseconds. No rounding here: the key
    // records the time the playhead is actually at, and only the display snaps a fractional millisecond.
    const timeMs = this.context.playback.time * 1000;
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
   * row went stale — changes nothing, and the rebuild puts the field back to what the clip holds.
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

  /**
   * Retimes one camera key from its row. The call is the app's, because a key that moved changes the shot the playhead
   * resolves and the frame, the drawn path and the panel have to be re-read with it — the clip itself does not change,
   * so no rebuild of the mixer is asked for. A refused move changes nothing and the rebuild puts the field back to what
   * the take holds.
   */
  private writeCameraKeyTime(segmentId: string, keyId: string, field: HTMLInputElement): void {
    const takeId = activeTake(this.context.project.camera)?.id;
    const timeMs = Number(field.value);
    if (takeId !== undefined && Number.isFinite(timeMs))
      this.context.moveCameraKey(takeId, segmentId, keyId, timeMs);
    this.refresh();
  }

  /** Removes one camera key from its row; the app re-reads what reads the camera, and the rebuild drops the row. */
  private deleteCameraKey(segmentId: string, keyId: string): void {
    const takeId = activeTake(this.context.project.camera)?.id;
    if (takeId !== undefined) this.context.removeCameraKey(takeId, segmentId, keyId);
    this.refresh();
  }

  private writeInterpolation(): void {
    const resolved = this.readTarget();
    const target = resolved?.kind === 'object' ? resolved : undefined;
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
    // ever does come in short drags the clip onto it instead of losing the keyframes.
    this.context.setDuration(durationMs);
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
