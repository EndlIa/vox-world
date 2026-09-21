# src/app/files.ts

Ring: 4 · Layer: app · Depends on: none

## Responsibility
The browser file boundary: ask the user for a GLB, accept a dropped GLB, and download the produced MP4.
It moves `File` and `Blob` values across the page boundary and holds no project state; content
validation, decoding, and encoding belong to `three-runtime/import.ts` and `export/`.

## Public interface
```ts
function pickGlbFile(): Promise<File | undefined>;
function wireDropTarget(target: HTMLElement, onFile: (file: File) => void): () => void;
function saveMp4(blob: Blob, filename: string): void;
```

## Internal logic
`pickGlbFile`
1. Create a detached `<input type="file">`, set `accept = '.glb,model/gltf-binary'` and `hidden = true`.
   No `window.showOpenFilePicker`: it adds a second permission path and a second result shape for the same
   user gesture.
2. Attach `change` and `cancel` with one shared settle path that resolves the outer promise exactly once —
   `change` → `input.files?.[0]`, `cancel` → `undefined` (`input.files` is null when the dialog is
   dismissed).
3. Append the input to `document.body`, call `click()`, and then remove the input and both listeners
   inside the settle path, before resolving. No element is left in the DOM and no listener outlives the
   dialog.
4. No timeout: a browser that fires neither event leaves the promise pending until the next gesture, which
   is the honest outcome and cannot leak state because the input was removed.

`wireDropTarget`
1. Register `dragenter` and `dragover`: `event.preventDefault()` — without it the browser navigates to the
   dropped file — then set `event.dataTransfer.dropEffect = 'copy'` and add the highlight class to
   `target`.
2. Register `dragleave` and `drop`: remove the highlight class; `drop` also calls `preventDefault()`
   before reading the payload.
3. In `drop`, forward `event.dataTransfer?.files?.[0]` to `onFile` only when its `name` ends in `.glb`
   (case-insensitive); every other drop is ignored, since `onFile` has no error channel and the highlight
   is already cleared.
4. Handlers are declared as `(event: Event) => void` and narrow with `event instanceof DragEvent` instead
   of a type assertion, matching the signature `on` accepts.
5. Return a detach function that removes all four listeners and clears the highlight; it is idempotent
   because `removeEventListener` is.

`saveMp4`
1. `const url = URL.createObjectURL(blob)`.
2. Create a hidden `<a>` with `href = url` and `download = filename`, append it, `click()` it, and remove
   it.
3. Revoke the URL from a `setTimeout(…, 0)` queued after the click, so the browser has already taken over
   the download; revoking synchronously can abort it.

## Invariants
- No module-level state, no cached input element, no cached object URL.
- `pickGlbFile` resolves exactly once per call and never rejects; a dismissed dialog is `undefined`, not a
  failure.
- Each `wireDropTarget` call registers exactly its own four listeners and returns a detach function that
  removes exactly those and nothing else.
- `saveMp4` leaves no anchor in the document and no live object URL once the queued revoke runs.
- This file never reads or writes `Project`, the mirror, or any document type — it only produces and
  consumes `File`/`Blob`.

## Errors
No `Result` type: this is the raw browser boundary, and there is no user-facing operation here that can
fail on its own. A dropped non-GLB file is ignored silently rather than reported. A GLB that fails to
parse is reported by `importGlb`'s result through `main`; `saveMp4` does not verify that the blob is a
valid MP4, because the encoder already reported success or failure before it is called.

## Dependencies
None — browser globals only (`document`, `URL`, `DragEvent`, `Promise`). `ui/dom.ts` is deliberately not
imported, so this file stays usable from the page bootstrap and from `Panels` without dragging UI
machinery into the file boundary.

## Tests
None. File picking, drag and drop, and downloads need a real browser; they are verified by running the app
(README section 10) — pick a GLB, drop a GLB on the viewport, and download an exported MP4.
