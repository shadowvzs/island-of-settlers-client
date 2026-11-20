import { shuttleCapacityFor } from "./harbour-shuttle-plan";
import type { NavalOrder, NavalShip } from "./settlement-naval-fleet";
import type { Goods, SettlementBuilding, SettlementContext } from "./settlement-types";
import { workshopUpgradeDemand } from "./workshop-upgrades";

/**
 * One genuine, uncovered reason to row between two harbours. Explicit transfer orders are the
 * player's own fulfillment claim; an expedition preparation or harbour upgrade at the destination is
 * demand from the existing shared systems. Both are used only where no land route joins the harbours,
 * so the boat never competes with the ordinary carrier network.
 */
export interface ShuttleNeed {
  ware: string;
  count: number;
  automatic: boolean;
  /** Real uncovered request before the visible boat-load cap. */
  remainingNeed: number;
  order: number;
  /** The shared transfer order this need reserves from (explicit needs only). */
  transfer?: SettlementContext["transfers"][number];
}

const excluded = (ware: string) => ware === "boat" || ware.startsWith("~");
const covered = (context: SettlementContext, source: SettlementBuilding, destination: SettlementBuilding) =>
  Boolean(context.options.roads.route(source.access, destination.access));
const sourceCount = (source: SettlementBuilding, ware: string) => Math.max(0, source.inventory[ware] ?? 0);
const fleetCoverage = (orders: readonly NavalOrder[], ships: readonly NavalShip[], uid: number, ware: string) =>
  orders.reduce((sum, order) => sum + (order.destinationUid === uid && !order.expedition &&
    !order.exploration && !order.colony ? order.cargo[ware] ?? 0 : 0), 0) +
  ships.reduce((sum, ship) => sum + (ship.destinationUid === uid && ship.phase !== "away" &&
    !ship.visitor && !ship.expedition && !ship.exploration && !ship.colony &&
    ship.foundingSiteUid === undefined ? ship.cargo[ware] ?? 0 : 0), 0);
const automaticDemand = (context: SettlementContext, destination: SettlementBuilding): Goods => {
  const expedition = context.naval?.expeditionDemand(destination.uid) ?? {};
  const demand: Goods = { ...expedition };
  for (const [ware, count] of Object.entries(workshopUpgradeDemand(destination)))
    demand[ware] = (demand[ware] ?? 0) + Math.max(0, count - (destination.inventory[ware] ?? 0) -
      (destination.workshopUpgrade?.reserved ? Math.max(0, (destination.incoming[ware] ?? 0) -
        (destination.workshopUpgrade.incoming?.[ware] ?? 0)) : 0));
  return demand;
};

/**
 * Uncovered needs for a harbour pair. An explicit `transferWare` order is exactly the shared
 * fulfillment claim, not an arbitrary equalisation. Automatic demand supplies the destination
 * harbour's own expedition/upgrade need only when a road cannot already bring it; a pending sea
 * transport for the same ware also wins, so one claim is never fulfilled twice.
 */
export const shuttleNeeds = (
  context: SettlementContext, source: SettlementBuilding, destination: SettlementBuilding,
  orders: readonly NavalOrder[], ships: readonly NavalShip[] = []
): ShuttleNeed[] => {
  if (source.uid === destination.uid || source.storagePoolId !== undefined &&
    source.storagePoolId === destination.storagePoolId || covered(context, source, destination)) return [];
  const needs: ShuttleNeed[] = [];
  for (const transfer of context.transfers) {
    if (transfer.source !== source.uid || transfer.destination !== destination.uid || transfer.count < 1 ||
      excluded(transfer.ware)) continue;
    const count = Math.min(transfer.count, sourceCount(source, transfer.ware), shuttleCapacityFor(transfer.ware));
    if (count > 0) needs.push({ automatic: false, count, order: transfer.id ?? context.transfers.indexOf(transfer),
      remainingNeed: transfer.count, transfer, ware: transfer.ware });
  }
  const automatic = automaticDemand(context, destination);
  for (const [ware, requested] of Object.entries(automatic)) {
    const remainingNeed = Math.max(0, requested - fleetCoverage(orders, ships, destination.uid, ware));
    if (remainingNeed < 1 || excluded(ware)) continue;
    const count = Math.min(remainingNeed, sourceCount(source, ware), shuttleCapacityFor(ware));
    if (count > 0) needs.push({ automatic: true, count, order: destination.uid, remainingNeed, ware });
  }
  return needs;
};
