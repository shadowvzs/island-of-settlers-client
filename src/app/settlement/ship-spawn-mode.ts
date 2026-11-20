import type { I18n } from "@lingui/core";

import { translateMessage } from "../../shared/i18n/translate";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import { createDebugClickMode } from "./debug-click-mode";
import { SETTLEMENT_DEBUG_MESSAGES as M } from "./debug-messages";

interface ShipSpawnModeOptions {
  cancelPlacement: () => void;
  i18n?: I18n;
  message: (text: string, warning?: boolean) => void;
  pickGround: (x: number, y: number) => { x: number; z: number } | null;
  simulation: Pick<SettlementSimulation, "spawnDebugShip">;
}

/** One real fleet ship per click; refusals keep placement active for another attempt. */
export const createShipSpawnMode = (options: ShipSpawnModeOptions) => {
  const copy = M.debug.shipSpawn;
  return createDebugClickMode({
    activeMessage: () => translateMessage(options.i18n, copy.on),
    cancelPlacement: options.cancelPlacement,
    inactiveMessage: () => translateMessage(options.i18n, copy.off),
    message: options.message,
    onClick: (x, y) => {
      const point = options.pickGround(x, y);
      const result = point && options.simulation.spawnDebugShip({ x: point.x, z: point.z });
      if (!result || !result.ok) {
        const reason = result ? result.reason : "water";
        options.message(translateMessage(options.i18n, copy[reason]), true);
        return;
      }
      options.message(translateMessage(options.i18n, copy.created), false);
    }
  });
};
