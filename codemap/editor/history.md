# src/editor/history.ts

Ring: 3 · Layer: editor · Depends on: document/project.ts, voxels/uniform/grid.ts, voxels/uniform/region.ts

## Responsibility
The undo stack of one editing session: what each completed gesture changed, and where the session stands in it.
It owns no project state, renders nothing, and shows nothing — it reads the document through `Project.snapshot`,
writes it back through `Project.restore`, and reports which objects a step touched so the caller rebuilds exactly
those.

Two things are deliberately outside its scope: the camera and the timeline. A step restores the object set and
the cells a gesture named and leaves both as they are, so undoing an edit never rewinds a shot or a keyframe, and a
camera or timeline edit is not something this file can take back.

It keeps no replayable log of its own beyond those cells. Recovering an object's old *structure* is one record set
instead, which is why a gesture that replaced a payload — a subdivision, a detach, an import — undoes by restoring
the record that still points at the previous payload rather than by reversing the change.

## Public interface
```ts
import type { ObjectId, Project, SceneObject } from '../document/project.js';
import type { CellKey, HexColor } from '../voxels/uniform/grid.js';
import type { RegionShape } from '../voxels/uniform/region.js';

type RegionCapture = { objectId: ObjectId; shape: RegionShape };
type CellChange = { key: CellKey; before: HexColor | undefined; after: HexColor | undefined };
type CellGroup = { objectId: ObjectId; changes: CellChange[] };
type Edit = { objects: { before: SceneObject[]; after: SceneObject[] }; cells: CellGroup[] };
type Capture = { objects: SceneObject[]; cells: { objectId: ObjectId; before: Map<CellKey, HexColor | undefined> }[] };

const DEFAULT_HISTORY_DEPTH = 50;

class EditHistory {
  constructor(project: Project, opts?: { depth?: number });
  begin(regions?: readonly RegionCapture[]): Capture;
  commit(capture: Capture): readonly ObjectId[] | null;
  undo(): readonly ObjectId[] | null;
  redo(): readonly ObjectId[] | null;
  get canUndo(): boolean;
  get canRedo(): boolean;
  reset(): void;
}
```

## Internal logic
1. One entry is two whole record sets plus the cell changes inside the regions the gesture named. The record sets
   are what describe structure — including an object a gesture deleted, whose payload the record still points at —
   while the cells are the one thing a record set cannot describe: a grid is mutated in place, so a record that
   shares it shares its new cells.
2. `begin(regions)` reads every object record through `Project.snapshot` and, for each named region, the cells it
   names as a packed-key map through `visitRegion`. A region on an object with no grid — a group, a fresh import —
   captures no cells, exactly as a write to it would find none.
3. `commit(capture)` reads the records again and diffs them: two records differ when any field the document holds
   differs, with the payload compared by identity. It then re-reads each captured cell and keeps the ones whose
   colour is not what `begin` saw; a cell whose whole payload was replaced still counts, because the record set
   says *which* payload an object holds and the cell change says what that payload holds.
4. Nothing is recorded when both diffs come out empty — a refused operation, a paint over empty space — so a caller
   never judges whether a step is worth keeping, and `commit` answers `null`.
5. A recorded step truncates the redo branch, is pushed, and drops the oldest entry once the stack is longer than
   the depth; `reset()` clears the stack for a document that was just loaded, because a loaded document has no past.
6. `apply` writes one side back: the object set first — because it decides which payload a cell write lands in — and
   then the recorded cells into whatever payload each object holds now.
7. The ids a caller gets back are the records that differ plus every object a cell write landed in.

## Invariants
- The camera, the timeline, and the project settings are never written by a step: every restore splices the current
  ones in, so a step changes the object set and the named cells and nothing else.
- Counters never rewind. `restore` raises `nextId` above every id it is given, and the current counters are what is
  passed in, so an undo cannot make the document hand out an id twice.
- A step is recorded whole or not at all: nothing is held between `begin` and `commit`, so an abandoned gesture
  leaves no trace.
- Both sides of a step are read from the live document, so an entry's `after` is what the operation actually did
  rather than what its caller expected.
- `undo` past the bottom and `redo` past the top change nothing and answer `null`; `canUndo` and `canRedo` are the
  cursor's own reading.
- The record sets are plain data with payloads shared by reference: a step costs the object count, never the cell
  count, except for the cells a gesture actually named.

## Errors
- The constructor throws `RangeError` for a depth that is not a whole number of gestures at least one.
- No other call throws for a caller: an empty capture, a region on an object that does not exist, and a gesture that
  changed nothing are all ordinary cases with ordinary answers.
- A `RangeError` out of the `Project.restore` a step triggers is a broken invariant of this file's own records — ids
  and parents it captured itself — never a user-facing failure.

## Dependencies
- `../document/project.ts` — `Project` (`snapshot`, `restore`, `get`), `ObjectId`, `SceneObject`.
- `../voxels/uniform/grid.ts` — `packKey`, `unpackKey`, and the `CellKey`/`HexColor` types.
- `../voxels/uniform/region.ts` — `RegionShape` (type only) and `visitRegion`, which is how a region is read without
  writing it.
No `three-runtime` import and no DOM: history is document state and arithmetic, and the caller is what rebuilds a
mirror from the ids it reports.

## Tests
`tests/history.test.ts` drives the owner against a real project and pins both kinds of step: a cell write that comes
back and goes again (colour and size), an island removal restored in one step, a gesture that changed nothing
recording nothing, a rename put back, and a deletion undone with the payload the record still held — the grid
instance and its cells. It also pins the scope and the bookkeeping: the camera and the timeline unchanged across an
undo, the oldest step dropped past a depth of one, the redo branch replaced by the next gesture, and `reset()`
forgetting everything a load would. The wiring — a press recording one step, the panel's two buttons and the
keyboard — is reached by running the application.
