import { shipDeckCapacity } from "@shared/catalog";

import { type Archipelago, type ColonyEvacuation,findColony } from "../../shared/settlement/archipelago";
import {
  idleShipCount, needTotal, sendIdleShipsAway, shipLoads, takeHomeReserves
} from "../../shared/settlement/colony-troop-supply";
import { addGood } from "../../shared/settlement/production-rules";
import type { NavalHomewardLoad } from "../../shared/settlement/settlement-naval-fleet";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import type { Goods } from "../../shared/settlement/settlement-types";

/** One full sailing-ship deck (catalog `ship:sailingShip` capacity). */
const { passengers: SHIP_DECK_SOLDIERS } = shipDeckCapacity();

export interface ColonyShipOptions {
  simulation: SettlementSimulation;
  group(): Archipelago;
  setGroup(next: Archipelago): void;
  notify(message: string): void;
  now(): number;
  /** Live home buildings when the home island is replayed as a session; falls back to the filed save. */
  homeBuildings?(): import("../../shared/settlement/settlement-types").SettlementBuilding[] | undefined;
  /** Live full home settlement for troop ships and evacuation checks. */
  homeSettlement?(): import("../../shared/settlement/settlement-save-state").SettlementSaveV1 | undefined;
  /** A serial native owner replaces coarse archived economy for this exact source interval. */
  ownsArchivedIsland?: (islandId: number | null) => boolean;
}

/** Visitor ships take the island's voyage time once it is discovered; before that they arrive at once. */
export const visitorVoyageSeconds = (island: { discovery?: unknown; voyageSeconds: number } | undefined) =>
  island?.discovery ? island.voyageSeconds : 0;

const ships = (count: number) => `${count} ${count === 1 ? "ship" : "ships"}`;
const soldiers = (count: number) => `${count} ${count === 1 ? "soldier" : "soldiers"}`;

const mergeLoads = (loads: readonly NavalHomewardLoad[]) => {
  const cargo: Goods = {};
  for (const load of loads) for (const [ware, count] of Object.entries(load.cargo)) addGood(cargo, ware, count);
  return { cargo, troops: loads.flatMap(load => load.troops) };
};

/**
 * Soldiers between islands (owner decisions 2026-10-13): a conquered colony's military buildings
 * call stored soldiers from home on idle home ships; a freed colony's soldiers and wares are fetched
 * by idle home ships, or reach the home harbour at once when no ship came in time.
 */
export const createColonyTroopShips = (options: ColonyShipOptions) => {
  const { simulation } = options;
  /** On a conquered colony: troop ships from home, filled to capacity, as many as are idle at home. */
  const sendTroops = () => {
    const group = options.group(), colony = findColony(group, group.active),
      home = options.homeSettlement?.() ?? group.home?.settlement;
    if (!colony || !home || simulation.colony()?.status !== "conquered") return;
    const need = simulation.garrisonShortfall();
    const idle = needTotal(need) ? idleShipCount(home) : 0;
    if (!idle) return;
    const troops = takeHomeReserves(home, need, idle * SHIP_DECK_SOLDIERS);
    if (!troops.length) return;
    const loads = shipLoads(troops);
    sendIdleShipsAway(home, loads.length, { expeditionId: colony.expeditionId,
      voyageSeconds: colony.island.voyageSeconds }, loads);
    for (const load of loads)
      if (simulation.sendVisitorShip({}, [], "troops", load.troops,
        visitorVoyageSeconds(colony.island)) === null) simulation.receiveTroops(load.troops);
    options.notify(`${ships(loads.length)} from home bring ${soldiers(troops.length)} for the military buildings.`);
  };
  /** Idle home ships sail for what is left; past its deadline the rest lands in the home harbour. */
  const evacuate = (evacuation: ColonyEvacuation): ColonyEvacuation | null => {
    if (options.now() >= evacuation.deadline) {
      if (simulation.receiveColonyEvacuation) {
        if (!simulation.receiveColonyEvacuation(evacuation)) return evacuation;
      } else {
        simulation.receiveTroops(evacuation.troops); simulation.receiveHomeGoods(evacuation.cargo);
      }
      options.notify(`${evacuation.name}: remaining troops and goods returned to the home harbour.`);
      return null;
    }
    const loads = shipLoads(evacuation.troops, evacuation.cargo);
    const voyage = { expeditionId: evacuation.expeditionId, voyageSeconds: evacuation.voyageSeconds };
    let sent = 0;
    while (sent < loads.length && simulation.fetchFromColony(voyage, loads[sent]!) !== null) sent++;
    if (sent) options.notify(`${ships(sent)} sail to ${evacuation.name} to bring its garrison and wares home.`);
    const rest = mergeLoads(loads.slice(sent));
    if (!rest.troops.length && !Object.keys(rest.cargo).length) return null;
    return { ...evacuation, ...rest };
  };
  const evacuateAll = () => {
    const pending = options.group().evacuations;
    if (!pending?.length) return;
    const left = pending.flatMap(evacuation => evacuate(evacuation) ?? []);
    options.setGroup({ ...options.group(), evacuations: left.length ? left : undefined });
  };
  return { evacuateAll, sendTroops };
};
