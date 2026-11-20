import type { I18n } from "@lingui/core";

import { translateMessage } from "../../shared/i18n/translate";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import { createDebugClickMode } from "./debug-click-mode";
import { SETTLEMENT_DEBUG_MESSAGES as M } from "./debug-messages";
import { soldierSpawnMessage } from "./debug-tool-messages";

interface SoldierSpawnModeOptions {
  cancelPlacement: () => void;
  /** Active Lingui instance: the toggle's on/off notices follow the selected locale. */
  i18n?: I18n;
  message: (text: string, warning?: boolean) => void;
  pickGround: (x: number, y: number) => { x: number; z: number } | null;
  simulation: Pick<SettlementSimulation, "playerNation" | "spawnDebugSoldier">;
}

/** Development tool "Spawn soldier on click": while on, a map click spawns one random friendly field soldier. */
export const createSoldierSpawnMode = (options: SoldierSpawnModeOptions) => {
  const { message } = options;
  const spawnSoldierAt = (x: number, y: number) => {
    const point = options.pickGround(x, y);
    if (!point) { message("No walkable ground under the cursor.", true); return; }
    const notice = soldierSpawnMessage(options.simulation.spawnDebugSoldier({ x: point.x, z: point.z }),
      options.simulation.playerNation());
    message(notice.text, notice.warning);
  };
  return createDebugClickMode({
    activeMessage: () => translateMessage(options.i18n, M.debug.soldierSpawn.on),
    cancelPlacement: options.cancelPlacement,
    inactiveMessage: () => translateMessage(options.i18n, M.debug.soldierSpawn.off),
    message,
    onClick: spawnSoldierAt
  });
};
