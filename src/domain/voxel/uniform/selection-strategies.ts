import type { VoxelKey } from "../../../util/packed-int";
import { byColor, withinBox } from "./query";
import type { Bounds3i, ColorHex, UniformVoxSnapshot } from "./types";

/**
 * Self-contained voxel selection demand for the active object. Rectangle carries
 * its candidates because `SelectVoxelsCommand.strategy` is the only addressing
 * field a command gets; `screenRect` stays in the tool, which turns it into
 * `projectedKeys`.
 */
export type SelectionStrategy =
  | Readonly<{ kind: "box"; bounds: Bounds3i }>
  | Readonly<{
      kind: "rectangle";
      projectedKeys: readonly VoxelKey[];
      surfaceKeys: readonly VoxelKey[];
      bypass: boolean;
    }>
  | Readonly<{ kind: "color"; color: ColorHex }>;

export type SelectionResolution = Readonly<{
  keys: readonly VoxelKey[];
}>;

/**
 * Resolves one strategy against the active object's local container. Keys are
 * deduped and ascending; range and ownership of candidate keys are the
 * projection side's responsibility (see `resolveScope` for validated scopes).
 */
export function resolveSelection(
  strategy: SelectionStrategy,
  snapshot: UniformVoxSnapshot,
): SelectionResolution {
  switch (strategy.kind) {
    case "box":
      return { keys: Array.from(withinBox(snapshot, strategy.bounds)) };
    case "color":
      return { keys: Array.from(byColor(snapshot, strategy.color)) };
    case "rectangle": {
      // Bypass keeps the whole projected depth; otherwise only render-target
      // surface keys survive. Add targets empty positions, so the result is not
      // filtered by voxel existence.
      const surface = strategy.bypass ? undefined : new Set(strategy.surfaceKeys);
      const selected = new Set<VoxelKey>();

      for (const key of strategy.projectedKeys) {
        if (surface === undefined || surface.has(key)) {
          selected.add(key);
        }
      }

      return { keys: [...selected].sort((left, right) => left - right) };
    }
    default: {
      const unreachable: never = strategy;

      throw new Error(`Unsupported selection strategy: ${String(unreachable)}`);
    }
  }
}
