import { distanceBetween } from "../settlement-geometry";
import type { SettlementPoint } from "../settlement-types";
import { retargetReach } from "./commander-orders";
import type { CommanderAction, RoleGroupMemory, SquadMemory } from "./commander-types";

type FactionMemory = Map<number, SquadMemory>;
export type SquadMemorySave = [number, [number, SquadMemory][]][];

/**
 * The squad's memory after a decision: the standing target is kept while the action is the same and the
 * new target is within `retargetReach` of it (`RETARGET`; a retreat's legs `WAYPOINT_REACH`). A squad that used
 * role groups (A14-1) remembers them; an unchanged memory without groups is returned as it is (no new object).
 */
export const rememberDecision = (
  memory: SquadMemory | undefined,
  action: CommanderAction,
  point: SettlementPoint | undefined,
  groups?: readonly RoleGroupMemory[]
): SquadMemory => {
  if (memory?.action !== action) return groups ? { action, groups, target: point } : { action, target: point };
  const standing = memory.target;
  const kept = standing !== undefined && (!point || distanceBetween(standing, point) < retargetReach(action));
  const target = kept ? standing : point;
  if (groups) return { action, groups, target };
  return target === standing && !memory.groups ? memory : { action, target };
};

/**
 * Last decision of each squad (by its first uid), per faction, in decision order. Each faction owns two
 * maps that swap at every decision, so a decision allocates no map.
 */
export const createSquadMemories = () => {
  const memories = new Map<number, FactionMemory>();
  const spares = new Map<number, FactionMemory>();
  return {
    of: (faction: number): ReadonlyMap<number, SquadMemory> | undefined => memories.get(faction),
    /** The empty map the faction's running decision fills. */
    open: (faction: number): FactionMemory => {
      const next = spares.get(faction) ?? new Map<number, SquadMemory>();
      next.clear();
      return next;
    },
    /** The filled map becomes the faction's memory; the one it replaces is reused next time. */
    commit: (faction: number, next: FactionMemory) => {
      const previous = memories.get(faction);
      if (previous) spares.set(faction, previous);
      memories.set(faction, next);
    },
    save: (): SquadMemorySave =>
      structuredClone(
        [...memories].map(([faction, memory]) => [faction, [...memory]] as [number, [number, SquadMemory][]])
      ),
    restore: (saved: SquadMemorySave | undefined) => {
      memories.clear();
      spares.clear();
      for (const [faction, memory] of saved ?? []) memories.set(faction, new Map(structuredClone(memory)));
    },
    clear: () => {
      memories.clear();
      spares.clear();
    }
  };
};
