# src/export/encode.ts

Ring: 3 · Layer: export · Depends on: mp4-muxer (library), WebCodecs (platform) — no module of ours

## Responsibility
The encoder and muxer half of the export: pick a codec the browser actually supports, then turn a stream of `ImageBitmap` frames into one MP4 blob. It knows nothing about the project, the scene, or the timeline — `FrameSink` is the only thing the render side sees (README D7). Capture orchestration lives in `export/job.ts`.

## Public interface
```ts
type FrameSink = { push(frame: ImageBitmap, index: number): void };
type CodecChoice = { codec: string; muxerCodec: 'avc' | 'hevc' | 'av1' | 'vp9'; label: string };
function selectCodec(width: number, height: number, fps: number): Promise<CodecChoice | undefined>;
class Mp4Writer implements FrameSink {
  constructor(choice: CodecChoice, opts: { width: number; height: number; fps: number; bitrate?: number });
  push(frame: ImageBitmap, index: number): void;       // encodes and muxes, closes the frame
  finish(): Promise<{ ok: true; blob: Blob; codec: string } |
    { ok: false; error: 'encoder-failed' | 'not-finalized'; detail: string }>;
  cancel(): void;
}
```
`FinishResult` names that `finish()` union but stays module-private: the module exports exactly `FrameSink`, `CodecChoice`, `selectCodec`, and `Mp4Writer`, so the name is declared once and used only by the cached-result field and the settle helper.

## Internal logic
1. `selectCodec` probes the candidate table below in that fixed preference order (README D7), returning the first entry the platform accepts **for the requested size**. For each it builds `{ codec, width, height, framerate: fps, bitrate, latencyMode: 'quality' }` — bitrate derived from the pixel rate and clamped unless the caller fixed it — and awaits `VideoEncoder.isConfigSupported(config)`. A `supported: false` answer, a rejection, or a throw moves on to the next candidate; nothing else is ever tried. Every entry is profile/level qualified, because Chromium answers `isConfigSupported` **false** for the bare `avc1`/`av01`/`vp09` strings the brief listed, which would fail every export with `'no-codec'`.

   | candidate | profile / level | probed when |
   | --- | --- | --- |
   | `avc1.42001f` | H.264 baseline 3.1 | `width * height <= 1280 * 720` only — baseline's level caps at 720p, so above that it is skipped, not probed and rejected |
   | `avc1.4d0028` | H.264 main 4.0 | any size |
   | `avc1.640028` | H.264 high 4.0 | any size |
   | `av01.0.04M.08` | AV1 main, level 4.0 | any size |
   | `vp09.00.40.08` | VP9 profile 0, level 4.0 | any size |

   The measurements that fixed this order (Chromium, `isConfigSupported` at the same bitrate rule): all three bare strings false at 960x540, 1280x720 and 1920x1080; `avc1.42001f` true at 960x540 and 1280x720 but false at 1920x1080; `avc1.4d0028`, `avc1.640028`, `av01.0.04M.08` and `vp09.00.40.08` true at all three. The 720p boundary is therefore what chooses between baseline and the level-4.0 entries at a given resolution, and it is the only size-dependent rule in the table.
2. The first supported candidate becomes the choice. The container codec is mapped from the probe string's **prefix and nothing else** — `avc1.` → `'avc'`, `av01.` → `'av1'`, `vp09.` → `'vp9'` — so the table cannot disagree with the muxer, and an unrecognized prefix is a `RangeError` (a bug in the table) rather than a silently wrong container. The mapping runs before the probe, so a bare string can never reach `mp4-muxer` as an unknown container codec. `label` is the exact probed string (`'avc1.4d0028'`), so a reported codec names the profile and level that were actually used. If no candidate works — or `VideoEncoder` itself is absent — the result is `undefined` and the caller reports `'no-codec'`; nothing is substituted silently. A browser without a software H.264 encoder legitimately lands on AV1-in-MP4, but only through this order, never by renaming a fallback.
3. Construction creates `new Muxer({ target: new ArrayBufferTarget(), video: { codec: choice.muxerCodec, width, height }, fastStart: 'in-memory' })` and `new VideoEncoder({ output, error })`, where `output(chunk, meta)` forwards to `muxer.addVideoChunk(chunk, meta)` and re-enters the drain (step 5), and `error(e)` records the platform failure and marks the writer failed.
4. `push(frame, index)` appends `{ frame, index }` to an internal FIFO and calls `drain()`. It never blocks, never drops a frame, and never reorders: the FIFO keeps encoder input order equal to frame order. `push` after `finish()`, after `cancel()`, or after an encoder failure is a no-op that still closes its argument, because a cancel can race the loop's last frame. The flag that closes the writer to pushes is deliberately separate from the drain: it gates `push` only, so `finish()` can refuse new frames and still encode every frame already in the FIFO. A drain that stopped at `finish()` too would leave `finish()` waiting on a FIFO nothing could empty, which is a deadlock rather than backpressure.
5. `drain()` encodes while the FIFO is non-empty and the encoder accepts work (`encodeQueueSize < MAX_QUEUE = 8`): per entry it creates `new VideoFrame(frame, { timestamp: Math.round(index * 1e6 / fps), duration: Math.round(1e6 / fps) })`, calls `encoder.encode(videoFrame, { keyFrame: index % keyFrameInterval === 0 })`, and closes the entry's `ImageBitmap` in a `finally`. The drain is re-entered from the encoder's `output` callback, so it resumes as the queue empties — that is the whole backpressure story, and it keeps the FIFO bounded in practice to what one `job.ts` frame produces.
6. Timestamps derive from `index / fps` alone, never from wall-clock time and never from the previous frame: the presentation time of frame `i` is exactly `i / fps` seconds, so the MP4 duration equals `frames / fps` and matches the timeline exactly.
7. `finish()` waits for the FIFO to empty, `await encoder.flush()`, `muxer.finalize()`, and returns `{ ok: true, blob: new Blob([target.buffer], { type: 'video/mp4' }), codec: choice.codec }`. The chosen codec string travels back with the file so the UI can report it (D7). It is terminal: a second call returns the same result without re-finalizing.
8. `cancel()` marks the writer cancelled, closes every bitmap still in the FIFO, `encoder.close()`, and discards the muxer and its target. It is idempotent and is the only way a partially encoded muxer is thrown away; `finish()` after `cancel()` never produces a blob. A `finish()` on a writer that never received a frame refuses with `'not-finalized'` and releases the encoder the same way, because there is no partial file to keep.

## Invariants
- Every `ImageBitmap` handed to `push` is closed exactly once, on every path including cancel and encoder failure.
- Chunks reach `mp4-muxer` in push order, one per pushed frame, with `timestamp === round(index * 1e6 / fps)` and duration `round(1e6 / fps)`, so the file's duration is exactly `frames / fps`.
- `selectCodec` returns either a choice whose config passed `isConfigSupported` or `undefined`; never a codec outside the `avc1.`/`av01.`/`vp09.` families, and it does not throw for an unsupported environment.
- An export never probes a bare codec string: every candidate is profile/level qualified, `avc1.42001f` is only offered at or below 1280x720, and the returned `codec` and `label` are the exact string that was probed, so the reported codec names the profile and level actually used.
- The writer holds no reference to the project, scene, capture, or DOM: it takes bitmaps and produces an MP4, which is what keeps `FrameSink` the only seam between rendering and encoding.
- `finish()` is terminal and idempotent; a failure result carries no `Blob` and caches none.
- The encoder queue is bounded: `push` never grows it past `MAX_QUEUE` without the drain path having been given a chance to run.

## Errors
- `{ ok: false, error: 'encoder-failed', detail }` — the encoder's `error` callback fired or `flush()` rejected; the platform's message is passed through and the muxer is discarded.
- `{ ok: false, error: 'not-finalized', detail }` — `finish()` on a writer that was cancelled or never received a frame. No blob is produced.
- `selectCodec` reports failure by returning `undefined` (spelled `'no-codec'` by `job.ts`): never by throwing, never by silently choosing a weaker codec.
- Programmer errors throw: `new VideoFrame` on a closed/detached bitmap throws `InvalidStateError`, a candidate whose prefix is not `avc1.`/`av01.`/`vp09.` throws `RangeError` from the prefix mapping, and a `CodecChoice` with an unknown `muxerCodec` is refused by `mp4-muxer`.

## Dependencies
- `mp4-muxer` — `Muxer`, `ArrayBufferTarget`: the MP4 container.
- WebCodecs `VideoEncoder`/`VideoFrame` and `Blob` — the platform. `selectCodec` returning `undefined` when `VideoEncoder` is missing is why the probe is never assumed to succeed.
No relative import: this file depends on no module of ours, which is exactly what makes the encoder replaceable behind `FrameSink` (README D7).

## Tests
No `tests/*.test.ts` covers this module: the node test environment has no WebCodecs, and the demo slice verifies export by running the application and inspecting the produced MP4 (README section 10). The observable checks are that the export reports the codec it chose, that the file plays, and that its duration equals `frames / fps`. The timestamp mapping is a pure function of index and fps, so it is the one part that could be pinned in a node test if the writer is ever refactored.

## Open questions
- ~~The brief fixes the candidate list as the bare strings `avc1`, `av01`, `vp09`. Some browsers only answer `isConfigSupported` true for a profile-qualified H.264 string (`avc1.PPCCLL`); whether to try such a candidate before dropping to AV1 is undecided.~~ **Resolved.** The bare strings were wrong: measured in Chromium, all three answer `isConfigSupported` false at 960x540, 1280x720 and 1920x1080, so the first runnable slice failed every export with `'no-codec'`. The candidate table is now qualified and size-aware, with `avc1.42001f` limited to at most 1280x720 and the level-4.0 entries covering the rest (see step 1). If the brief is revised, its candidate list should carry these strings.
- The brief lists `'encoder-failed'` and `'not-finalized'` without fixing which applies after `cancel()`; this contract uses `'not-finalized'`.
