# src/three-runtime/capture.ts

Ring: 2 · Layer: three-runtime · Depends on: `three`

## Responsibility
Renders one frame per call at the export resolution on its own offscreen `WebGLRenderer` and hands that frame to the encoder as an `ImageBitmap`. It draws whatever scene and camera it is given: it knows nothing about mask colors, timelines, or the visible canvas, and it reads no project data.

## Public interface
```ts
type CaptureResult = { ok: true; bitmap: ImageBitmap } |
  { ok: false; error: 'context-lost' | 'render-failed'; detail: string };
class Capture {
  constructor(opts: { width: number; height: number });
  readonly width: number;
  readonly height: number;
  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void;   // one frame, at export size
  readFrame(): Promise<CaptureResult>;
  resize(width: number, height: number): void;
  dispose(): void;
}
```

## Internal logic
1. Constructor: `new THREE.WebGLRenderer({ antialias: false, alpha: false, preserveDrawingBuffer: true })`, then `setPixelRatio(1)` — export pixels are exact and `devicePixelRatio` must not scale them — `setSize(width, height, false)` so no canvas style is touched, `toneMapping = THREE.NoToneMapping`, and `outputColorSpace = THREE.SRGBColorSpace`. The canvas is never attached to the document; nothing is rendered until `render` is called.
2. `render(scene, camera)` first sets `camera.aspect = width / height` and calls `camera.updateProjectionMatrix()`: the capture owns the export viewport, so it owns the aspect, while fov, near, far, and the transform stay the caller's data — in the app that camera is `SceneMirror.camera`, the output camera derived from `project.camera` (README D17).
3. Then `renderer.setRenderTarget(null)` and `renderer.render(scene, camera)`, which sets the "a frame is available" flag. A mask frame is exactly this same call after `SceneMirror.setMaskMode(true)`; this file neither sets nor reads any mask color.
4. `readFrame()` resolves `createImageBitmap(renderer.domElement)`, producing an `ImageBitmap` of exactly `width × height` pixels from the last successful render. The bitmap belongs to the caller, which must `close()` it after encoding; `Capture` keeps no reference to it.
5. `resize(width, height)` re-sizes the renderer without touching the canvas style and clears the availability flag, so a frame can never be read at a size it was not rendered at.
6. `dispose()` disposes the renderer, drops its targets, removes the context-loss listener, and calls `forceContextLoss()`, because a session may create several captures and browsers cap live WebGL contexts. After it, the object is inert.
7. Context loss is tracked by a `webglcontextlost` listener on the offscreen canvas plus `renderer.getContext().isContextLost()`. `render` throws a plain `Error` because its signature has no result union, `readFrame` reports `context-lost` as data, and neither ever returns a stale or blank frame as success.

## Invariants
- Export resolution is `width × height` pixels regardless of the visible canvas size, its CSS size, or `devicePixelRatio`. This renderer-ownership boundary is the reason the class exists: `Capture` owns its `WebGLRenderer`, drawing buffer, and size, and nothing else renders into it, resizes it, or disposes it. The app's on-screen renderer is a different object and the two share no canvas or target.
- One `render` call produces exactly one frame, and `readFrame` returns the most recent successfully rendered frame — never one from a previous size.
- `Capture` holds no scene, camera, material, or color it did not receive as an argument, so `SceneMirror.setMaskMode(true)` plus `render` is the whole mask-pass mechanism and the `FrameSink` boundary (README D7) is fed from here.
- No tone mapping and sRGB output mean a flat material color reaches the encoder as the hex value that was set, which is what makes the mask pass exact.
- Scene visibility decides what is drawn: the export camera has only layer 0 enabled, so the overlay guide (layer 1) never reaches a frame.

## Errors
- `readFrame` → `{ ok: false, error: 'render-failed', detail }` when `createImageBitmap` rejects, when the drawing buffer cannot be read, or when no frame has been rendered since construction or the last `resize` (`detail: 'no frame rendered'`).
- `readFrame` → `{ ok: false, error: 'context-lost', detail }` when the offscreen context is lost; a loss is never masked by a blank bitmap.
- `render` and `resize` throw `Error` with the detail `capture context lost` or `capture disposed`, since a synchronous signature cannot carry the result union.
- `RangeError` for a non-positive or non-integer `width`/`height`, in the constructor and in `resize`.

## Dependencies
- `three` — `WebGLRenderer`, `Scene`, `PerspectiveCamera`, `NoToneMapping`, `SRGBColorSpace`.
That is the whole list: `Capture` imports nothing from this repository, which is what keeps the export path independent of the mirror and the visible canvas.

## Tests
- No vitest file: the node test environment has no WebGL context, and the brief forbids `WebGLRenderer` in tests. Verified by running an export (README §10) and inspecting the produced MP4: resolution equal to the requested export size on a differently sized viewport, one frame per timeline frame, and mask frames carrying flat per-object colors.

## Open questions
- `preserveDrawingBuffer: true` is set so a frame survives until the asynchronous `readFrame()`; if a caller ever reads the frame in the same task as `render`, it could be turned off for speed.
