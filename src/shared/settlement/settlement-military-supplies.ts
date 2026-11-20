import { MILITARY_COIN_CAPACITIES, MILITARY_DRINK_LIMIT } from "../balance/military";
import { catapultAmmoChoice, DEFAULT_CATAPULT_AMMO } from "./catapult-ammo-kinds";
import { catapultStoneDemand } from "./military-catapult-resupply";
import { type GarrisonTroop,isGarrisonTroop } from "./military-garrison-rules";
import type {
  GarrisonRankCounts, MilitarySupplyDemand, SettlementSoldier
} from "./settlement-military";
import { MAX_SOLDIER_RANK } from "./settlement-military-ranks";
import type { SettlementBuilding } from "./settlement-types";

const emptyRankCounts = (): Record<GarrisonTroop, number[]> => ({
  archer: Array<number>(MAX_SOLDIER_RANK + 1).fill(0),
  heavy: Array<number>(MAX_SOLDIER_RANK + 1).fill(0),
  shield: Array<number>(MAX_SOLDIER_RANK + 1).fill(0)
});

/** Physically inside soldiers by type and rank; travelling troops are excluded. */
export const stationedRankCounts = (soldiers: readonly SettlementSoldier[]): GarrisonRankCounts => {
  const counts = emptyRankCounts();
  for (const soldier of soldiers) {
    const type = soldier.combat?.type ?? "shield";
    if (!soldier.stationed || !isGarrisonTroop(type)) continue;
    const rankCount = counts[type][soldier.rank];
    if (rankCount !== undefined) counts[type][soldier.rank] = rankCount + 1;
  }
  return counts;
};

/** A tower names its ammunition ware only when it is not the default plain stone. */
const catapultSupplyDemand = (building: SettlementBuilding, noDemand: MilitarySupplyDemand, standing: boolean) => {
  const stone = standing ? catapultStoneDemand(building) : 0, stoneWare = catapultAmmoChoice(building);
  return stoneWare === DEFAULT_CATAPULT_AMMO ? { ...noDemand, stone } : { ...noDemand, stone, stoneWare };
};

/** Local coins and national drink still missing for promotion; never warehouse totals. */
export const militarySupplyDemand = (
  building: SettlementBuilding | undefined, soldiers: readonly SettlementSoldier[],
  coinsAllowed: boolean | undefined, drinkWare: string, standing = true
): MilitarySupplyDemand => {
  const noDemand = { coins: 0, drink: 0, drinkWare };
  if (building?.typeId === 16) return catapultSupplyDemand(building, noDemand, standing);
  if (!building || MILITARY_COIN_CAPACITIES[building.typeId] === undefined ||
    !soldiers.some((soldier) => soldier.stationed && soldier.rank < MAX_SOLDIER_RANK)) return noDemand;
  // The toggle controls coins only; already-delivered coins keep funding training, so their
  // matching drinks may still be refilled.
  const coins = coinsAllowed === false ? 0 : Math.max(0, MILITARY_COIN_CAPACITIES[building.typeId]! -
    (building.input.coins ?? 0) - (building.incoming.coins ?? 0));
  const drink = Math.max(0, MILITARY_DRINK_LIMIT -
    (building.input[drinkWare] ?? 0) - (building.incoming[drinkWare] ?? 0));
  return { coins, drink, drinkWare };
};
