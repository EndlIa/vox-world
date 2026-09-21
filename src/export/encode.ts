import { ArrayBufferTarget, Muxer } from 'mp4-muxer';

/** The renderer-to-encoder seam (README D7): the export loop sees nothing else of this file. */
export type FrameSink = { push(frame: ImageBitmap, index: number): void };

export type CodecChoice = { codec: string; muxerCodec: 'avc' | 'hevc' | 'av1' | 'vp9'; label: string };

type FinishResult =
  | { ok: true; blob: Blob; codec: string }
  | { ok: false; error: 'encoder-failed' | 'not-finalized'; detail: string };

/** Baseline 3.1's level caps at 720p, so it is only probed at or below that pixel count. */
const BASELINE_3_1_MAX_PIXELS = 1280 * 720;

/**
 * Probed in this fixed preference order (README D7); the first candidate the platform accepts for
 * the requested size wins. Every entry is a profile/level qualified string: Chromium answers
 * `isConfigSupported` false for a bare `avc1`/`av01`/`vp09`, so a bare entry would disable export
 * outright. `avc1.42001f` is baseline 3.1 and is skipped above 720p, where its level cannot carry
 * the frame; main 4.0 and high 4.0 cover the rest, then AV1, then VP9.
 */
const CODEC_CANDIDATES: ReadonlyArray<{ codec: string; maxPixels?: number }> = [
  { codec: 'avc1.42001f', maxPixels: BASELINE_3_1_MAX_PIXELS },
  { codec: 'avc1.4d0028' },
  { codec: 'avc1.640028' },
  { codec: 'av01.0.04M.08' },
  { codec: 'vp09.00.40.08' },
];

/** The container codec a probed string belongs to, decided by its prefix and nothing else. */
function muxerCodecFor(codec: string): CodecChoice['muxerCodec'] {
  if (codec.startsWith('avc1.')) return 'avc';
  if (codec.startsWith('av01.')) return 'av1';
  if (codec.startsWith('vp09.')) return 'vp9';
  throw new RangeError(`unknown video codec string: ${codec}`);
}

/** Rough bits per pixel per second, clamped, so a bitrate follows from the requested frame size. */
const BITS_PER_PIXEL = 0.1;
const MIN_BITRATE = 1_000_000;
const MAX_BITRATE = 40_000_000;
/** Encoder input may sit this far ahead of the encoder before the drain stops feeding it. */
const MAX_QUEUE = 8;
const KEY_FRAME_INTERVAL = 30;

function bitrateFor(width: number, height: number, fps: number): number {
  const raw = width * height * fps * BITS_PER_PIXEL;
  return Math.round(Math.min(MAX_BITRATE, Math.max(MIN_BITRATE, raw)));
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Picks the first codec the platform actually supports for this frame size, walking the preference
 * order above. A missing `VideoEncoder`, a config rejected at this resolution, a `supported: false`
 * answer, or a rejection moves on to the next candidate; nothing else is ever tried, and `undefined`
 * is the only failure this returns — the caller reports `'no-codec'` rather than being handed a
 * silently substituted codec. The returned `label` is the exact probed string, so the export can
 * report which profile was used.
 */
export async function selectCodec(width: number, height: number, fps: number): Promise<CodecChoice | undefined> {
  if (typeof VideoEncoder === 'undefined') return undefined;
  const bitrate = bitrateFor(width, height, fps);
  const pixels = width * height;
  for (const candidate of CODEC_CANDIDATES) {
    const maxPixels = candidate.maxPixels;
    if (maxPixels !== undefined && pixels > maxPixels) continue;
    const config: VideoEncoderConfig = {
      codec: candidate.codec,
      width,
      height,
      framerate: fps,
      bitrate,
      latencyMode: 'quality',
    };
    // Mapped before the probe, so a bare string in the table is a bug that surfaces here rather
    // than at the muxer as an unknown container codec.
    const muxerCodec = muxerCodecFor(candidate.codec);
    try {
      const support = await VideoEncoder.isConfigSupported(config);
      if (support.supported === true) {
        return { codec: candidate.codec, muxerCodec, label: candidate.codec };
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

/**
 * Turns a stream of `ImageBitmap` frames into one MP4 blob. Timestamps derive from `index / fps`
 * alone, so the file's duration is exactly `frames / fps`; every bitmap handed to `push` is closed
 * exactly once, on every path including `cancel` and an encoder failure.
 */
export class Mp4Writer implements FrameSink {
  private readonly choice: CodecChoice;
  private readonly fps: number;
  private readonly encoder: VideoEncoder;
  private muxer: Muxer<ArrayBufferTarget> | null;
  private target: ArrayBufferTarget | null;
  private readonly queue: Array<{ frame: ImageBitmap; index: number }> = [];
  private waiters: Array<() => void> = [];
  private failure: string | null = null;
  private cancelled = false;
  /** True once `finish`, `cancel`, or a failure closed the writer to new frames. */
  private closed = false;
  private pushed = 0;
  private finished: FinishResult | null = null;

  constructor(choice: CodecChoice, opts: { width: number; height: number; fps: number; bitrate?: number }) {
    this.choice = choice;
    this.fps = opts.fps;
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
      target,
      video: { codec: choice.muxerCodec, width: opts.width, height: opts.height },
      fastStart: 'in-memory',
    });
    this.target = target;
    this.muxer = muxer;
    this.encoder = new VideoEncoder({
      output: (chunk, meta) => {
        try {
          muxer.addVideoChunk(chunk, meta);
        } catch (cause) {
          this.fail(cause);
        }
        this.drain();
      },
      error: (error: DOMException) => {
        this.fail(error);
      },
    });
    this.encoder.configure({
      codec: choice.codec,
      width: opts.width,
      height: opts.height,
      framerate: opts.fps,
      bitrate: opts.bitrate ?? bitrateFor(opts.width, opts.height, opts.fps),
      latencyMode: 'quality',
    });
  }

  /** Never blocks and never reorders; a push into a closed writer only closes its frame. */
  push(frame: ImageBitmap, index: number): void {
    if (this.closed) {
      frame.close();
      return;
    }
    this.queue.push({ frame, index });
    this.pushed += 1;
    this.drain();
  }

  /**
   * Flushes the remaining frames, finalizes the muxer, and returns the file with the codec string
   * the caller must report. Terminal and idempotent: the second call returns the same result.
   */
  async finish(): Promise<FinishResult> {
    const cached = this.finished;
    if (cached !== null) return cached;
    this.closed = true;
    const muxer = this.muxer;
    const target = this.target;
    const failed = this.failure;
    if (failed !== null) return this.settle({ ok: false, error: 'encoder-failed', detail: failed });
    if (this.cancelled || muxer === null || target === null) {
      return this.settle({ ok: false, error: 'not-finalized', detail: 'the writer was cancelled' });
    }
    if (this.pushed === 0) {
      this.discard();
      return this.settle({ ok: false, error: 'not-finalized', detail: 'the writer never received a frame' });
    }
    try {
      await this.awaitQueue();
      if (this.cancelled) {
        return this.settle({ ok: false, error: 'not-finalized', detail: 'the writer was cancelled' });
      }
      const pendingFailure = this.failure;
      if (pendingFailure !== null) return this.settle({ ok: false, error: 'encoder-failed', detail: pendingFailure });
      await this.encoder.flush();
      muxer.finalize();
      const blob = new Blob([target.buffer], { type: 'video/mp4' });
      return this.settle({ ok: true, blob, codec: this.choice.codec });
    } catch (cause) {
      return this.settle({ ok: false, error: 'encoder-failed', detail: describeCause(cause) });
    }
  }

  /** Marks the writer cancelled, closes every queued frame, and discards the partial muxer. */
  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.discard();
  }

  private settle(result: FinishResult): FinishResult {
    if (this.finished !== null) return this.finished;
    this.finished = result;
    return result;
  }

  /** Drops the encoder, the FIFO, and the muxer: the only way a partial file is thrown away. */
  private discard(): void {
    this.closed = true;
    this.closeQueue();
    this.wakeWaiters();
    this.muxer = null;
    this.target = null;
    try {
      this.encoder.close();
    } catch {
      // The encoder was already closed by the failing path that got here.
    }
  }

  /** Feeds the encoder while the FIFO has entries and it accepts more, re-entered by `output`. */
  private drain(): void {
    while (this.queue.length > 0 && this.encoder.encodeQueueSize < MAX_QUEUE && !this.cancelled && this.failure === null) {
      const entry = this.queue.shift();
      if (entry === undefined) break;
      this.encodeEntry(entry);
    }
    if (this.queue.length === 0) this.wakeWaiters();
  }

  private encodeEntry(entry: { frame: ImageBitmap; index: number }): void {
    const timestamp = Math.round((entry.index * 1e6) / this.fps);
    const duration = Math.round(1e6 / this.fps);
    let videoFrame: VideoFrame | null = null;
    try {
      videoFrame = new VideoFrame(entry.frame, { timestamp, duration });
      this.encoder.encode(videoFrame, { keyFrame: entry.index % KEY_FRAME_INTERVAL === 0 });
    } catch (cause) {
      this.fail(cause);
    } finally {
      if (videoFrame !== null) videoFrame.close();
      entry.frame.close();
    }
  }

  private awaitQueue(): Promise<void> {
    if (this.queue.length === 0) return Promise.resolve();
    return new Promise<void>((wake) => {
      this.waiters.push(wake);
    });
  }

  private wakeWaiters(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const wake of waiters) wake();
  }

  private closeQueue(): void {
    while (this.queue.length > 0) {
      const entry = this.queue.shift();
      if (entry === undefined) break;
      entry.frame.close();
    }
  }

  private fail(cause: unknown): void {
    if (this.failure === null) this.failure = describeCause(cause);
    this.discard();
  }
}
