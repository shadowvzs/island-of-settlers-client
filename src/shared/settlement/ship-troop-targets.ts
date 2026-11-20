import { DMath } from "../math/deterministic-math";
import { HARBOUR_TYPE_ID } from "./building-type-ids";
import { TROOP_GANGWAY_HULL_SPAN, TROOP_HARBOUR_PICK_RADIUS, TROOP_LANDING_PICK_RADIUS } from "./constants";
import { type AdventureLanding, findLandingWithin, gatherSlot } from "./settlement-adventure-landing";
import { isOwnBuilding } from "./settlement-home";
import { type FleetBerthing, liesAside } from "./settlement-naval-berthing";
import type { NavalShip } from "./settlement-naval-fleet";
import type { createShipRoutePlanner, ShipDestination } from "./settlement-ship-routes";
import type { SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";

/** `sailShip` / `landShipTroops` destination as recorded: an own harbour, or a clicked map point. */
export type TroopShipDestination = { harbourUid: number } | SettlementPoint;

/** A destination the ship can reach: a harbour pier, or a coast anchorage with its gangway. */
export type ResolvedTroopDestination =
  | { kind: "harbour"; uid: number }
  | { kind: "coast"; landing: AdventureLanding };

export type TroopDestinationCheck = ResolvedTroopDestination | { reason: string };

interface TroopTargetOptions {
  berthing: FleetBerthing;
  /** A filter of water clear of harbour berths, lanes and jetties (built per search). */
  clearWater: () => (water: SettlementPoint) => boolean;
  context: SettlementContext;
  planner: ReturnType<typeof createShipRoutePlanner>;
  sea: Uint8Array;
}

/** The pose the ship anchors in off a landing beach. */
export const landingAnchorage = (landing: AdventureLanding): ShipDestination =>
  ({ ...landing.water, yaw: landing.yaw });

/**
 * The ship can sail to the landing's anchorage and back out from it (2026-11-17, seed 123: an anchorage in a
 * pocket by the map edge could be reached but never left).
 */
export const reachesAndLeaves = (planner: ReturnType<typeof createShipRoutePlanner>, berthing: FleetBerthing,
  ship: NavalShip, landing: AdventureLanding) => {
  // Idle and waiting ships are not in the way: they make room when the ship sets off (`makeWay`).
  const held = berthing.obstacles(ship).filter(other => !liesAside(other as NavalShip));
  const anchorage = { ...landing.water, yaw: landing.yaw };
  return Boolean(planner.route(ship, anchorage, held) &&
    planner.route(anchorage, { x: ship.x, yaw: ship.yaw, z: ship.z }, held));
};

const isMapPoint = (context: SettlementContext, point: unknown): point is SettlementPoint => {
  const { cellsX, cellsZ } = context.options.world;
  const candidate = point as SettlementPoint | null;
  return Boolean(candidate) && typeof candidate === "object" && Number.isFinite(candidate!.x) &&
    Number.isFinite(candidate!.z) && candidate!.x >= 0 && candidate!.z >= 0 && candidate!.x < cellsX &&
    candidate!.z < cellsZ;
};

const isOwnHarbour = (building: SettlementBuilding) => building.typeId === HARBOUR_TYPE_ID &&
  building.construction === 1 &&
  isOwnBuilding(building);

/**
 * Where a troop ship may go (MIL-SHIPS-SIM): the same checks serve the sim command and the UI cursor. A coast
 * uses today's landing rules (the adventure landing search: navigable water off dry land, a gangway, gathering
 * room ashore); hostile coasts are allowed wherever those rules accept them (owner 2026-11-13).
 */
export const createTroopShipTargets = ({ berthing, clearWater, context, planner, sea }: TroopTargetOptions) => {
  const ownHarbour = (uid: number) =>
    context.buildings.find(building => building.uid === uid && isOwnHarbour(building));
  /** The own harbour whose door a clicked point is next to (its pier, not a beach). */
  const harbourAt = (point: SettlementPoint) => context.buildings
    .filter(building => isOwnHarbour(building) &&
      DMath.hypot(building.access.x - point.x, building.access.z - point.z) <= TROOP_HARBOUR_PICK_RADIUS)
    .sort((a, b) => DMath.hypot(a.access.x - point.x, a.access.z - point.z) -
      DMath.hypot(b.access.x - point.x, b.access.z - point.z) || a.uid - b.uid)[0];
  /** A harbour's first berth, read without the tick's terrain refresh (the checks are also UI queries). */
  const firstBerth = (uid: number) => berthing.berths.forHarbour(uid)[0];
  const harbourTarget = (ship: NavalShip, uid: number): TroopDestinationCheck => {
    if (!Number.isSafeInteger(uid) || !ownHarbour(uid)) return { reason: "Choose one of your finished harbours" };
    const berth = firstBerth(uid);
    if (!berth) return { reason: "That harbour has no berth" };
    return planner.route(ship, berth) ? { kind: "harbour", uid } : { reason: "Ship cannot reach that harbour" };
  };
  /** Room to gather inland from the gangway foot (the landing search falls back to the foot when there is none). */
  const gathers = (landing: AdventureLanding) => {
    const shore = landing.gangway.shore, slot = gatherSlot(context, shore, 0);
    return DMath.hypot(slot.x - shore.x, slot.z - shore.z) > 0;
  };
  const coastTarget = (ship: NavalShip, point: SettlementPoint): TroopDestinationCheck => {
    const { world } = context.options;
    if (sea[Math.floor(point.z) * world.cellsX + Math.floor(point.x)]) return { reason: "Choose a coast on land" };
    let beach = false;
    const clear = clearWater();
    const landing = findLandingWithin(context, sea, TROOP_LANDING_PICK_RADIUS, point, candidate => {
      if (!gathers(candidate) || !clear(candidate.water)) return false;
      beach = true;
      return reachesAndLeaves(planner, berthing, ship, candidate);
    }, TROOP_GANGWAY_HULL_SPAN);
    if (landing) return { kind: "coast", landing };
    return { reason: beach ? "Ship cannot reach that water" : "No landing beach here" };
  };
  /** Resolves a recorded destination for `ship`, or the reason it is refused. */
  const resolve = (ship: NavalShip, destination: TroopShipDestination): TroopDestinationCheck => {
    if (destination && typeof destination === "object" && "harbourUid" in destination)
      return harbourTarget(ship, destination.harbourUid);
    if (!isMapPoint(context, destination)) return { reason: "Choose a point on the map" };
    const harbour = harbourAt(destination);
    return harbour ? harbourTarget(ship, harbour.uid) : coastTarget(ship, destination);
  };
  return { firstBerth, ownHarbour, resolve };
};
