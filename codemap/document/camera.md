# src/document/camera.ts

Ring: 1 · Layer: document · Depends on: `three`

## Responsibility
The authored camera as plain data plus one pure evaluator: named **takes**, each a chain of **segments** that tiles the
clip, each segment holding its own pose **keys**, its own projection, and its own lens. It holds no mirror, no DOM, no
timeline, and no evaluation state; `resolveCameraAt` is a pure function of the takes and a time, so playback, the
carrier, the path drawing and an export can all read the camera without sharing a mutable pose.

The shape exists for three properties a single camera plus property tracks cannot hold at once: a take is a whole
shooting plan that can be copied and switched rather than undone; a segment is a continuous shot whose boundary is an
exact cut, with no interpolation across it; and the projection is a segment property, so it can only change at a cut.

Times are the authoring unit — milliseconds at whatever precision the author gave — matching `document/timeline.ts`.

## Public interface
```ts
type ProjectionKind = 'perspective' | 'orthographic';
type SegmentEntry = 'start' | 'continuous' | 'cut';
type CameraKey = { id: string; timeMs: number; position: Vector3; quaternion: Quaternion; lens: number };
type CameraSegment = {
  id: string; name: string; startMs: number; endMs: number; enter: SegmentEntry;
  projection: ProjectionKind; near: number; far: number; keys: CameraKey[];
};
type CameraTake = { id: string; name: string; segments: CameraSegment[] };
type Camera = { takes: CameraTake[]; activeTakeId: string };
type ResolvedCamera = {
  takeId: string; segmentId: string; position: Vector3; quaternion: Quaternion;
  projection: ProjectionKind; lens: number; near: number; far: number;
};
type CameraEditResult = { ok: true } | { ok: false; error: string; detail: string };

const DEFAULT_FOV = 50; const DEFAULT_NEAR = 0.1; const DEFAULT_FAR = 2000;

function createCamera(init: { durationMs: number; position: Vector3; quaternion: Quaternion; fov?: number; near?: number; far?: number }): Camera;
function copyKey(key: CameraKey): CameraKey;
function copyTake(take: CameraTake): CameraTake;
function copyCamera(camera: Camera): Camera;
function adoptCameraIds(camera: Camera): void;
function activeTake(camera: Camera): CameraTake | undefined;
function takeById(camera: Camera, takeId: string): CameraTake | undefined;
function segmentAt(take: CameraTake, timeMs: number): CameraSegment | undefined;
function resolveCameraAt(camera: Camera, timeMs: number): ResolvedCamera | undefined;

function setActiveTake(camera: Camera, takeId: string): boolean;
function addTake(camera: Camera, init: { name?: string; source?: CameraTake; durationMs: number }): CameraTake;
function removeTake(camera: Camera, takeId: string): boolean;
function renameTake(camera: Camera, takeId: string, name: string): boolean;

function splitSegment(camera: Camera, takeId: string, timeMs: number, durationMs: number): CameraEditResult;
function removeSegment(camera: Camera, takeId: string, segmentId: string): boolean;
function setSegmentEntry(camera: Camera, takeId: string, segmentId: string, entry: SegmentEntry): CameraEditResult;
function setSegmentProjection(camera: Camera, takeId: string, segmentId: string, projection: ProjectionKind): CameraEditResult;
function setSegmentLensParams(camera: Camera, takeId: string, segmentId: string, params: { near: number; far: number }): CameraEditResult;
function setSegmentRange(camera: Camera, takeId: string, segmentId: string, range: { startMs: number; endMs: number }): CameraEditResult;

function upsertKey(camera: Camera, takeId: string, segmentId: string, init: { timeMs: number; position: Vector3; quaternion: Quaternion; lens: number }): { ok: true; key: CameraKey } | { ok: false; error: string; detail: string };
function moveKey(camera: Camera, takeId: string, segmentId: string, keyId: string, timeMs: number): boolean;
function removeKey(camera: Camera, takeId: string, segmentId: string, keyId: string): boolean;
function retimeCamera(camera: Camera, durationMs: number): void;
```

## Internal logic
1. Constants: `DEFAULT_FOV = 50`, `DEFAULT_NEAR = 0.1`, `DEFAULT_FAR = 2000`, and the id shapes `take-<n>`,
   `segment-<n>`, `camkey-<n>` with their module counters. `SAME_STATE_EPSILON = 1e-9` is how close two boundary states
   have to be for a `continuous` seam to mean anything.
2. `createCamera` builds the shape a project starts from: one take named `Take 1`, one segment named `Shot 1` covering
   `[0, durationMs]` with `enter: 'start'`, perspective, the default clip planes, and one key at `0` holding the given
   pose and lens. The pose is cloned, so the caller's vectors stay its own.
3. `activeTake` resolves `activeTakeId`, falling back to the first take when the id names nothing — a camera whose
   active take went missing still has a state rather than none, and `removeTake` is the only writer of that field.
4. `segmentAt` walks the segments in order and keeps the last one that starts at or before the time, so the ranges are
   half-open on the right and the clip's own end belongs to the last segment. A time before the first segment's start
   resolves through the first segment instead of nothing: an author scrubbing past a shortened clip sees a camera.
5. `resolveKey` answers one segment's state at a time: the first key's state before the first key, the last key's after
   the last, and in between position by `lerpVectors`, orientation by shortest-arc `slerp`, and the lens scalar
   linearly. Nothing about `enter` can change this, so a mislabelled boundary cannot bend a path.
6. `resolveCameraAt` returns a fresh `ResolvedCamera` on every call — the vectors and the quaternion are new — which is
   what makes two readers of the same time independent. It returns `undefined` only when the camera has no take at all.
7. Take edits: `addTake` either copies a source take (a deep copy, keys included, with fresh ids, so editing the copy
   cannot reach the original) or creates a single segment opening on a default shot; `removeTake` refuses the last take
   and hands `activeTakeId` to the first survivor; `setActiveTake` refuses an unknown id; `renameTake` refuses an empty
   name.
8. `splitSegment` cuts the segment that owns `timeMs` in two: the earlier keeps every key before the cut plus a new key
   at the cut holding the state the segment had there, the later starts at the cut with the same state and
   `enter: 'cut'`, and `retimeCamera` then re-covers the clip. A time at either end of the segment, or outside every
   segment, is refused, because a split has to leave both sides a range and a key.
9. `removeSegment` closes the hole through the following segment, which takes over the removed range and the removed
   segment's `enter`; with no following segment the previous one grows into the range. The only segment of a take
   cannot be removed.
10. `setSegmentEntry` refuses `continuous` whose two sides are not the same state — position, orientation within
    `SAME_STATE_EPSILON`, and lens — and refuses it for a segment that opens the take. `cut` and `start` are taken as
    given: the label never decides the path, only what the author has asserted about it.
11. `setSegmentProjection` changes the kind and leaves the scalar alone: a field of view in degrees is not a world
    height, and converting would need a distance the camera does not store, so the author sets the number after the
    switch.
12. `setSegmentLensParams` refuses a non-finite, non-positive, or non-increasing pair, because `near >= far` renders
    nothing. The pair is constant for the life of the segment; animating clip planes is deliberately not offered.
13. `setSegmentRange` treats a boundary as shared: moving a segment's start moves the previous segment's end, and its
    end moves the next segment's start, which is what keeps the take tiling the clip however a cut is dragged. A range
    that is not a range, or that would leave a neighbour with nothing, is refused.
14. `upsertKey` is the one write behind a carrier drag, a typed pose, and `Camera -> View`: it clamps the time into the
    segment's own range (a key outside it could never be read), replaces the state of a key already at that time while
    keeping its id, and otherwise inserts in ascending order. The quaternion is normalized on the way in; `moveKey`
    refuses a collision with another key and resorts; `removeKey` refuses the last key of a segment.
15. `retimeCamera` writes only the two ends of each take — the first segment's start and the last segment's end — so a
    longer clip never silently re-times an inner cut.
16. `copyCamera`/`copyTake`/`copyKey` clone the value types, which is what `Project.snapshot` returns and what
    `Project.restore` writes from; `adoptCameraIds` raises the three counters above every id the camera already holds,
    skipping ids of another shape so a foreign file cannot steer a minter.

## Invariants
- The segments of a take tile its range with no gap and no overlap: `segments[i].endMs === segments[i + 1].startMs`,
  the first starts at `0`, and the last ends at the clip's length after `retimeCamera`.
- Every segment holds at least one key, its keys are strictly ascending and inside `[startMs, endMs]`, and its first key
  is never before its start nor its last after its end — so every time in the range resolves.
- A take is never empty and a camera always holds at least one take; `activeTakeId` names an existing take after every
  mutator that can remove one.
- Nothing interpolates across a segment boundary: the state at a cut instant is the later segment's, and both sides of
  a fresh split hold the same state until the author moves one.
- The projection kind is a segment property, so a projection can only change at a cut.
- `resolveCameraAt` allocates its result and reads nothing else: two calls for one time are equal and independent, and
  no mutator can make an earlier call's result change.
- Ids are minted only here, from module counters floored above anything loaded; ids are opaque to every caller.

## Errors
- `assertFinite` throws `TypeError` for a non-finite time, lens, duration, or range end — a programmer error, not a
  value from a file or a user.
- User-facing refusals come back as values: `'unknown-take'`, `'outside-segment'`, `'bad-split'`,
  `'unknown-segment'`, `'bad-lens'`, `'bad-range'`, `'overlap'`, `'not-continuous'`, `'no-previous'`, each naming the
  segment, take, or value that caused it. The boolean mutators return `false` for "nothing changed".
- A refused edit leaves the camera exactly as it was: every check runs before the first write.

## Dependencies
- `three` — `Vector3`, `Quaternion`, for the poses the document stores and the slerp the evaluation does.

## Tests
`tests/camera.test.ts` pins the shape a project starts from and that it answers for every time; the hold outside the
authored span; linear position and lens with shortest-arc orientation; a pure resolve; segment ownership of an instant
and of the clip's end; a split that tiles the take with the same state keyed on both sides; two sides of a cut
diverging with no blend across the boundary; refusals for an empty split, a removed-only segment, an overlapping range,
and unusable clip planes; a shared boundary moving both neighbours; the lens scalar surviving a projection switch;
`continuous` accepted only for matching states; take copy, switch, rename, and removal with the active flag; keyed
writes clamping, replacing, moving, and refusing the last key; `retimeCamera` moving only the ends; and `adoptCameraIds`
flooring the counters.

## Open questions
- Clip planes are per segment constants. Animating them would need a second key list per segment and a rule for how it
  interpolates across a `continuous` seam; nothing has needed it yet.
- The evaluation allocates one `ResolvedCamera` per call, which is what makes two readers independent. If a per-frame
  resolve in a hot loop ever shows up in a profile, the answer is a caller-owned scratch target rather than a shared
  cached state.
