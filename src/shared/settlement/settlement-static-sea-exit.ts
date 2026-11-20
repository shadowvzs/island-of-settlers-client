import { sameMaskBytes } from "../world/mask-bytes";
import type { WorldData } from "../world/world-data";
import { findSeaExit } from "./settlement-sea-exit";
import type { SettlementPoint } from "./settlement-types";

const EXIT_LIMIT = 256;

/**
 * Only for the planner's immutable turning mask, replaced when its sailing geometry changes. Exits read
 * nothing but that mask, so a terrain revision that leaves its bytes as they were keeps them
 * (JETTY-FRAMES: dry levelling no longer renews them).
 */
export const createStaticSeaExitLookup = (world: WorldData, turningMask: () => Uint8Array) => {
  const exits = new Map<string, SettlementPoint | null>();
  let mask: Uint8Array | undefined, copy = new Uint8Array(0), width = 0, depth = 0, revision = -1;
  const unchanged = (current: Uint8Array, nextRevision: number) => mask === current && width === world.cellsX &&
    depth === world.cellsZ && (revision === nextRevision || sameMaskBytes(copy, current));
  return (from: SettlementPoint, accepts?: (point: SettlementPoint) => boolean) => {
    const current = turningMask(), nextRevision = world.terrainRevision ?? 0;
    if (!unchanged(current, nextRevision)) {
      exits.clear(); mask = current; copy = current.slice(); width = world.cellsX; depth = world.cellsZ;
    }
    revision = nextRevision;
    // A custom predicate may depend on moving ships, so it never shares a static exit proof.
    if (accepts) return findSeaExit(world, current, from, accepts);
    // Both the nearest-turnable search and BFS depend on the floored origin, not its fractional pose.
    const key = `${Math.floor(from.x)},${Math.floor(from.z)}`;
    if (exits.has(key)) {
      const known = exits.get(key)!;
      return known && { ...known };
    }
    const found = findSeaExit(world, current, from);
    if (exits.size >= EXIT_LIMIT) exits.delete(exits.keys().next().value!);
    exits.set(key, found && { ...found });
    return found;
  };
};
