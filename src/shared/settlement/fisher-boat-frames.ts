import { FISHING_SKIFF_KEEL_DEPTH } from "../../render-common/ships/fishing-skiff-dimensions";
import { FISHING_SKIFF_LENGTH } from "../../render-common/ships/fishing-skiff-dimensions";
import { fisheryYardSkiffAnchor } from "../../render-common/ships/fishing-skiff-yard";
import type { FishingBoatFrame } from "../../render-common/ships/ship-frame";
import { DMath } from "../math/deterministic-math";
import { sampleSmooth } from "../world/grid-geometry";
import { boatWaterlineAlong, boatWaterSurface, isSkiffWaterClear } from "./boat-fishing-water";
import { BOAT_BOW_ON_SAND, BOAT_WARE, FISHER_BOAT_BEACH_SECONDS, FISHER_BOAT_LAUNCH_SECONDS,
  FISHER_BOAT_NET_SECONDS } from "./constants";
import { buildingNation } from "./settlement-nation";
import type { FisherBoatCustody, SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";

/**
 * The whole parked hull stays afloat beyond the visible waterline, including the shore-facing end.
 */
const parkedHull = (world: SettlementContext["options"]["world"], boat: FisherBoatCustody) => {
  const directionX = DMath.sin(boat.yaw), directionZ = DMath.cos(boat.yaw);
  const surface = boatWaterSurface(world, boat.x, boat.z);
  const bow = boatWaterlineAlong(world, boat, directionX, directionZ, surface) ?? boat;
  let reach = FISHING_SKIFF_LENGTH / 2 - BOAT_BOW_ON_SAND;
  while (reach < 3 && !isSkiffWaterClear(world, bow.x + directionX * reach, bow.z + directionZ * reach, boat.yaw))
    reach += .05;
  const x = bow.x + directionX * reach, z = bow.z + directionZ * reach;
  const bed = sampleSmooth(world, world.heights, x, z);
  return { bed, x, y: Math.max(bed, boatWaterSurface(world, x, z)), z };
};

const netProgress = (actor: SettlementActor | undefined) =>
  actor?.phase === "fisherBoatNet" ? 1 - actor.timer / FISHER_BOAT_NET_SECONDS : undefined;

/** The hauled fish lie in the boat while it is rowed back and beached. */
const catchAboard = (actor: SettlementActor | undefined) =>
  actor?.phase === "fisherBoatRowBack" || actor?.phase === "fisherBoatBeach" && actor.timer >= 1
    ? { catch: true as const } : {};

type FrameBase = Pick<FishingBoatFrame, "id" | "nation" | "person">;

/** A delivered boat in the yard leans against its Fishery's wall until the fisher lifts it. */
const yardFrame = (
  context: SettlementContext, building: SettlementBuilding, worker: SettlementActor | undefined, base: FrameBase
): FishingBoatFrame | undefined => {
  if (!(building.input[BOAT_WARE] ?? 0) || worker?.phase === "fisherBoatLift") return undefined;
  const anchor = fisheryYardSkiffAnchor(buildingNation(context, building) ?? "roman", building);
  return { ...base, crewed: false, rowing: false, stowed: true, x: anchor.x, y: building.y, yaw: anchor.yaw,
    z: anchor.z };
};

const boatFrame = (
  context: SettlementContext, building: SettlementBuilding, worker: SettlementActor | undefined, base: FrameBase
): FishingBoatFrame | undefined => {
  const { world } = context.options, boat = building.fisherBoat;
  if (!boat) return yardFrame(context, building, worker, base);
  if (boat.place === "afloat") {
    return { ...base, bed: sampleSmooth(world, world.heights, boat.x, boat.z), ...catchAboard(worker), crewed: true,
      net: netProgress(worker),
      rowing: netProgress(worker) === undefined, x: boat.x, y: boatWaterSurface(world, boat.x, boat.z), yaw: boat.yaw,
      z: boat.z };
  }
  if (boat.place === "carried") return undefined;
  if (boat.place === "dropped") {
    return { ...base, crewed: false, rowing: false, x: boat.x, y: sampleSmooth(world, world.heights, boat.x, boat.z) + FISHING_SKIFF_KEEL_DEPTH,
      yaw: boat.yaw, z: boat.z };
  }
  let handling: FishingBoatFrame["handling"];
  if (worker?.phase === "fisherBoatLaunch")
    handling = { kind: "launch", progress: 1 - worker.timer / FISHER_BOAT_LAUNCH_SECONDS };
  else if (worker?.phase === "fisherBoatBeach")
    handling = { kind: "beach", progress: 1 - worker.timer / FISHER_BOAT_BEACH_SECONDS };
  return { ...base, ...catchAboard(worker), crewed: false, handling, rowing: false, yaw: boat.yaw,
    ...parkedHull(world, boat) };
};

/**
 * Render frames of every Fishery skiff: in the yard, parked at the shore, dropped or afloat. A carried
 * boat is drawn by the carrier's ware (overhead clip pending, Codex); afloat the hidden fisher is drawn as
 * the boat's rower.
 */
export const fisherBoatFrames = (context: SettlementContext): FishingBoatFrame[] =>
  context.buildings.flatMap(building => {
    if (building.typeId !== 18 || (!building.fisherBoat && !building.input[BOAT_WARE])) return [];
    const worker = context.actors.find(actor => actor.uid === building.worker);
    const base = { id: building.uid, nation: buildingNation(context, building), person: worker?.uid ?? building.uid };
    const frame = boatFrame(context, building, worker, base);
    return frame ? [frame] : [];
  });
