import { requireBuildingGeometry } from "@shared/catalog/building-data/geometry";

import { WORKER_RADIUS } from "../../render-common/workers/worker-dimensions";
import { DMath } from "../math/deterministic-math";
import { withBuildingNavigationSearch } from "./settlement-building-navigation";
import { exitPath } from "./settlement-entrance";
import { groundPath } from "./settlement-paths";
import { isPublicTerrainSingleLeg, publicTerrainPath } from "./settlement-terrain-routing";
import { createTransientMap } from "./settlement-transient-state";
import type {
  SettlementActor,
  SettlementBuilding,
  SettlementContext,
  SettlementPoint
} from "./settlement-types";

/** Matches the reserved door-swing envelope margin in building-placement-envelope. */
const DOOR_SWING_MARGIN = 0.05;
const DOOR_LANE_STEP = 0.25;
const doorstepClearances = new Map<number, number>();

/** Lane distance where a worker body clears the outward-swinging door leaf and may turn aside. */
const doorstepClearance = (typeId: number) => {
  const cached = doorstepClearances.get(typeId);
  if (cached !== undefined) return cached;
  const { door, plot: { scale } } = requireBuildingGeometry(typeId);
  const leafWidth = door.width;
  const clearance = (leafWidth + DOOR_SWING_MARGIN) * scale + WORKER_RADIUS;
  doorstepClearances.set(typeId, clearance);
  return clearance;
};

/**
 * Turning stops along the scoped door lane, from the doorstep outwards. The outer worker approach
 * is always the final stop, so a yard without any shorter clear turn keeps the original route.
 */
const doorLaneStops = (building: SettlementBuilding): SettlementPoint[] => {
  const { doorThreshold: door, workerApproach: approach } = building;
  const length = DMath.hypot(approach.x - door.x, approach.z - door.z);
  const stops: SettlementPoint[] = [];
  const doorstep = doorstepClearance(building.typeId);
  for (let distance = doorstep; distance < length; distance += DOOR_LANE_STEP) {
    const ratio = distance / length;
    stops.push({ x: door.x + (approach.x - door.x) * ratio, z: door.z + (approach.z - door.z) * ratio });
  }
  stops.push(approach);
  return stops;
};

/**
 * Exterior yard stock is reached from the first clear doorstep turn, not from the outer approach
 * beside the road signpost. The yard search keeps masonry, props and stock bays as obstacles.
 */
export const doorToStockPath = (
  context: SettlementContext,
  building: SettlementBuilding,
  stock: SettlementPoint
) => {
  const stops = doorLaneStops(building);
  for (let index = 0; index < stops.length; index++) {
    const path = groundPath(context, stops[index]!, stock, building.uid);
    if (path) return [...stops.slice(0, index + 1), ...path];
  }
  return null;
};

/** The return joins the door lane at its innermost reachable stop, then walks straight inside. */
export const stockToDoorPath = (
  context: SettlementContext,
  actor: SettlementActor,
  building: SettlementBuilding
) => {
  const stops = doorLaneStops(building);
  for (let index = 0; index < stops.length; index++) {
    const path = groundPath(context, actor, stops[index]!, building.uid);
    if (path) return [...path, ...stops.slice(0, index).reverse(), building.doorThreshold];
  }
  return null;
};

/** Local stock errands use the doorway lane; the public road endpoint is for road travel. */
export const stockErrandPath = (
  context: SettlementContext,
  actor: SettlementActor,
  building: SettlementBuilding,
  stock: SettlementPoint
) => actor.visible
  ? groundPath(context, actor, stock, building.uid)
  : doorToStockPath(context, building, stock);

/** A visible worker still inside its plot leaves by the road lane; one inside the house by the door. */
export const outputStockPath = (
  context: SettlementContext,
  actor: SettlementActor,
  building: SettlementBuilding,
  stock: SettlementPoint,
  mustExitPlot: boolean
) => {
  if (!actor.visible) return doorToStockPath(context, building, stock);
  if (!mustExitPlot) return groundPath(context, actor, stock, building.uid);
  const path = groundPath(context, building.access, stock, building.uid);
  return path && [...exitPath(building), ...path];
};

/**
 * A worker far from its yard (a hunter after a long chase) whose fine route ran out of budget follows
 * the coarse corridor to its road access, then walks the yard leg to the stock like a leaving worker.
 */
export const farStockReturnPath = (
  context: SettlementContext,
  actor: SettlementActor,
  building: SettlementBuilding,
  stock: SettlementPoint
) => {
  if (!actor.visible || context.options.findWorkerPath || isPublicTerrainSingleLeg(actor, building.access))
    return null;
  const approach = withBuildingNavigationSearch(context, () =>
    publicTerrainPath(context, actor, building.access));
  if (!approach) return null;
  const yard = groundPath(context, building.access, stock, building.uid);
  return yard ? [...approach, ...yard] : null;
};

/**
 * An outdoor work leg (tree, rock, field, shore) starts at the worker approach outside the door.
 * The road access beside the signpost is for road travel only, so it is never a detour stop.
 * The leg never cuts through the worker's own yard: an outbound worker carries no stock errand,
 * so its movement treats the plot as solid, and planning must agree or it freezes at the edge.
 */
const failedOutdoorPaths = createTransientMap<{ revision: string; targets: Set<string> }>();

export const outdoorWorkPath = (
  context: SettlementContext,
  building: SettlementBuilding,
  target: SettlementPoint
) => {
  // A failed terrain route cannot change until roads, props, plots or field reservations change.
  // Moving people are handled by traffic while walking, not by this static route search.
  if (context.options.findWorkerPath) return groundPath(context, building.workerApproach, target);
  const { roads, world } = context.options;
  const revision = `${world.buildRevision ?? 0}:${world.terrainRevision ?? 0}:` +
    `${context.navigationRevision ?? 0}:${roads.revision ?? 0}:${context.buildings.length}`;
  let failed = failedOutdoorPaths.get(context);
  if (!failed || failed.revision !== revision) {
    failed = { revision, targets: new Set() }; failedOutdoorPaths.set(context, failed);
  }
  const key = `${building.uid}:${building.workerApproach.x},${building.workerApproach.z}:${target.x},${target.z}`;
  if (failed.targets.has(key)) return null;
  const shore = target as SettlementPoint & { shoreEntry?: SettlementPoint; waterY?: number };
  const longPublicLeg = !shore.shoreEntry && shore.waterY === undefined &&
    !isPublicTerrainSingleLeg(building.workerApproach, target);
  const path = longPublicLeg
    ? withBuildingNavigationSearch(context, () =>
      publicTerrainPath(context, building.workerApproach, target) ??
      groundPath(context, building.workerApproach, target))
    : groundPath(context, building.workerApproach, target);
  if (!path) {
    if (failed.targets.size >= 2048) failed.targets.clear();
    failed.targets.add(key);
  }
  return path;
};
