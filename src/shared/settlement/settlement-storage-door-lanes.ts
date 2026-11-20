import { usesStorageDoubleDoor } from "../../render-common/buildings/storage-door-profile";
import { WORKER_RADIUS } from "../../render-common/workers/worker-dimensions";
import { DMath } from "../math/deterministic-math";
import { distanceToSegment } from "./settlement-geometry";
import { isOwnBuilding } from "./settlement-home";
import type { SettlementActor, SettlementBuilding, SettlementPoint } from "./settlement-types";

/** Full .4m bodies have .1m between the two .5m-spaced lane centres. */
export const STORAGE_DOOR_LANE_OFFSET = .25;
/** Both complete bodies and a5cm margin at each outside edge of the local entrance ribbon. */
export const STORAGE_DOOR_APPROACH_WIDTH = 2 * (STORAGE_DOOR_LANE_OFFSET + WORKER_RADIUS + .05);
export type StorageDoorDirection = "in" | "out";

/**
 * A finished double-door storage of an economy keeps an in and an out lane: the player's, or a computer economy's
 * (a pool access point; EAI3-accept: without lanes its carriers and builders jammed head-on in the depot door). A
 * hostile storage of a faction without an economy keeps its single passage, as before.
 */
export const hasStorageDoorLanes = (building: SettlementBuilding) =>
  usesStorageDoubleDoor(building.typeId) && building.hasDoor && building.construction >= 1 &&
  (isOwnBuilding(building) || building.storagePoolId !== undefined);

export const storageDoorLanePoint = (
  building: SettlementBuilding, point: SettlementPoint, direction: StorageDoorDirection
): SettlementPoint => {
  if (!hasStorageDoorLanes(building)) return point;
  const angle = (building.rotation ?? 0) * Math.PI / 2;
  const side = direction === "in" ? STORAGE_DOOR_LANE_OFFSET : -STORAGE_DOOR_LANE_OFFSET;
  return { ...point, x: point.x + Math.round(DMath.cos(angle)) * side,
    z: point.z - Math.round(DMath.sin(angle)) * side };
};

export const storageDoorFootTraffic = (actor: SettlementActor) =>
  !actor.mounted && !actor.handcart && actor.job !== "Mount";

/** Same projected corridor as the visible paired leaves; also protects both lanes from waiters. */
export const storageDoorLaneDistance = (building: SettlementBuilding, point: SettlementPoint,
  direction: StorageDoorDirection) => {
  const door = storageDoorLanePoint(building, building.doorThreshold, direction);
  const approach = storageDoorLanePoint(building, building.workerApproach, direction);
  const access = storageDoorLanePoint(building, building.access, direction);
  return Math.min(distanceToSegment(point, door, approach), distanceToSegment(point, approach, access));
};

/** Local -X is leaf0, local +X leaf1, irrespective of national facing/quarter-turn rotation. */
export const storageDoorLeafAt = (building: SettlementBuilding, actor: SettlementActor): 0 | 1 => {
  const angle = (building.rotation ?? 0) * Math.PI / 2;
  const lateral = (actor.x - building.doorThreshold.x) * Math.round(DMath.cos(angle)) -
    (actor.z - building.doorThreshold.z) * Math.round(DMath.sin(angle));
  return lateral < 0 ? 0 : 1;
};

/** Place an invisible indoor departure behind its own leaf before normal visible walking starts. */
export const prepareStorageDoorDeparture = (actor: SettlementActor, building: SettlementBuilding) => {
  if (actor.visible || !hasStorageDoorLanes(building) || !storageDoorFootTraffic(actor)) return;
  const point = storageDoorLanePoint(building, building.doorThreshold, "out");
  actor.x = point.x; actor.z = point.z;
};
