/**
 * The two string transforms the runtime's shader patches are built from.
 *
 * Both are pure and total: a source that does not carry the anchor comes back unchanged, so a three upgrade that
 * moves a chunk is caught by the test that runs the patch over three's own shader source, rather than silently
 * producing a program without the patch.
 */

/**
 * Adds `declaration` above `main` and `statement` at the end of its body. `declaration` is a line or two of GLSL the
 * program needs in scope before `main`, and `statement` the write that uses it.
 */
export function insertChunks(source: string, declaration: string, statement: string): string {
  const start = source.indexOf('void main() {');
  const end = source.lastIndexOf('}');
  if (start < 0 || end < start) return source;
  return `${source.slice(0, start)}${declaration}\n${source.slice(start, end)}${statement}\n${source.slice(end)}`;
}

/** Adds `insertion` immediately before `anchor`, for a patch that belongs ahead of one of three's chunks. */
export function insertBefore(source: string, anchor: string, insertion: string): string {
  const at = source.indexOf(anchor);
  if (at < 0) return source;
  return `${source.slice(0, at)}${insertion}${source.slice(at)}`;
}
