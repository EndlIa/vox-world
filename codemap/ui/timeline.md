# src/ui/timeline.ts

Ring: 4 · Layer: ui · Depends on: ./dom.js, ../document/timeline.js, ../document/project.js, ../animation/playback.js, ../editor/session.js

## Responsibility
The timeline widget: one transport toggle, a scrub bar carrying the markers of both kinds of key, the exact time, duration and frame-rate inputs, a retime-in-place keyframe list with its add, seek, and delete actions against the active object, and the list of the active take's camera keys with their seek, retime, and delete actions. The camera is not a track here — `document/camera.ts` owns it and the carrier authors it, so every target this widget resolves against `document/timeline.ts` is an object — but its keys are shown and edited on this bar, because the widget is the only place a camera key can be seen, seeked to, retimed, or removed at all. It edits the timeline through the pure mutators of `document/timeline.ts`, hands the two camera key edits to the app through `moveCameraKey`/`removeCameraKey`, and never touches the mixer:
seeking is delegated to `onScrub`, clip rebuilds to `onEdited`, the clip's length to `setDuration`, and the transport press to `onTransport`, because a run of the clip changes the viewport too. It renders nothing about voxels. Every time it reads, displays, or hands over is the authoring unit, milliseconds, so the widget never converts — and the only place it rounds is the display and an entered seek, never a stored time: `onScrub` takes milliseconds and the app divides by 1000 for the clip, whose times are seconds. Its host is the bar along
the bottom of the page, and that bar starts collapsed: whether it is on screen is the app's flag, and `setVisible` is the view of it, the way
`setTime` is the view of the playhead.

## Public interface
```ts
type TimelineContext = {
  project: Project; playback: Playback; session: EditorSession;
  onScrub(timeMs: number): void;   // seeks to an absolute millisecond time; the app converts it to the clip's seconds
  onEdited(): void;
  setDuration(durationMs: number): void;   // writes the clip's length; the app retimes the camera's coverage with it
  /**
   * Retimes one camera key of one segment. The app owns the write because a key that moved changes the shot the playhead
   * resolves; the clip is untouched, so no rebuild is asked for. A refused move — that millisecond already holds a key,
   * or the row went stale — changes nothing.
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
1. The constructor builds one `<div>` under `root`: a transport row — the one Play/Pause toggle and the `loop` checkbox labelled
   `loop`, the row's only control whose meaning is not in its own text, so the label carries the word and, by wrapping
   the box, toggles it; the pair is `flex: 0 0 auto` so the readout keeps the rest of the row — then a scrub row: an `<input type="range">` with `min =
   0`, `step = 1` and `max` written from `timeline.durationMs` on every `refresh()`, the marker layer over it, and the exact-time number field
   (`time (ms)`, `step = 1`, `change` → `onScrub`); then the fields `duration (ms)` (`step = 100`), `fps`, `target`, `channel`, and
   `interpolation` beside the `add` button; then the keyframe list — capped at `maxHeight = '100px'` with
   `overflowY = 'auto'`, so a bar of rows that grew with every keyframe cannot eat the viewport it sits under
   — then the camera block: a dim heading line naming the active take, and a second list capped and scrolled the same
   way, holding one row per camera key of that take; then the panel's own message line. It finishes with `refresh()`.
2. Target resolution: `{ kind: 'object', objectId: session.activeObjectId }`, or `undefined` while nothing is active; every track this widget writes targets an object, so the target select holds the one option. The channel select is rebuilt from `OBJECT_CHANNELS` (`position` | `quaternion` | `scale`) and the object option's
   text names the active object, or says `(none)`.
3. Keyframe rows and the scrub bar's object markers both come from `findTrack(project.timeline, target, channel)?.keyframes ?? []`, rendered in
   array order, with a marker placed at `timeMs / durationMs` of the bar's width. Rows and markers are rebuilt on every `refresh()`, and each
   row addresses its keyframe by `id`, never by its place in the list. `trackKey` is used as a lookup helper only and is never parsed. The
   camera markers are the layer's second population and come from the take instead (step 15); they carry
   `CAMERA_MARKER_COLOR = 'var(--text)'` against the object keys' `MARKER_COLOR = 'var(--accent)'`, because the two are
   on one bar and a key the author cannot tell apart from a track's is no better than one that was not drawn.
4. A row is a `key` button that seeks to that keyframe through `onScrub(keyframe.timeMs)`, a `time (ms)` number field (`min = 0`,
   `max = durationMs`, `step = 1`) that retimes it, a `delete` button, and a dim `v=[…]` value label built with `fmt`. There is no panel-level
   `move` or `delete` and no row selection: retiming a keyframe in its own row made a selection unnecessary.
5. Retiming calls `moveKeyframe(project.timeline, target, channel, id, timeMs)`, then `refresh()` and `onEdited()` on `true`. A `false` — the
   millisecond already holds another keyframe, or the row went stale after the timeline changed under it — changes nothing, and the `refresh()`
   alone restores the field from what the clip holds.
6. Delete calls `removeKeyframe` with the same `false` handling and otherwise `refresh()` plus `onEdited()`; the track it empties stays, so the
   list goes empty while the channel keeps its interpolation.
7. Add reads the authoring value from project truth at the playhead — the active object's `transform.position`/`quaternion`/`scale` components — builds a fresh `number[]` of the channel length (3, or 4 for `quaternion`), and calls
   `addKeyframe(project.timeline, target, channel, timeMs, value)` with `timeMs = playback.time * 1000` — unrounded, so the key lands at the time the
   playhead is actually at — because the playhead is the
   clip's seconds and the authoring time is milliseconds. The `position` channel is read through
   `project.keyframePosition(target, transform.position)` — whole cells for an object that aligns, a copy for an
   unaligned one — so an aligned object's keyframes land on the lattice even while its live placement is a sampled one; that is
   `document/project.ts`'s rule, and the camera has no case in it any more because the widget never asks about one. On `ok` it calls `refresh()`
   then `onEdited()`; on `bad-value-length` it writes that literal into the panel's own message line and changes nothing (defensive — the length is
   correct by construction). The button is enabled exactly while a target and a channel resolve, not while a track exists: a channel's first
   keyframe is what creates its track, so requiring one would make the first key impossible to add.
8. The interpolation select calls `setInterpolation(project.timeline, target, channel, mode)` and calls `onEdited()` on `true`, so the rebuilt
   clip picks up the new mode; it is disabled while the channel has no track.
9. The duration field hands the value to `context.setDuration(durationMs)` and then `refresh()`es — it calls no mutator itself and no
   `onEdited()`, because the app's write is the one place the clip's length and the camera's coverage move together, and it rebuilds what reads
   the clip. Its own `min` is `maxKeyframeTime(timeline)`, the floor that keeps the field from offering a length that would cut the clip
   short, and a non-finite entry only refreshes. The fps field writes `project.timeline.fps` for a finite positive number and refreshes
   otherwise; `fps` is the frame grid the HUD readout and the export defaults use, and it no longer positions anything on the scrub bar.
10. Transport: the toggle's click calls `context.onTransport()` and nothing else — the app owns the transport, because a run of the clip changes the
    viewport too, so the widget reports the press rather than performing it — and the `loop` checkbox calls `playback.setLoop(checked)`.
    The widget reads `playback.playing` back only for the label (step 12). There is no `stop`, because returning to the start is what the scrub bar
    and the exact-time field are for.
11. The scrub bar's `input` event and the exact-time field's `change` event both call `context.onScrub(Number(value))` in milliseconds; the panel
    neither seeks nor starts playback itself.
12. `setTime(timeMs)` moves the playhead display only: no `onScrub`, no playback state. It rounds and clamps the value into
    `[0, timeline.durationMs]` and writes the scrub position, the readout as `<n> ms`, the exact-time field — except while that field is the
    focused element — and the play toggle's label from `playback.playing`. The render loop is what calls it every frame, so a press is not the
    only thing that starts or stops playback and the label has to be re-derived rather than set on click.
13. `setVisible(visible)` writes `this.root.hidden = !visible` and nothing else: the host is the bar, so showing or hiding it is the whole of the
    widget's visibility, and the panel keeps no flag of its own. Only the host is hidden: the contents stay built and the render loop goes on
    calling `setTime`, so a bar that comes back shows the current playhead and whatever the channel held.
14. `refresh()` rebuilds rows — the object rows and the camera rows both — the marker positions, the duration field's `min`, the scrub's `max`, and the enabled/disabled state from the timeline and the take,
    and is the only code that reads either for display. It ends by calling `setTime(playback.time * 1000)`, which snaps to whole milliseconds for display alone, so a rebuild
    re-reads the playhead instead of moving it.
15. The camera rows are the one part of the widget that reads a take. Each row is a `key` button that seeks to the key through `onScrub(key.timeMs)`, a `time (ms)` field that retimes it, a `delete` button, and a dim `p=[…]` label built with `fmt` from the key's own position. The field's `min`/`max` are the *segment's* range, not the clip's, because a key outside its own shot could never be read; `delete` is disabled while the segment holds one key, which is the model's own refusal of the last one. When the take holds more than one segment the label is prefixed with the segment's name, because that is what bounds the row's time and nothing else on this bar says which shot a key belongs to. The rows come from `activeTake(project.camera)`, in segment order and then key order, and the heading line names that take — so a key switch, a cut, a copy, or a deletion moves the whole block with it. `writeCameraKeyTime` hands a finite time to `context.moveCameraKey` and `deleteCameraKey` hands the ids to `context.removeCameraKey`; both then `refresh()`, and neither calls `onEdited()`, because the camera is no track and no clip changes — a refused move changes nothing and the rebuild puts the field back to what the take holds. A camera write made anywhere else — a carrier drag, `Camera -> View`, a typed pose, `Cut here`, a take switch, copy, or deletion, a retimed clip length — reaches these rows through the app's own `refreshShotViews`, which refreshes this panel with the frame, the path and the `Camera` group, so the block is a view of the take and not a copy of it.

## Invariants
- The panel never calls `playback.setTime`, `playback.rebuild`, or `playback.advance`, never calls `play` or `pause`, and never holds an
  `AnimationMixer`: its `playback` uses are `setLoop` plus the read-only `time` and `playing` reads. The transport press is reported to the app through
  `onTransport`, because a run of the clip changes the viewport too.
- Its only direct project writes are through `document/timeline.ts` mutators plus `timeline.fps`; object and voxel data are untouched. The camera
  is written only by the app: this file reads a take (`activeTake`) and reports a retime or a removal through `moveCameraKey`/`removeCameraKey`, and
  the app's own `moveKey`/`removeKey` are what reach the document.
- Every camera key of the active take is rendered exactly once as a row and once as a marker, in segment order then key order, and a row addresses
  its key by `(takeId, segmentId, keyId)` — never by its place in a list that a retime re-sorts. The block does not depend on the target or channel
  selects, and it is never empty: a take always holds a segment and a segment always holds a key, so the camera's own state is on screen whatever
  the rest of the bar is showing.
- Every keyframe mutation that returned `true` is followed by exactly one `onEdited()` call, so the app rebuilds the clip once per user action;
  a refused one — add's `bad-value-length`, a `false` from move or remove, interpolation with no track — reports or refreshes and never calls it.
  The duration is the one write that goes the other way: the widget hands it to `context.setDuration` and calls no `onEdited()`, because the app's
  own write rebuilds the clip and moves the camera's coverage with it.
- After any add, retime, or delete, keyframes are strictly ascending in `timeMs` with one keyframe per millisecond, a `value.length` matching the
  channel, and every time inside `[0, timeline.durationMs]`, because the model clamps what this file hands it.
- The widget never converts units: every time it reads, displays, or hands over is milliseconds, and `onScrub`'s contract is milliseconds; the
  clip's seconds begin at the app.
- `setTime` clamps into `[0, timeline.durationMs]`, does not fire `onScrub`, does not change `playback` state, and renders identically when called
  twice with the same value; the only project value it reads is `timeline.durationMs`.
- `setVisible` writes the host's `hidden` attribute and nothing else: the panel never reads the app's flag, never keeps one, and `refresh()` never
  touches visibility, so the bar can only change state through the app's `setTimelineVisible`, which is the one writer of that flag.
- A keyframe authored here stores whole cells for the `position` channel of an aligned object, and the mixer's interpolation between those cells is
  untouched: the value is snapped once, as it is read from project truth, and no other channel this file writes is rounded.
- The keyframe list is capped and scrolls: its height never follows the number of rows, so the bar keeps a fixed height whatever the track holds and
  everything above the list stays where it was as keyframes are added — a track of any length scrolls inside the 100 px cap instead of pushing the
  viewport off screen. The camera key list is capped and scrolled the same way, so a take of many keys cannot grow the bar either. The cap is on each
  list alone; the message line below them is not part of either.

## Errors
`addKeyframe`'s `{ ok: false, error: 'bad-value-length' }` is shown verbatim in the panel's own message line, since `TimelineContext` carries no
`reportError`. The boolean `false` from `moveKeyframe`, `removeKeyframe`, and `setInterpolation` is an ordinary outcome and produces a
`refresh()` instead of a message: for a move it means either the millisecond belongs to another keyframe or the row went stale, and the rebuild
puts the field back to what the clip holds. A camera row has the same shape of outcome without a boolean: a non-finite entry never reaches the app,
and a retime or a removal the model refuses — the millisecond already holds another key, the segment holds one key, the row went stale — changes
nothing, so the `refresh()` that always follows is the whole report and the field comes back showing what the take holds. A duration that is not finite, and an fps that is not finite and positive, reflect from their own
`refresh()` instead of reaching the app — the model's `setDuration` would throw on the first, and a non-positive `fps` is no frame grid at all. Showing and
hiding the bar has no failure path at all — `setVisible` writes the host's attribute and returns — and nothing here throws and no failure is
silently dropped.

## Dependencies
- `./dom.js` — `el`, `fmt` for construction and the time and keyframe-value readouts.
- `../document/timeline.js` — the mutators (`addKeyframe`, `moveKeyframe`, `removeKeyframe`, `setInterpolation`) and the lookups
  (`findTrack`, `maxKeyframeTime`), plus the `TrackTarget`, `TrackChannel`, `Interpolation` types; that file owns the data, the ordering rules,
  and the clamp, so the panel owns none of that logic. `setDuration` is imported alongside them but the length no longer goes through it — the
  app's `setDuration` is the writer.
- `../document/project.js` — `Project` for `timeline`, object transforms, `camera` (the take the camera rows read), and `keyframePosition`, the one rule a `position` keyframe is
  read through (ring 1).
- `../document/camera.js` — `activeTake` for the take the camera rows come from, plus the `CameraKey` and `CameraSegment` types of the rows' inputs
  (ring 1). The two mutators `moveKey`/`removeKey` are deliberately *not* imported here: the widget reports the edit and the app performs it, because a
  key that moved changes the shot the playhead resolves and the app is what re-reads the frame, the path, and the `Camera` group with it.
- `../animation/playback.js` — `Playback` for the loop setting, the playhead read, and the `playing` flag the toggle's label follows (ring 1); the
  transport itself is the app's, through `onTransport`.
- `../editor/session.js` — `EditorSession` for the active object that keys the object tracks (ring 3).
- No outer-ring import and no `three` import of its own: keyframe values are read as plain numbers from the `Vector3`/`Quaternion` components the
  project already holds.

## Tests
None. The widget needs a DOM, and the mutators it calls are pinned by `tests/timeline.test.ts` (insertion order, id-addressed moves and removals,
the clamp on authored times, `setDuration`'s collapse, `maxKeyframeTime`, and the emptied track that stays), while `moveKey` and `removeKey` — the
camera rows' two writes — are pinned by `tests/camera.test.ts` (a collision and a stale id refused, the last key of a segment refused, the segment
re-sorted). Panel behavior is verified by running
the app: add, retime, seek to, and delete keyframes while watching the preview, and confirm a retime onto an occupied millisecond is refused and
the field comes back; a track with enough keyframes must scroll inside the capped list rather than growing the bar. The camera block is on the same
run: with a take holding one key the list shows that one row with its `delete` disabled, aiming the shot at a second time adds a second row and a
second marker, pressing a row's `key` must seek the playhead to that key's millisecond, typing a new time must retime it and re-sort the list,
`delete` must remove the row and disable itself once one key is left, and a second marker for the same millisecond as an object keyframe must stay
distinguishable from it. A `Cut here` must add a row and prefix the labels with the segment names, and `Copy take` must move the whole block onto the
copy. The transport walk is on the same run: pressing play must start a run that takes the viewport with it and pressing it again must pause and hand the frame over, with the toggle's label following `playback.playing` in both cases.
