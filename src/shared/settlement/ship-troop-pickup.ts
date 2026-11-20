import { DMath } from "../math/deterministic-math";
import {
  TROOP_GANGWAY_BOARDING_PHASES, TROOP_GANGWAY_HULL_SPAN, TROOP_PICKUP_ANCHORAGE_SPACING, TROOP_PICKUP_SEARCH_RADIUS
} from "./constants";
import { type AdventureLanding, findLandingWithin } from "./settlement-adventure-landing";
import { landmassAt } from "./settlement-landmass-index";
import type { FleetBerthing } from "./settlement-naval-berthing";
import type { NavalShip } from "./settlement-naval-fleet";
import type { createShipRoutePlanner } from "./settlement-ship-routes";
import type { SettlementActor, SettlementContext, SettlementPoint } from "./settlement-types";
import { isFreeOwnSoldier } from "./ship-troop-boarding";
import { isFieldCommander } from "./ship-troop-commander";
import { reachesAndLeaves } from "./ship-troop-targets";

interface TroopPickupOptions {
  berthing: FleetBerthing;
  clearWater: () => (water: SettlementPoint) => boolean;
  context: SettlementContext;
  planner: ReturnType<typeof createShipRoutePlanner>;
  sea: Uint8Array;
  ships: readonly NavalShip[];
}

/** A coast anchorage where a ship comes to fetch soldiers, or why there is none. */
export type TroopPickupSite = { anchor: AdventureLanding } | { reason: string };

/** A field soldier that could walk up a gangway (mounted riders and the commander included, dismounted not). */
const canWalkToGangway = (context: SettlementContext, actor: SettlementActor) => isFieldCommander(context, actor) ||
  (isFreeOwnSoldier(context, actor) && TROOP_GANGWAY_BOARDING_PHASES.includes(actor.phase) &&
    !context.military?.soldierOf?.(actor.uid)?.combat?.dismounted);

/** The water another troop mission holds: its anchorage, or the anchorage it sails for. */
const missionWaters = (ships: readonly NavalShip[], except: NavalShip): SettlementPoint[] => ships.flatMap(ship => {
  if (ship === except || !ship.troopMission) return [];
  const { anchor, target } = ship.troopMission;
  const waters = anchor ? [anchor.water] : [];
  return target?.kind === "coast" ? [...waters, target.landing.water] : waters;
});

/**
 * Coast pickup (owner 2026-11-17): a free ship that is not docked at the soldiers' shore fetches them from the
 * coast nearest the chosen soldier closest to it. The anchorage needs a gangway on that soldier's landmass, a
 * course from the ship and water no other troop mission holds; the soldiers wait at the gangway foot.
 */
export const createTroopShipPickup = ({ berthing, clearWater, context, planner, sea, ships }: TroopPickupOptions) => {
  const { world } = context.options;
  /** The chosen soldier able to board at a coast that stands nearest the ship. */
  const nearestWalker = (ship: NavalShip, ids: readonly number[]) => {
    const distance = (actor: SettlementActor) => DMath.hypot(actor.x - ship.x, actor.z - ship.z);
    const chosen = new Set(ids);
    return context.actors.filter(actor => chosen.has(actor.uid) && canWalkToGangway(context, actor))
      .sort((a, b) => distance(a) - distance(b) || a.uid - b.uid)[0];
  };
  const isHeldWater = (ship: NavalShip, water: SettlementPoint) => missionWaters(ships, ship)
    .some(held => DMath.hypot(held.x - water.x, held.z - water.z) < TROOP_PICKUP_ANCHORAGE_SPACING);
  /** Read-only: the anchorage `ship` would fetch the chosen soldiers from. */
  const pickupSite = (ship: NavalShip, ids: readonly number[]): TroopPickupSite => {
    const walker = nearestWalker(ship, ids);
    if (!walker) return { reason: "No chosen soldier can board" };
    const land = landmassAt(world, walker);
    let beach = false;
    const clear = clearWater();
    const anchor = findLandingWithin(context, sea, TROOP_PICKUP_SEARCH_RADIUS, walker, landing => {
      if (landmassAt(world, landing.gangway.shore) !== land || isHeldWater(ship, landing.water) ||
        !clear(landing.water)) return false;
      beach = true;
      return reachesAndLeaves(planner, berthing, ship, landing);
    }, TROOP_GANGWAY_HULL_SPAN);
    if (anchor) return { anchor };
    return { reason: beach ? "Ship cannot reach the soldiers' coast" : "No landing beach near the soldiers" };
  };
  return { pickupSite };
};
