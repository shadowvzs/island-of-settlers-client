import type { CampaignWareAmount } from "../../../../island-of-settlers-shared/src/campaign/campaign-model";
import type { ScriptWorldPort } from "../../../../island-of-settlers-shared/src/script/engine/ports";
import type { QuestFacts } from "../../../../island-of-settlers-shared/src/script/engine/quests";
import { isTutorialResourceMissing } from "../progression/tutorial-resources";
import { type HomeIslandFacts, homeQuestFacts } from "../quests/home-quest-facts";
import { homeStorage } from "../settlement/colony-economy";
import { payQuestCost } from "../settlement/settlement-quest-claim";
import type { SettlementContext } from "../settlement/settlement-types";
import { contextPlayerLevel } from "../settlement/sim-rules";

/**
 * The quest side of the settlement world port (TRG6 on TRG3a): what built-in objectives read on a script-running
 * island, the claim cost taken from its stock, and the campaign map status of the replay rule. Everything is read
 * from the simulation itself (or a recorded/stable option), so engine quest state stays replay-deterministic.
 * Action counters (`counterReached`, produce/action objectives) come from the island's own counter store (TRG4).
 */
type QuestPort = Pick<ScriptWorldPort, "campaignMapStatus" | "payQuestCost" | "questFacts">;

const islandFacts = (context: SettlementContext): HomeIslandFacts => ({
  buildings: context.buildings,
  missingResource: resource => isTutorialResourceMissing(resource, context.options.world,
    context.options.resourceTargets, context.options.countHuntableAnimals),
  soldiers: [...context.military?.soldierRecords?.() ?? []],
  stored: ware => homeStorage(context.buildings)?.inventory[ware] ?? 0,
  surveyedDeposits: context.options.world.mineZones?.filter(zone => zone.surveyed).length ?? 0
});

const currentFacts = (context: SettlementContext) => homeQuestFacts(islandFacts(context), {},
  context.playerNation ?? "roman", contextPlayerLevel(context) ?? 0);

/** Each read builds the facts from the live island (the engine reads them on the one-second cadence only). */
const liveQuestFacts = (context: SettlementContext): QuestFacts => ({
  buildingCount: building => currentFacts(context).buildingCount(building),
  counter: key => context.script?.counters.get(key) ?? 0,
  missingResource: resource => currentFacts(context).missingResource(resource),
  playerLevel: () => currentFacts(context).playerLevel(),
  questWare: ware => currentFacts(context).questWare(ware),
  soldierCount: (type, stationed) => currentFacts(context).soldierCount(type, stationed),
  stock: (ware, building) => currentFacts(context).stock(ware, building),
  surveyedDeposits: () => currentFacts(context).surveyedDeposits(),
  worldHour: () => context.script?.environmentReading()?.hour ?? null
});

/** Cost lines hold the Roman drink chain like every quest; the island pays its own nation's ware. */
const costRecord = (context: SettlementContext, cost: readonly CampaignWareAmount[]) => {
  const facts = currentFacts(context);
  return Object.fromEntries(cost.map(line => [facts.questWare(line.ware), line.amount]));
};

export const createSettlementQuestPort = (context: SettlementContext): QuestPort => ({
  ...(context.options.campaignMapStatus ? { campaignMapStatus: context.options.campaignMapStatus } : {}),
  payQuestCost: cost => payQuestCost(context.buildings, costRecord(context, cost),
    ware => homeStorage(context.buildings)?.inventory[ware] ?? 0),
  questFacts: liveQuestFacts(context)
});
