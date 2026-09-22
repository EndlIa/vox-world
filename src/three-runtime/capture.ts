/**
 * Offscreen frame capture.
 *
 * Renders one frame per call at the export resolution on its own `WebGLRenderer` and hands that frame
 * to the encoder as an `ImageBitmap`. It draws whatever scene and camera it is given: it knows nothing
 * about mask colors, timelines, or the visible canvas, and it reads no project data — which is what
 * keeps the export path independent of the viewport.
 *
 * Mask frames are exactly `SceneMirror.setMaskMode(true)` followed by the same `render` call.
 */

import * as THREE from 'three';

export type CaptureResult =
  | { ok: true; bitmap: ImageBitmap }
  | { ok: false; error: 'context-lost' | 'render-failed'; detail: string };

export class Capture {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly canvas: HTMLCanvasElement;
  private frameWidth: number;
  private frameHeight: number;
  private disposed = false;
  private contextLost = false;
  private frameReady = false;

  constructor(opts: { width: number; height: number }) {
    requireSize(opts.width, opts.height);
    this.frameWidth = opts.width;
    this.frameHeight = opts.height;

    // The same logarithmic depth buffer the viewport uses: an exported frame must not fight where the
    // viewport does not, and the output camera's own near and far are the document's business (README D40).
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      preserveDrawingBuffer: true,
      logarithmicDepthBuffer: true,
    });
    // Export pixels are exact: `devicePixelRatio` must never scale them, and the canvas has no style.
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(opts.width, opts.height, false);
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.canvas = this.renderer.domElement;
    this.canvas.addEventListener('webglcontextlost', this.handleContextLost);
  }

  /** Export width in pixels, whatever the visible canvas or its CSS size is. */
  get width(): number {
    return this.frameWidth;
  }

  /** Export height in pixels, whatever the visible canvas or its CSS size is. */
  get height(): number {
    return this.frameHeight;
  }

  /**
   * Draws one frame at the export size.
   *
   * The capture owns the export aspect; `fov`, `near`, `far`, and the transform stay the caller's
   * data, so the camera passed here is the output camera derived from `project.camera` (README D17).
   */
  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    this.requireUsable();

    camera.aspect = this.frameWidth / this.frameHeight;
    camera.updateProjectionMatrix();

    this.renderer.setRenderTarget(null);
    try {
      this.renderer.render(scene, camera);
    } catch (error) {
      this.frameReady = false;
      if (this.isLost()) throw new Error('capture context lost');
      throw error;
    }
    this.frameReady = true;
  }

  /** The most recently rendered frame; the caller owns the bitmap and must `close()` it. */
  async readFrame(): Promise<CaptureResult> {
    if (this.disposed) return { ok: false, error: 'render-failed', detail: 'capture disposed' };
    if (this.isLost()) return { ok: false, error: 'context-lost', detail: 'capture context lost' };
    if (!this.frameReady) return { ok: false, error: 'render-failed', detail: 'no frame rendered' };

    try {
      return { ok: true, bitmap: await createImageBitmap(this.canvas) };
    } catch (error) {
      if (this.isLost()) return { ok: false, error: 'context-lost', detail: 'capture context lost' };
      return {
        ok: false,
        error: 'render-failed',
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Re-sizes the export target; a frame rendered at another size can never be read afterwards. */
  resize(width: number, height: number): void {
    requireSize(width, height);
    this.requireUsable();

    this.frameWidth = width;
    this.frameHeight = height;
    this.renderer.setSize(width, height, false);
    this.frameReady = false;
  }

  /** Releases the renderer and its targets, then the context; the object is inert afterwards. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.frameReady = false;

    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.renderer.setRenderTarget(null);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  private readonly handleContextLost = (): void => {
    this.contextLost = true;
    this.frameReady = false;
  };

  private requireUsable(): void {
    if (this.disposed) throw new Error('capture disposed');
    if (this.isLost()) throw new Error('capture context lost');
  }

  private isLost(): boolean {
    if (this.contextLost) return true;
    const lost = this.renderer.getContext().isContextLost();
    if (lost) this.contextLost = true;
    return lost;
  }
}

function requireSize(width: number, height: number): void {
  if (!Number.isInteger(width) || width <= 0) {
    throw new RangeError(`Capture: width must be a positive integer, got ${width}`);
  }
  if (!Number.isInteger(height) || height <= 0) {
    throw new RangeError(`Capture: height must be a positive integer, got ${height}`);
  }
}
