import type { ScenarioCatapult } from "../world/scenario-catapult";
import { type DifficultyLevel,difficultyScaled } from "./difficulty";
import { CATAPULT_AMMO_CAPACITY,CATAPULT_ROOF_CAPACITY } from "./military-catapult-ammo";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";

/** Authored hostile ammunition at the live difficulty, never above the rack capacity. */
export const difficultyCatapultStones = (authored: ScenarioCatapult, level?: DifficultyLevel) =>
  Math.min(CATAPULT_AMMO_CAPACITY, difficultyScaled(authored.stones, "startingStock", level));

/** Authored hostile people are independent of the friendly settlement's recruitment pool. */
export const initializeHostileCatapult = (
  context: SettlementContext, building: SettlementBuilding, authored: ScenarioCatapult
) => {
  const stones = difficultyCatapultStones(authored, context.difficulty);
  building.enemyCatapultVariant = authored.variant;
  building.input.stone = authored.roofStones ?? Math.min(CATAPULT_ROOF_CAPACITY, stones);
  building.catapultSupply = { ground: stones - building.input.stone };
  const actor: SettlementActor = {
    uid: context.nextActor++, ...building.doorThreshold, y: building.y, yaw: 0, visible: false,
    hostileCivilianFaction: building.militaryFaction,
    job: "Carrier", action: "idle", ware: null, phase: "inside", building: building.uid,
    home: building.uid, path: [], pathIndex: 0, timer: 0, animationTime: 0
  };
  building.worker = actor.uid;
  context.actors.push(actor);
};
