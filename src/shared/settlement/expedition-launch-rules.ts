import { EXPEDITION_ENEMY_FORCE_RATIO } from "../balance/colonies";
import { adventureEnemyCount, type AdventureIsland, isAdventureIsland } from "./adventure-rules";
import { type ColonyIsland, colonyTroopCount, type ColonyTroops } from "./colony-expedition-rules";
import { colonyFortPlans } from "./colony-island-rules";

/** Uses the same roster planners that populate the target island. */
export const expeditionRequiredSoldiers = (island: ColonyIsland | AdventureIsland) => {
  const enemies = isAdventureIsland(island) ? adventureEnemyCount(island.difficulty)
    : colonyFortPlans(island.difficulty, island.seed).reduce((sum, fort) => sum + fort.troops.length, 0);
  return Math.max(1, Math.ceil(enemies * EXPEDITION_ENEMY_FORCE_RATIO));
};

/** A ship carrying another order, cargo or passengers cannot begin an expedition. */
export const isIdleExpeditionShip = (ship: {
  visitor?: boolean; phase: string; orderId?: number; passengers?: number; cargo?: Readonly<Record<string, number>>;
  reservedFor?: number;
}) => !ship.visitor && ship.phase === "idle" && ship.orderId === undefined && ship.reservedFor === undefined &&
  !ship.passengers && !Object.values(ship.cargo ?? {}).some(count => count > 0);

/** Combined readiness explains every missing prerequisite on the whole action button. */
export const expeditionReadinessReason = (required: number, available: Partial<ColonyTroops>, idleShips: number) => {
  const count = colonyTroopCount(available);
  const reasons: string[] = [];
  if (count < required) reasons.push(`Requires ${required} eligible soldiers (${count} available)`);
  if (!idleShips) reasons.push("Requires an idle player-owned ship");
  return reasons.join("; ") || null;
};
