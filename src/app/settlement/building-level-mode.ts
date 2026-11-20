import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import type { SettlementBuilding } from "../../shared/settlement/settlement-types";
import { createDebugClickMode } from "./debug-click-mode";
import { buildingLevelMessage } from "./debug-tool-messages";

interface BuildingLevelModeOptions {
  buildingName: (typeId: number) => string;
  cancelPlacement: () => void;
  message: (text: string, warning?: boolean) => void;
  onRaised: () => void;
  pickBuilding: (x: number, y: number) => SettlementBuilding | undefined;
  simulation: Pick<SettlementSimulation, "debugRaiseBuildingLevel">;
}

/** Development tool "Raise building level": while on, a clicked building gains one level for free. */
export const createBuildingLevelMode = (options: BuildingLevelModeOptions) => {
  const { buildingName, message } = options;
  const raiseBuildingAt = (x: number, y: number) => {
    const building = options.pickBuilding(x, y);
    if (!building) { message("No building under the cursor.", true); return; }
    const notice = buildingLevelMessage(options.simulation.debugRaiseBuildingLevel(building.uid), buildingName);
    message(notice.text, notice.warning);
    options.onRaised();
  };
  return createDebugClickMode({
    activeMessage: "Raise building level: click a building. Escape or the button turns it off.",
    cancelPlacement: options.cancelPlacement,
    inactiveMessage: "Raise building level is off.",
    message,
    onClick: raiseBuildingAt
  });
};
