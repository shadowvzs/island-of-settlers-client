import { DMath } from "../math/deterministic-math";
import { isOrdinaryTroopType, type MilitaryTroopType, ORDINARY_TROOP_TYPES } from "./military-combat-rules";
import { militaryGroundPath } from "./military-routing";
import { findHomeBuilding } from "./settlement-home";
import type { createSettlementMilitary } from "./settlement-military";
import { isNavigationClear } from "./settlement-navigation";
import type { SettlementContext, SettlementPoint } from "./settlement-types";

type Military = ReturnType<typeof createSettlementMilitary>;

/** The computer enemy faction of coastal raiders, colony forts and adventure camps. */
const DEBUG_ENEMY_FACTION = 1;
const DEBUG_ENEMY_TYPES: readonly MilitaryTroopType[] = ORDINARY_TROOP_TYPES;
const DEBUG_ENEMY_MAX_RANK = 2;
/** Cells searched around the click for walkable ground. */
const SEARCH_RADIUS = 12;
/** Route checks allowed per click, so a click in an unreachable pocket stays cheap. */
const MAX_ROUTE_CHECKS = 24;

export interface DebugEnemySpawn {
  id: number;
  point: SettlementPoint;
  rank: number;
  type: MilitaryTroopType;
}

/** A random troop type and rank 0-2. */
export const randomDebugEnemy = (random: () => number) => ({
  rank: Math.floor(random() * (DEBUG_ENEMY_MAX_RANK + 1)),
  type: DEBUG_ENEMY_TYPES[Math.floor(random() * DEBUG_ENEMY_TYPES.length)]!
});

/** The click point, then the map cell centres within SEARCH_RADIUS, nearest first. */
const candidatePoints = (context: SettlementContext, point: SettlementPoint) => {
  const { cellsX, cellsZ } = context.options.world;
  const cellX = Math.floor(point.x), cellZ = Math.floor(point.z);
  const cells: (SettlementPoint & { distance: number })[] = [];
  for (let z = Math.max(0, cellZ - SEARCH_RADIUS); z <= Math.min(cellsZ - 1, cellZ + SEARCH_RADIUS); z++)
    for (let x = Math.max(0, cellX - SEARCH_RADIUS); x <= Math.min(cellsX - 1, cellX + SEARCH_RADIUS); x++) {
      const distance = DMath.hypot(x + .5 - point.x, z + .5 - point.z);
      if (distance <= SEARCH_RADIUS) cells.push({ distance, x: x + .5, z: z + .5 });
    }
  cells.sort((a, b) => a.distance - b.distance);
  return [point, ...cells];
};

/**
 * Development tool "Spawn enemy on click": one enemy soldier of the given type and rank at the
 * clicked point, or the nearest walkable point the player's troops can reach from home. It is an
 * ordinary computer soldier: its raid objective goes through the normal commander and combat orders.
 */
export const spawnDebugEnemy = (
  context: SettlementContext, military: Military, point: SettlementPoint,
  { rank, type }: { rank: number; type: MilitaryTroopType }
): DebugEnemySpawn | null => {
  if (!isOrdinaryTroopType(type)) return null;
  const home = findHomeBuilding(context);
  let routeChecks = 0;
  for (const candidate of candidatePoints(context, point)) {
    const target = { x: candidate.x, z: candidate.z };
    if (!isNavigationClear(context, target)) continue;
    if (home) {
      if (routeChecks++ >= MAX_ROUTE_CHECKS) return null;
      if (!militaryGroundPath(context, target, home.access)) continue;
    }
    const id = military.combat.spawnOpponent(target, type, rank, DEBUG_ENEMY_FACTION);
    if (id !== null) {
      if (home && !military.combat.siegeOpponent([id], home.uid, DEBUG_ENEMY_FACTION))
        military.combat.commandOpponent([id], home.access, DEBUG_ENEMY_FACTION, "attackMove");
      return { id, point: target, rank, type };
    }
  }
  return null;
};
