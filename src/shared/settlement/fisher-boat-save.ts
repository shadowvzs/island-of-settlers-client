import { FISHERY_TYPE_ID } from "./building-type-ids";
import { BOAT_SITE_NETS, BOAT_SITE_SLOTS } from "./constants";
import { isFiniteNumber, isSaveInteger, isSaveObject, isSavePoint } from "./save-validation";
import type { SettlementContext, SettlementPoint } from "./settlement-types";

type SavedWorld = SettlementContext["options"]["world"];
type SavedBuilding = Record<string, unknown>;

const isCustodyPlace = (place: unknown) =>
  place === "afloat" || place === "carried" || place === "dropped" || place === "slot";
const isBoatWaterKind = (water: unknown) => water === "lake" || water === "sea";

const isMapPoint = (value: unknown, world: SavedWorld): value is SavedBuilding & SettlementPoint =>
  isSavePoint(value) && value.x >= 0 && value.z >= 0 && value.x < world.cellsX && value.z < world.cellsZ;

const isLaunchSlot = (value: unknown, world: SavedWorld) =>
  isMapPoint(value, world) && isMapPoint(value.launch, world) && isMapPoint(value.shoreEntry, world) &&
  isFiniteNumber(value.waterY) && isFiniteNumber(value.yaw);

const isRankedList = (value: unknown, limit: number, valid: (entry: unknown) => boolean) =>
  Array.isArray(value) && value.length > 0 && value.length <= limit && value.every(valid);

const isBoatSite = (site: unknown, world: SavedWorld) => {
  if (!isSaveObject(site) || !isFiniteNumber(site.radius) || site.radius < 0) return false;
  if (site.ok === false) return true;
  return site.ok === true && isBoatWaterKind(site.water) &&
    isRankedList(site.slots, BOAT_SITE_SLOTS, slot => isLaunchSlot(slot, world)) &&
    isRankedList(site.nets, BOAT_SITE_NETS, net => isMapPoint(net, world));
};

const isCustody = (custody: unknown, site: unknown, world: SavedWorld) => {
  if (!isMapPoint(custody, world) || !isCustodyPlace(custody.place) || !isFiniteNumber(custody.yaw))
    return false;
  const slots = isSaveObject(site) && Array.isArray(site.slots) ? site.slots.length : 0;
  return isSaveInteger(custody.slot) && custody.slot >= 0 && custody.slot < slots;
};

const ownedBoats = (building: SavedBuilding) => {
  const input = isSaveObject(building.input) ? building.input.boat : undefined;
  return (isSaveInteger(input) ? input : 0) + Number(building.fisherBoat !== undefined);
};

/** FISHER-BOAT save fields: only on a Fishery, well formed, and at most one owned boat. */
export const fisherBoatSaveProblem = (building: SavedBuilding, world: SavedWorld) => {
  const { boatSite, fisherBoat, fisherMode } = building;
  if (fisherMode === undefined && boatSite === undefined && fisherBoat === undefined) return undefined;
  if (building.typeId !== FISHERY_TYPE_ID) return "Fisher boat state on a non-fishery";
  if (fisherMode !== undefined && fisherMode !== "boat") return "Invalid fisher mode";
  if (boatSite !== undefined && !isBoatSite(boatSite, world)) return "Invalid fisher boat site";
  if (fisherBoat !== undefined && !isCustody(fisherBoat, boatSite, world)) return "Invalid fisher boat custody";
  return ownedBoats(building) > 1 ? "Fishery owns more than one boat" : undefined;
};

/** An actor's boat trip names one of its Fishery's ranked slots and nets. */
export const isSavedFisherBoatTrip = (trip: unknown) =>
  isSaveObject(trip) && (trip.yard === undefined || typeof trip.yard === "boolean") && isSaveInteger(trip.net) && trip.net >= 0 && trip.net < BOAT_SITE_NETS &&
  isSaveInteger(trip.slot) && trip.slot >= 0 && trip.slot < BOAT_SITE_SLOTS;
