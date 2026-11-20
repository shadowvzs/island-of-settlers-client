import { DMath } from "../math/deterministic-math";
import { fisheryYardSkiffPickup, groundSkiffPickup } from "../../render-common/ships/fishing-skiff-yard";
import { PRODUCTION_OUTPUT_CAPACITY } from "../balance/economy";
import { emitWareProduced } from "../script-world/script-building-events";
import type { BoatLaunchSlot } from "./boat-fishing-site";
import {
  BOAT_WARE, FISHER_BOAT_AFLOAT_PHASES, FISHER_BOAT_BEACH_SECONDS, FISHER_BOAT_CATCH, FISHER_BOAT_LAUNCH_SECONDS,
  FISHER_BOAT_LIFT_SECONDS, FISHER_BOAT_NET_SECONDS, FISHER_BOAT_PHASES, FISHER_BOAT_RETRY_SECONDS,
  FISHER_BOAT_ROW_SPEED, FISHER_BOAT_WALK_PHASES
} from "./constants";
import { fisherBoatRoute, fisherBoatRouteLength } from "./fisher-boat-route";
import { pointAlongBoatRoute } from "./harbour-boat-route";
import { addGood, countGoods } from "./production-rules";
import { currentBoatFishingSite } from "./settlement-fisher-boat-mode";
import { buildingNation } from "./settlement-nation";
import { groundPath, moveActor, setActorPath } from "./settlement-paths";
import type { SettlementActor, SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";
import { doorToStockPath, outdoorWorkPath } from "./settlement-worker-stock-paths";

/**
 * FISHER-BOAT L4 trip (plan §2, owner answers 2026-11-11): fetch the boat from the yard or a dropped
 * spot, carry it to its launch slot (or walk to the parked boat), launch, row out, work the net, row
 * back, beach the boat (it stays parked there) and carry the whole catch home in one basket.
 */
export const isFisherBoatPhase = (phase: string) => FISHER_BOAT_PHASES.has(phase);
/** On the water: out of reach of land raiders and hidden from walkers (plan §2). */
export const isFisherBoatAfloat = (actor: SettlementActor) => FISHER_BOAT_AFLOAT_PHASES.has(actor.phase);

/** The stored site for the current work radius, re-validated and stored when the radius changed. */
const okSite = (context: SettlementContext, building: SettlementBuilding) => {
  const site = currentBoatFishingSite(context, building);
  if (!site.ok) return undefined;
  building.boatSite = site;
  return site;
};

/** The shore approach of a slot, with the Fisher beach permission (`isFishingShoreStep`). */
const shoreTarget = (slot: BoatLaunchSlot) => ({
  approach: { shoreEntry: slot.shoreEntry, waterY: slot.waterY, x: slot.x, z: slot.z },
  id: -1, kind: "fish" as const, x: slot.launch.x, z: slot.launch.z
});

const hasBoat = (building: SettlementBuilding) =>
  (building.input[BOAT_WARE] ?? 0) > 0 || building.fisherBoat?.place === "slot" ||
  building.fisherBoat?.place === "dropped";

const canStartTrip = (building: SettlementBuilding) =>
  building.typeId === 18 && building.fisherMode === "boat" && !building.productionPaused &&
  countGoods(building.output) < PRODUCTION_OUTPUT_CAPACITY && hasBoat(building);

/** The first leg from inside: to the yard boat, the dropped boat, or the parked boat's slot. */
const firstLeg = (context: SettlementContext, building: SettlementBuilding, slot: BoatLaunchSlot) => {
  const boat = building.fisherBoat;
  if (boat?.place === "slot") {
    const path = outdoorWorkPath(context, building, slot);
    return path && { path: [building.workerApproach, ...path], phase: "fisherBoatWalk", yard: false };
  }
  if (boat?.place === "dropped") {
    const path = outdoorWorkPath(context, building, groundSkiffPickup(boat));
    return path && { path: [building.workerApproach, ...path], phase: "fisherBoatFetch", yard: false };
  }
  const pickup = fisheryYardSkiffPickup(buildingNation(context, building) ?? "roman", building);
  const path = doorToStockPath(context, building, pickup);
  return path && { path, phase: "fisherBoatFetch", yard: true };
};

/** Starts a boat trip instead of a rod cycle when boat mode, a boat and a free shore are ready. */
export const startFisherBoatTrip = (
  context: SettlementContext, actor: SettlementActor, building: SettlementBuilding
) => {
  if (!canStartTrip(building)) return false;
  const site = okSite(context, building);
  if (!site) return false;
  const slotIndex = Math.min(building.fisherBoat?.slot ?? 0, site.slots.length - 1);
  const slot = site.slots[slotIndex]!;
  const leg = firstLeg(context, building, slot);
  if (!leg) return false;
  if (leg.phase === "fisherBoatFetch") actor.stockBuilding = building.uid;
  actor.boatTrip = { net: building.cycle % site.nets.length, slot: slotIndex, ...(leg.yard ? { yard: true } : {}) };
  actor.target = shoreTarget(slot);
  setActorPath(actor, leg.path, leg.phase);
  building.door = 1; building.working = true; building.status = "Working";
  return true;
};

const tripSlot = (building: SettlementBuilding, actor: SettlementActor) => {
  const site = building.boatSite;
  return site?.ok && actor.boatTrip ? site.slots[actor.boatTrip.slot] : undefined;
};

const tripRoute = (context: SettlementContext, building: SettlementBuilding, actor: SettlementActor) => {
  const site = building.boatSite;
  if (!site?.ok || !actor.boatTrip) return null;
  const slot = site.slots[actor.boatTrip.slot], net = site.nets[actor.boatTrip.net];
  return slot && net ? fisherBoatRoute(context.options.world, slot.launch, net) : null;
};

const inPlace = (
  actor: SettlementActor, phase: string, seconds: number, action: SettlementActor["action"] = "idle"
) => {
  actor.phase = phase; actor.timer = seconds; actor.action = action; actor.path = []; actor.pathIndex = 0;
};

const parkAt = (building: SettlementBuilding, slotIndex: number, slot: SettlementPoint & { yaw: number }) => {
  building.fisherBoat = { place: "slot", slot: slotIndex, x: slot.x, yaw: slot.yaw, z: slot.z };
};

/** At the boat: lift it from the yard stock or the ground onto the fisher's head. */
const liftBoat = (building: SettlementBuilding, actor: SettlementActor) => {
  if ((building.input[BOAT_WARE] ?? 0) > 0) addGood(building.input, BOAT_WARE, -1);
  building.fisherBoat = { place: "carried", slot: actor.boatTrip!.slot, x: actor.x, yaw: actor.yaw, z: actor.z };
  actor.ware = BOAT_WARE;
};

const carryToSlot = (context: SettlementContext, actor: SettlementActor, slot: BoatLaunchSlot) => {
  const path = groundPath(context, actor, slot, actor.stockBuilding);
  if (path) setActorPath(actor, path, "fisherBoatCarry");
  else inPlace(actor, "fisherBoatBlocked", FISHER_BOAT_RETRY_SECONDS);
};

/** Afloat: the hidden rower and the boat follow the rowing route by the remaining timer. */
const placeAfloat = (actor: SettlementActor, building: SettlementBuilding, route: SettlementPoint[], share: number) => {
  const point = pointAlongBoatRoute(route, fisherBoatRouteLength(route) * share);
  actor.x = point.x; actor.z = point.z; actor.yaw = point.yaw;
  building.fisherBoat = { place: "afloat", slot: actor.boatTrip!.slot, x: point.x, yaw: point.yaw, z: point.z };
};

const rowSeconds = (route: SettlementPoint[]) => fisherBoatRouteLength(route) / FISHER_BOAT_ROW_SPEED;

const launch = (context: SettlementContext, actor: SettlementActor, building: SettlementBuilding) => {
  const route = tripRoute(context, building, actor);
  if (!route) return false;
  actor.visible = false;
  inPlace(actor, "fisherBoatRowOut", rowSeconds(route), "idle");
  placeAfloat(actor, building, route, 0);
  return true;
};

const beach = (actor: SettlementActor, building: SettlementBuilding, slot: BoatLaunchSlot) => {
  actor.x = slot.x; actor.z = slot.z; actor.yaw = slot.yaw + Math.PI; actor.visible = true;
  parkAt(building, actor.boatTrip!.slot, slot);
  inPlace(actor, "fisherBoatBeach", FISHER_BOAT_BEACH_SECONDS);
};

/** The haul: four fish in one basket (owner answer 1), each counted as a production cycle. */
const takeCatch = (context: SettlementContext, actor: SettlementActor, building: SettlementBuilding) => {
  for (let fish = 0; fish < FISHER_BOAT_CATCH; fish++) {
    building.cycle++;
    context.options.onProductionCycle?.(building, {}, "fish");
  }
  if (context.script) emitWareProduced(context, building, "fish", FISHER_BOAT_CATCH);
  actor.ware = "fish"; actor.wareUnits = FISHER_BOAT_CATCH; actor.boatTrip = undefined;
};

const advanceAfloat = (
  context: SettlementContext, actor: SettlementActor, building: SettlementBuilding, dt: number
) => {
  const route = tripRoute(context, building, actor);
  const slot = tripSlot(building, actor);
  if (!route || !slot) return endTrip(actor, building);
  const total = actor.phase === "fisherBoatNet" ? FISHER_BOAT_NET_SECONDS : rowSeconds(route);
  actor.timer = Math.max(0, actor.timer - dt);
  if (actor.phase !== "fisherBoatNet") {
    const share = total ? 1 - actor.timer / total : 1;
    placeAfloat(actor, building, route, actor.phase === "fisherBoatRowOut" ? share : 1 - share);
  }
  if (actor.timer > 0) return;
  if (actor.phase === "fisherBoatRowOut") inPlace(actor, "fisherBoatNet", FISHER_BOAT_NET_SECONDS, "work");
  else if (actor.phase === "fisherBoatNet") inPlace(actor, "fisherBoatRowBack", rowSeconds(route), "idle");
  else beach(actor, building, slot);
};

/** A trip that lost its site or route ends with the boat parked (or kept in the yard); the fisher rests. */
const endTrip = (actor: SettlementActor, building: SettlementBuilding) => {
  const slot = tripSlot(building, actor);
  if (actor.ware === BOAT_WARE || building.fisherBoat?.place === "afloat") {
    if (slot) { parkAt(building, actor.boatTrip!.slot, slot); actor.x = slot.x; actor.z = slot.z; }
    actor.ware = null; actor.visible = true;
  }
  actor.boatTrip = undefined; actor.stockBuilding = undefined;
  inPlace(actor, "deposit", 0);
};

const arriveFromWalk = (context: SettlementContext, actor: SettlementActor, building: SettlementBuilding, slot: BoatLaunchSlot) => {
  if (actor.phase === "fisherBoatFetch") {
    if (!building.fisherBoat)
      actor.yaw = fisheryYardSkiffPickup(buildingNation(context, building) ?? "roman", building).yaw;
    else if (building.fisherBoat.place === "dropped") actor.yaw = groundSkiffPickup(building.fisherBoat).yaw;
    inPlace(actor, "fisherBoatLift", FISHER_BOAT_LIFT_SECONDS, "work"); return;
  }
  if (actor.phase === "fisherBoatCarry") { actor.ware = null; parkAt(building, actor.boatTrip!.slot, slot); }
  actor.stockBuilding = undefined;
  actor.yaw = slot.yaw;
  inPlace(actor, "fisherBoatLaunch", FISHER_BOAT_LAUNCH_SECONDS, "work");
};

const advanceInPlace = (
  context: SettlementContext, actor: SettlementActor, building: SettlementBuilding, dt: number,
  deposit: () => void
) => {
  const slot = tripSlot(building, actor);
  actor.timer -= dt;
  if (actor.timer > 0) return;
  if (!slot) { endTrip(actor, building); return; }
  if (actor.phase === "fisherBoatLift") { liftBoat(building, actor); carryToSlot(context, actor, slot); }
  else if (actor.phase === "fisherBoatBlocked") carryToSlot(context, actor, slot);
  else if (actor.phase === "fisherBoatLaunch") { if (!launch(context, actor, building)) endTrip(actor, building); }
  else { takeCatch(context, actor, building); deposit(); }
};

/** Advances a boat-trip phase; false for every other phase (the worker chain continues). */
export const updateFisherBoatTrip = (
  context: SettlementContext, actor: SettlementActor, building: SettlementBuilding, dt: number,
  deposit: () => void
) => {
  if (!isFisherBoatPhase(actor.phase)) return false;
  if (!actor.boatTrip) { endTrip(actor, building); return true; }
  // Old saves could stop a yard lift at the front door. Walk to the actual
  // stored hull before consuming that boat; newly routed trips already agree.
  if (actor.phase === "fisherBoatLift" && !actor.boatTrip.yard && !building.fisherBoat &&
    (building.input[BOAT_WARE] ?? 0) > 0) {
    const pickup = fisheryYardSkiffPickup(buildingNation(context, building) ?? "roman", building);
    actor.boatTrip.yard = true; actor.stockBuilding = building.uid;
    if (DMath.hypot(actor.x - pickup.x, actor.z - pickup.z) > .01) {
      const path = groundPath(context, actor, pickup, building.uid);
      if (path) setActorPath(actor, path, "fisherBoatFetch");
      else endTrip(actor, building);
      return true;
    }
  }
  if (FISHER_BOAT_AFLOAT_PHASES.has(actor.phase)) {
    advanceAfloat(context, actor, building, dt);
    return true;
  }
  if (!FISHER_BOAT_WALK_PHASES.has(actor.phase)) {
    advanceInPlace(context, actor, building, dt, deposit);
    return true;
  }
  const slot = tripSlot(building, actor);
  if (!slot) { endTrip(actor, building); return true; }
  if (moveActor(context, actor, dt)) arriveFromWalk(context, actor, building, slot);
  return true;
};
