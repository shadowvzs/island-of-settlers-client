import { getAuthoredBuildingPlot } from "../../render-common/buildings/building-plot-profile";
import { catapultStairManeuver } from "../../render-common/buildings/catapult-hatch";
import { WORKER_HEIGHT } from "../../render-common/workers/worker-dimensions";
import { DMath } from "../math/deterministic-math";
import { isCatapultAmmoKind } from "./catapult-ammo-kinds";
import { CATAPULT_RESUPPLY_ROOF_ROUTE } from "./catapult-cycle";
import { CATAPULT_PORTER_VERTICAL_SPEED, isCatapultPorterOutside } from "./military-catapult-resupply";
import type { SettlementActor, SettlementBuilding, SettlementPoint } from "./settlement-types";

type WorldPoint = SettlementPoint & { y: number };
/** The removed workplace cannot own a route: its displaced employee saves the remaining physical exit. */
export interface CatapultWorkerEvacuation {
  deck: number;
  door: WorldPoint;
  elapsed: number;
  fromY: number;
  ground: number;
  hatch: WorldPoint;
  rotation: number;
  route: WorldPoint[];
  stage: "roof" | "stairs" | "door";
}
const worldPoint = (site: SettlementBuilding, local: readonly [number, number, number]): WorldPoint => {
  const yaw = site.rotation * Math.PI / 2, scale = getAuthoredBuildingPlot(16)!.structureScale;
  return { x: site.x + (local[0] * DMath.cos(yaw) + local[2] * DMath.sin(yaw)) * scale,
    y: site.y + local[1] * scale,
    z: site.z + (local[2] * DMath.cos(yaw) - local[0] * DMath.sin(yaw)) * scale };
};
/** Capture before demolition detaches the reservation, without moving the worker or transferring cargo. */
export const prepareCatapultWorkerEvacuation = (site: SettlementBuilding, actor: SettlementActor) => {
  const porter = site.catapultSupply?.porter;
  if (!porter || porter.actor !== actor.uid || isCatapultPorterOutside(porter.phase)) return;
  const hatch = worldPoint(site, CATAPULT_RESUPPLY_ROOF_ROUTE[0]!);
  const roof = ["roof", "place", "roof-return"].includes(porter.phase);
  actor.catapultEvacuation = { deck: hatch.y, door: { ...site.doorThreshold, y: site.y }, elapsed: 0,
    fromY: actor.y, ground: site.y, hatch, rotation: site.rotation,
    route: roof ? CATAPULT_RESUPPLY_ROOF_ROUTE.slice(0, -1).reverse().map(point => worldPoint(site, point)) : [],
    stage: roof ? "roof" : "stairs" };
};
const walkSavedExit = (actor: SettlementActor, route: WorldPoint[], seconds: number, visible: boolean) => {
  let distance = .65 * seconds;
  actor.visible = visible;
  actor.action = actor.ware ? "carry" : "walk";
  actor.locomotionSpeed = .65;
  while (route.length) {
    const target = route[0]!, dx = target.x - actor.x, dz = target.z - actor.z;
    const length = DMath.hypot(dx, dz), step = Math.min(length, distance);
    if (length > 1e-9) {
      actor.x += dx / length * step; actor.z += dz / length * step; actor.yaw = DMath.atan2(dx, dz);
    }
    if (length > distance + 1e-9) return false;
    route.shift(); distance -= step;
    if (distance <= 1e-9) break;
  }
  return route.length === 0;
};
/** Returns ownership to the ordinary demolition/storage-return worker only after the real door is reached. */
export const updateCatapultWorkerEvacuation = (actor: SettlementActor, dt: number) => {
  const exit = actor.catapultEvacuation;
  if (!exit) return false;
  actor.phase = "catapultEvacuate";
  if (exit.stage === "roof") {
    if (!walkSavedExit(actor, exit.route, dt, true)) return true;
    exit.stage = "stairs"; exit.fromY = actor.y; exit.elapsed = 0;
    return true;
  }
  if (exit.stage === "stairs") {
    exit.elapsed += dt;
    actor.y = Math.max(exit.ground, exit.fromY - exit.elapsed * CATAPULT_PORTER_VERTICAL_SPEED);
    const maneuver = catapultStairManeuver(exit.deck - actor.y, !isCatapultAmmoKind(actor.ware));
    const yaw = exit.rotation * Math.PI / 2;
    actor.x = exit.hatch.x + maneuver.x * DMath.cos(yaw) + maneuver.z * DMath.sin(yaw);
    actor.z = exit.hatch.z + maneuver.z * DMath.cos(yaw) - maneuver.x * DMath.sin(yaw);
    actor.yaw = yaw + maneuver.heading; actor.action = "idle";
    actor.visible = actor.y + WORKER_HEIGHT > exit.deck + 1e-9;
    if (actor.y > exit.ground) return true;
    exit.stage = "door"; exit.route = [exit.door];
    return true;
  }
  if (!walkSavedExit(actor, exit.route, dt, false)) return true;
  actor.visible = true; actor.phase = "demolitionBlocked";
  actor.action = "idle"; actor.path = []; actor.pathIndex = 0;
  actor.catapultEvacuation = undefined;
  return true;
};
const validPoint = (point: unknown): point is WorldPoint => !!point && typeof point === "object" &&
  ["x", "y", "z"].every(key => Number.isFinite((point as Record<string, unknown>)[key]));
export const catapultWorkerEvacuationError = (actor: Record<string, unknown>) => {
  if (actor.catapultEvacuation === undefined) return undefined;
  const exit = actor.catapultEvacuation as CatapultWorkerEvacuation;
  if (!exit || typeof exit !== "object" || !actor.demolitionReturning || actor.job !== "Carrier" ||
    actor.phase !== "catapultEvacuate" || !["roof", "stairs", "door"].includes(exit.stage) ||
    ![exit.deck, exit.ground, exit.fromY, exit.elapsed].every(Number.isFinite) || exit.elapsed < 0 ||
    exit.deck <= exit.ground || exit.fromY < exit.ground || exit.fromY > exit.deck + 1e-8 ||
    !Number.isInteger(exit.rotation) || exit.rotation < 0 || exit.rotation > 3 ||
    !validPoint(exit.hatch) || !validPoint(exit.door) || exit.hatch.y !== exit.deck || exit.door.y !== exit.ground ||
    !Array.isArray(exit.route) || exit.route.length > CATAPULT_RESUPPLY_ROOF_ROUTE.length ||
    !exit.route.every(validPoint)) return "Invalid catapult worker evacuation";
  return undefined;
};
