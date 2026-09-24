# src/three-runtime/shaderPatch.ts

Ring: 2 · Layer: three-runtime · Depends on: nothing

## Responsibility
The two string transforms every shader patch in the runtime is built from: add a declaration above `main` and a
statement at the end of its body, or insert a block immediately before a named chunk. Both are pure and total, so a
patch is checked in the node environment and a source that does not carry the anchor comes back unchanged.

## Public interface
```ts
function insertChunks(source: string, declaration: string, statement: string): string;
function insertBefore(source: string, anchor: string, insertion: string): string;
```

## Internal logic
1. `insertChunks` finds the first `void main() {` and the last `}`, and returns the source with `declaration` placed
   above `main` and `statement` placed at the end of the body — the shape a patch needs when it has to declare a
   varying or a chunk and then write to it from inside `main`. A source without a `main`, or with a `}` before it,
   comes back unchanged.
2. `insertBefore` inserts ahead of the first occurrence of `anchor`, which is how a patch lands ahead of one of three's
   own chunks. A source without the anchor comes back unchanged.

## Invariants
- Both are pure: no state, no I/O, no exceptions, and the input string is never mutated.
- Both are total: an unrecognised source returns the input itself, so a patch over a program that changed shape cannot
  corrupt it. The anchor each patch depends on is pinned by the test that runs it over three's own shader source, so a
  library upgrade that moves one fails the suite rather than silently dropping the patch.
- Neither parses GLSL: they splice text at anchors, which is why every caller's anchor is a literal chunk name or a
  literal line of the library it patches.

## Errors
Nothing throws; an absent anchor is a no-op, documented above.

## Dependencies
None. `grid.ts` uses `insertChunks` and `faceGrid.ts` uses both.

## Tests
Covered through its callers: `tests/grid.test.ts` for the log-depth patch and `tests/faceGrid.test.ts` for both
transforms over three's lambert source, including the no-op returns.

## Open questions
- Two callers is the whole population. A third that needs to replace a line rather than insert one should add its
  transform here rather than growing a private copy elsewhere.
