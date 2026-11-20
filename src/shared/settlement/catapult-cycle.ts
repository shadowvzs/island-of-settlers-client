import { CATAPULT_CARRY_FORWARD, CATAPULT_CARRY_HEIGHT, CATAPULT_DECK_HEIGHT } from "../../render-common/buildings/catapult-dimensions";
import { CATAPULT_HATCH_WELL } from "../../render-common/buildings/catapult-hatch";
import { CATAPULT_STONE_DIAMETER } from "../../render-common/buildings/catapult-mechanism";
import {
  CATAPULT_CRANK, CATAPULT_ENGINE_ORIGIN, CATAPULT_TRAVERSE, catapultMechanismPoint, catapultReleasePoint,
  catapultStationPoint
} from "../../render-common/buildings/catapult-mechanism";
import { WORKER_SCALE } from "../../render-common/workers/worker-dimensions";
import { DMath } from "../math/deterministic-math";
import type { CatapultAmmoReservation } from "./military-catapult-ammo";

export const CATAPULT_HOME_YAW = Math.PI / 4;
export const CATAPULT_RESUPPLY_ROOF_ROUTE = [CATAPULT_HATCH_WELL.center, [-.43, CATAPULT_DECK_HEIGHT, -.55]] as const;
/** Zero-duration phases are driven by actual hand-powered angular movement, not a timer. */
export const CATAPULT_PHASE_SECONDS = Object.freeze({ pick: 1.4, load: 3.6, wind: 0, clear: 3.8,
  traverse: 0, fire: .2, return: .6, park: 0, ready: 0, rewind: .6, loose: 0, retrieve: 0, "recover-cup": .8, "empty-return": 0 });
export type CatapultPhase = keyof typeof CATAPULT_PHASE_SECONDS;
export interface CatapultCycle extends CatapultAmmoReservation {
  operator: number; target: number; phase: CatapultPhase; elapsed: number; stoneSlot?: number; turnVelocity?: number;
}
export const CATAPULT_PREPARE_SECONDS = CATAPULT_PHASE_SECONDS.pick + CATAPULT_PHASE_SECONDS.load +
  CATAPULT_PHASE_SECONDS.wind + CATAPULT_PHASE_SECONDS.clear + CATAPULT_PHASE_SECONDS.fire;
export const CATAPULT_ANCHORS = Object.freeze({
  operator: CATAPULT_TRAVERSE.body,
  pickup: [-.43, CATAPULT_DECK_HEIGHT, -.55] as const,
  loading: catapultStationPoint([-.33, 1.77, .53]),
  transit: catapultStationPoint([-.53, 1.77, .50]),
  winch: catapultStationPoint([-.70, 1.77, .10]),
  turntable: CATAPULT_ENGINE_ORIGIN,
  pivot: catapultMechanismPoint([0, 2.16, -.12]),
  crank: CATAPULT_CRANK.pivot,
  release: catapultReleasePoint()
});
export const rotateCatapultPoint = (point: readonly number[], yaw: number): [number, number, number] =>
  [point[0]! * DMath.cos(yaw) + point[2]! * DMath.sin(yaw), point[1]!,
    point[2]! * DMath.cos(yaw) - point[0]! * DMath.sin(yaw)];
export const rotateCatapultMechanismPoint = (point: readonly number[], yaw: number): [number, number, number] => {
  const relative = rotateCatapultPoint([point[0]! - CATAPULT_ENGINE_ORIGIN[0], point[1]!, point[2]! - CATAPULT_ENGINE_ORIGIN[2]], yaw);
  return [relative[0] + CATAPULT_ENGINE_ORIGIN[0], relative[1], relative[2] + CATAPULT_ENGINE_ORIGIN[2]];
};
const home = (point: readonly number[]) => rotateCatapultMechanismPoint(point, CATAPULT_HOME_YAW);
export const CATAPULT_LOADING_CUP = [CATAPULT_ANCHORS.release[0],
  CATAPULT_ANCHORS.pivot[1] + (CATAPULT_ANCHORS.release[1] - CATAPULT_ANCHORS.pivot[1]) * DMath.cos(1.25)
    - (CATAPULT_ANCHORS.release[2] - CATAPULT_ANCHORS.pivot[2]) * DMath.sin(1.25),
  CATAPULT_ANCHORS.pivot[2] + (CATAPULT_ANCHORS.release[1] - CATAPULT_ANCHORS.pivot[1]) * DMath.sin(1.25)
    + (CATAPULT_ANCHORS.release[2] - CATAPULT_ANCHORS.pivot[2]) * DMath.cos(1.25)] as const;
const stockEdge = -.6875, stone = CATAPULT_STONE_DIAMETER;
/** Two compact three-high stacks keep the enlarged ammunition beyond the360-degree cup sweep. */
export const catapultStockAnchor = (slot: number) => [stockEdge - (slot % 2) * .025,
  CATAPULT_DECK_HEIGHT + stone / 2 + Math.floor(slot / 2) * stone, stockEdge + (slot % 2) * stone] as const;
export const CATAPULT_STOCK_ROUTE = [home(CATAPULT_ANCHORS.operator), [.02, CATAPULT_DECK_HEIGHT, -.64], CATAPULT_ANCHORS.pickup] as const;
export const CATAPULT_LOAD_ROUTE = [CATAPULT_ANCHORS.pickup, [-.395, CATAPULT_DECK_HEIGHT, -.35], [-.68, CATAPULT_DECK_HEIGHT, -.31], [-.68, CATAPULT_DECK_HEIGHT, .05],
  [-.60, CATAPULT_DECK_HEIGHT, .50], home(CATAPULT_ANCHORS.winch), home(CATAPULT_ANCHORS.transit), home(CATAPULT_ANCHORS.loading)] as const;
const clearRoute = [home(CATAPULT_ANCHORS.loading), home(CATAPULT_ANCHORS.transit), home(CATAPULT_ANCHORS.winch), [-.6785, CATAPULT_DECK_HEIGHT, -.0307], [-.395, CATAPULT_DECK_HEIGHT, -.35],
  [.02, CATAPULT_DECK_HEIGHT, -.64], home(CATAPULT_ANCHORS.operator)] as const;
const pathPose = (points: readonly (readonly number[])[], progress: number) => {
  const lengths = points.slice(1).map((point, index) =>
    DMath.hypot(point[0]! - points[index]![0]!, point[2]! - points[index]![2]!));
  let remaining = Math.max(0, Math.min(1, progress)) * lengths.reduce((sum, length) => sum + length, 0);
  for (let index = 0; index < lengths.length; index++) {
    const from = points[index]!, to = points[index + 1]!, length = lengths[index]!;
    if (remaining > length && index < lengths.length - 1) { remaining -= length; continue; }
    const t = length > 0 ? Math.min(1, remaining / length) : 1;
    return { operator: from.map((value, axis) => value + (to[axis]! - value) * t) as [number, number, number],
      yaw: DMath.atan2(to[0]! - from[0]!, to[2]! - from[2]!) };
  }
  return { operator: [...points[0]!] as [number, number, number], yaw: 0 };
};
export const catapultPose = (cycle?: CatapultCycle) => {
  const phase = cycle?.phase;
  let duration: number = CATAPULT_PHASE_SECONDS[phase ?? "pick"];
  if (phase === "load" && cycle?.loadSeconds !== undefined) duration = cycle.loadSeconds;
  if ((phase === "retrieve" || phase === "empty-return") && cycle?.recoverySeconds !== undefined) duration = cycle.recoverySeconds;
  const t = duration > 0 ? Math.min(1, (cycle?.elapsed ?? 0) / duration) : 0;
  let path = { operator: [...CATAPULT_ANCHORS.operator] as [number, number, number], yaw: CATAPULT_TRAVERSE.facing };
  let arm = 1.25, loaded = false, carrying = false, walking = false, relative = true, handWeight = 1;
  let pickup: number | undefined, putdown: number | undefined, hands: "bar" | "release" | "crank" | undefined;
  if (phase === "pick") {
    path = pathPose(CATAPULT_STOCK_ROUTE, Math.min(1, t / .6)); relative = false; walking = t < .6;
    if (!walking) { pickup = (t - .6) / .4; carrying = true; }
  }
  if (phase === "load") {
    path = pathPose(cycle?.loadPath ?? CATAPULT_LOAD_ROUTE, Math.min(1, t / .83)); relative = false; carrying = true; walking = t < .83;
    if (!walking) putdown = (t - .83) / .17;
  }
  // Legacy winding snapshots move directly onward; new cycles have no wheel/crank animation.
  if (phase === "wind") { path = pathPose([home(CATAPULT_ANCHORS.loading)], 1); relative = false; loaded = true; }
  if (phase === "clear") {
    path = pathPose(clearRoute, Math.min(1, t / .9));
    relative = false; walking = t < .9; loaded = true;
    if (!walking) { hands = "bar"; handWeight = (t - .9) / .1; }
  }
  if (phase === "traverse" || phase === "park") {
    walking = Math.abs(cycle?.turnVelocity ?? 0) > 1e-6; loaded = phase === "traverse"; hands = "bar";
  }
  if (phase === "fire") { arm = 1.25 * (1 - t); loaded = true; hands = "release"; walking = Math.abs(cycle?.turnVelocity ?? 0) > 1e-6; }
  if (phase === "return") { arm = 1.25 * t; hands = "bar"; }
  if (phase === "ready") { loaded = true; arm = cycle?.armHold ?? 1.25; }
  if (phase === "rewind") { loaded = true; arm = (cycle?.armHold ?? 1.25) + (1.25 - (cycle?.armHold ?? 1.25)) * t; hands = "bar"; }
  if (phase === "recover-cup") {
    const start = [CATAPULT_ANCHORS.operator[0] - DMath.sin(CATAPULT_TRAVERSE.facing) * .08,
      CATAPULT_ANCHORS.operator[1], CATAPULT_ANCHORS.operator[2] - DMath.cos(CATAPULT_TRAVERSE.facing) * .08];
    path = pathPose([start, CATAPULT_ANCHORS.operator], Math.min(1, t * 2)); walking = t < .5; loaded = true; arm = cycle?.armHold ?? 1.25;
    if (!walking) { hands = "bar"; handWeight = (t - .5) * 2; }
  }
  if (phase === "retrieve") {
    const walkTime = Math.max(0, duration - .6), elapsed = cycle?.elapsed ?? 0;
    path = pathPose(cycle?.recoveryPath ?? CATAPULT_STOCK_ROUTE, walkTime > 0 ? Math.min(1, elapsed / walkTime) : 1);
    relative = false; walking = elapsed < walkTime;
    if (!walking) { pickup = Math.min(1, (elapsed - walkTime) / .6); carrying = true; }
  }
  if (phase === "empty-return") { path = pathPose(cycle?.recoveryPath ?? [...CATAPULT_STOCK_ROUTE].reverse(), t); relative = false; walking = t < 1; }
  if (cycle?.ammo === "cup") loaded = true;
  const crankAngle = 0;
  let trigger = 0;
  if (phase === "fire") trigger = t;
  if (phase === "return") trigger = Math.max(0, 1 - t * 2);
  return { arm, carrying, crankAngle, hands, handWeight, loaded, operator: path.operator, phase, pickup, progress: t,
    putdown, relative, reverse: (cycle?.turnVelocity ?? 0) < 0, trigger, walking, yaw: path.yaw };
};

/** The same fixed-deck handling pose is used by render contacts and saved physical ammo drops. */
export const catapultCrewLocalPose = (cycle: CatapultCycle | undefined, aim: number, scale: number, stock = 1) => {
  const pose = catapultPose(cycle);
  const operator = pose.relative ? rotateCatapultMechanismPoint(pose.operator, aim) : pose.operator;
  const cupPoint = rotateCatapultMechanismPoint(CATAPULT_LOADING_CUP, aim);
  const pickupPoint = cycle?.phase === "retrieve" && cycle.ammoPoint ? catapultLoosePoint(cycle, scale) :
    catapultStockAnchor(cycle?.stoneSlot ?? Math.max(0, stock - 1));
  let yaw = (pose.relative ? aim : 0) + pose.yaw;
  if (pose.pickup !== undefined) yaw = DMath.atan2(pickupPoint[0] - operator[0], pickupPoint[2] - operator[2]);
  if (pose.putdown !== undefined) yaw = DMath.atan2(cupPoint[0] - operator[0], cupPoint[2] - operator[2]);
  if (pose.hands === "crank") {
    const crank = rotateCatapultMechanismPoint(CATAPULT_ANCHORS.crank, aim);
    yaw = DMath.atan2(crank[0] - operator[0], crank[2] - operator[2]);
  }
  if (pose.hands === "bar" || pose.hands === "release") {
    const desired = aim + CATAPULT_TRAVERSE.facing;
    if (pose.phase === "clear") yaw += DMath.atan2(DMath.sin(desired - yaw), DMath.cos(desired - yaw)) * pose.handWeight;
    else yaw = desired;
  }
  const forward = CATAPULT_CARRY_FORWARD * WORKER_SCALE / scale;
  // The heavy cradles the large boulder higher so its underside stays within both arm chains' reach.
  const carryPoint = [operator[0] + DMath.sin(yaw) * forward, operator[1] + CATAPULT_CARRY_HEIGHT * WORKER_SCALE / scale,
    operator[2] + DMath.cos(yaw) * forward] as const;
  return { ...pose, operator, yaw, pickupPoint, cupPoint, carryPoint };
};
export const catapultLoosePoint = (cycle: CatapultCycle, scale: number): [number, number, number] => {
  const point = cycle.ammoPoint ?? [0, CATAPULT_DECK_HEIGHT + stone / 2, 0];
  const floor = cycle.ammoFloor ?? CATAPULT_DECK_HEIGHT + stone / 2;
  const elapsed = cycle.ammoElapsed ?? 0;
  const y = Math.max(floor, point[1] - .5 * 9.8 / scale * elapsed * elapsed);
  if (cycle.ammo === "cup") {
    const settled = rotateCatapultMechanismPoint(CATAPULT_LOADING_CUP, CATAPULT_HOME_YAW);
    const progress = point[1] > floor ? Math.min(1, (point[1] - y) / (point[1] - floor)) : 1;
    return [point[0] + (settled[0] - point[0]) * progress, y, point[2] + (settled[2] - point[2]) * progress];
  }
  return [point[0], y, point[2]];
};

export const catapultPhaseDuration = (cycle: CatapultCycle) => {
  if (cycle.phase === "load" && cycle.loadSeconds !== undefined) return cycle.loadSeconds;
  if ((cycle.phase === "retrieve" || cycle.phase === "empty-return") && cycle.recoverySeconds !== undefined) return cycle.recoverySeconds;
  return CATAPULT_PHASE_SECONDS[cycle.phase];
};
