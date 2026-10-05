# src/ui/timeline.ts

Ring: 4 · Layer: ui · Depends on: ./dom.js, ../document/timeline.js, ../document/project.js, ../document/camera.js, ../animation/playback.js, ../editor/session.js

## Responsibility
The timeline widget: one transport toggle, a scrub bar carrying the **selected target's** key markers, the exact time,
duration and frame-rate inputs, one `target` select, and **one** key list. The `target` select is the bar's single
subject switch: its options are the active object plus one per camera take. An **object** target shows the active
object's keyframe track in the list, with the channel/interpolation selects and the `add` button live. A **camera**
target shows the selected take's pose keys, grouped by segment, with `Copy take`, `Delete take`, and `Cut here` live in
the same bar. There is no second, always-visible camera list: both targets render into the one content region.

The camera is still no track here and `document/camera.ts` owns it — the carrier is what authors a shot — but a camera
take is a first-class target. Selecting one makes it the preview/editor take, so the viewport, the `Camera` group, and
the keys listed here describe the same plan; the switch itself is the app's, reported through the context. The take's
keys are shown and edited here because the widget is the only place a camera key can be seen, seeked to, retimed, or
removed at all, and its structure — copy, delete, cut — is the take's, so it belongs to the bar that names a take rather
than to the group that aims the shot.

It edits object keyframes through the mutators of `document/timeline.ts` and reports every camera key edit and
take-structure action through the context callbacks the app implements; it delegates seeking to `onScrub`, clip rebuilds
to `onEdited`, the clip's length to `setDuration`, and the transport press to `onTransport`, because a run of the clip
changes the viewport too. It renders nothing about voxels. Every time it reads, displays, or hands over is the authoring
unit, milliseconds, so the widget never converts — and the only place it rounds is the display and an entered seek,
never a stored time: `onScrub` takes milliseconds and the app divides by 1000 for the clip, whose times are seconds. Its
host is the bar along the bottom of the page, and that bar starts collapsed: whether it is on screen is the app's flag,
and `setVisible` is the view of it, the way `setTime` is the view of the playhead.

## Public interface
```ts
type TimelineTarget =
  | { kind: 'object'; objectId: ObjectId }
  | { kind: 'camera'; takeId: string };

type TimelineContext = {
  project: Project; playback: Playback; session: EditorSession;
  onScrub(timeMs: number): void;   // seeks to an absolute millisecond time; the app converts it to the clip's seconds
  onEdited(): void;
  setDuration(durationMs: number): void;   // writes the clip's length; the app retimes the camera's coverage with it
  /**
   * Switches the take the bar shows and the clip previews; the selected camera take *is* the preview/editor take, so
   * the app owns the switch. Returns false while a run is in flight, so the bar leaves its target where it was.
   */
  setActiveTake(takeId: string): boolean;
  copyTake(): void;          // copies the shown take and switches to the copy; the app owns it
  deleteTake(): void;        // deletes the shown take; the model refuses the last one
  cutAtPlayhead(): void;     // splits the shot the playhead is in; the app owns the write and the re-read
  /**
   * Retimes one camera key of one segment. The app owns the write because a key that moved changes the shot the
   * playhead resolves; the clip is untouched, so no rebuild is asked for. A refused move changes nothing.
   */
  moveCameraKey(takeId: string, segmentId: string, keyId: string, timeMs: number): void;
  /** Removes one camera key; the app re-reads what reads the camera. The model refuses the last key of a segment. */
  removeCameraKey(takeId: string, segmentId: string, keyId: string): void;
  onTransport(): void;       // starts or pauses the run; the app owns the transport because a run moves the viewport
};
class TimelinePanel {
  constructor(root: HTMLElement, context: TimelineContext);
  setTime(timeMs: number): void;
  setVisible(visible: boolean): void;   // shows or hides the host bar; the app owns the flag
  refresh(): void;
}
```

## Internal logic
1. The constructor builds one `<div>` under `root`: a transport row — the one Play/Pause toggle and the `loop`
   checkbox labelled `loop`, the row's only control whose meaning is not in its own text, so the label carries the word
   and, by wrapping the box, toggles it; the pair is `flex: 0 0 auto` so the readout keeps the rest of the row — then a
   scrub row: an `<input type="range">` with `min = 0`, `step = 1` and `max` written from `timeline.durationMs` on every
   `refresh()`, the marker layer over it, and the exact-time number field (`time (ms)`, `step = 1`, `change` →
   `onScrub`); then a general row with `duration (ms)` (`step = 100`), `fps`, and the `target` select; then two
   mutually exclusive control rows — the object row (`channel`, `interpolation`, `add`) and the camera row (`Copy
   take`, `Delete take`, `Cut here`); then the one key list, capped at `maxHeight = '100px'` with `overflowY = 'auto'`,
   shared by both targets; then the panel's own message line. It finishes with `refresh()`.
2. Target state. The widget holds `targetKind: 'object' | 'camera'` — the camera case holds no take id of its own,
   because the take the bar shows is the app's preview/editor take, so the select and the list are read back from it and
   a switch anywhere else moves them with it. `readTarget()` resolves it: for a camera target it returns
   `{ kind: 'camera', takeId: activeTake(project.camera)?.id }` (or the object target when there is no take), else
   `{ kind: 'object', objectId: session.activeObjectId }` or `undefined` while nothing is active. `TimelineTarget` is
   that union, and the object arm is structurally the `TrackTarget` the timeline mutators take.
3. The target select is rebuilt on every `refresh()`: one `active object: <name>` (or `active object (none)`) option
   whose value is `object`, then one `camera: <name>` option per take whose value is `take:<id>`. Its value is set to
   `take:<preview take id>` while the bar is on a camera target and `object` otherwise. A camera target with no take to
   show falls back to the object target rather than rendering an empty selection. The select's `change` is
   `writeTarget()`: choosing `object` sets the target kind and writes no camera state; choosing `take:<id>` hands the id
   to `context.setActiveTake(id)` — the app's preview-take switch — and only on `true` moves the target kind to camera,
   so a run's refusal (see the app) leaves the bar on the take actually previewed. The select is then re-read.
4. Content region. `refresh()` reads the resolved target and renders exactly one population into the one list, and the
   matching control row is shown while the other is `hidden`:
   - an object target renders `findTrack(timeline, target, channel)?.keyframes ?? []` in array order, one `keyframeRow`
     each, with a marker placed at `timeMs / durationMs` of the bar in `MARKER_COLOR = 'var(--accent)'`; the channel
     select is rebuilt from `OBJECT_CHANNELS` (`position` | `quaternion` | `scale`), the interpolation select follows the
     track, and `add` is enabled exactly while a target and a channel resolve — not while a track exists, because the
     first keyframe of a channel is what creates its track;
   - a camera target renders the preview take's keys in segment order then key order, one `cameraKeyRow` each, with a
     marker in `CAMERA_MARKER_COLOR = 'var(--text)'` — the second colour is what tells a camera key apart from an object
     keyframe on the same bar. The camera structure buttons are live here and `Copy take`/`Cut here` are `disabled`
     while `playback.playing`, and `Delete take` also while the project holds one take, mirroring the app's refusal and
     the model's refusal of the last take.
   Every row and marker is rebuilt on each `refresh()`, and each row addresses its key by id, never by its place in a
   list that a retime re-sorts.
5. A keyframe row is a `key` button that seeks through `onScrub(keyframe.timeMs)`, a `time (ms)` number field
   (`min = 0`, `max = durationMs`, `step = 1`) that retimes it, a `delete` button, and a dim `v=[…]` value label built
   with `fmt`. There is no panel-level `move` or `delete` and no row selection: retiming a keyframe in its own row made
   a selection unnecessary. Retime calls `moveKeyframe(project.timeline, target, channel, id, timeMs)`, then `refresh()`
   and `onEdited()` on `true`; a `false` refreshes alone. Delete calls `removeKeyframe` with the same handling; the
   track it empties stays, so the list goes empty while the channel keeps its interpolation.
6. Add reads the authoring value from project truth at the playhead — the active object's
   `transform.position`/`quaternion`/`scale` components — builds a fresh `number[]` of the channel length (3, or 4 for
   `quaternion`), and calls `addKeyframe(project.timeline, target, channel, timeMs, value)` with
   `timeMs = playback.time * 1000` — unrounded, so the key lands at the time the playhead is actually at. The `position`
   channel is read through `project.keyframePosition(target, transform.position)` — whole cells for an object that
   aligns, a copy for an unaligned one. On `ok` it calls `refresh()` then `onEdited()`; on `bad-value-length` it writes
   that literal into the panel's own message line and changes nothing.
7. A camera key row is a `key` button that seeks through `onScrub(key.timeMs)`, a `time (ms)` field that retimes it, a
   `delete` button, and a dim `p=[…]` label built with `fmt` from the key's own position. The field's `min`/`max` are the
   *segment's* range, not the clip's, because a key outside its own shot could never be read; `delete` is disabled while
   the segment holds one key, which is the model's own refusal of the last one, and both the field and `delete` are
   disabled while a run is in flight, which mirrors the app's refusal. When the take holds more than one segment the
   label is prefixed with the segment's name, because that is what bounds the row's time and nothing else on this bar
   says which shot a key belongs to. The row reports its edits as `(takeId, segmentId, keyId)`, taking the take id from
   `activeTake(project.camera)` at the moment of the call, so a rebuild that reorders the list cannot make a press land
   on a neighbour.
8. Retime and delete of a camera key are the app's: the row calls `context.moveCameraKey(takeId, segmentId, keyId, timeMs)`
   / `context.removeCameraKey(...)` and then `refresh()`es, so the app's own follow-up reads the frame, the path and the
   panel again — the clip does not change, so no rebuild is asked for. A non-finite entered time never reaches the app.
9. The interpolation select calls `setInterpolation(project.timeline, target, channel, mode)` for an object target and
   calls `onEdited()` on `true`, so the rebuilt clip picks up the new mode; it is disabled while the channel has no
   track.
10. The duration field hands the value to `context.setDuration(durationMs)` and then `refresh()`es — it calls no mutator
    itself and no `onEdited()`, because the app's write is the one place the clip's length and the camera's coverage move
    together. Its own `min` is `maxKeyframeTime(timeline)`, and a non-finite entry only refreshes. The fps field writes
    `project.timeline.fps` for a finite positive number and refreshes otherwise.
11. Transport: the toggle's click calls `context.onTransport()` and nothing else — the app owns the transport, because a
    run of the clip changes the viewport too — and the `loop` checkbox calls `playback.setLoop(checked)`. There is no
    `stop`. The scrub bar's `input` and the exact-time field's `change` both call `context.onScrub(Number(value))` in
    milliseconds; the panel neither seeks nor starts playback itself.
12. `setTime(timeMs)` moves the playhead display only: no `onScrub`, no playback state. It rounds and clamps the value
    into `[0, timeline.durationMs]` and writes the scrub position, the readout as `<n> ms`, the exact-time field — except
    while that field is the focused element — and the play toggle's label from `playback.playing`. The render loop is
    what calls it every frame, so a press is not the only thing that starts or stops playback and the label has to be
    re-derived rather than set on click.
13. `setVisible(visible)` writes `this.root.hidden = !visible` and nothing else: the host is the bar, so showing or
    hiding it is the whole of the widget's visibility, and the panel keeps no flag of its own. The contents stay built
    and the render loop goes on calling `setTime`.
14. `refresh()` rebuilds the target options, the rows — object or camera, one population — their markers, the duration
    field's `min`, the scrub's `max`, the two control rows' visibility, and the enabled/disabled state, and is the only
    code that reads the timeline, the take, or the transport for display. It ends by calling `setTime(playback.time * 1000)`,
    which snaps to whole milliseconds for display alone.

## Invariants
- The panel never calls `playback.setTime`, `playback.rebuild`, or `playback.advance`, never calls `play` or `pause`, and
  never holds an `AnimationMixer`: its `playback` uses are `setLoop` plus the read-only `time` and `playing` reads. The
  transport press is reported to the app through `onTransport`.
- Its only direct project writes are through `document/timeline.ts` mutators plus `timeline.fps`; object and voxel data
  are untouched. The camera is written only by the app: this file reads a take (`activeTake`) and reports a take switch,
  a copy, a delete, a cut, a camera-key retime, or a camera-key removal through the context callbacks, and the app's own
  `setActiveTake`/`addTake`/`removeTake`/`splitSegment`/`moveKey`/`removeKey` are what reach the document.
- The bar has exactly one key list and one target selection. Both targets render into that one list — an object target
  its track, a camera target the take's keys — so there is never a second, appended camera list beside the object
  keyframes, and the two control rows are mutually exclusive.
- Every key of the selected target is rendered exactly once as a row and once as a marker: the active object's track
  keyframes, or the shown take's keys in segment order then key order. A camera row addresses its key by
  `(takeId, segmentId, keyId)` — never by its place in a list that a retime re-sorts.
- The camera target *is* the preview/editor take: `refresh()` reads the select's value and the list back from
  `activeTake(project.camera)`, so a take switched anywhere else moves the bar with it, and the bar never holds a take
  the viewport is not previewing. `context.setActiveTake`'s `false` — a run in flight — leaves the target kind unchanged.
- Every keyframe mutation that returned `true` is followed by exactly one `onEdited()` call; a refused one — add's
  `bad-value-length`, a `false` from move, remove, or interpolation with no track — reports or refreshes and never calls
  it. The duration is the one write that goes the other way: the widget hands it to `context.setDuration` and calls no
  `onEdited()`, because the app's own write rebuilds the clip and moves the camera's coverage with it.
- After any add, retime, or delete, keyframes are strictly ascending in `timeMs` with one keyframe per millisecond, a
  `value.length` matching the channel, and every time inside `[0, timeline.durationMs]`, because the model clamps what
  this file hands it.
- The widget never converts units: every time it reads, displays, or hands over is milliseconds, and `onScrub`'s
  contract is milliseconds; the clip's seconds begin at the app.
- `setTime` clamps into `[0, timeline.durationMs]`, does not fire `onScrub`, does not change `playback` state, and
  renders identically when called twice with the same value; the only project value it reads is `timeline.durationMs`.
- `setVisible` writes the host's `hidden` attribute and nothing else: the panel never reads the app's flag, never keeps
  one, and `refresh()` never touches visibility.
- A keyframe authored here stores whole cells for the `position` channel of an aligned object; no other value this file
  writes is rounded.
- The key list is capped and scrolls: its height never follows the number of rows, so the bar keeps a fixed height
  whatever the target holds and everything above the list stays where it was — a track or a take of any length scrolls
  inside the 100 px cap instead of pushing the viewport off screen.

## Errors
`addKeyframe`'s `{ ok: false, error: 'bad-value-length' }` is shown verbatim in the panel's own message line, since
`TimelineContext` carries no `reportError`. The boolean `false` from `moveKeyframe`, `removeKeyframe`, and
`setInterpolation` is an ordinary outcome and produces a `refresh()` instead of a message; for a move it means either
the millisecond belongs to another keyframe or the row went stale, and the rebuild puts the field back to what the clip
holds. A camera row has the same shape of outcome without a boolean: a non-finite entry never reaches the app, and a
retime or a removal the model refuses — the millisecond already holds another key, the segment holds one key, the row
went stale, or a run is in flight — changes nothing, so the `refresh()` that always follows is the whole report and the
field comes back showing what the take holds. A duration that is not finite, and an fps that is not finite and positive,
reflect from their own `refresh()` instead of reaching the app. Showing and hiding the bar has no failure path.

## Dependencies
- `./dom.js` — `el`, `fmt` for construction and the time and key-value readouts.
- `../document/timeline.js` — the mutators (`addKeyframe`, `moveKeyframe`, `removeKeyframe`, `setInterpolation`) and the
  lookups (`findTrack`, `maxKeyframeTime`), plus the `TrackTarget`, `TrackChannel`, `Interpolation` types; that file
  owns the data, the ordering rules, and the clamp. `setDuration` is imported alongside them but the length goes through
  the context, not it.
- `../document/project.js` — `Project`, `ObjectId` for `timeline`, object transforms, `camera` (the takes the target
  select lists and the take the camera rows read), and `keyframePosition`, the one rule a `position` keyframe is read
  through (ring 1).
- `../document/camera.js` — `activeTake` for the preview take the camera target resolves to, plus the `CameraKey` and
  `CameraSegment` types of the rows' inputs (ring 1). The mutators are deliberately *not* imported: the widget reports
  the edit and the app performs it, because a key that moved or a take that changed changes the shot the playhead
  resolves and the app is what re-reads the frame, the path, and the `Camera` group with it.
- `../animation/playback.js` — `Playback` for the loop setting, the playhead read, and the `playing` flag the toggle's
  label and the camera rows' disabling follow (ring 1); the transport itself is the app's, through `onTransport`.
- `../editor/session.js` — `EditorSession` for the active object that keys the object tracks (ring 3).
- No outer-ring import and no `three` import of its own: keyframe values are read as plain numbers from the
  `Vector3`/`Quaternion` components the project already holds.

## Tests
None. The widget needs a DOM, and the mutators it calls are pinned by `tests/timeline.test.ts` (insertion order,
id-addressed moves and removals, the clamp on authored times, `setDuration`'s collapse, `maxKeyframeTime`, and the
emptied track that stays), while the camera model's `resolveCameraAt` — the take a camera target previews and an export
renders — is pinned by `tests/camera.test.ts` and `tests/scene.test.ts` (a take named by id resolves while the active
take stays the preview, an unknown explicit id resolves to nothing, and the active take answers when no id is named).
Panel behavior is verified by running the app: add, retime, seek to, and delete object keyframes while watching the
preview, and confirm a retime onto an occupied millisecond is refused and the field comes back; the target select must
list the active object plus one entry per take, choosing a take must switch the preview and replace the list with that
take's keys, and choosing the object must put the object track back. With a camera target the camera control row shows
`Copy take`/`Delete take`/`Cut here` and the object row is hidden: aiming the shot at a second time adds a second row and
a second marker, a row's `key` seeks, typing a new time retimes it and re-sorts the list, `delete` removes the row and
disables itself once one key is left, `Cut here` adds a row and prefixes the labels with the segment names, `Copy take`
moves the whole block onto the copy, and `Delete take` is disabled with one take; while a run plays, a target switch,
the structure buttons, and the key rows must all refuse. The transport walk is on the same run: pressing play must start
a run that takes the viewport with it and pressing it again must pause and hand the frame over, with the toggle's label
following `playback.playing` in both cases.
