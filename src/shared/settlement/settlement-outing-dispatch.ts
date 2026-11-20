import { DMath } from "../math/deterministic-math";
import { ownerThreatenedAt } from "./military-civilian-safety";
import { STORAGE_IDS } from "./production-rules";
import { reachableCells } from "./settlement-colony";
import { ownerOf, PLAYER_FACTION } from "./settlement-ownership";
import { groundPath } from "./settlement-paths";
import { availableIdleSettlers } from "./settlement-population";
import type { SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";
import { stockLandAt } from "./stock-lands";

/**
 * Where an outing (`settlement-outing.ts`: BD2 ruin clearing, EAI2d wall repair) starts and which way it walks. Both
 * read the work's owner, so a computer economy sends its own settlers from its own storages.
 */

/** The player's storages keep the raider door check; a computer economy's ask its own view of the door. */
const doorThreatened = (context: SettlementContext, storage: SettlementBuilding, owner: number) => {
  if (owner === PLAYER_FACTION) return context.civilianThreat?.doorThreatened(storage) === true;
  return ownerThreatenedAt(context, owner, storage.doorThreshold);
};

/**
 * The owner's nearest completed storage on the work point's land with an idle settler and a safe door: where an
 * outing (ruin clearing, EAI2d wall repair) starts.
 */
export const outingStorage = (context: SettlementContext, owner: number, point: SettlementPoint) => {
  const land = stockLandAt(context, point);
  if (land < 0) return undefined;
  let best: SettlementBuilding | undefined, bestDistance = Infinity;
  for (const storage of context.buildings) {
    if (storage.construction !== 1 || !STORAGE_IDS.has(storage.typeId) || ownerOf(storage) !== owner ||
      availableIdleSettlers(context, storage) < 1) continue;
    const distance = DMath.hypot(storage.access.x - point.x, storage.access.z - point.z);
    if (distance >= bestDistance || stockLandAt(context, storage.access) !== land ||
      doorThreatened(context, storage, owner)) continue;
    best = storage;
    bestDistance = distance;
  }
  return best;
};

/**
 * The way out to a work point: along the roads when they reach it (cheap), else over open ground. A failed ground
 * search scans the whole island, so the cell flood rules a walled-off point out first.
 */
export const outingPath = (context: SettlementContext, storage: SettlementBuilding, point: SettlementPoint) => {
  const road = context.options.roads.route(storage.access, point);
  if (road) return road.points.slice();
  if (!reachableCells(context, storage.access)(point)) return null;
  return groundPath(context, storage.access, point);
};
