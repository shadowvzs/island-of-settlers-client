import type { I18n } from "@lingui/core";

import { translateMessage } from "../../shared/i18n/translate";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import { createExternalStore } from "../components/ui-store";
import { createDevelopmentTool } from "../settings/development/development-tool";
import { troopIcon } from "./army-icons";
import type { DebugClickModeControls } from "./debug-click-modes";
import { SETTLEMENT_DEBUG_MESSAGES as M } from "./debug-messages";
import type { MilitaryDebugControls } from "./military-debug/helpers";

type SoldierSpawnClick =
  Pick<DebugClickModeControls, "setSoldierSpawnMode" | "soldierSpawnMode" | "watchSoldierSpawnMode">;

/** The Development panel's soldier tools: the one-time training encounter and the soldier-spawn click mode. */
export const createMilitaryDebugTools = (options: {
  debugClick?: SoldierSpawnClick;
  i18n?: I18n;
  message: (message: string) => void;
  simulation: SettlementSimulation;
  onChange: () => void;
}) => {
  const { debugClick, simulation } = options;
  const icon = () => troopIcon(simulation.playerNation(), "heavy");
  const soldierSpawn = debugClick && createDevelopmentTool({
    icon: icon(),
    label: translateMessage(options.i18n, M.military.soldierSpawn.label),
    title: translateMessage(options.i18n, M.military.soldierSpawn.title),
    onClick: () => debugClick.setSoldierSpawnMode(!debugClick.soldierSpawnMode())
  });
  if (soldierSpawn) {
    soldierSpawn.update({ active: debugClick.soldierSpawnMode() });
    debugClick.watchSoldierSpawnMode(active => soldierSpawn.update({ active }));
  }
  const training = createDevelopmentTool({
    icon: icon(),
    label: translateMessage(options.i18n, M.military.training.label),
    title: translateMessage(options.i18n, M.military.training.title),
    onClick: () => {
      const result = simulation.startMilitaryTrainingEncounter();
      const ready = "Training encounter ready. Select troops using the right-side soldier icon.";
      options.message(result.ok ? ready : result.reason ?? "The training encounter cannot start here.");
      options.onChange();
    }
  });
  const hidden = createExternalStore(false);
  const controls: MilitaryDebugControls = { hidden, tools: [training, ...(soldierSpawn ? [soldierSpawn] : [])] };
  return { controls, hidden, training };
};
