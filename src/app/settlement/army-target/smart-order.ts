import type { I18n, MessageDescriptor, Values } from "@lingui/core";

import { isOpenArcherTower } from "../../../render-common/buildings/bandit-camp-plan";
import { translateMessage } from "../../../shared/i18n/translate";
import { militaryBuildingCapacity } from "../../../shared/settlement/military-garrison-rules";
import type { QueueMilitaryRefusal } from "../../../shared/settlement/military-order-queue-rules";
import type { MilitaryOrder } from "../../../shared/settlement/military-targeting";
import type { SettlementSimulation } from "../../../shared/settlement/settlement-simulation";
import type { SettlementPoint } from "../../../shared/settlement/settlement-types";
import { attackBuilding, militaryRefusal } from "../military-order-dispatch";
import { boardingFeedback, translateShipRefusal } from "../ship-orders/helpers";
import {
  type ArmyTarget, type ArmyTargetBuilding, queuedArmyStep, refusedSiegeArchers, splitRiders
} from "./helpers";
import { ARMY_TARGET_MESSAGES as M } from "./messages";

export interface SmartOrderResult {
  accepted: boolean;
  text: string;
}

type Ids = readonly number[];

/**
 * Carries out a resolved smart order with the recorded commands (targetMilitary, commandMilitary, siegeMilitary,
 * garrisonMilitary, returnMilitaryHome and, for an own ship, embarkMilitary). Mixed selections are split as
 * military controls §6 describes; a ship that cannot take everyone boards the nearest and the rest wait at the
 * pier (§9.2).
 */
export const createSmartArmyOrder = (options: { i18n?: I18n; simulation: SettlementSimulation }) => {
  const { simulation } = options;
  const text = (descriptor: MessageDescriptor, values?: Values) => translateMessage(options.i18n, descriptor, values);
  const accepted = (descriptor: MessageDescriptor, values?: Values) =>
    ({ accepted: true, text: text(descriptor, values) });
  const refused = (ids: Ids, descriptor?: MessageDescriptor): SmartOrderResult =>
    ({ accepted: false, text: descriptor ? text(descriptor) : militaryRefusal(simulation, ids, null, options.i18n) });
  const combatOf = () => new Map(simulation.militarySoldiers().map(soldier => [soldier.actor, soldier.combat]));
  const attackMove = (ids: Ids, point: SettlementPoint) =>
    ids.length > 0 && simulation.commandMilitary(ids, point, "attackMove");

  const hasNoRoom = (uid: number) => {
    const building = simulation.buildings().find(entry => entry.uid === uid);
    if (!building) return false;
    const assigned = simulation.militarySoldiers().filter(soldier => soldier.building === uid).length;
    return assigned >= militaryBuildingCapacity(building);
  };
  /** Infantry enter; riders cannot garrison and attack-move to the door to wait there. */
  const garrison = (ids: Ids, target: ArmyTargetBuilding): SmartOrderResult => {
    const combat = combatOf();
    const { infantry, riders } = splitRiders(ids, id => combat.get(id)?.type);
    const entered = infantry.length ? simulation.garrisonMilitary(infantry, target.uid) : 0;
    const waiting = attackMove(riders, target.access);
    if (entered && waiting) return accepted(M.garrisonRiders, { count: entered });
    if (entered) return accepted(M.garrison, { count: entered });
    if (waiting) return accepted(M.onlyRiders);
    return refused(ids, infantry.length && hasNoRoom(target.uid) ? M.garrisonFull : undefined);
  };
  /** Archers a defended fort refuses attack-move to its door and shoot the defenders instead. */
  const siege = (ids: Ids, target: ArmyTargetBuilding): SmartOrderResult => {
    const building = simulation.buildings().find(entry => entry.uid === target.uid);
    if (building && isOpenArcherTower(building))
      return attackBuilding(simulation, ids, building) ? accepted(M.siege) : refused(ids);
    const besieged = simulation.siegeMilitary(ids, target.uid);
    const combat = combatOf();
    const archers = refusedSiegeArchers(ids, id => combat.get(id), target.uid);
    const archersMoved = attackMove(archers, target.access);
    if (besieged && archersMoved) return accepted(M.siegeArchers, { archers: archers.length });
    if (besieged) return accepted(M.siege);
    return archersMoved ? accepted(M.siegeOnlyArchers) : refused(ids);
  };
  const groundOrder = (ids: Ids, point: SettlementPoint, mode: MilitaryOrder) =>
    simulation.commandMilitary(ids, point, mode) ? accepted(M.ground[mode]) : refused(ids);
  const simulationRefusal = (reason: string): SmartOrderResult =>
    ({ accepted: false, text: translateShipRefusal(reason, options.i18n) });
  /** Boards the ship (a colony calls its troop ship instead); the simulation reports who boards and who waits. */
  const board = (ids: Ids, shipId: string): SmartOrderResult => {
    const result = simulation.embarkMilitary(ids, Number(shipId));
    if (!result.ok) return simulationRefusal(result.reason);
    const pickup = simulation.islandRole() === "colony";
    return accepted(boardingFeedback(pickup, result.waiting.length),
      { boarding: result.boarding.length, waiting: result.waiting.length });
  };
  /**
   * A click on an enemy body chases it (targetMilitary). A target the soldiers cannot lock onto (gone, hidden, off
   * the land since the pick) still gets the near-the-enemy order: an attack-move to where it stood.
   */
  const chase = (ids: Ids, uid: number, point: SettlementPoint): SmartOrderResult => {
    const result = simulation.targetMilitary(ids, uid);
    if (result.ok) return accepted(M.targetUnit);
    if (result.reason !== "noTroops" && attackMove(ids, point)) return accepted(M.attackUnit);
    if (simulation.storyLockedSoldiers(ids).length) return refused(ids);
    return refused(ids, M.targetRefused[result.reason]);
  };
  const queueRefusal = (ids: Ids, reason: QueueMilitaryRefusal): SmartOrderResult => {
    if (reason === "queueFull") return refused(ids, M.queueFull);
    if (reason === "invalidStep") return refused(ids, M.queueUnsupported);
    if (reason === "noTroops" || simulation.storyLockedSoldiers(ids).length) return refused(ids);
    return refused(ids, M.targetRefused[reason]);
  };
  /** The message of a queued step that started at once: the same wording as the plain order. */
  const startedText = (target: ArmyTarget) => {
    if (target.kind === "targetUnit") return M.targetUnit;
    if (target.kind === "siege" || target.kind === "garrison" || target.kind === "store" ||
      target.kind === "board") return M.queueStarted;
    return target.kind === "ground" ? M.ground[target.mode] : M.attackUnit;
  };
  /** Shift + right tap: the step joins the group's queue (or starts now for an idle group with none). */
  const queue = (target: ArmyTarget, ids: Ids): SmartOrderResult => {
    if (target.kind === "noGround") return refused(ids, M.noGround);
    const step = queuedArmyStep(target);
    if (!step) return refused(ids, M.queueUnsupported);
    const result = simulation.queueMilitaryOrder(ids, step);
    if (!result.ok) return queueRefusal(ids, result.reason);
    return result.immediate ? accepted(startedText(target)) : accepted(M.queued, { count: result.waiting });
  };
  const store = (ids: Ids, target: ArmyTargetBuilding) => {
    if (simulation.returnMilitaryHome(ids, target.uid)) return accepted(M.store);
    return refused(ids, simulation.storyLockedSoldiers(ids).length ? undefined : M.storeRefused);
  };

  return (target: ArmyTarget, ids: Ids, queued = false): SmartOrderResult => {
    if (queued) return queue(target, ids);
    switch (target.kind) {
      case "attackUnit":
        return attackMove(ids, target.point) ? accepted(M.attackUnit) : refused(ids);
      case "targetUnit": return chase(ids, target.targetUid, target.point);
      case "siege": return siege(ids, target.building);
      case "board": return board(ids, target.shipId);
      case "boardRefused": return simulationRefusal(target.reason);
      case "garrison": return garrison(ids, target.building);
      case "store": return store(ids, target.building);
      case "gather":
        return attackMove(ids, target.building.access) ? accepted(M.gather) : refused(ids);
      case "ground": return groundOrder(ids, target.point, target.mode);
      case "noGround": return refused(ids, M.noGround);
      case "ownSoldier": return groundOrder(ids, target.point, "attackMove");
    }
  };
};
