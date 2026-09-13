/**
 * The single ascending-order rule for stable string identities. Canonical
 * snapshot, track and keyframe ordering all compare ids through it.
 */
export function compareStrings(left: string, right: string): -1 | 0 | 1 {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}
