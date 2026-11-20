import { type BoatFishingSite, type BoatSiteReservations, findBoatFishingSite, fisheryWorkRange }
  from "./boat-fishing-site";
import { isSkiffWaterClear } from "./boat-fishing-water";
import { FISHERY_TYPE_ID, HEADQUARTERS_TYPE_ID, STOREHOUSE_TYPE_ID } from "./building-type-ids";
import { BOAT_WARE } from "./constants";
import { isOwnBuilding } from "./settlement-home";
import { createTransportReservationIndex } from "./settlement-transport-reservation-index";
import type { SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";
import { stockLandAt } from "./stock-lands";

/**
 * FISHER-BOAT mode (plan 2026-11-11 §1.1, owner answers 2 and 6): a Fishery fishes with the rod
 * (default) or from a skiff. Boat mode needs a validated sea/lake shore inside the work radius and a
 * boat the island can spare; switching reserves one boat from a headquarters or storehouse on the
 * same land, which a carrier then delivers as the Fishery's input. Harbour boats are never taken.
 */
export type FisherMode = "boat" | "rod";
/** Why boat mode cannot be chosen right now. */
export type FisherBoatBlock = "noBoat" | "noShore";
/** Where the Fishery's own boat is, for the panel; trip places arrive with the trip lane (L4). */
export type FisherBoatPlace = "afloat" | "carried" | "dropped" | "incoming" | "shore" | "waiting" | "yard";

export const isFisherMode = (mode: unknown): mode is FisherMode => mode === "boat" || mode === "rod";

export const fisherMode = (building: SettlementBuilding): FisherMode => building.fisherMode ?? "rod";

const isCompletedFishery = (building: SettlementBuilding | undefined): building is SettlementBuilding =>
  building?.typeId === FISHERY_TYPE_ID && building.construction === 1 && isOwnBuilding(building);

/** Boats this Fishery owns: in its yard, carried to it, or out at the shore/water. */
export const fisheryBoatCount = (building: SettlementBuilding) =>
  (building.input[BOAT_WARE] ?? 0) + (building.incoming[BOAT_WARE] ?? 0) + Number(building.fisherBoat !== undefined);

/** A boat-mode Fishery that still waits for its reserved boat. */
const reservesBoat = (building: SettlementBuilding) =>
  isCompletedFishery(building) && building.fisherMode === "boat" && fisheryBoatCount(building) < 1;

/** Carriers fetch the reserved boat while the Fishery is not paused (paused buildings ask for nothing). */
export const fisheryNeedsBoat = (building: SettlementBuilding) =>
  reservesBoat(building) && !building.productionPaused;

/** Boat sources for a Fishery: completed player headquarters and storehouses, never a harbour. */
export const isFisherBoatSource = (source: SettlementBuilding) =>
  (source.typeId === HEADQUARTERS_TYPE_ID || source.typeId === STOREHOUSE_TYPE_ID) &&
  source.construction === 1 && isOwnBuilding(source);

const sameLand = (context: SettlementContext, land: number, point: SettlementPoint) =>
  land >= 0 && stockLandAt(context, point) === land;

/** Idle storehouse/headquarters boats on the Fishery's land, minus those other fisheries reserved. */
export const spareIslandBoats = (context: SettlementContext, fishery: SettlementBuilding) => {
  const land = stockLandAt(context, fishery.access);
  const reservations = createTransportReservationIndex(context);
  let spare = 0;
  for (const building of context.buildings) {
    if (!sameLand(context, land, building.access)) continue;
    if (isFisherBoatSource(building)) spare += Math.max(0, reservations.available(building, BOAT_WARE));
    else if (building !== fishery && reservesBoat(building)) spare -= 1;
  }
  return spare;
};

/** Slots and first nets of the other boat fisheries, so two fisheries never share one. */
const otherFisheryReservations = (context: SettlementContext, fishery: SettlementBuilding): BoatSiteReservations => {
  const reserved = { nets: [] as SettlementPoint[], slots: [] as SettlementPoint[] };
  for (const building of context.buildings) {
    const site = building.boatSite;
    if (building === fishery || building.fisherMode !== "boat" || !site?.ok) continue;
    reserved.slots.push(site.slots[0]!);
    reserved.nets.push(site.nets[0]!);
  }
  return reserved;
};

const storedSite = (context: SettlementContext, building: SettlementBuilding) => {
  const site = building.boatSite;
  if (!site || site.radius !== fisheryWorkRange(building)?.radius) return undefined;
  if (site.ok && site.slots.some(slot => !isSkiffWaterClear(context.options.world, slot.launch.x, slot.launch.z)))
    return undefined;
  return site;
};

/** The stored validation for the current work radius, or a fresh deterministic search. */
export const currentBoatFishingSite = (context: SettlementContext, building: SettlementBuilding): BoatFishingSite =>
  storedSite(context, building) ?? findBoatFishingSite(context, building, otherFisheryReservations(context, building));

export const fisherBoatBlock = (
  context: SettlementContext, building: SettlementBuilding, site: BoatFishingSite
): FisherBoatBlock | undefined => {
  if (!site.ok) return "noShore";
  if (fisheryBoatCount(building) > 0 || spareIslandBoats(context, building) > 0) return undefined;
  return "noBoat";
};

/** Where the Fishery's boat is (undefined: rod mode and no boat of its own). */
export const fisherBoatPlace = (building: SettlementBuilding): FisherBoatPlace | undefined => {
  if (building.fisherBoat) return building.fisherBoat.place === "slot" ? "shore" : building.fisherBoat.place;
  if ((building.input[BOAT_WARE] ?? 0) > 0) return "yard";
  if ((building.incoming[BOAT_WARE] ?? 0) > 0) return "incoming";
  return building.fisherMode === "boat" ? "waiting" : undefined;
};

/**
 * The replay-recorded mode command. Rod is always accepted (an owned boat stays parked, owner
 * answer 3); boat needs a valid shore and an owned or spare island boat, and stores the validation.
 */
export const setFisherMode = (
  context: SettlementContext, building: SettlementBuilding | undefined, mode: FisherMode
) => {
  if (!isCompletedFishery(building) || !isFisherMode(mode)) return false;
  if (mode === "rod") {
    building.fisherMode = undefined;
    return true;
  }
  if (building.fisherMode === "boat") return true;
  const site = currentBoatFishingSite(context, building);
  if (!site.ok || fisherBoatBlock(context, building, site)) return false;
  building.boatSite = site;
  building.fisherMode = "boat";
  return true;
};

/** The panel's view of one Fishery's mode, boat option and boat. */
export interface FisherBoatStatus {
  block?: FisherBoatBlock;
  mode: FisherMode;
  place?: FisherBoatPlace;
}

const previews = new WeakMap<SettlementBuilding, { key: string; site: BoatFishingSite }>();

/** Everything a shore search reads: terrain, felled props, plots, roads and the other boat fisheries. */
const previewKey = (context: SettlementContext, building: SettlementBuilding) => {
  const { roads, world } = context.options;
  const boatFisheries = context.buildings.filter(other => other.fisherMode === "boat").length;
  return [world.terrainRevision ?? 0, world.buildRevision ?? 0, world.props.count, context.navigationRevision ?? 0,
    roads.revision ?? 0, context.buildings.length, boatFisheries, fisheryWorkRange(building)?.radius].join(":");
};

/** A read-only, cached shore search for the panel; only the mode command stores a validation. */
const previewBoatFishingSite = (context: SettlementContext, building: SettlementBuilding) => {
  const stored = storedSite(context, building);
  if (stored) return stored;
  const key = previewKey(context, building), cached = previews.get(building);
  if (cached?.key === key) return cached.site;
  const site = currentBoatFishingSite(context, building);
  previews.set(building, { key, site });
  return site;
};

/** Panel status; undefined for anything but a completed player Fishery. */
export const fisherBoatStatus = (context: SettlementContext, building: SettlementBuilding | undefined):
  FisherBoatStatus | undefined => {
  if (!isCompletedFishery(building)) return undefined;
  const mode = fisherMode(building), place = fisherBoatPlace(building);
  if (mode === "boat") return { mode, place };
  return { block: fisherBoatBlock(context, building, previewBoatFishingSite(context, building)), mode, place };
};

/** A Fishery that fishes from its own boat: boat mode with the boat in the yard, at the shore or afloat. */
export const isBoatFishing = (building: SettlementBuilding) =>
  building.typeId === FISHERY_TYPE_ID && building.fisherMode === "boat" &&
  ((building.input[BOAT_WARE] ?? 0) > 0 || building.fisherBoat !== undefined);
