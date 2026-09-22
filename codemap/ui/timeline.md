# src/ui/timeline.ts

Ring: 4 · Layer: ui · Depends on: ./dom.js, ../document/timeline.js, ../document/project.js, ../animation/playback.js, ../editor/session.js

## Responsibility
The timeline widget: transport controls, scrub bar, keyframe markers, duration and frame-rate inputs, and add, move, and delete actions against
the active object and the output camera. It edits authoring data through the pure mutators of `document/timeline.ts` and never touches the mixer:
seeking is delegated to `onScrub` and clip rebuilds to `onEdited` (README D2). It renders nothing about voxels.

## Public interface
```ts
type TimelineContext = {
  project: Project; playback: Playback; session: EditorSession;
  onScrub(time: number): void;
  onEdited(): void;          // keyframes changed: rebuild the clip
};
class TimelinePanel {
  constructor(root: HTMLElement, context: TimelineContext);
  setTime(time: number): void;
  refresh(): void;
}
```

## Internal logic
1. The constructor builds one `<div>` under `root`: a transport row (play, pause, stop, loop toggle), a scrub `<input type="range">` with `min =
   0`, `max = timeline.duration`, `step = 1 / timeline.fps`, a time readout, duration and fps number inputs, a target switch (active object |
   camera), a channel select (`position` | `quaternion` | `scale`, plus `fov` when the target is the camera), an interpolation select (`step` |
   `linear` | `smooth`), add/move/delete buttons, and a keyframe list; it finishes with `refresh()`.
2. Target resolution: `{ kind: 'camera' }` when the switch is on the camera, otherwise `{ kind: 'object', objectId: session.activeObjectId }`;
   with no active object the rows are empty and Add is disabled.
3. Keyframe rows and the markers on the scrub bar both come from `findTrack(project.timeline, target, channel)?.keyframes ?? []`, rendered in
   array order with the index as their identity and markers placed at `time` seconds. `trackKey` is used as a lookup helper only and is never
   parsed.
4. Add reads the authoring value from project truth at the current time — the target's `transform.position`/`quaternion`/`scale` components, or
   `project.camera.transform` and `project.camera.fov` for the camera — builds a fresh `number[]` of the channel length (3, 4, or 1), and calls
   `addKeyframe(project.timeline, target, channel, time, value)`. The `position` channel is read through
   `project.keyframePosition(target, transform.position)` — whole cells for an object that aligns, a copy of the placement for the camera and for an
   unaligned object — so an aligned object's keyframes land on the lattice (README D42) even while its live placement is a sampled one; that is
   `document/project.ts`'s rule, which decides the camera case, so this file never branches on the target kind for it. On `ok` it calls `refresh()`
   then `onEdited()`; on `bad-value-length` it writes that literal into the panel's own message line and changes nothing (defensive — the length is
   correct by construction).
5. Move calls `moveKeyframe(project.timeline, target, channel, index, time)`, then `sortKeyframes(project.timeline)` because `moveKeyframe`
   re-sorts only the track it touched, then `refresh()` and `onEdited()`. A `false` (stale row) means the view is out of date: `refresh()` only.
6. Delete calls `removeKeyframe` with the same `false` handling and otherwise `refresh()` plus `onEdited()`.
7. The interpolation select calls `setInterpolation(project.timeline, target, channel, mode)` and calls `onEdited()` on `true`, so the rebuilt
   clip picks up the new mode.
8. The duration and fps inputs write `project.timeline.duration` and `project.timeline.fps` (plain data owned by `document/timeline.ts`), then
   `refresh()` and `onEdited()`; the scrub bar's `max` and `step` follow them, and `fps` is the frame grid the HUD readout and the export
   defaults use.
9. Transport calls `playback.play()`, `playback.pause()`, `playback.stop()`, and `playback.setLoop(checked)`; the readout and slider position are
   derived from `playback.time` and `playback.duration` on every `refresh()`.
10. The scrub bar's `input` event calls `context.onScrub(Number(slider.value))`; the panel neither seeks nor starts playback itself.
11. `setTime(time)` writes the slider position and the readout only. It does not call `onScrub` and does not touch `playback`, so the render loop
    can push the playhead into the widget every frame without re-entering the app's seek path and without starting playback.
12. `refresh()` rebuilds rows, marker positions, and the enabled/disabled state from the timeline, and is the only code that reads the timeline
    for display.

## Invariants
- The panel never calls `playback.setTime`, `playback.rebuild`, or `playback.advance` and never holds an `AnimationMixer`; its only `playback`
  uses are the four transport calls and the `time`/`duration` reads.
- Its only project writes are through `document/timeline.ts` mutators plus `timeline.duration` and `timeline.fps`; object, voxel, and camera data
  are untouched.
- Every keyframe mutation that returned `true` is followed by exactly one `onEdited()` call, so the app rebuilds the clip once per user action.
- After any add, move, or delete, keyframes are strictly ascending in `time` with one keyframe per time and a `value.length` matching the
  channel.
- `setTime` clamps into `[0, playback.duration]`, does not fire `onScrub`, does not change `playback` state, and renders identically when called
  twice with the same value.
- A keyframe authored here stores whole cells for the `position` channel of an aligned object, and the mixer's interpolation between those cells is
  untouched: the value is snapped once, as it is read from project truth, and no other channel this file writes is rounded.

## Errors
`addKeyframe`'s `{ ok: false, error: 'bad-value-length' }` is shown verbatim in the panel's own message line, since `TimelineContext` carries no
`reportError`. The boolean `false` from `moveKeyframe`, `removeKeyframe`, and `setInterpolation` is an ordinary stale-view outcome and produces a
`refresh()` instead of a message. Nothing here throws and no failure is silently dropped.

## Dependencies
- `./dom.js` — `el`, `on`, `fmt` for construction, listener detach, and the time/fps readout.
- `../document/timeline.js` — the mutators and the `TrackTarget`, `TrackChannel`, `Interpolation` types; that file owns the data and the ordering
  rules, so the panel owns none of that logic.
- `../document/project.js` — `Project` for `timeline`, `camera`, object transforms, and `keyframePosition`, the one rule a `position` keyframe is
  read through (ring 1).
- `../animation/playback.js` — `Playback` for transport and playhead display only (ring 1).
- `../editor/session.js` — `EditorSession` for the active object that keys the object tracks (ring 3).
- No outer-ring import and no `three` import of its own: keyframe values are read as plain numbers from the `Vector3`/`Quaternion` components the
  project already holds.

## Tests
None. The widget needs a DOM, and the mutators it calls are pinned by `tests/timeline.test.ts` (insertion order, value-length validation,
interpolation modes, `removeTracksFor`). Panel behavior is verified by running the app: add, move, and delete keyframes while watching the
preview.
