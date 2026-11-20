import type { I18n } from "@lingui/core";

import { getBuildingDefinition } from "../../render-common/buildings/building-catalog";
import { translateMessage } from "../../shared/i18n/translate";
import type { ColonyFortState } from "../../shared/settlement/settlement-colony-forts";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import type { SettlementBuilding } from "../../shared/settlement/settlement-types";
import { SETTLEMENT_MESSAGES as M } from "../settlement-ui/messages";

type FortMessage = (text: string, warning: boolean, building: SettlementBuilding) => void;

const fortName = (building: SettlementBuilding) => getBuildingDefinition(building.typeId).name;

/**
 * News about the enemy forts of a colony: the moment one loses its last defender (its walls can now
 * be attacked) and the moment its walls fall (it burns down; colony forts are never captured).
 */
export const createColonyFortMessages = (message: FortMessage, i18n?: I18n) => {
  let previous = new Map<number, ColonyFortState>();
  return (simulation: SettlementSimulation) => {
    const states = simulation.colony()?.fortStates ?? [];
    const next = new Map(states.map(fort => [fort.uid, fort]));
    for (const [uid, before] of previous) {
      const after = next.get(uid), building = simulation.buildings().find(entry => entry.uid === uid);
      if (!after || !building) continue;
      if (before.fallen === undefined && after.fallen !== undefined)
        message(translateMessage(i18n, M.status.fortDestroyed, { fort: fortName(building) }), false, building);
      else if (before.defenders > 0 && after.defenders === 0)
        message(translateMessage(i18n, M.status.fortNoDefenders, { fort: fortName(building) }), false, building);
    }
    previous = next;
  };
};
