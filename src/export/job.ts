import type { Project } from '../document/project.js';
import type { Playback } from '../animation/playback.js';
import type { SceneMirror } from '../three-runtime/scene.js';
import type { Capture } from '../three-runtime/capture.js';
import { Mp4Writer, selectCodec } from './encode.js';
import type * as THREE from 'three';

export type ExportRequest = {
  project: Project;
  scene: THREE.Scene;
  capture: Capture;
  playback: Playback;
  output: { width: number; height: number; fps: number; from: number; to: number; mode: 'beauty' | 'mask' };
};

export type ExportProgress = { frame: number; total: number };

export type ExportResult =
  | { ok: true; blob: Blob; codec: string; frames: number }
  | { ok: false; error: 'cancelled' | 'no-codec' | 'encoder-failed' | 'not-finalized' | 'no-frames'; detail: string };

/**
 * Walks the requested timeline range at frame rate, samples it frame-exactly, renders each frame at
 * export resolution through the output camera, and feeds the encoder. It reports progress, honours
 * cancellation, and never mutates the project: an export cannot corrupt authored data.
 */
export class ExportJob {
  private readonly mirror: SceneMirror;

  constructor(opts: { mirror: SceneMirror }) {
    this.mirror = opts.mirror;
  }

  async run(
    request: ExportRequest,
    onProgress: (p: ExportProgress) => void,
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
          return { ok: false, error: 'cancelled', detail: `export cancelled at frame ${i} of ${total}` };
        }
        playback.setTime(from + i / fps);
        capture.render(scene, this.mirror.camera);
        const frame = await capture.readFrame();
        if (!frame.ok) {
          return { ok: false, error: 'encoder-failed', detail: `capture: ${frame.detail}` };
        }
        writer.push(frame.bitmap, i);
        onProgress({ frame: i + 1, total });
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        });
      }
      const written = await writer.finish();
      finished = true;
      if (!written.ok) return { ok: false, error: written.error, detail: written.detail };
      return { ok: true, blob: written.blob, codec: written.codec, frames: total };
    } finally {
      if (!finished) writer.cancel();
      this.mirror.setMaskMode(false);
      playback.setTime(restoreTime);
    }
  }
}
