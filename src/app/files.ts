/**
 * The browser file boundary: ask for a GLB, accept a dropped GLB, download the produced MP4.
 * It moves `File` and `Blob` values across the page boundary and holds no project state.
 */

const DROP_HIGHLIGHT_CLASS = 'drop-active';

/** Opens the file dialog and resolves the chosen GLB, or `undefined` when the dialog is dismissed. */
export function pickGlbFile(): Promise<File | undefined> {
  return new Promise<File | undefined>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.glb,model/gltf-binary';
    input.hidden = true;

    let settled = false;
    const settle = (file: File | undefined): void => {
      if (settled) return;
      settled = true;
      input.removeEventListener('change', onChange);
      input.removeEventListener('cancel', onCancel);
      input.remove();
      resolve(file);
    };
    const onChange = (): void => settle(input.files?.[0]);
    const onCancel = (): void => settle(undefined);

    input.addEventListener('change', onChange);
    input.addEventListener('cancel', onCancel);
    document.body.append(input);
    input.click();
  });
}

/**
 * Accepts a `.glb` dropped on `target`, highlighting it while a drag is over it. Returns a detach
 * function that removes exactly the four listeners this call registered.
 */
export function wireDropTarget(target: HTMLElement, onFile: (file: File) => void): () => void {
  const highlight = (event: Event): void => {
    if (!(event instanceof DragEvent)) return;
    event.preventDefault();
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy';
    target.classList.add(DROP_HIGHLIGHT_CLASS);
  };
  const unhighlight = (): void => {
    target.classList.remove(DROP_HIGHLIGHT_CLASS);
  };
  const drop = (event: Event): void => {
    unhighlight();
    if (!(event instanceof DragEvent)) return;
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file === undefined) return;
    if (!file.name.toLowerCase().endsWith('.glb')) return;
    onFile(file);
  };

  target.addEventListener('dragenter', highlight);
  target.addEventListener('dragover', highlight);
  target.addEventListener('dragleave', unhighlight);
  target.addEventListener('drop', drop);

  return () => {
    target.removeEventListener('dragenter', highlight);
    target.removeEventListener('dragover', highlight);
    target.removeEventListener('dragleave', unhighlight);
    target.removeEventListener('drop', drop);
    unhighlight();
  };
}

/** Offers `blob` as a download, revoking the object URL after the browser has taken it over. */
export function saveMp4(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
