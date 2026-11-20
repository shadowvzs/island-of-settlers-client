import { DMath } from "../math/deterministic-math";
import { TROOP_SHIP_DOCKED_REACH } from "./constants";
import { type FleetBerthing, liesAside } from "./settlement-naval-berthing";
import type { NavalShip } from "./settlement-naval-fleet";
import type { createShipRoutePlanner } from "./settlement-ship-routes";
import type { SettlementContext, SettlementPoint } from "./settlement-types";
import { planTroopBoarding, type TroopBoardingSite } from "./ship-troop-boarding";
import { createTroopShipPickup } from "./ship-troop-pickup";
import type { createTroopShipTargets } from "./ship-troop-targets";

interface TroopSiteOptions {
  berthing: FleetBerthing;
  /** A filter of water clear of harbour berths, lanes and jetties (built per search). */
  clearWater: () => (water: SettlementPoint) => boolean;
  context: SettlementContext;
  planner: ReturnType<typeof createShipRoutePlanner>;
  sea: Uint8Array;
  ships: readonly NavalShip[];
  targets: ReturnType<typeof createTroopShipTargets>;
}

/** An own ship with no voyage, order, reservation, cargo or passengers. */
export const isFreeTroopShip = (ship: NavalShip) => ship.phase === "idle" && !ship.visitor && !ship.gone &&
  !ship.troopMission && ship.orderId === undefined && ship.nextOrderId === undefined &&
  ship.reservedFor === undefined && ship.foundingSiteUid === undefined && !ship.colony && !ship.expedition &&
  !ship.exploration && !ship.dismantle && !ship.passengers?.length && !ship.troops?.length &&
  !Object.values(ship.cargo).some(count => count > 0);

/** A ship sailing to a coast to lie there (a pickup, or `sailShip`) takes more soldiers at that gangway. */
/** A hull this close to a berth lies at it (tiles). */
const BERTH_HELD_REACH = 2;

const boundAnchorage = (ship: NavalShip) => {
  const target = ship.troopMission?.target;
  const sailing = ship.phase === "sailing" || ship.phase === "stranded";
  return sailing && target?.kind === "coast" && !target.land ? target.landing : undefined;
};

/**
 * Where a selection boards an own ship (owner 2026-11-13 / 2026-11-17): a free ship at the harbour it lies at
 * when some chosen soldier can board there, else at the coast of the soldiers (a pickup); a mission ship at its
 * pier, its anchored gangway or the anchorage it sails for.
 */
export const createTroopBoardingSites = (options: TroopSiteOptions) => {
  const { context, planner, ships, targets } = options;
  const pickup = createTroopShipPickup(options);
  /** Own harbours by their first berth's distance from the ship (within `reach`), nearest first. */
  const harboursNear = (ship: NavalShip, reach: number) => context.buildings
    .flatMap(building => {
      const berth = targets.ownHarbour(building.uid) ? targets.firstBerth(building.uid) : undefined;
      const distance = berth ? DMath.hypot(berth.x - ship.x, berth.z - ship.z) : Infinity;
      return berth && distance <= reach ? [{ berth, building, distance }] : [];
    })
    .sort((a, b) => a.distance - b.distance || a.building.uid - b.building.uid);
  /**
   * Another ship lies at (or is bound for) the berth and will not make room for it: an idle or waiting ship
   * would. Read-only, so the UI's boarding check and the command agree without touching the berth state.
   */
  const berthTaken = (ship: NavalShip, berth: SettlementPoint) => ships.some(other => {
    if (other === ship || other.phase === "away" || liesAside(other)) return false;
    const end = ["positioning", "sailing"].includes(other.phase) ? other.route.at(-1) : undefined;
    const at = (point: SettlementPoint) => DMath.hypot(point.x - berth.x, point.z - berth.z) < BERTH_HELD_REACH;
    return at(other) || Boolean(end && at(end));
  });
  /** The nearest harbour (within `reach`) where some chosen soldier boards and whose berth the ship can take. */
  const boardingHarbour = (ship: NavalShip, ids: readonly number[], reach: number) => harboursNear(ship, reach)
    .find(({ berth, building }) => planTroopBoarding(context, ship, { harbour: building }, ids).boarding.length &&
      !berthTaken(ship, berth) && planner.route(ship, berth))?.building;
  /**
   * A free ship boards at the harbour it lies at when some chosen soldier can board there; otherwise it fetches
   * field soldiers from their coast, and stored soldiers at their harbour, however far off (owner 2026-11-17).
   */
  const freeShipSite = (ship: NavalShip, ids: readonly number[]): TroopBoardingSite | { reason: string } => {
    const docked = boardingHarbour(ship, ids, TROOP_SHIP_DOCKED_REACH);
    if (docked) return { harbour: docked };
    const coast = pickup.pickupSite(ship, ids);
    if (!("reason" in coast)) return coast;
    const stored = boardingHarbour(ship, ids, Infinity);
    return stored ? { harbour: stored } : coast;
  };
  const boardingSite = (ship: NavalShip, ids: readonly number[]): TroopBoardingSite | { reason: string } => {
    const mission = ship.troopMission;
    if (!mission) return isFreeTroopShip(ship) ? freeShipSite(ship, ids) : { reason: "The ship is busy" };
    const bound = boundAnchorage(ship);
    if (bound) return { anchor: bound };
    if (ship.phase !== "loading" && ship.phase !== "positioning") return { reason: "The ship is under way" };
    if (mission.anchor) return { anchor: mission.anchor };
    const uid = mission.harbourUid ?? mission.waitingOff;
    const harbour = uid === undefined ? undefined : targets.ownHarbour(uid);
    return harbour ? { harbour } : { reason: "The ship is not at a harbour" };
  };
  /** The panel's verdict without a selection: a free ship can always fetch soldiers, a mission ship where it lies. */
  const canBoard = (ship: NavalShip) =>
    (ship.troopMission ? !("reason" in boardingSite(ship, [])) : isFreeTroopShip(ship));
  return { boardingSite, canBoard, pickupSite: pickup.pickupSite };
};
