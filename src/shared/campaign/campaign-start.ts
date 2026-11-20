import type {
  CampaignCargo, CampaignMap
} from "../../../../island-of-settlers-shared/src/campaign/campaign-model";
import {
  narrowBuildingAvailability
} from "../../../../island-of-settlers-shared/src/game-settings/building-availability";
import { campaignScenarioRules } from "../../../../island-of-settlers-shared/src/campaign/campaign-scenario-rules";
import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { HARBOUR_TYPE_ID } from "../settlement/building-type-ids";
import { militaryHealth } from "../settlement/military-combat-rules";
import { addGood } from "../settlement/production-rules";
import type { EmigratedTroop } from "../settlement/settlement-military";
import type { Goods, SettlementOptions } from "../settlement/settlement-types";
import type { WorldData } from "../world/world-data";
import { campaignVictoryCheck } from "./campaign-victory";

/**
 * The start state of a campaign attempt (C9a): the map file's world with the campaign map's rules applied, the
 * landing harbour as the only player building, the delivered cargo (or, without a home, the map file's start setup)
 * as its stock, settlers and soldiers, the home nation and Normal difficulty (the campaign ignores the difficulty
 * setting). Pure, so two starts from the same record and cargo build identical islands.
 */

export type CampaignRuleSource = Pick<CampaignMap, "commanderAllowed" | "disabledBuildings" | "lodgeAllowed">;

/** The campaign record's per-type level caps (`maxLevel` set) as map availability level caps. */
const campaignLevelCaps = (map: CampaignRuleSource) => {
  const levelCaps = map.disabledBuildings.flatMap(({ buildingType, maxLevel }) =>
    maxLevel === null ? [] : [{ level: maxLevel, type: buildingType }]);
  return levelCaps.length ? { levelCaps: levelCaps.sort((first, second) => first.type - second.type) } : undefined;
};

/**
 * The map file's world as the run plays it: the campaign map's blacklist, commander rule and level caps over its
 * scenario (the caps narrow the map file's own availability; MAP BUILDING AVAILABILITY).
 */
export const campaignRunWorld = (world: WorldData, map: CampaignRuleSource): WorldData => {
  const scenario = world.scenario;
  if (scenario?.kind !== "campaign") throw new Error("A campaign run needs a campaign map file");
  if (!scenario.harbourPlot) throw new Error("A campaign run needs the landing harbour plot");
  const availability = narrowBuildingAvailability(scenario.availability, campaignLevelCaps(map));
  return { ...world, scenario: { ...scenario, ...campaignScenarioRules(map), ...(availability ? { availability } : {}) } };
};

/** The delivered goods as the landing harbour's stock (lines of the same ware add up). */
export const campaignCargoStock = (goods: CampaignCargo["goods"]): Goods => {
  const stock: Goods = {};
  for (const line of goods) addGood(stock, line.ware, line.amount);
  return stock;
};

/** The delivered soldiers as full-health recruits, in cargo line order. */
export const campaignCargoTroops = (soldiers: CampaignCargo["soldiers"]): EmigratedTroop[] =>
  soldiers.flatMap(({ amount, type }) =>
    Array.from({ length: amount }, () => ({ hp: militaryHealth(type, 0), rank: 0, type })));

export interface CampaignStartInput {
  /**
   * What the departure delivered (C8); the run never sees what stayed at home. Absent on a start without a home
   * (plan §11.2, GS3): the map file's own start setup (stock or nation default, settlers, start soldiers) applies.
   */
  cargo?: CampaignCargo;
  /** The map record's victory rule and region library (C9b); absent: only the map script decides victory. */
  map?: Pick<CampaignMap, "regions" | "victory">;
  /** The home island's nation. */
  nation: WorkerNation;
}

/** An expedition start brings its cargo and nothing of the map's start setup (owner Q-G5: cargo only). */
const cargoStart = (cargo: CampaignCargo | undefined) => {
  if (!cargo) return {};
  return { initialSettlers: cargo.settlers, initialStock: campaignCargoStock(cargo.goods) };
};

/** The settlement options of a fresh campaign start; the caller adds world, roads, clock and callbacks. */
export const campaignStartOptions = ({ cargo, map, nation }: CampaignStartInput) => ({
  ...(map ? { campaignVictory: campaignVictoryCheck(map.victory, map.regions) } : {}),
  ...cargoStart(cargo),
  difficulty: "normal",
  homeBuilding: HARBOUR_TYPE_ID,
  playerNation: nation
}) satisfies Partial<SettlementOptions>;
