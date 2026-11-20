import { isBuildingCourtyardPointWalkable } from "../../render-common/buildings/building-courtyard";
import { stockStyleFor } from "../../render-common/buildings/building-stock-layout";
import type { WorkerNation } from "../../render-common/workers/worker-nation";
import type { CampaignOutcomeRecord } from "../../shared/campaign/campaign-map-outcome";
import { isAdventureIsland } from "../../shared/settlement/adventure-rules";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import type { SettlementBuilding, SettlementOptions, SettlementPoint } from "../../shared/settlement/settlement-types";
import type { createBuildingDemolitionFrames } from "./building-demolition-frames";
import { clearIslandRoadGround } from "./island-road-clearance";
import type { IslandSettlementOptions } from "./island-settlement";
import { createIslandStockContacts } from "./island-stock-contacts";

interface IslandSimulationHookContext {
  demolition: ReturnType<typeof createBuildingDemolitionFrames>;
  getSimulation: () => SettlementSimulation;
  message: (text: string, warning?: boolean) => void;
}

/** Workers enter a finished building's courtyard only where it is walkable (sites are open). */
export const canWorkerEnterBuildingPlot = (building: SettlementBuilding, point: SettlementPoint, nation?: WorkerNation) =>
  building.construction < 1 || isBuildingCourtyardPointWalkable(building.typeId, building.x, building.z,
    building.rotation, point, building.output, building.input, stockStyleFor(nation, building));

/** The notice of a decided campaign map (C9a; translated as domain text). */
const campaignOutcomeNotice = ({ kind, reason }: Readonly<CampaignOutcomeRecord>) => {
  if (kind === "victory") return "Victory: the campaign map is won.";
  if (reason === "harbourLost") return "The landing harbour fell: the campaign map is lost.";
  return "Defeat: the campaign map is lost.";
};

/** Simulation callbacks of the live island: player progress, notices and renderer/world upkeep. */
export const createIslandSimulationHooks = (
  options: IslandSettlementOptions,
  context: IslandSimulationHookContext
): Partial<SettlementOptions> => {
  const { demolition, getSimulation, message } = context;
  const navigationWarnings = new Set<string>();
  return {
    developmentAllowed: options.developmentAllowed ?? true,
    commanderOwner: options.player && { claim: (id, seed) => options.player!.claimCommander(id, seed),
      get: () => options.player!.commanderOwner(), release: id => options.player!.releaseCommander(id) },
    commanderVoyageSeconds: () => options.getIslandTravel?.()?.voyageSeconds?.() ?? 120,
    playerLevel: () => options.player?.level() ?? 1,
    onBuildingDemolished: building => {
      demolition.start(building, getSimulation().playerNation());
      options.player?.buildingRemoved();
      options.onBuildingDemolished?.(building);
    },
    onNavigationFailure: event => {
      options.onNavigationFailure?.(event);
      const key = `${event.job}/${event.building}`;
      if (navigationWarnings.has(key)) return;
      navigationWarnings.add(key);
      message(`${event.job} cannot reach its destination; goods are retained.`, true);
    },
    onColonyArrived: expedition => message(isAdventureIsland(expedition.island)
      ? "Adventure troops have landed: visit the island from the Colonies panel."
      : "Colony expedition has landed: the colony harbour is ready."),
    onCampaignOutcome: outcome => {
      options.onCampaignOutcome?.(outcome);
      message(campaignOutcomeNotice(outcome), outcome.kind === "defeat");
    },
    onScenarioOutcome: (status, coins) => message(status === "won"
      ? `Scenario completed${coins ? ` — ${coins} coin reward` : ""}.` : "Scenario expired."),
    onProduced: ware => options.player?.produced(ware),
    onTutorialEvent: (key, amount) => options.player?.tutorialEvent(key, amount),
    onBuildingCompleted: building => {
      const simulation = getSimulation();
      clearIslandRoadGround(options.world, options.renderer,
        simulation.roadSegments().map(road => ({ ...road, tier: road.tier ?? "dirt" })),
        simulation.bridgeSiteFrames().flatMap(site => site.segments));
      options.player?.buildingCompleted(building);
    },
    stockContact: options.stockContact ?? createIslandStockContacts(options.world,
      (x, z) => getSimulation().isOccupied(x, z), building => getSimulation().buildingNation(building)),
    canWorkerEnterPlot: options.canWorkerEnterPlot ?? ((building, point) =>
      canWorkerEnterBuildingPlot(building, point, getSimulation().buildingNation(building)))
  };
};
