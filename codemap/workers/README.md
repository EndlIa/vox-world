# src/workers/

Deliberately empty in this slice (README D9): nothing imports from this directory, and the only thing
that may move here later is voxelization. `voxelize()` already takes nothing but geometry, options,
progress callbacks, and an `AbortSignal`, so it moves unchanged, and README section 7 reserves its job
payload shape as `VoxelizeJob` — `{ request, progress, result, error }` as plain records.

Nothing may depend on this directory, and every value crossing it, once it exists, must be
structured-cloneable.
