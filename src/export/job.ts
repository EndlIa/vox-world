import type { Project } from '../document/project.js';
import type { Playback } from '../animation/playback.js';
import type { SceneMirror } from '../three-runtime/scene.js';
import type { Capture } from '../three-runtime/capture.js';
import { Mp4Writer, selectCodec } from './encode.js';
import type { FinishResult } from './encode.js';
import type * as THREE from 'three';

/**
 * How long the writer's teardown may take before the encoder is treated as unresponsive.
 *
 * The teardown waits for the encoder's own queue to drain and for its flush, and an encoder that has accepted frames
 * and stopped answering leaves that wait pending forever: measured here, an export then walks its whole range and
 * never returns, reports nothing, and holds the one job slot the app has — so the deadline turns a silent hang into a
 * reported failure (README D7, D38).
 */
const FINISH_DEADLINE_MS = 20_000;

export type ExportRequest = {
  project: Project;
  scene: THREE.Scene;
  capture: Capture;
  playback: Playback;
  output: { width: number; height: number; fps: number; from: number; to: number; mode: 'beauty' | 'mask' };
};

export type ExportResult =
  | { ok: true; blob: Blob; codec: string; frames: number }
  | { ok: false; error: 'cancelled' | 'no-codec' | 'encoder-failed' | 'not-finalized' | 'no-frames'; detail: string };

/**
 * Walks the requested timeline range at frame rate, samples it frame-exactly, renders each frame at
 * the requested resolution through the output camera, and feeds the encoder. It honours cancellation
 * and never mutates the project: an export cannot corrupt authored data.
 */
export class ExportJob {
  private readonly mirror: SceneMirror;

  constructor(opts: { mirror: SceneMirror }) {
    this.mirror = opts.mirror;
  }

  async run(
    request: ExportRequest,
    signal?: AbortSignal,
  ): Promise<ExportResult> {
    const { capture, playback, scene, output } = request;
    const { width, height, fps, from, to, mode } = output;
    const restoreTime = playback.time;
    if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(fps) || fps <= 0) {
      throw new RangeError(`invalid export range: from ${from}, to ${to}, fps ${fps}`);
    }
    const end = Math.min(to, playback.duration);
    if (end < from) {
      return { ok: false, error: 'no-frames', detail: `the range ${from}..${to} is empty once clamped to ${end}` };
    }
    const total = Math.round((end - from) * fps) + 1;
    const choice = await selectCodec(width, height, fps);
    if (choice === undefined) {
      return {
        ok: false,
        error: 'no-codec',
        detail: `no supported video encoder: tried the avc1, av01 and vp09 profiles at ${width}x${height}`,
      };
    }
    this.mirror.sync();
    const writer = new Mp4Writer(choice, { width, height, fps });
    let finished = false;
    try {
      if (mode === 'mask') this.mirror.setMaskMode(true);
      for (let i = 0; i < total; i++) {
        if (signal?.aborted === true) {
          return { ok: false, error: 'cancelled', detail: `render cancelled at frame ${i} of ${total}` };
        }
        playback.setTime(from + i / fps);
        capture.render(scene, this.mirror.camera);
        const frame = await capture.readFrame();
        if (!frame.ok) {
          return { ok: false, error: 'encoder-failed', detail: `capture: ${frame.detail}` };
        }
        writer.push(frame.bitmap, i);
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        });
      }
      const written = await this.finishWriter(writer, total);
      finished = true;
      if (!written.ok) return { ok: false, error: written.error, detail: written.detail };
      return { ok: true, blob: written.blob, codec: written.codec, frames: total };
    } finally {
      if (!finished) writer.cancel();
      this.mirror.setMaskMode(false);
      playback.setTime(restoreTime);
    }
  }

  /**
   * Takes the writer's teardown, but not for longer than `FINISH_DEADLINE_MS`.
   *
   * The teardown waits for the encoder's queue to drain and then for its flush, and an encoder that has accepted
   * frames and stopped answering leaves both pending for good: the export then walks its whole range, returns
   * nothing, and holds the app's one job slot. A deadline that expires cancels the writer — which closes its frames,
   * drops its muxer, and closes the encoder, so the wait inside resolves instead of staying pending — and reports the
   * failure with the number of frames the run reached (README D7, D38).
   */
  private async finishWriter(writer: Mp4Writer, frames: number): Promise<FinishResult> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<FinishResult>((resolve) => {
      timer = setTimeout(() => {
        writer.cancel();
        resolve({
          ok: false,
          error: 'encoder-failed',
          detail: `the encoder did not finish ${frames} frame(s) within ${Math.round(FINISH_DEADLINE_MS / 1000)} s`,
        });
      }, FINISH_DEADLINE_MS);
    });
    try {
      return await Promise.race([writer.finish(), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }
}
