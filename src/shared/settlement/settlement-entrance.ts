import { isBuildingCourtyardEscapeStep, isBuildingCourtyardPointWalkable } from "../../render-common/buildings/building-courtyard";
import { stockStyleFor } from "../../render-common/buildings/building-stock-layout";
import { DMath } from "../math/deterministic-math";
import { isCatapultPorter, isCatapultPorterOutside } from "./military-catapult-resupply";
import { STORAGE_IDS } from "./production-rules";
import { getBuilding } from "./settlement-building-index";
import { distanceToSegment } from "./settlement-geometry";
import { isOwnLevelerSitePoint } from "./settlement-leveler-access";
import { buildingNation } from "./settlement-nation";
import { hasStorageDoorLanes, STORAGE_DOOR_LANE_OFFSET, type StorageDoorDirection, storageDoorFootTraffic,
  storageDoorLaneDistance, storageDoorLanePoint } from "./settlement-storage-door-lanes";
import { actorSeparation } from "./settlement-traffic";
import type {
  SettlementActor,
  SettlementBuilding,
  SettlementContext,
  SettlementPoint
} from "./settlement-types";

/** Foot crews walk their storage lane; a led horse (`crew`) needs the whole doorway centre line. */
const doorLanePoint = (building: SettlementBuilding, point: SettlementPoint, direction: StorageDoorDirection,
  crew?: SettlementActor) => crew?.job === "Mount" ? point : storageDoorLanePoint(building, point, direction);
export const entrancePath = (building: SettlementBuilding, crew?: SettlementActor) => [
  doorLanePoint(building, building.workerApproach, "in", crew),
  doorLanePoint(building, building.doorThreshold, "in", crew)
];
export const exitPath = (building: SettlementBuilding, crew?: SettlementActor) => [
  doorLanePoint(building, building.workerApproach, "out", crew),
  doorLanePoint(building, building.access, "out", crew)
];
/**
 * A point `distance` tiles out from the building's road access, straight away from its door, shifted `side` tiles
 * sideways (a place to stand clear of the doorway: a deploying commander, a computer faction's muster).
 */
export const doorFrontPoint = (building: SettlementBuilding, distance: number, side: number): SettlementPoint => {
  const { access, doorThreshold } = building;
  const dx = access.x - doorThreshold.x, dz = access.z - doorThreshold.z;
  const length = DMath.hypot(dx, dz) || 1, forwardX = dx / length, forwardZ = dz / length;
  return { x: access.x + forwardX * distance - forwardZ * side, z: access.z + forwardZ * distance + forwardX * side };
};
/** Rounding margin of the box test: far above any `distanceToSegment` error, far below a lane width. */
const DOOR_LANE_BOX_MARGIN = 1e-6;
/**
 * Every lane segment (both storage foot lanes included) lies in the box of the door, approach and
 * access points widened by the lane offset, so a point farther than `clearance` from that box is
 * farther than `clearance` from every lane. A10: rejects most pair checks without segment math.
 */
const doorLaneBox = (building: SettlementBuilding, clearance: number) => {
  const { access, doorThreshold, workerApproach } = building;
  const reach = clearance + STORAGE_DOOR_LANE_OFFSET + DOOR_LANE_BOX_MARGIN;
  return { maxX: Math.max(access.x, doorThreshold.x, workerApproach.x) + reach,
    maxZ: Math.max(access.z, doorThreshold.z, workerApproach.z) + reach,
    minX: Math.min(access.x, doorThreshold.x, workerApproach.x) - reach,
    minZ: Math.min(access.z, doorThreshold.z, workerApproach.z) - reach };
};
const isOutsideBox = (box: ReturnType<typeof doorLaneBox>, point: SettlementPoint) =>
  point.x < box.minX || point.x > box.maxX || point.z < box.minZ || point.z > box.maxZ;
const isOutsideDoorLaneBox = (building: SettlementBuilding, point: SettlementPoint, clearance: number) =>
  isOutsideBox(doorLaneBox(building, clearance), point);
/** Near the lane a settler walks between this building's door, its approach and its road access. */
export const isNearDoorLane = (building: SettlementBuilding, point: SettlementPoint, clearance: number) =>
  !isOutsideDoorLaneBox(building, point, clearance) && (
    distanceToSegment(point, building.doorThreshold, building.workerApproach) < clearance ||
  distanceToSegment(point, building.workerApproach, building.access) < clearance ||
  (hasStorageDoorLanes(building) && (storageDoorLaneDistance(building, point, "in") < clearance ||
    storageDoorLaneDistance(building, point, "out") < clearance)));
const DOOR_LANE = 0.17;
/** Door fighters are jostled by the crowd outside; they may step back into the doorway from its full width. */
const DOOR_FIGHT_LANE = 0.45;
const DOOR_LANE_PHASES = new Set([
  "assigned", "upgradeAssigned",
  "pickup",
  "outbound",
  "militaryLeaving",
  "militaryTransferLeaving",
  "militarySiege",
  "enterHome",
  "enterRetire",
  "enterAssigned",
  "enterRest",
  "enterPickup",
  "enterDelivery",
  "exitLoaded",
  "exitDelivery",
  "outputWalk",
  "inputApproach",
  "inputReturn",
  "outputFullReturn",
  "shipInputWalk",
  "boatInputWalk",
  "navalToHarbour",
  "navalToShip",
  "navalEnterHarbour",
  "navalLanding",
  "navalLandingEnter",
  "foresterPickupWalk",
  "fisherBoatFetch",
  "fisherBoatCarry",
  "settlerRelocate",
  "settlerRelocateEnter"
]);
const SOURCE_PASSAGE_PHASES = new Set(["enterPickup", "exitLoaded"]);
const porterPassage = (actor: SettlementActor, building: SettlementBuilding | undefined) => {
  const porter = building?.catapultSupply?.porter;
  return !!building && !!porter && isCatapultPorter(building, actor.uid) && isCatapultPorterOutside(porter.phase);
};
const HOME_PASSAGE_PHASES = new Set([
  "home", "enterHome", "retire", "enterRetire", "pickup", "assigned", "upgradeAssigned", "navalToHarbour", "navalToShip",
  "settlerRelocate"
]);
/** A saved/repaired arrival can already be inside the hall on its way back to the access.
 * It must finish that outward leg before joining the outside queue; otherwise it blocks the
 * departing crew behind it while waiting for that same crew's turn to end.
 */
export const CLEARING_PHASES: ReadonlySet<string> = new Set(["home", "retire", "pickup", "deliver"]);
/** The storage uid `clearingStorageArrival` looks at (its building can only be this one). */
export const clearingStorageUid = (actor: SettlementActor) => {
  if (!CLEARING_PHASES.has(actor.phase) || !actor.visible) return undefined;
  if (actor.phase === "pickup") return actor.delivery?.source;
  return actor.phase === "deliver" ? actor.delivery?.destination : actor.home;
};
/**
 * A12: a necessary condition of `clearingStorageArrival(context, actor)?.uid === uid` for scans that
 * test every actor against one storage: the same building lookup and the door-lane box rejection of
 * its `isNearDoorLane` test, before any route or lane arithmetic. False: the arrival test is false.
 */
export const createClearingArrivalFilter = (context: SettlementContext, uid: number) => {
  const building = getBuilding(context, uid);
  if (!building) return () => false;
  const box = doorLaneBox(building, DOOR_LANE);
  return (actor: SettlementActor) => clearingStorageUid(actor) === uid && !isOutsideBox(box, actor);
};
export const clearingStorageArrival = (context: SettlementContext, actor: SettlementActor) => {
  const uid = clearingStorageUid(actor);
  if (uid === undefined) return undefined;
  const building = getBuilding(context, uid), next = actor.path[actor.pathIndex];
  const end = actor.path.at(-1);
  if (!building || !building.hasDoor || !STORAGE_IDS.has(building.typeId) || building.construction < 1 || !next || !end ||
    DMath.hypot(end.x - building.access.x, end.z - building.access.z) > .01 ||
    !isNearDoorLane(building, actor, DOOR_LANE)) return undefined;
  const dx = building.doorThreshold.x - building.access.x;
  const dz = building.doorThreshold.z - building.access.z;
  const inward = (point: SettlementPoint) =>
    (point.x - building.access.x) * dx + (point.z - building.access.z) * dz;
  return inward(actor) > 1e-6 && inward(next) <= inward(actor) &&
    isNearDoorLane(building, next, DOOR_LANE) ? building : undefined;
};
/** The building whose door lane the actor's current phase walks through. */
export const passageBuilding = (actor: SettlementActor) => {
  if (SOURCE_PASSAGE_PHASES.has(actor.phase)) return actor.delivery?.source;
  return HOME_PASSAGE_PHASES.has(actor.phase) ? actor.home : actor.building;
};
/** The building whose door lane the actor's phase may cross, when it grants one (point-independent). */
const ownPassageBuilding = (context: SettlementContext, actor: SettlementActor) => {
  const building = getBuilding(context, passageBuilding(actor));
  if (!DOOR_LANE_PHASES.has(actor.phase) && !porterPassage(actor, building)) return undefined;
  return building && building.construction >= 1 ? building : undefined;
};
const isInOwnDoorLanes = (clearing: SettlementBuilding | undefined, building: SettlementBuilding | undefined,
  actor: SettlementActor, point: SettlementPoint) => {
  if (clearing && isNearDoorLane(clearing, point, DOOR_LANE) &&
    (point.x - actor.x) * (clearing.doorThreshold.x - clearing.access.x) +
      (point.z - actor.z) * (clearing.doorThreshold.z - clearing.access.z) <= 1e-6) return true;
  if (!building) return false;
  if (
    point.x < building.x - building.width / 2 ||
    point.x > building.x + building.width / 2 ||
    point.z < building.z - building.depth / 2 ||
    point.z > building.z + building.depth / 2
  )
    return false;
  return isNearDoorLane(building, point, actor.phase === "militarySiege" ? DOOR_FIGHT_LANE : DOOR_LANE);
};
/** Only the travelling actor's own door lane can cross its reserved plot. */
export const isOwnDoorLane = (context: SettlementContext, actor: SettlementActor, point: SettlementPoint) =>
  isInOwnDoorLanes(clearingStorageArrival(context, actor), ownPassageBuilding(context, actor), actor, point);
/**
 * A10b: `isOwnDoorLane` for many points while nothing moves (one segment check). The lanes depend on
 * the actor's phase, route and position and on building state only, never on the point.
 */
export const ownDoorLaneProbe = (context: SettlementContext, actor: SettlementActor) => {
  const clearing = clearingStorageArrival(context, actor), building = ownPassageBuilding(context, actor);
  return (point: SettlementPoint) => isInOwnDoorLanes(clearing, building, actor, point);
};

const entering = new Set([
  "enterHome",
  "enterRetire",
  "enterAssigned",
  "enterRest",
  "enterPickup",
  "enterDelivery",
  "inputReturn",
  "outputFullReturn",
  "navalEnterHarbour",
  "navalLandingEnter",
  "settlerRelocateEnter"
]);
const exiting = new Set([
  "militaryLeaving",
  "militaryTransferLeaving",
  "pickup",
  "assigned", "upgradeAssigned",
  "outbound",
  "exitLoaded",
  "exitDelivery",
  "outputWalk",
  "inputApproach",
  "shipInputWalk",
  "boatInputWalk",
  "navalToHarbour",
  "navalToShip",
  "foresterPickupWalk",
  "fisherBoatFetch",
  "fisherBoatCarry",
  "settlerRelocate"
]);
/** The phase walks out of its passage building's door (a departure, never an arrival). */
export const isDoorDeparturePhase = (phase: string) => exiting.has(phase);
/** The phase walks in through its passage building's door. */
export const isDoorEntryPhase = (phase: string) => entering.has(phase);
const inPassage = (actor: SettlementActor, building: SettlementBuilding) =>
  isNearDoorLane(building, actor, .35);
/** Nearby passers-by and outdoor stock work do not request another building's door. */
export const actorOpensDoor = (actor: SettlementActor, building: SettlementBuilding) =>
  actor.visible &&
  building.hasDoor &&
  building.construction >= 1 &&
    (entering.has(actor.phase) || exiting.has(actor.phase) || actor.phase === "militarySiege" ||
      porterPassage(actor, building)) &&
  passageBuilding(actor) === building.uid &&
  DMath.hypot(actor.x - building.doorThreshold.x, actor.z - building.doorThreshold.z) < 0.45 &&
  isNearDoorLane(building, actor, .17);
/** Serialized doorway traffic must not invent road shoulder detours inside its own passage. */
export const isInOwnDoorPassage = (context: SettlementContext, actor: SettlementActor) => {
  const building = getBuilding(context, passageBuilding(actor));
  return !!building && building.construction >= 1 && inPassage(actor, building);
};
export const canLeaveDoor = (context: SettlementContext, actor: SettlementActor) => {
  const uid = passageBuilding(actor);
  const building = getBuilding(context, uid);
  if (building && hasStorageDoorLanes(building) && storageDoorFootTraffic(actor)) {
    return !context.actors.some(other => other !== actor && other.visible &&
      (DMath.hypot(other.x - actor.x, other.z - actor.z) < actorSeparation(actor, other) + .02 ||
        (!storageDoorFootTraffic(other) && passageBuilding(other) === uid && inPassage(other, building))));
  }
  return !context.actors.some(
    (other) =>
      other !== actor &&
      other.visible &&
      passageBuilding(other) === uid &&
      (building && (entering.has(other.phase) || exiting.has(other.phase) || porterPassage(other, building)) &&
        inPassage(other, building))
  );
};
export const canEnterDoor = (
  context: SettlementContext,
  actor: SettlementActor,
  building: SettlementBuilding
) => {
  if (hasStorageDoorLanes(building) && storageDoorFootTraffic(actor)) {
    return !context.actors.some(other => other !== actor && other.visible &&
      passageBuilding(other) === building.uid &&
      (DMath.hypot(other.x - actor.x, other.z - actor.z) < actorSeparation(actor, other) + .02 ||
        (!storageDoorFootTraffic(other) && inPassage(other, building))));
  }
  return !context.actors.some(
    (other) =>
      other !== actor &&
      other.visible &&
      passageBuilding(other) === building.uid &&
      (((entering.has(other.phase) || (porterPassage(other, building) &&
        building.catapultSupply?.porter?.phase === "inbound")) &&
        DMath.hypot(other.x - actor.x, other.z - actor.z) < actorSeparation(actor, other) + .02) ||
        ((exiting.has(other.phase) || (porterPassage(other, building) &&
          building.catapultSupply?.porter?.phase === "outbound")) && inPassage(other, building)))
  );
};

export const isOwnStockCourtyard = (
  context: SettlementContext,
  actor: SettlementActor,
  point: SettlementPoint
) => {
  const building =
    actor.stockBuilding === undefined
      ? undefined
      : getBuilding(context, actor.stockBuilding);
  if (actor.job === "Leveler" && building && building.construction < 1)
    return isOwnLevelerSitePoint(context, actor, point, building);
  return (
    !!building &&
    point.x >= building.x - building.width / 2 &&
    point.x <= building.x + building.width / 2 &&
    point.z >= building.z - building.depth / 2 &&
    point.z <= building.z + building.depth / 2 &&
    ((context.options.canWorkerEnterPlot?.(building, point) ??
      isBuildingCourtyardPointWalkable(
        building.typeId,
        building.x,
        building.z,
        building.rotation,
        point,
        building.output,
        building.input
      )) ||
      isBuildingCourtyardEscapeStep(building.typeId, building.x, building.z, building.rotation,
        actor, point, building.output, building.input, stockStyleFor(buildingNation(context, building), building)))
  );
};
