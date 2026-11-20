import { nationQuestWare } from "@shared/catalog/balance";

import { homeTutorialQuest } from "../../shared/quests/home-quest-book";
import { getProductionRule } from "../../shared/settlement/production-rules";
import { isOwnBuilding } from "../../shared/settlement/settlement-home";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import type { SettlementBuilding } from "../../shared/settlement/settlement-types";

/** Event steps whose action starts in a building: the trade office opens from the Harbour. */
const EVENT_BUILDINGS: Readonly<Record<string, number>> = { "trade-offer": 39 };

/** Show an owned objective building, or start placement when the building has not been built. */
export const showTutorialTarget = (
  id: string,
  simulation: SettlementSimulation,
  actions: {
    focus: (building: SettlementBuilding) => void;
    select: (typeId: number) => void;
  }
) => {
  const quest = homeTutorialQuest(id);
  if (!quest) return;
  const objective = quest.objective;
  const building = simulation.buildings().find((building) => {
    if (!isOwnBuilding(building)) return false;
    if (objective.kind === "build" || objective.kind === "stock")
      return building.typeId === objective.building;
    if (objective.kind === "produce")
      return getProductionRule(building.typeId, simulation.playerNation())?.outputs.includes(
        nationQuestWare(objective.ware, simulation.playerNation())
      );
    if (objective.kind === "event") return building.typeId === EVENT_BUILDINGS[objective.event];
    return false;
  });
  if (building) {
    actions.focus(building);
    return;
  }
  if (objective.kind === "build") actions.select(objective.building);
};
