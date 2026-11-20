import { requireBuildingGeometry } from "@shared/catalog/building-data/geometry";

import { CATAPULT_DECK_HEIGHT } from "../../render-common/buildings/catapult-dimensions";
import { CATAPULT_STONE_DIAMETER } from "../../render-common/buildings/catapult-mechanism";
import { DMath } from "../math/deterministic-math";
import { sampleSmooth } from "../world/grid-geometry";
import { smoothstep01 } from "../world/noise";
import { CATAPULT_HOME_YAW, CATAPULT_LOAD_ROUTE, CATAPULT_STOCK_ROUTE,
  catapultCrewLocalPose, catapultLoosePoint, catapultPose, catapultStockAnchor } from "./catapult-cycle";
import {
  catapultRoofStone, dropReservedStone, landReservedStone, loadReservedStone, retrieveReservedStone, unreserveRackStone
} from "./military-catapult-ammo";
import { catapultRoofReserved, dropCatapultStone } from "./military-catapult-resupply";
import type { SettlementSoldier } from "./settlement-military";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";

type Point = readonly [number, number, number];
const scaleOf = () => requireBuildingGeometry(16).plot.scale;
const distance = (a: Point, b: Point) => DMath.hypot(a[0] - b[0], a[2] - b[2]);
const length = (path: readonly Point[]) => path.slice(1).reduce((sum, point, index) => sum + distance(path[index]!, point), 0);
const angleHome = (site: SettlementBuilding) => Math.abs(DMath.atan2(
  DMath.sin((site.catapultAim ?? CATAPULT_HOME_YAW) - CATAPULT_HOME_YAW),
  DMath.cos((site.catapultAim ?? CATAPULT_HOME_YAW) - CATAPULT_HOME_YAW))) < .002;

const splitPath = (path: readonly Point[], point: Point) => {
  let best = Infinity, segment = 0;
  for (let index = 0; index + 1 < path.length; index++) {
    const from = path[index]!, to = path[index + 1]!, dx = to[0] - from[0], dz = to[2] - from[2];
    const t = Math.max(0, Math.min(1, ((point[0] - from[0]) * dx + (point[2] - from[2]) * dz) / (dx * dx + dz * dz || 1)));
    const error = DMath.hypot(point[0] - from[0] - dx * t, point[2] - from[2] - dz * t);
    if (error < best) { best = error; segment = index; }
  }
  return { before: [...path.slice(0, segment + 1), point], after: [point, ...path.slice(segment + 1)] };
};
const prepareRecoveryPaths = (site: SettlementBuilding, operator: Point) => {
  const cycle = site.catapultCycle!;
  if (cycle.phase === "pick") {
    cycle.recoveryPath = [...CATAPULT_STOCK_ROUTE]; cycle.loadPath = [...CATAPULT_LOAD_ROUTE];
  } else {
    const split = splitPath(cycle.loadPath ?? CATAPULT_LOAD_ROUTE, operator);
    cycle.recoveryPath = [...(cycle.recoveryPath ?? CATAPULT_STOCK_ROUTE), ...split.before.slice(1)];
    cycle.loadPath = split.after;
  }
  cycle.recoverySeconds = length(cycle.recoveryPath) * scaleOf() / 1.3 + .6;
  cycle.loadSeconds = length(cycle.loadPath) * scaleOf() / 1.15 + .6;
};
const actualHeldPoint = (site: SettlementBuilding) => {
  const cycle = site.catapultCycle!;
  const pose = catapultCrewLocalPose(cycle, site.catapultAim ?? CATAPULT_HOME_YAW, scaleOf(), catapultRoofStone(site));
  let point: Point = pose.carryPoint;
  if (pose.pickup !== undefined) {
    const lift = smoothstep01((pose.pickup - .4) / .55);
    point = pose.pickupPoint.map((value, axis) => value + (pose.carryPoint[axis]! - value) * lift) as unknown as Point;
  }
  if (pose.putdown !== undefined) {
    const lift = 1 - smoothstep01(pose.putdown / .72);
    point = pose.cupPoint.map((value, axis) => value + (pose.carryPoint[axis]! - value) * lift) as unknown as Point;
  }
  return { point, pose };
};
const roofSupport = (site: SettlementBuilding, point: Point) => {
  let floor = CATAPULT_DECK_HEIGHT + CATAPULT_STONE_DIAMETER / 2;
  // Static rack support is handled by its actual contiguous pile; don't fall through its lower stones.
  const count = Math.max(0, catapultRoofStone(site) - 1);
  for (let slot = 0; slot < count; slot++) {
    const stock = catapultStockAnchor(slot);
    const gap = distance(stock, point);
    if (gap < CATAPULT_STONE_DIAMETER) floor = Math.max(floor, stock[1] +
      Math.sqrt(CATAPULT_STONE_DIAMETER * CATAPULT_STONE_DIAMETER - gap * gap));
  }
  return Math.min(point[1], floor);
};
const floorAt = (context: SettlementContext, site: SettlementBuilding, point: Point) => {
  if (Math.abs(point[0]) <= .825 && Math.abs(point[2]) <= .825) return roofSupport(site, point);
  const yaw = site.rotation * Math.PI / 2, scale = scaleOf();
  const x = site.x + (point[0] * DMath.cos(yaw) + point[2] * DMath.sin(yaw)) * scale;
  const z = site.z + (point[2] * DMath.cos(yaw) - point[0] * DMath.sin(yaw)) * scale;
  return (sampleSmooth(context.options.world, context.options.world.heights, x, z) - site.y) / scale + CATAPULT_STONE_DIAMETER / 2;
};
const holdCup = (site: SettlementBuilding) => {
  const cycle = site.catapultCycle!;
  cycle.armHold = catapultPose(cycle).arm; cycle.phase = "ready"; cycle.elapsed = 0; cycle.turnVelocity = 0;
};
const dropHands = (context: SettlementContext, site: SettlementBuilding) => {
  const cycle = site.catapultCycle!, { point, pose } = actualHeldPoint(site);
  if (pose.pickup !== undefined && pose.pickup <= .4) {
    unreserveRackStone(site); site.catapultCycle = undefined; return;
  }
  if (pose.putdown !== undefined) {
    loadReservedStone(site); holdCup(site);
    cycle.ammoPoint = [...point]; cycle.ammoFloor = pose.cupPoint[1]; cycle.ammoElapsed = 0;
    return;
  }
  prepareRecoveryPaths(site, pose.operator);
  dropReservedStone(site, point, floorAt(context, site, point));
  cycle.phase = "loose"; cycle.elapsed = 0; cycle.turnVelocity = 0;
};
const advanceFall = (site: SettlementBuilding, dt: number) => {
  const cycle = site.catapultCycle!;
  cycle.ammoElapsed = (cycle.ammoElapsed ?? 0) + dt;
  return catapultLoosePoint(cycle, scaleOf())[1] <= (cycle.ammoFloor ?? CATAPULT_DECK_HEIGHT + CATAPULT_STONE_DIAMETER / 2) + 1e-8;
};
const landOutside = (site: SettlementBuilding) => {
  const cycle = site.catapultCycle!, point = catapultLoosePoint(cycle, scaleOf()), yaw = site.rotation * Math.PI / 2, scale = scaleOf();
  if (Math.abs(point[0]) <= .825 && Math.abs(point[2]) <= .825) return false;
  if (!landReservedStone(site, point, (landing, kind) => {
    dropCatapultStone(site, { x: site.x + (landing[0] * DMath.cos(yaw) + landing[2] * DMath.sin(yaw)) * scale,
      y: site.y + (landing[1] - CATAPULT_STONE_DIAMETER / 2) * scale,
      z: site.z + (landing[2] * DMath.cos(yaw) - landing[0] * DMath.sin(yaw)) * scale }, kind);
    return true;
  })) return false;
  site.catapultCycle = undefined; return true;
};

/** Returns true when a physical recovery/hold owns this tick; ordinary preparation may otherwise proceed. */
export const updateCatapultRecovery = (context: SettlementContext, site: SettlementBuilding,
  heavy: SettlementSoldier | undefined, target: SettlementActor | undefined, dt: number) => {
  const cycle = site.catapultCycle;
  if (!cycle) return false;
  const operatorLost = !heavy || heavy.actor !== cycle.operator;
  if (cycle.ammo === "hand" && operatorLost) { dropHands(context, site); return true; }
  if (cycle.ammo === "loose") {
    if (cycle.phase === "retrieve" && operatorLost) {
      const { point, pose } = actualHeldPoint(site);
      if (pose.pickup !== undefined && pose.pickup > .4) {
        retrieveReservedStone(site); dropReservedStone(site, point, floorAt(context, site, point));
      }
      cycle.phase = "loose"; cycle.elapsed = 0;
    }
    if (cycle.phase === "loose") {
      if (!advanceFall(site, dt)) return true;
      if (landOutside(site)) return true;
      if (!heavy) return true;
      cycle.operator = heavy.actor; cycle.phase = "retrieve"; cycle.elapsed = 0;
      return true;
    }
    return false;
  }
  if (cycle.ammo === "cup") {
    if (cycle.phase === "ready" && cycle.ammoPoint) {
      if (!advanceFall(site, dt)) return true;
      delete cycle.ammoPoint; delete cycle.ammoFloor; delete cycle.ammoElapsed;
    }
    if (operatorLost) { holdCup(site); if (!heavy) return true; cycle.operator = heavy.actor;
      cycle.phase = "recover-cup"; cycle.elapsed = 0; return true; }
    if (cycle.phase === "ready") {
      if (Math.abs((cycle.armHold ?? 1.25) - 1.25) > 1e-8) { cycle.phase = "recover-cup"; cycle.elapsed = 0; return true; }
      if (!target || catapultRoofReserved(site)) {
        if (!angleHome(site)) { cycle.phase = "park"; cycle.elapsed = 0; return false; }
        return true;
      }
      cycle.target = target.uid; cycle.phase = "traverse"; cycle.elapsed = 0; return false;
    }
    if (!target && (cycle.phase === "traverse" || cycle.phase === "fire")) {
      holdCup(site);
      cycle.phase = Math.abs((cycle.armHold ?? 1.25) - 1.25) > 1e-8 ? "rewind" : "park";
      return true;
    }
    return false;
  }
  if (operatorLost) { site.catapultCycle = undefined; return true; }
  if (!target && cycle.phase === "pick") {
    const pose = catapultCrewLocalPose(cycle, site.catapultAim ?? CATAPULT_HOME_YAW, scaleOf());
    cycle.recoveryPath = splitPath(CATAPULT_STOCK_ROUTE, pose.operator).before.reverse();
    cycle.recoverySeconds = Math.max(.05, length(cycle.recoveryPath) * scaleOf() / 1.3);
    cycle.phase = "empty-return"; cycle.elapsed = 0; return true;
  }
  return false;
};
