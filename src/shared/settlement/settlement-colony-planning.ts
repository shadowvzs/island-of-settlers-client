import { COLONY_CREW, COLONY_SUPPLIES, TROOP_DECK_SLOTS } from "../balance/colonies";
import { type ActiveOperation, operationBlockReason } from "../campaign/active-operation";
import { type CampaignLaunchRequirements, campaignRequirementStatus } from "../campaign/campaign-requirements";
import type { AdventureIsland } from "./adventure-rules";
import {
  colonyArrivalSeconds, colonyDeckItems, type ColonyIsland, colonyTroopCount, colonyTroopReason,
  type ColonyTroops, packColonyLoads
} from "./colony-expedition-rules";
import { expeditionTroopCap } from "./expedition-debug-rules";
import { expeditionReadinessReason, expeditionRequiredSoldiers } from "./expedition-launch-rules";
import { harbourHelperSupply } from "./harbour-helper-supply";
import { isOrdinaryTroopType, type MilitaryTroopType } from "./military-combat-rules";
import { colonyCommanderCapReason, colonyCommanderReason } from "./settlement-colony-commander";
import type { ColonyExpeditionPlan } from "./settlement-colony-expeditions";
import { COMMANDER_DECK_SLOTS } from "./settlement-commander-transport";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";
import { contextPlayerLevel } from "./sim-rules";

export type ExpeditionIsland = ColonyIsland | AdventureIsland;
export interface ColonyPlanningDeps {
  context: SettlementContext;
  availableTroops(sourceUid?: number): ColonyTroops;
  freeShips(): number;
  harbourOf(uid: number): SettlementBuilding | undefined;
  /** What holds the shared operation slot from this island's own expeditions (`activeOperation`). */
  operation(): ActiveOperation | null;
  talentVoyage(island: ExpeditionIsland): number;
}
const isAdventure = (island: ExpeditionIsland) => "kind" in island;
const suppliesOf = (island: ExpeditionIsland) => isAdventure(island) ? {} : COLONY_SUPPLIES;
const crewOf = (island: ExpeditionIsland) => isAdventure(island) ? 0 : COLONY_CREW;

/** Pure colony/adventure planning: shared by the planner and the accepted launch. */
export const createColonyPlanning = (deps: ColonyPlanningDeps) => {
  const { availableTroops, context, freeShips, harbourOf, operation } = deps;
  const launchReason = (
    sourceUid: number, island: ExpeditionIsland, troops: Partial<ColonyTroops>, commanderId?: string
  ) => {
    const blocked = operationBlockReason(operation());
    if (blocked) return blocked;
    if (Object.entries(troops).some(([type, count]) => !isOrdinaryTroopType(type) && (count ?? 0) > 0))
      return "Ordinary cavalry is retired";
    const commanderIssue = colonyCommanderReason(context, commanderId);
    if (commanderIssue) return commanderIssue;
    const capIssue = colonyCommanderCapReason(troops, commanderId, expeditionTroopCap(island));
    if (capIssue) return capIssue;
    const required = expeditionRequiredSoldiers(island);
    const readiness = expeditionReadinessReason(required, availableTroops(sourceUid), freeShips());
    if (readiness) return readiness;
    if (colonyTroopCount(troops) < required) return `Select at least ${required} soldiers for this target`;
    if (!harbourOf(sourceUid)) return "Choose a completed harbour";
    return colonyTroopReason(troops, island.difficulty, availableTroops(sourceUid), expeditionTroopCap(island));
  };
  const planFor = (
    sourceUid: number, island: ExpeditionIsland | undefined, troops: Partial<ColonyTroops>, commanderId?: string
  ) => {
    const crew = island ? crewOf(island) : COLONY_CREW;
    const passengers = Array.from({ length: crew }, (_, uid) => ({ slots: 1, uid }));
    if (commanderId) passengers.push({ slots: COMMANDER_DECK_SLOTS, uid: -1 });
    for (const [type, count] of Object.entries(troops) as Array<[MilitaryTroopType, number]>)
      if (isOrdinaryTroopType(type)) for (let index = 0; index < count; index++)
        passengers.push({ slots: TROOP_DECK_SLOTS[type], uid: -1 });
    const loads = packColonyLoads(colonyDeckItems(passengers, island ? suppliesOf(island) : COLONY_SUPPLIES));
    const ships = harbourOf(sourceUid) ? freeShips() : 0;
    return { requiredSoldiers: island && expeditionRequiredSoldiers(island),
      launchReason: island ? launchReason(sourceUid, island, troops, commanderId) : "Choose an island",
      loads: loads.length, seconds: colonyArrivalSeconds(loads, ships, island && deps.talentVoyage(island)),
      ships, trips: ships ? Math.ceil(loads.length / ships) : 0,
      commanderDeckSlots: commanderId ? COMMANDER_DECK_SLOTS : undefined,
      commanderTroopCap: commanderId ? 1 : undefined,
      commanderReason: island ? colonyCommanderReason(context, commanderId) : null } satisfies ColonyExpeditionPlan;
  };
  /**
   * The campaign launch check from the same pools the colony gate reads. `operation`: the full slot (the session
   * adds the filed colonies, adventure and campaign run); this island's own expeditions by default.
   */
  const campaignRequirements = (
    sourceUid: number, launch: CampaignLaunchRequirements, slot: ActiveOperation | null = operation()
  ) => {
    const source = harbourOf(sourceUid);
    const supply = source && { goods: (ware: string) => source.inventory[ware] ?? 0, idleShips: freeShips(),
      settlers: harbourHelperSupply(context, source), soldiers: availableTroops(sourceUid) };
    return campaignRequirementStatus(launch, supply,
      { operation: slot, playerLevel: contextPlayerLevel(context) ?? 0 });
  };
  return { campaignRequirements, launchReason, planFor };
};
