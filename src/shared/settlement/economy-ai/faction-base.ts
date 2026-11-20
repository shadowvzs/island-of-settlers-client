import { DMath } from "../../math/deterministic-math";
import type { AreaRef } from "../commander/strategic-intents";
import { ownerOf } from "../settlement-ownership";
import { isRoadWorkShell, type SettlementBuilding, type SettlementContext } from "../settlement-types";
import { GOAL_POST_RADIUS } from "./constants";

/** Whether `building` is one of the faction's standing buildings (own state is fully known, plan §3.2). */
const isOwnBuilding = (building: SettlementBuilding, faction: number) =>
  ownerOf(building) === faction && !isRoadWorkShell(building);

/** The faction's base as a post: round its oldest standing building; undefined while it owns none. */
export const baseArea = (context: SettlementContext, faction: number): AreaRef | undefined => {
  let base: SettlementBuilding | undefined;
  for (const building of context.buildings)
    if (isOwnBuilding(building, faction) && (!base || building.uid < base.uid)) base = building;
  return base && { radius: GOAL_POST_RADIUS, x: base.x, z: base.z };
};

/**
 * The faction's front towards `x`, `z` (EAI4b's hold post): round its own building nearest to that point, the lower
 * uid on ties; undefined while it owns none.
 */
export const frontArea = (
  context: SettlementContext, faction: number, x: number, z: number, radius: number
): AreaRef | undefined => {
  let front: SettlementBuilding | undefined, best = Infinity;
  for (const building of context.buildings) {
    if (!isOwnBuilding(building, faction)) continue;
    const span = DMath.hypot(building.x - x, building.z - z);
    if (span > best || (span === best && front && building.uid > front.uid)) continue;
    front = building;
    best = span;
  }
  return front && { radius, x: front.x, z: front.z };
};
