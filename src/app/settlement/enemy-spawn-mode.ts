import type { I18n } from "@lingui/core";

import { translateMessage } from "../../shared/i18n/translate";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import { createDebugClickMode } from "./debug-click-mode";
import { SETTLEMENT_DEBUG_MESSAGES as M } from "./debug-messages";
import { enemySpawnMessage } from "./debug-tool-messages";

interface EnemySpawnModeOptions {
  cancelPlacement: () => void;
  /** The island's enemy army nation, which names the spawned soldier. */
  enemyNation: () => string;
  /** Active Lingui instance: the toggle's on/off notices follow the selected locale. */
  i18n?: I18n;
  message: (text: string, warning?: boolean) => void;
  pickGround: (x: number, y: number) => { x: number; z: number } | null;
  simulation: Pick<SettlementSimulation, "spawnDebugEnemy">;
}

/** Development tool "Spawn enemy on click": while on, a map click spawns one enemy, nothing else. */
export const createEnemySpawnMode = (options: EnemySpawnModeOptions) => {
  const { message } = options;
  const spawnEnemyAt = (x: number, y: number) => {
    const point = options.pickGround(x, y);
    if (!point) { message("No ground under the cursor.", true); return; }
    const notice = enemySpawnMessage(options.simulation.spawnDebugEnemy({ x: point.x, z: point.z }), options.enemyNation());
    message(notice.text, notice.warning);
  };
  return createDebugClickMode({
    activeMessage: () => translateMessage(options.i18n, M.debug.enemySpawn.on),
    cancelPlacement: options.cancelPlacement,
    inactiveMessage: () => translateMessage(options.i18n, M.debug.enemySpawn.off),
    message,
    onClick: spawnEnemyAt
  });
};
