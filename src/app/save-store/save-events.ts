import type { ShipFrame } from "../../render-common/ships/ship-frame";
import type { SettlementBuilding } from "../../shared/settlement/settlement-types";
import type { SaveCoordinator } from "./save-coordinator";

/**
 * Key game events that deserve a save soon, read from counters the frame already has: a construction or
 * workshop upgrade finished (more completed buildings / upgrade levels), or a ship sailed off or came back
 * (ships away from the island: voyages, expeditions, trade). The first observation only sets the baseline.
 */
export const createSaveEventWatch = () => {
  let built = -1, levels = -1, away = -1;
  return (buildings: readonly SettlementBuilding[], ships: readonly Pick<ShipFrame, "phase">[]) => {
    let nextBuilt = 0, nextLevels = 0, nextAway = 0;
    for (const building of buildings) {
      if (building.construction >= 1) nextBuilt++;
      nextLevels += building.workshopUpgrade?.level ?? 0;
    }
    for (const ship of ships) if (ship.phase === "away") nextAway++;
    const happened = built >= 0 && (nextBuilt > built || nextLevels > levels || nextAway !== away);
    built = nextBuilt;
    levels = nextLevels;
    away = nextAway;
    return happened;
  };
};

/** Tab closing: one last save (also with Autosave off); a page handoff that already saved stops the coordinator. */
export const watchPageHide = (coordinator: Pick<SaveCoordinator, "flush">, target: Pick<Window,
  "addEventListener" | "removeEventListener"> = window) => {
  const hide = () => { void coordinator.flush("pagehide"); };
  target.addEventListener("pagehide", hide);
  return () => target.removeEventListener("pagehide", hide);
};
