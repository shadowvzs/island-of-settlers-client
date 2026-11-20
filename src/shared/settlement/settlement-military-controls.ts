import { MILITARY_COIN_CAPACITIES, MILITARY_DRINK_LIMIT } from "../balance/military";
import { catapultAmmoUnits } from "./catapult-ammo-kinds";
import { catapultStatus } from "./military-catapult";
import { catapultRoofStone } from "./military-catapult-ammo";
import { catapultCarriedStone, catapultGroundStone } from "./military-catapult-resupply";
import {
  compositionTotal, type GarrisonComposition, isValidComposition, militaryBuildingCapacity
} from "./military-garrison-rules";
import type {
  MilitaryBuildingSnapshot, MilitaryTrainingFocus, SettlementSoldier
} from "./settlement-military";
import { compositionOf } from "./settlement-military-garrison-scheduler";
import type { SoldierBuildingIndex } from "./settlement-military-soldier-index";
import { stationedRankCounts } from "./settlement-military-supplies";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";

const catapultBuildingSnapshot = (
  building: SettlementBuilding, soldiers: Iterable<SettlementSoldier>, actors: readonly SettlementActor[]
) => {
  if (building.typeId !== 16) return {};
  return { stoneStock: catapultRoofStone(building), stoneGround: catapultGroundStone(building),
    stoneCarried: catapultCarriedStone(building), stoneIncoming: catapultAmmoUnits(building.incoming),
    catapultStatus: catapultStatus(building, [...soldiers], actors) };
};

export interface MilitaryControlsDeps {
  coinsAllowed: Map<number, boolean>;
  compositions: Map<number, GarrisonComposition>;
  drinkWare: string;
  militaryBuildings: () => SettlementBuilding[];
  soldierIndex: SoldierBuildingIndex;
  soldiers: Map<number, SettlementSoldier>;
  target: (building: SettlementBuilding) => number;
  targets: Map<number, number>;
  trainingFocus: Map<number, MilitaryTrainingFocus>;
}

/**
 * The player's per-building garrison levers (count, composition, coins, training focus) and the military building
 * snapshot the UI reads. Split out of `createSettlementMilitary`.
 */
export const createMilitaryControls = (context: SettlementContext, deps: MilitaryControlsDeps) => {
  const {
    coinsAllowed, compositions, drinkWare, militaryBuildings, soldierIndex, soldiers, target, targets, trainingFocus
  } = deps;
  const isMilitaryUid = (uid: number) => militaryBuildings().some((building) => building.uid === uid);
  return {
    setTarget: (uid: number, count: number) => {
      const building = militaryBuildings().find((entry) => entry.uid === uid);
      if (!building || !Number.isFinite(count)) return;
      compositions.delete(uid);
      targets.set(uid, Math.max(building.territoryClaimed ? 1 : 0,
        Math.min(militaryBuildingCapacity(building), Math.floor(count))));
    },
    /** Manual per-type counts; null returns the building to automatic filling. */
    setComposition: (uid: number, value: GarrisonComposition | null) => {
      const building = militaryBuildings().find((entry) => entry.uid === uid);
      if (!building) return false;
      if (value && (!isValidComposition(building.typeId, value) ||
        compositionTotal(value) > militaryBuildingCapacity(building) ||
        (building.territoryClaimed && compositionTotal(value) < 1))) return false;
      if (!value) {
        compositions.delete(uid);
        return true;
      }
      compositions.set(uid, { archer: value.archer, heavy: value.heavy, shield: value.shield });
      targets.delete(uid);
      return true;
    },
    setCoinsAllowed: (uid: number, allowed: boolean) => {
      if (isMilitaryUid(uid)) coinsAllowed.set(uid, allowed);
    },
    setTrainingFocus: (uid: number, focus: MilitaryTrainingFocus) => {
      if (!isMilitaryUid(uid) || !["balanced", "elite"].includes(focus)) return false;
      trainingFocus.set(uid, focus);
      return true;
    },
    snapshot: (): MilitaryBuildingSnapshot[] => {
      // External readers see the current assignments, not the last scheduler pass.
      soldierIndex.rebuild();
      return militaryBuildings().map((building) => {
        const assigned = soldierIndex.of(building.uid), stationed = assigned.filter((soldier) => soldier.stationed);
        return { uid: building.uid, typeId: building.typeId, capacity: militaryBuildingCapacity(building),
          target: target(building), trainingFocus: trainingFocus.get(building.uid) ?? "balanced",
          coinsAllowed: coinsAllowed.get(building.uid) !== false,
          coinCapacity: MILITARY_COIN_CAPACITIES[building.typeId] ?? 0,
          ...catapultBuildingSnapshot(building, soldiers.values(), context.actors),
          coinStock: building.input.coins ?? 0, coinIncoming: building.incoming.coins ?? 0,
          drinkWare, drinkCapacity: building.typeId === 16 ? 0 : MILITARY_DRINK_LIMIT,
          drinkStock: building.input[drinkWare] ?? 0, drinkIncoming: building.incoming[drinkWare] ?? 0,
          stationed: stationed.length, travelling: assigned.length - stationed.length,
          ranks: stationed.map((soldier) => soldier.rank),
          stationedTroops: compositionOf(soldierIndex.of, building.uid, true),
          assignedTroops: compositionOf(soldierIndex.of, building.uid),
          stationedByRank: stationedRankCounts(stationed),
          manual: compositions.has(building.uid) ? { ...compositions.get(building.uid)! } : null };
      });
    }
  };
};
