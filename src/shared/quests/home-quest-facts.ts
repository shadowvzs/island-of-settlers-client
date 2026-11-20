import { getContentEntry, splitContentId } from "@shared/catalog";
import { nationQuestWare } from "@shared/catalog/balance";

import type { QuestFacts } from "../../../../island-of-settlers-shared/src/script/engine/quests";
import type { WorkerNation } from "../../render-common/workers/worker-unit";
import type { TutorialResource } from "./home-quest-types";
import { isOwnBuilding } from "../settlement/settlement-home";

/**
 * The home island as the shared quest engine reads it (QU5, lane TRG6): live completed player buildings, their
 * stock and stationed soldiers, the action/production counters of the home quest state, and the nation drink rule.
 */
export interface HomeIslandFacts {
  buildings: readonly {
    construction: number;
    inventory: Readonly<Record<string, number>>;
    militaryFaction?: number;
    typeId: number;
  }[];
  /** Whether the home island lacks a natural resource; asked only for the active quest's resource. */
  missingResource?: (resource: TutorialResource) => boolean;
  soldiers: readonly { combat?: { faction: number; type: string }; stationed: boolean }[];
  /** Island stock of a ware (claim costs); absent: nothing in stock. */
  stored?: (ware: string) => number;
  surveyedDeposits?: number;
}

const codeByContent = new Map<string, number | undefined>();

const buildingCode = (contentId: string) => {
  if (!codeByContent.has(contentId)) codeByContent.set(contentId, getContentEntry(contentId)?.code);
  return codeByContent.get(contentId);
};

const contentKey = (contentId: string) => splitContentId(contentId)?.key ?? contentId;

/** Completed player-owned (faction 0) buildings of a type, pre-existing ones included; or their stock of a ware. */
const ownedBuildingTotal = (facts: HomeIslandFacts, contentId: string, ware?: string) => {
  const typeId = buildingCode(contentId);
  let total = 0;
  for (const building of facts.buildings) {
    if (building.typeId !== typeId || building.construction !== 1 || !isOwnBuilding(building)) continue;
    total += ware === undefined ? 1 : building.inventory[ware] ?? 0;
  }
  return total;
};

const soldierTotal = (facts: HomeIslandFacts, soldierType: string | null, stationed: boolean) => {
  const troop = soldierType === null ? null : contentKey(soldierType);
  let total = 0;
  for (const soldier of facts.soldiers) {
    if ((stationed && !soldier.stationed) || (soldier.combat?.faction ?? 0) !== 0) continue;
    if (troop !== null && soldier.combat?.type !== troop) continue;
    total++;
  }
  return total;
};

export const homeQuestFacts = (
  facts: HomeIslandFacts, counters: Readonly<Record<string, number>>, nation: WorkerNation, level: number
): QuestFacts => ({
  buildingCount: building => ownedBuildingTotal(facts, building),
  counter: key => counters[key] ?? 0,
  missingResource: resource => Boolean(facts.missingResource?.(resource)),
  playerLevel: () => level,
  questWare: ware => nationQuestWare(ware, nation),
  soldierCount: (soldierType, stationed) => soldierTotal(facts, soldierType, stationed),
  stock: (ware, building) => (building === null ? facts.stored?.(ware) ?? 0 : ownedBuildingTotal(facts, building, ware)),
  surveyedDeposits: () => facts.surveyedDeposits ?? 0
});
