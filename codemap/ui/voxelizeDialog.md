# src/ui/voxelizeDialog.ts

Ring: 4 · Layer: ui · Depends on: ./dom.js

## Responsibility
The voxelization settings modal: the only place the voxel count is chosen (README D26). It shows a
backdrop and a card, seeds the count the prompt opens at and the model's per-axis extent from the
`defaults()` callback it was constructed with, and
answers one `VoxelizeDialogOutcome` per prompt: `{ kind: 'run', cellsAcross }` on confirm,
`{ kind: 'cancel' }` on Cancel or Escape. The one field asks how long the model is in voxels, and the
read-only dimensions beside it are what that count makes the model — an orientation readout, never the
value the job is handed (README D29, D41). It owns no project state, calls nothing, and runs no
job — it is a question, and the app acts on the answer.

## Public interface
```ts
const DEFAULT_VOXELS_ACROSS = 96;   // exported: the count every prompt opens at
type VoxelizeDialogDefaults = { extent: { readonly x: number; readonly y: number; readonly z: number } };
type VoxelizeDialogOutcome = { kind: 'run'; cellsAcross: number } | { kind: 'cancel' };
class VoxelizeDialog {
  constructor(root: HTMLElement, defaults: () => VoxelizeDialogDefaults);
  open(context: { title: string }): Promise<VoxelizeDialogOutcome>;
  get isOpen(): boolean;
  dispose(): void;
}
```

## Internal logic
1. The constructor builds the whole modal once through `el`: a backdrop `div` (`position: fixed; inset: 0; z-index: 20`, a
   translucent page-colored fill, and a centered flex row so the card sits in the middle of the window), and inside it a
   `section` card of 320 px holding the title `h2`, the field, the read-only dimensions line, and a `.row` of the `Voxelize` and
   `Cancel` buttons. It is never appended by the constructor: `root` receives it only while a prompt is open. The backdrop
   itself takes no listener: a prompt is answered by its own buttons, so a stray click on it cannot discard the settings the
   user is choosing.
2. The one field is the `Voxels across` integer input (`min 1`, `max 511`, `step 1`) with its read-only `div.dim` dimensions
   line after it, the field built through the same local labelled-field helper the panel uses (`span.dim` caption + control in
   a `label`). Nothing is hidden, shown, or disabled by state: there is one number to ask for, and no representation,
   cell size, root size, or max depth to choose from.
3. `open(context)` closes any prompt already on screen as a cancel, then seeds from `defaults()` —
   `voxelsAcrossInput.value = DEFAULT_VOXELS_ACROSS` and `extent = defaults().extent` — writes `context.title` into the `h2`,
   appends the backdrop to `root`, registers one `keydown` listener on `document`, focuses the count, and returns a promise
   whose resolver it stores. Seeding on every `open()` is what lets the app ask about a different model each time with no state
   kept here. The count is the seed that is a constant rather than something the model decides: every prompt opens at 96
   whatever was imported, and the extent is what that count is read against to print the model's shape (README D29).
4. `syncFields()` runs on seeding and on the count's `input`: it writes the dimensions line and sets
   `voxelizeButton.disabled` from `readCount() === undefined`, so `Voxelize` is offered exactly while the count is one the
   app can voxelize at. The line reads the model's dimensions in voxels — `<x> × <y> × <z> voxels`, each axis
   `Math.max(1, Math.round((axis / longest) * count))` of the seeded extent, so the longest axis is the count itself — or
   `? voxels per axis` while the count does not parse, or `<count> voxels per axis` when the seeded extent has no positive
   axis to scale against. It is recomputed on every keystroke from the seeded extent, so it is orientation, not state: one
   voxel is one world unit, so the line and the field are the same kind of number (README D41).
5. `readCount()` is the count when it parses as an integer in `[1, 511]`, else `undefined`. The count is handed over exactly
   as read — only the dimensions line rounds, and the app scales the import by the count itself. The cap is deliberate: the
   count is capped at 511 because the container's key space fits 512 cells per axis and a payload whose extent touches both
   sides of the aligned lattice can occupy one cell more than the nominal count, so 511 leaves the grid guard
   (`exceeds-grid`) a cell of slack. A blank field, a fraction, a negative, a non-finite value, or a count past 511 is not an
   answer: nothing is built and `Voxelize` stays disabled.
6. The `keydown` listener answers the prompt: Enter calls the same confirm path the `Voxelize` button does, Escape closes with
   a cancel, and both `preventDefault()` so the key never reaches the page. The listener lives on `document` rather than on the
   card because clicking the backdrop moves focus to the body; it is registered on `open()` and removed by the close that
   settles that prompt.
7. `confirm()` resolves `{ kind: 'run', cellsAcross }` only when `readCount()` returned a count; a field that does not parse
   leaves the prompt up instead of resolving a cancel or an impossible count. `Cancel`, Escape, and `dispose()` resolve
   `{ kind: 'cancel' }`.
8. One private close settles the pending promise and takes the modal out of `root`: it captures the resolver, returns at once
   when there is none (so a second confirm, cancel, or `dispose()` is a no-op), detaches the key listener, removes the
   backdrop, then calls the resolver with the outcome — which is why every promise settles exactly once. The field itself is
   left as it is; the next `open()` re-seeds it.
9. The nodes are built once and reused across prompts: a closed dialog is out of the DOM entirely (nothing of it is on screen,
   and nothing of it can take a click), and the next `open()` re-appends the same elements after re-seeding them. A second
   `open()` while a prompt is up first settles the pending one as a cancel, so one prompt is on screen at a time and the newest
   request — its title and its seeds — is the one being answered.
10. `dispose()` closes a pending prompt as a cancel, releases the listener, and marks the dialog dead: `open()` afterwards
    throws, so a page being torn down cannot leave a caller waiting on a modal that will never be answered.

## Invariants
- At most one prompt is open, `isOpen` is true exactly while a promise is pending, and that promise settles exactly once — a
  second confirm, a later cancel, or a `dispose()` after it are no-ops. `open()` while a prompt is up settles the older
  promise as a cancel before showing the new one.
- `{ kind: 'run' }` always carries a `cellsAcross` the app can voxelize at — an integer in `[1, 511]` — never a partial
  answer and never a value that did not parse; when the count does not parse, `Voxelize` is disabled and both Enter and a
  click do nothing.
- The count is the whole request: it is the only number the user edits, it is what the app is handed, and the dimensions
  beside it are a readout the dialog recomputes from the seeded extent and rounds. The count is capped at 511 so a payload
  that spans one cell more than its count still fits the container's 512 cells per axis — and, since a cell is one world unit,
  the count is also the model's length in the world (README D41).
- Every prompt is seeded on `open()`: the count from the constant `DEFAULT_VOXELS_ACROSS` — model independent, the same 96
  whatever was imported — and the extent from `defaults()`, which the model's shape does decide; the dialog holds no setting
  between prompts, no defaults, and no project state.
- The dialog calls nothing: no `Project`, no session, no ops, no voxelizer, no mirror, and no `app/` import. The outcome is
  the whole of what it produces.
- Out of the DOM whenever closed: a settled prompt has removed the backdrop and the `document` key listener, so a closed
  dialog cannot capture a click, a keystroke, or a tab stop.
- After `dispose()` the dialog cannot be reopened.

## Errors
No `Result` and no reporting: the dialog validates nothing for anyone but itself (an unparsable field simply disables
`Voxelize`), and a job's failure never reaches it — the app reports that (README D38). `open()` on a disposed dialog throws
`TypeError`, which is a programmer error — `main` disposes the dialog only while tearing the page down.

## Dependencies
- `./dom.js` — `el` for construction and `on` for the document key listener, which returns its own detach function.
- Page globals (`document`, `KeyboardEvent`) and nothing else: no Three.js, no project, no outer-ring import, and nothing in
  `ui` imports this file except `app/main.ts` — which also imports `DEFAULT_VOXELS_ACROSS`, the count it scales an arriving
  import to. `VoxelizeTarget` is gone from the app (README D41), so this file no longer names
  `../voxels/voxelize/voxelize.js` at all.

## Tests
None. The dialog needs a DOM and vitest runs in the node environment, so it is verified by running the app (README section 10):
import a GLB and the settings must be asked for in a modal seeded from that model — `Voxels across` at 96, with the read-only
line below it printing that model's dimensions in voxels, 96 along its longest axis, instead of a length —
`Voxelize` must produce voxels at the count the field shows, `Cancel` and Escape must leave the imported raw model displayed as
an `'empty'` object. A blank or out-of-range count must leave `Voxelize` disabled, and editing the count must move
the printed dimensions before the job runs. The dialog is also the only way to voxelize — the panel holds no control that
re-opens it — so a second attempt at the settings means importing the file again.
