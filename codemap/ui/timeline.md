# src/ui/timeline.ts

Ring: 4 · Layer: ui · Depends on: ./dom.js, ../document/timeline.js, ../document/project.js, ../animation/playback.js, ../editor/session.js

## Responsibility
The timeline widget: one transport toggle, a scrub bar with its keyframe markers, the exact time, duration and frame-rate inputs, and a retime-in-place keyframe list with its add, seek, and delete actions against the active object and the output camera. It edits authoring data through the pure mutators of `document/timeline.ts` and never touches the mixer:
seeking is delegated to `onScrub` and clip rebuilds to `onEdited` (README D2), and the transport press to `onTransport`, because a run of the clip changes the viewport too (README D48). It renders nothing about voxels. Every time it reads, displays, or hands over is the authoring unit, whole milliseconds, so the widget never converts: `onScrub` takes milliseconds and the app divides by 1000 for the clip, whose times are seconds (README D45). Its host is the bar along
the bottom of the page, and that bar starts collapsed: whether it is on screen is the app's flag, and `setVisible` is the view of it, the way
`setTime` is the view of the playhead (README D44).

## Public interface
```ts
type TimelineContext = {
  project: Project; playback: Playback; session: EditorSession;
  onScrub(timeMs: number): void;   // seeks to an absolute millisecond time; the app converts it to the clip's seconds
  onEdited(): void;          // keyframes changed: rebuild the clip
  onTransport(): void;       // starts or pauses the run; the app owns the transport because a run moves the viewport (D48)
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
   (README D47) — and the panel's own message line; it finishes with `refresh()`.
2. Target resolution: `{ kind: 'camera' }` when the switch is on the camera, otherwise `{ kind: 'object', objectId: session.activeObjectId }`;
   the channel select is rebuilt for the target kind (`position` | `quaternion` | `scale`, plus `fov` for the camera) and the object option's
   text names the active object, or says `(none)`.
3. Keyframe rows and the scrub bar's markers both come from `findTrack(project.timeline, target, channel)?.keyframes ?? []`, rendered in
   array order, with a marker placed at `timeMs / durationMs` of the bar's width. Rows and markers are rebuilt on every `refresh()`, and each
   row addresses its keyframe by `id`, never by its place in the list. `trackKey` is used as a lookup helper only and is never parsed.
4. A row is a `key` button that seeks to that keyframe through `onScrub(keyframe.timeMs)`, a `time (ms)` number field (`min = 0`,
   `max = durationMs`, `step = 1`) that retimes it, a `delete` button, and a dim `v=[…]` value label built with `fmt`. There is no panel-level
   `move` or `delete` and no row selection: retiming a keyframe in its own row made a selection unnecessary (README D45).
5. Retiming calls `moveKeyframe(project.timeline, target, channel, id, timeMs)`, then `refresh()` and `onEdited()` on `true`. A `false` — the
   millisecond already holds another keyframe, or the row went stale after the timeline changed under it — changes nothing, and the `refresh()`
   alone restores the field from what the clip holds.
6. Delete calls `removeKeyframe` with the same `false` handling and otherwise `refresh()` plus `onEdited()`; the track it empties stays, so the
   list goes empty while the channel keeps its interpolation.
7. Add reads the authoring value from project truth at the playhead — the target's `transform.position`/`quaternion`/`scale` components, or
   `project.camera.transform` and `project.camera.fov` for the camera — builds a fresh `number[]` of the channel length (3, 4, or 1), and calls
   `addKeyframe(project.timeline, target, channel, timeMs, value)` with `timeMs = Math.round(playback.time * 1000)`, because the playhead is the
   clip's seconds and the authoring time is milliseconds. The `position` channel is read through
   `project.keyframePosition(target, transform.position)` — whole cells for an object that aligns, a copy of the placement for the camera and for an
   unaligned object — so an aligned object's keyframes land on the lattice (README D42) even while its live placement is a sampled one; that is
   `document/project.ts`'s rule, which decides the camera case, so this file never branches on the target kind for it. On `ok` it calls `refresh()`
   then `onEdited()`; on `bad-value-length` it writes that literal into the panel's own message line and changes nothing (defensive — the length is
   correct by construction). The button is enabled exactly while a target and a channel resolve, not while a track exists: a channel's first
   keyframe is what creates its track, so requiring one would make the first key impossible to add.
8. The interpolation select calls `setInterpolation(project.timeline, target, channel, mode)` and calls `onEdited()` on `true`, so the rebuilt
   clip picks up the new mode; it is disabled while the channel has no track.
9. The duration field calls `setDuration(project.timeline, durationMs)`, which clamps every keyframe onto the new length, then `refresh()` and
   `onEdited()`; its own `min` is `maxKeyframeTime(timeline)`, the floor that keeps the field from offering a length that would cut the clip
   short, and a non-finite entry only refreshes. The fps field writes `project.timeline.fps` for a finite positive number and refreshes
   otherwise; `fps` is the frame grid the HUD readout and the export defaults use, and it no longer positions anything on the scrub bar.
10. Transport: the toggle's click calls `context.onTransport()` and nothing else — the app owns the transport, because a run of the clip changes the
    viewport too, so the widget reports the press rather than performing it (README D48) — and the `loop` checkbox calls `playback.setLoop(checked)`.
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
14. `refresh()` rebuilds rows, marker positions, the duration field's `min`, the scrub's `max`, and the enabled/disabled state from the timeline,
    and is the only code that reads the timeline for display. It ends by calling `setTime(Math.round(playback.time * 1000))`, so a rebuild
    re-reads the playhead instead of moving it.

## Invariants
- The panel never calls `playback.setTime`, `playback.rebuild`, or `playback.advance`, never calls `play` or `pause`, and never holds an
  `AnimationMixer`: its `playback` uses are `setLoop` plus the read-only `time` and `playing` reads. The transport press is reported to the app through
  `onTransport`, because a run of the clip changes the viewport too (README D48).
- Its only project writes are through `document/timeline.ts` mutators plus `timeline.fps`; object, voxel, and camera data are untouched.
- Every keyframe mutation that returned `true` is followed by exactly one `onEdited()` call, so the app rebuilds the clip once per user action;
  a refused one — add's `bad-value-length`, a `false` from move or remove, interpolation with no track — reports or refreshes and never calls it.
- After any add, retime, or delete, keyframes are strictly ascending in `timeMs` with one keyframe per millisecond, a `value.length` matching the
  channel, and every time inside `[0, timeline.durationMs]`, because the model clamps what this file hands it.
- The widget never converts units: every time it reads, displays, or hands over is milliseconds, and `onScrub`'s contract is milliseconds; the
  clip's seconds begin at the app (README D45).
- `setTime` clamps into `[0, timeline.durationMs]`, does not fire `onScrub`, does not change `playback` state, and renders identically when called
  twice with the same value; the only project value it reads is `timeline.durationMs`.
- `setVisible` writes the host's `hidden` attribute and nothing else: the panel never reads the app's flag, never keeps one, and `refresh()` never
  touches visibility, so the bar can only change state through the app's `setTimelineVisible`, which is the one writer of that flag (README D44).
- A keyframe authored here stores whole cells for the `position` channel of an aligned object, and the mixer's interpolation between those cells is
  untouched: the value is snapped once, as it is read from project truth, and no other channel this file writes is rounded.
- The keyframe list is capped and scrolls: its height never follows the number of rows, so the bar keeps a fixed height whatever the track holds and
  everything above the list stays where it was as keyframes are added — a track of any length scrolls inside the 100 px cap instead of pushing the
  viewport off screen (README D47). The cap is on the list alone; the message line below it is not part of it.

## Errors
`addKeyframe`'s `{ ok: false, error: 'bad-value-length' }` is shown verbatim in the panel's own message line, since `TimelineContext` carries no
`reportError`. The boolean `false` from `moveKeyframe`, `removeKeyframe`, and `setInterpolation` is an ordinary outcome and produces a
`refresh()` instead of a message: for a move it means either the millisecond belongs to another keyframe or the row went stale, and the rebuild
puts the field back to what the clip holds. A duration that is not finite, and an fps that is not finite and positive, reflect from their own
`refresh()` instead of reaching the model — `setDuration` would throw on the first, and a non-positive `fps` is no frame grid at all. Showing and
hiding the bar has no failure path at all — `setVisible` writes the host's attribute and returns — and nothing here throws and no failure is
silently dropped.

## Dependencies
- `./dom.js` — `el`, `fmt` for construction and the time and keyframe-value readouts.
- `../document/timeline.js` — the mutators (`addKeyframe`, `moveKeyframe`, `removeKeyframe`, `setDuration`, `setInterpolation`) and the lookups
  (`findTrack`, `maxKeyframeTime`), plus the `TrackTarget`, `TrackChannel`, `Interpolation` types; that file owns the data, the ordering rules,
  and the clamp, so the panel owns none of that logic.
- `../document/project.js` — `Project` for `timeline`, `camera`, object transforms, and `keyframePosition`, the one rule a `position` keyframe is
  read through (ring 1).
- `../animation/playback.js` — `Playback` for the loop setting, the playhead read, and the `playing` flag the toggle's label follows (ring 1); the
  transport itself is the app's, through `onTransport` (README D48).
- `../editor/session.js` — `EditorSession` for the active object that keys the object tracks (ring 3).
- No outer-ring import and no `three` import of its own: keyframe values are read as plain numbers from the `Vector3`/`Quaternion` components the
  project already holds.

## Tests
None. The widget needs a DOM, and the mutators it calls are pinned by `tests/timeline.test.ts` (insertion order, id-addressed moves and removals,
the clamp on authored times, `setDuration`'s collapse, `maxKeyframeTime`, and the emptied track that stays). Panel behavior is verified by running
the app: add, retime, seek to, and delete keyframes while watching the preview, and confirm a retime onto an occupied millisecond is refused and
the field comes back; a track with enough keyframes must scroll inside the capped list rather than growing the bar (README D47). The transport walk is on the same run (README D48): pressing play must start a run that takes the viewport with it and pressing it again must pause and hand the frame over, with the toggle's label following `playback.playing` in both cases.
