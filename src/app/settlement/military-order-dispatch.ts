import type { I18n } from "@lingui/core";

import { isOpenArcherTower } from "../../render-common/buildings/bandit-camp-plan";
import { translateMessage } from "../../shared/i18n/translate";
import { type MilitaryTroopType } from "../../shared/settlement/military-combat-rules";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import type { SettlementBuilding, SettlementPoint } from "../../shared/settlement/settlement-types";
import type { ArmyOrder } from "./army-rail/helpers";
import { ARMY_ORDER_ACCEPTED } from "./constants";
import { SETTLEMENT_DEBUG_MESSAGES as M } from "./debug-messages";
import type { MilitarySelection } from "./military-selection";
import { settlementBuildingFrameId } from "./settlement-render-frames";

/** The simulation order for a click on open ground. */
const groundOrder = (order: ArmyOrder) => {
  if (order === "attack") return "attackMove";
  return order === "retreat" ? "retreat" : "move";
};

const rallyMessage = (count: number, building: boolean) => {
  const target = building ? "attack the building it marks" : "march to it";
  return `Rally banner planted. ${count} soldiers ${target}.`;
};

/** A hostile building the player can siege: its door belongs to a computer faction. */
export const hasHostileDoor = (simulation: Pick<SettlementSimulation, "militaryDoors">, uid: number) =>
  simulation.militaryDoors().some(door => door.building === uid && door.faction > 0);

/** Sieges a hostile building; archers alone attack-move to a scaffold and shoot its archers. */
export const attackBuilding = (
  simulation: SettlementSimulation, ids: readonly number[], building: SettlementBuilding
) => {
  if (simulation.siegeMilitary(ids, building.uid)) return true;
  if (!isOpenArcherTower(building)) return false;
  return simulation.commandMilitary(ids, building.access, "attackMove");
};

/** Why nobody took the order: a story task, a door duel, else the order's own target rule. */
export const militaryRefusal = (
  simulation: SettlementSimulation, ids: readonly number[], order: ArmyOrder, i18n?: I18n
) => {
  if (simulation.storyLockedSoldiers(ids).length) return translateMessage(i18n, M.military.storyLocked);
  const selected = new Set(ids);
  const duelling = simulation.saveState().military?.combat?.exchanges?.some(exchange =>
    exchange.stage === "duel" && (selected.has(exchange.attacker) ||
      (exchange.defender !== undefined && selected.has(exchange.defender))));
  if (duelling) return "Selected soldiers are in a door duel. Wait for it to finish before moving them.";
  if (order === "enter") return "Choose a reachable friendly military building with room for infantry.";
  return order === "rally" ? "Choose open land for the rally banner." : "No eligible troops can reach that target.";
};

/**
 * The armed rail / hotkey order (Move, Attack, Retreat, Enter, Rally) at a map point: the first click
 * after arming it, left or right. Returns true once the click was handled (accepted or refused).
 */
export const createMilitaryOrderDispatch = (options: {
  i18n?: I18n;
  message: (message: string, error?: boolean) => void;
  pick: (x: number, y: number) => SettlementPoint | null;
  pickBuilding?: (x: number, y: number) => string | null;
  rallyTypes: () => MilitaryTroopType[];
  selection: MilitarySelection;
  simulation: SettlementSimulation;
}) => {
  const { selection, simulation } = options;
  const plantRally = (point: SettlementPoint) => {
    if (!simulation.plantMilitaryRally(point)) return null;
    const count = simulation.callOutMilitary(options.rallyTypes());
    return rallyMessage(count, simulation.militaryRally()?.building !== undefined);
  };
  const issueOrder = (order: ArmyOrder, point: SettlementPoint) => {
    if (order === "rally") return plantRally(point);
    const ids = selection.ids();
    const building = simulation.buildings().find(entry =>
      Math.abs(entry.x - point.x) <= entry.width / 2 && Math.abs(entry.z - point.z) <= entry.depth / 2);
    if (order === "enter") {
      const count = building ? simulation.garrisonMilitary(ids, building.uid) : 0;
      return count > 0 ? `${count} soldiers entering the garrison.` : null;
    }
    if (order === "attack" && building && hasHostileDoor(simulation, building.uid))
      return attackBuilding(simulation, ids, building) ? ARMY_ORDER_ACCEPTED : null;
    return simulation.commandMilitary(ids, point, groundOrder(order)) ? ARMY_ORDER_ACCEPTED : null;
  };
  /**
   * The point an order aims at: a clicked building's centre for building orders, else the ground. The renderer
   * picks buildings by frame id (`settlement-<uid>`), not by bare uid.
   */
  const targetPoint = (order: ArmyOrder, x: number, y: number) => {
    const hit = options.pickBuilding?.(x, y);
    const building = hit == null ? undefined
      : simulation.buildings().find(entry => settlementBuildingFrameId(entry.uid) === hit);
    const useBuilding = order === "rally" || order === "attack" || order === "enter";
    return useBuilding && building ? { x: building.x, z: building.z } : options.pick(x, y);
  };
  /** False when the order was refused (it stays armed); true when it was accepted. */
  const dispatch = (order: Exclude<ArmyOrder, null>, x: number, y: number) => {
    const point = targetPoint(order, x, y);
    if (!point) { options.message("Choose reachable land."); return false; }
    const feedback = issueOrder(order, point);
    if (!feedback) {
      options.message(militaryRefusal(simulation, selection.ids(), order, options.i18n));
      return false;
    }
    options.message(feedback);
    return true;
  };
  return { dispatch };
};
