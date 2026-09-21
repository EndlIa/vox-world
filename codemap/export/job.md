# src/export/job.ts

Ring: 3 · Layer: export · Depends on: document/project.ts, animation/playback.ts, three-runtime/scene.ts, three-runtime/capture.ts, export/encode.ts, three

## Responsibility
The export frame loop: walk the requested timeline range at frame rate, sample it frame-exactly, render each frame at export resolution, and feed the encoder. It reports progress, honours cancellation, and never mutates the project — an export cannot corrupt authored data. It is not the encoder (`export/encode.ts`) and not a UI job wrapper.

## Public interface
```ts
import type { Project } from '../document/project.js';
import type { Playback } from '../animation/playback.js';
import type { SceneMirror } from '../three-runtime/scene.js';
import type { Capture } from '../three-runtime/capture.js';
import type * as THREE from 'three';

type ExportRequest = {
  project: Project; scene: THREE.Scene; capture: Capture; playback: Playback;
  output: { width: number; height: number; fps: number; from: number; to: number; mode: 'beauty' | 'mask' };
};
type ExportProgress = { frame: number; total: number };
type ExportResult = { ok: true; blob: Blob; codec: string; frames: number } |
  { ok: false; error: 'cancelled' | 'no-codec' | 'encoder-failed' | 'not-finalized' | 'no-frames'; detail: string };
class ExportJob {
  constructor(opts: { mirror: SceneMirror });
  run(request: ExportRequest, onProgress: (p: ExportProgress) => void, signal?: AbortSignal): Promise<ExportResult>;
}
```

## Internal logic
1. Validate and clamp first: `end = Math.min(to, playback.duration)` (the job owns this clamping, so the dialog can pass any `to`), then `total = Math.round((end - from) * fps) + 1`, so `from..end` includes both endpoints. A legal but empty range (`end < from`) returns `'no-frames'` before any encoder exists; non-finite `from`/`to`/`fps` or `fps <= 0` throw (see Errors). The clamped `total` is the frame count reported in a successful result.
2. Codec: `const choice = await selectCodec(width, height, fps)`; `undefined` returns `'no-codec'` with a detail naming the three probed codecs. The codec is reported, never substituted (README D7), and the return happens before a writer exists, so no partial muxer can exist either.
3. Prepare: `mirror.sync()` once so objects marked dirty before the export render their current document state; `new Mp4Writer(choice, { width, height, fps })`; and `mirror.setMaskMode(true)` when `mode === 'mask'` — the mask pass is the mirror's per-object `maskColor` material switch, which `Capture` knows nothing about.
4. The loop is `for (let i = 0; i < total; i++)` with `t = from + i / fps` computed from the index rather than accumulated, so frame times carry no float drift:
   - abort check first: `signal?.aborted` leaves the loop and returns `'cancelled'` after the writer is cancelled;
   - `playback.setTime(t)` for frame-exact sampling — it clamps to `[0, timeline.duration]`, zeroes the mixer clock, updates once, and refreshes the camera projection itself, so the same `t` always produces the same frame and nothing is inherited from the viewport;
   - `capture.render(request.scene, mirror.camera)`: the render camera is the document camera, the same `PerspectiveCamera` instance `playback` drives with the camera track (README D17), never the viewport navigation camera — which is why exported framing equals authored framing;
   - `const frame = await capture.readFrame()`; a `{ ok: false }` result cancels the writer and returns `{ ok: false, error: 'encoder-failed', detail: 'capture: ' + detail }`;
   - `writer.push(frame.bitmap, i)` and then `onProgress({ frame: i + 1, total })`;
   - yield to the host once per frame with `await new Promise<void>(resolve => { setTimeout(resolve, 0) })`, a macrotask so the browser can paint the progress bar and deliver the cancel click between frames. The loop yields per frame rather than per `CHUNK` items (brief section 3) because the frame is the unit of observable progress and a cancel must land within one frame.
5. Finish: `const written = await writer.finish()`; failure is returned as `{ ok: false, error: written.error, detail: written.detail }` with the writer's literal unchanged; success returns `{ ok: true, blob: written.blob, codec: written.codec, frames: total }`.
6. Cleanup in a `finally` on every path: `writer.cancel()` when `finish()` was never reached (idempotent, closes any bitmap the sink still holds), `mirror.setMaskMode(false)` unconditionally — the job does not try to read what mask mode was before, because `SceneMirror` exposes no getter, so it always leaves the mirror unmasked — and `playback.setTime(restoreTime)` with the time found on entry. The job never calls `play`/`pause`/`stop`, so the transport state the user sees is untouched.
7. The loop never mutates the project: it reads `mirror.camera`, writes only mixer-driven `Object3D` transforms (derived render state), and calls `capture.render`, `capture.readFrame`, and `writer.push`. It calls no `editor/ops.ts` function, no `Project` mutator, and no container mutator, so `Project.objects`, the voxel containers, the timeline, and the camera settings are byte-identical after a successful, cancelled, or failed export.
8. `ExportJob` keeps only the `SceneMirror` between runs. `run` may be called again after it settles, but two overlapping runs on one job would fight over mask mode and each need their own writer, so `app` starts an export only when none is in flight.

## Invariants
- The project is unchanged by `run` on every exit path; only derived `Object3D` transforms and the mirror are touched.
- Exactly one `capture.readFrame()` and one `writer.push` per index, so the encoded frame count is `total` and the success result's `frames` is that clamped count; success carries a finalized blob plus the chosen codec string and failure carries no blob.
- `onProgress` is called once per frame with `frame = i + 1` and a constant `total`, in increasing order.
- `signal` is re-read before every frame, so cancellation is honoured within one frame.
- Frame times are exactly `from + i / fps` for `i` in `0..total-1` with `end = min(to, playback.duration)`, so the exported range covers the clamped span and never samples past the timeline.
- Mask mode is turned off unconditionally in the `finally` block on every path, including cancel and encoder failure, and `playback.time` is restored to its entry value.
- No failure path presents a partial file as success: only a finalized MP4 returns `ok: true`.

## Errors
- `'cancelled'` — `signal` aborted, checked before the first frame and before every subsequent one; the writer is cancelled and no file is offered.
- `'no-codec'` — `selectCodec` returned `undefined`; nothing is encoded and the user is told why (D7).
- `'encoder-failed'` — the writer's `'encoder-failed'`, or a `CaptureResult` failure, which is reported through this literal because `ExportResult` has no capture-specific one.
- `'not-finalized'` — `Mp4Writer.finish()`'s own literal, returned unchanged rather than collapsed into `'encoder-failed'`. It is the writer's answer for a cancelled writer or one that never received a frame, so the literal is in `ExportResult` even though the loop itself cannot reach it: one frame is pushed per index, so `push` always precedes `finish()`.
- `'no-frames'` — `end < from` after the clamp; returned before any encoder or render work.
- Programmer errors throw `RangeError`: non-finite `from`/`to`/`fps`, or `fps <= 0`. A non-positive `width`/`height` is likewise a caller bug and surfaces from `Capture` or the encoder config.

## Dependencies
- `../document/project.ts` — `Project`, carried by the request so one object identifies the timeline; the loop reads nothing mutable from it.
- `../animation/playback.ts` — `Playback`: `setTime` for frame-exact sampling and `time` for the restore.
- `../three-runtime/scene.ts` — `SceneMirror`: `camera` (the document camera), `sync`, `setMaskMode`.
- `../three-runtime/capture.ts` — `Capture`: `render` and `readFrame` at export resolution.
- `./encode.ts` — `selectCodec`, `Mp4Writer`, `FrameSink`: the encode seam (README D7); `three` — `Scene` for the render call.
Not imported: `editor/*`. That the export path cannot reach an edit operation is part of why an export cannot corrupt authored data.

## Tests
No `tests/*.test.ts` covers this module: it needs WebCodecs and a WebGL context, and the demo slice verifies export by running the application (README section 10). The checks are: export a range and compare the file duration against `frames / fps`, confirm the reported codec matches the choice, cancel mid-export and confirm no file is offered, and compare the project's objects and timeline before and after an export.

## Open questions
- `ExportResult` has no capture-specific literal, so a `Capture` failure is reported as `'encoder-failed'`; a dedicated literal would be more precise if the brief is revised.
