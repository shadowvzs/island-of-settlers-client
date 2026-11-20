import { colonyUpgradeReserve } from "./colony-advanced-material-trade";
import { lighterStorageBoxes } from "./harbour-lighters";
import type { NavalPassengerHooks, NavalShip } from "./settlement-naval-fleet";
import { isTradeShip } from "./settlement-naval-trade";
import type { Goods, SettlementBuilding, SettlementContext } from "./settlement-types";
import { storageBoxesAt } from "./ship-cargo-handling";

/**
 * A cargo carried in boxes between a ship and its harbour's storage (owner, 2026-10-21): the goods change hands
 * when the LAST box is carried in (unloading) or aboard (loading); a cargo of one box moves whole with that box.
 * `load` is the cargo when the job began. Unloading, the ship holds the goods until then; loading, they lie
 * reserved in the harbour's storage (`shipReserve`) from the start, so a save in the middle of the job neither
 * loses nor doubles them, and a cancelled load hands them back.
 */
export interface CargoTransfer { load: Goods }

/** Moves up to `count` units of `ware` between two stocks (absent keys count as 0). */
const moveWare = (from: Goods, to: Goods, ware: string, count: number) => {
  const moved = Math.max(0, Math.min(count, from[ware] ?? 0));
  if (moved <= 0) return;
  from[ware] = from[ware]! - moved;
  to[ware] = (to[ware] ?? 0) + moved;
};
/** The harbour's reservation without emptied wares (none left: no reservation). */
const tidyReserve = (harbour: SettlementBuilding) => {
  const reserve = harbour.shipReserve ?? {};
  for (const [ware, count] of Object.entries(reserve)) if (count <= 0) delete reserve[ware];
  if (!Object.keys(reserve).length) delete harbour.shipReserve;
};
/** An own transport order's wares are reserved in its harbour's storage (or handed back to it, `back`). */
export const reserveShipGoods = (harbour: SettlementBuilding, goods: Readonly<Goods>, back = false) => {
  harbour.shipReserve ??= {};
  for (const [ware, count] of Object.entries(goods)) {
    if (back) moveWare(harbour.shipReserve, harbour.inventory, ware, count);
    else moveWare(harbour.inventory, harbour.shipReserve, ware, count);
  }
  tidyReserve(harbour);
};

const unloading = (ship: NavalShip) => ship.phase === "unloading";
/** Boxes the porters (or the lighters' carriers) have brought in or taken out so far. */
const boxesDue = (ship: NavalShip) => {
  if (ship.lighters) {
    const { plan } = ship.lighters;
    return lighterStorageBoxes(plan, plan.seconds - ship.timer, unloading(ship));
  }
  return ship.handling ? storageBoxesAt(ship.handling, ship.handling.seconds - ship.timer, unloading(ship)) : 0;
};
const plannedBoxes = (ship: NavalShip) => ship.lighters?.plan.boxes ?? ship.handling?.boxes ?? 0;
const changeCargo = (ship: NavalShip, ware: string, change: number) => {
  const left = (ship.cargo[ware] ?? 0) + change;
  if (left > 0) ship.cargo[ware] = left; else delete ship.cargo[ware];
  ship.cargoCount += change;
};

/** Box by box transfers of the fleet's ships at their harbours. Created once per fleet. */
export const createCargoTransfers = (context: SettlementContext, hooks?: NavalPassengerHooks) => {
  const harbourOf = (ship: NavalShip) => context.buildings.find(building =>
    building.uid === (unloading(ship) ? ship.destinationUid : ship.sourceUid));
  /** The last box is in: the whole cargo goes into storage (a trade ship's into the trade office's care). */
  const credit = (ship: NavalShip, harbour: SettlementBuilding) => {
    const goods = Object.fromEntries(Object.entries(ship.cargo).filter(([, count]) => count > 0));
    if (isTradeShip(ship)) hooks?.tradeBoxUnloaded?.(ship.visitor.trade.delivery, ship.id, harbour.uid, goods);
    else for (const [ware, count] of Object.entries(goods))
      harbour.inventory[ware] = (harbour.inventory[ware] ?? 0) + count;
    for (const [ware, count] of Object.entries(goods)) changeCargo(ship, ware, -count);
  };
  /** The last box is aboard: the reserved goods leave storage; what the reservation lacks stays ashore. */
  const take = (ship: NavalShip, harbour: SettlementBuilding) => {
    const reserve = harbour.shipReserve ?? {};
    for (const [ware, count] of Object.entries(ship.cargo)) {
      const taken = Math.max(0, Math.min(count, reserve[ware] ?? 0));
      reserve[ware] = (reserve[ware] ?? 0) - taken;
      if (taken < count) changeCargo(ship, ware, taken - count);
    }
    tidyReserve(harbour);
  };
  /** A visitor's pickup is reserved in storage when its loading begins (an ore ship leaves a colony's reserve). */
  const reservePickup = (ship: NavalShip, harbour: SettlementBuilding) => {
    for (const [ware, count] of Object.entries(ship.cargo)) {
      const kept = ship.visitor?.role === "ore" ? colonyUpgradeReserve(context.buildings, ware) : 0;
      const taken = Math.max(0, Math.min(count, (harbour.inventory[ware] ?? 0) - kept));
      reserveShipGoods(harbour, { [ware]: taken });
      if (taken < count) changeCargo(ship, ware, taken - count);
    }
  };
  /** A load stops before its last box (its order cancelled): the reserved goods go back to the free stock. */
  const release = (ship: NavalShip) => {
    const harbour = ship.transfer && harbourOf(ship);
    if (!ship.transfer || ship.phase !== "loading") return;
    ship.transfer = undefined;
    if (!harbour) return;
    reserveShipGoods(harbour, ship.cargo, true);
    for (const [ware, count] of Object.entries(ship.cargo)) changeCargo(ship, ware, -count);
  };
  /** The ship begins to unload (or load) at its harbour; a visitor's pickup is reserved now. */
  const begin = (ship: NavalShip) => {
    const harbour = harbourOf(ship);
    if (ship.visitor && !unloading(ship) && harbour) reservePickup(ship, harbour);
    ship.transfer = { load: { ...ship.cargo } };
  };
  /**
   * Hands the goods over once the last box is carried in (unloading) or the job is over (`all`: loading, the
   * last box is set down on deck at the job's end).
   */
  const settle = (ship: NavalShip, all = false) => {
    const harbour = ship.transfer && harbourOf(ship);
    const lastIn = unloading(ship) && boxesDue(ship) >= plannedBoxes(ship);
    if (!ship.transfer || !harbour || (!all && !lastIn)) return;
    if (unloading(ship)) credit(ship, harbour); else take(ship, harbour);
    ship.transfer = undefined;
  };
  return { begin, release, settle };
};

/** Source loss refunds paid ashore goods; loading intentions must never become duplicate aboard cargo. */
export const releaseHarbourReservedCargo = (
  source: SettlementBuilding | undefined, ships: NavalShip[], releaseEmptyHull: (ship: NavalShip) => void
) => {
  if (!source) return;
  for (const ship of ships) {
    const pickup = ship.phase === "positioning" || ship.phase === "loading" ||
      ship.phase === "stranded" && ship.retryPhase === "positioning";
    if (ship.sourceUid !== source.uid || !pickup || ship.visitor && !ship.transfer) continue;
    reserveShipGoods(source, ship.cargo, true);
    ship.cargo = {};
    ship.cargoCount = (ship.passengers?.length ?? 0) + (ship.troops?.length ?? 0);
    ship.transfer = undefined; ship.handling = undefined;
    // Keep passenger/lighter physical actors and custody; only an entirely empty hull is freed.
    if (!ship.visitor && !ship.passengers?.length && !ship.troops?.length && !ship.lighters &&
      !ship.colony && !ship.expedition && !ship.exploration) releaseEmptyHull(ship);
  }
  if (source.shipReserve) reserveShipGoods(source, { ...source.shipReserve }, true);
};
