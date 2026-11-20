import { requireBuildingGeometry } from "@shared/catalog/building-data/geometry";

import { isBuildingCourtyardPointWalkable } from "../../render-common/buildings/building-courtyard";
import { stockStyleFor } from "../../render-common/buildings/building-stock-layout";
import { WELL_CYCLE_SECONDS, type WellWorkFrame } from "../../render-common/buildings/well-work-cycle";
import { WELL_BUCKET_HANDOFF } from "../../render-common/buildings/well-work-cycle";
import { handledWaterBucketScale, WATER_STOCK_CENTER_Y } from "../../render-common/wares/water-bucket-dimensions";
import type { WorkerNation } from "../../render-common/workers/worker-nation";
import { DMath } from "../math/deterministic-math";
import { emitWareProduced } from "../script-world/script-building-events";
import { countGoods } from "./production-rules";
import { buildingNation } from "./settlement-nation";
import { groundPath, moveActor, setActorPath } from "./settlement-paths";
import { advanceWareTransfer, clearWareTransfer, startWareTransfer, stockContact } from "./settlement-stock-transfers";
import type { SettlementActor, SettlementBuilding, SettlementContext, SettlementStockContact } from "./settlement-types";
import { findWellOutputPath } from "./settlement-well-output-path";

/** The operator stands beside the windlass, away from the front road and collected buckets. */
export const wellWorkstation = (building: SettlementBuilding, _nation: WorkerNation = "roman") => {
  const { mechanism, plot: { scale } } = requireBuildingGeometry(35);
  const rotation = building.rotation * Math.PI / 2;
  const cosine = DMath.cos(rotation), sine = DMath.sin(rotation);
  const transform = (x: number, z: number) => ({
    x: building.x + x * cosine + z * sine,
    z: building.z - x * sine + z * cosine
  });
  const point = transform(-0.205, 0.64);
  const crank = { ...transform(-0.06 * scale, mechanism[2] * scale + .56 * scale),
    y: building.y + mechanism[1] * scale };
  const frame: WellWorkFrame = { crank, elapsed: 0, rotation, scale };
  return { point, frame, yaw: DMath.atan2(crank.x - point.x, crank.z - point.z) };
};

const startWellWork = (context: SettlementContext, actor: SettlementActor, building: SettlementBuilding) => {
  const station = wellWorkstation(building, buildingNation(context, building));
  if (DMath.hypot(actor.x - station.point.x, actor.z - station.point.z) > .025) {
    approachWellWorkstation(context, actor, building);
    return;
  }
  actor.phase = "wellWork";
  actor.action = "work";
  actor.timer = WELL_CYCLE_SECONDS;
  actor.visible = true;
  actor.yaw = station.yaw;
  actor.wellWork = station.frame;
  building.workTime = 0;
  building.wellBucketTaken = false;
  building.working = true;
  building.status = "Drawing water";
};

export const approachWellWorkstation = (
  context: SettlementContext, actor: SettlementActor, building: SettlementBuilding, resting = false
) => {
  actor.wellWork = undefined;
  building.working = false;
  actor.stockBuilding = building.uid;
  const station = wellWorkstation(building, buildingNation(context, building));
  const path = groundPath(context, actor, station.point, building.uid);
  if (path) setActorPath(actor, path, resting ? "wellRestWalk" : "wellWorkWalk");
  else {
    actor.phase = resting ? "wellRestBlocked" : "wellWorkBlocked";
    actor.action = "idle";
    actor.timer = 1;
    building.status = "Waiting for clear windlass access";
  }
};

/** Pickup occurs at the exposed front-left rim, while the full bucket remains on its chain. */
export const wellBucketPickupContact = (building: SettlementBuilding, _nation: WorkerNation = "roman"): SettlementStockContact => {
  const { mechanism, plot: { scale } } = requireBuildingGeometry(35);
  const rotation = building.rotation * Math.PI / 2;
  const cosine = DMath.cos(rotation), sine = DMath.sin(rotation);
  const transform = (x: number, z: number) => ({
    x: building.x + x * cosine + z * sine,
    z: building.z - x * sine + z * cosine
  });
  return {
    approach: { ...transform(-.25, .55), y: building.y },
    stock: { ...transform((mechanism[0] - .06) * scale, mechanism[2] * scale),
      y: building.y + (mechanism[1] - .24) * scale },
    slot: -1, ware: "water", yaw: rotation,
    scale3: { x: scale, y: scale, z: scale }
  };
};

const approachFullBucket = (
  context: SettlementContext, actor: SettlementActor, building: SettlementBuilding
) => {
  actor.wellWork = undefined;
  building.working = false;
  building.workTime = WELL_CYCLE_SECONDS;
  actor.stockBuilding = building.uid;
  actor.stockContact = wellBucketPickupContact(building, buildingNation(context, building));
  const path = groundPath(context, actor, actor.stockContact.approach, building.uid);
  if (path) setActorPath(actor, path, "wellBucketWalk");
  else {
    actor.phase = "wellBucketBlocked"; actor.action = "idle"; actor.timer = 1;
  }
  building.status = "Collecting raised bucket";
};

/** Convert the stock contact from the usual water ware to the original handled drawing bucket. */
export const wellWaterOutputContact = (
  context: SettlementContext, building: SettlementBuilding, slot: number
): SettlementStockContact => {
  const contact = stockContact(context, building, "output", "water", slot);
  if (!contact.scale3) return contact;
  const { y } = contact.scale3;
  const scale3 = handledWaterBucketScale(contact.scale3);
  const rotation = building.rotation * Math.PI / 2;
  const cosine = DMath.cos(rotation), sine = DMath.sin(rotation);
  const dx = contact.stock.x - building.x, dz = contact.stock.z - building.z;
  const localX = dx * cosine - dz * sine, localZ = dx * sine + dz * cosine;
  const side = slot % 2 ? 1 : -1;
  let approach = contact.approach;
  for (let distance = .36; distance <= .65; distance += .025) {
    const candidateX = localX + side * distance, candidateZ = localZ + .4;
    const point = { x: building.x + candidateX * cosine + candidateZ * sine,
      y: building.y, z: building.z - candidateX * sine + candidateZ * cosine };
    if (!isBuildingCourtyardPointWalkable(35, building.x, building.z, building.rotation, point,
      building.output, building.input, stockStyleFor(buildingNation(context, building), building))) continue;
    approach = point;
    break;
  }
  return { ...contact, approach, scale3, stock: { ...contact.stock,
    y: contact.stock.y + WATER_STOCK_CENTER_Y * y - .041 * scale3.y } };
};

const walkWellOutput = (
  context: SettlementContext, actor: SettlementActor, building: SettlementBuilding
) => {
  actor.stockContact = wellWaterOutputContact(context, building, countGoods(building.output));
  const path = findWellOutputPath(context, building, actor, actor.stockContact.approach);
  if (path) setActorPath(actor, path, "wellOutputWalk");
  else { actor.phase = "wellOutputBlocked"; actor.action = "idle"; actor.timer = 1; }
  building.status = "Carrying full bucket to collection bay";
};

/** Outdoor water drawing owns a full pickup/carry/deposit handoff, rather than spawning shoulder cargo. */
const getWellCycleStatus = (workTime: number) => {
  if (workTime < 2) return "Lowering bucket";
  return workTime < 12 ? "Filling bucket" : "Raising bucket";
};

export const updateWellWorker = (
  context: SettlementContext, actor: SettlementActor, building: SettlementBuilding, dt: number
) => {
  if (building.typeId !== 35 || actor.job !== "Well worker") return false;
  if (actor.phase === "wellWorkWalk" || actor.phase === "wellRestWalk") {
    if (!moveActor(context, actor, dt)) return true;
    if (actor.phase === "wellWorkWalk") startWellWork(context, actor, building);
    else {
      actor.phase = "rest"; actor.timer = 2; actor.action = "idle";
      actor.yaw = wellWorkstation(building, buildingNation(context, building)).yaw;
      building.status = "Resting beside windlass";
    }
    return true;
  }
  if (actor.phase === "wellWorkBlocked" || actor.phase === "wellRestBlocked") {
    actor.timer -= dt;
    if (actor.timer <= 0)
      approachWellWorkstation(context, actor, building, actor.phase === "wellRestBlocked");
    return true;
  }
  if (actor.phase === "wellWork") {
    actor.timer -= dt;
    building.workTime = Math.min(WELL_CYCLE_SECONDS, WELL_CYCLE_SECONDS - actor.timer);
    actor.wellWork!.elapsed = building.workTime;
    building.status = getWellCycleStatus(building.workTime);
    if (actor.timer <= 0) approachFullBucket(context, actor, building);
    return true;
  }
  if (actor.phase === "wellBucketBlocked" || actor.phase === "wellOutputBlocked") {
    actor.timer -= dt;
    if (actor.timer <= 0) {
      if (actor.phase === "wellBucketBlocked") approachFullBucket(context, actor, building);
      else walkWellOutput(context, actor, building);
    }
    return true;
  }
  if (actor.phase === "wellBucketWalk") {
    if (!moveActor(context, actor, dt)) return true;
    actor.wellWork = undefined;
    actor.ware = "water";
    startWareTransfer(actor, "pickup", "water", actor.stockContact!);
    actor.phase = "wellBucketPickup";
    return true;
  }
  if (actor.phase === "wellBucketPickup") {
    const finished = advanceWareTransfer(actor, dt);
    building.wellBucketTaken = actor.wareTransfer!.progress >= WELL_BUCKET_HANDOFF;
    if (!finished) return true;
    clearWareTransfer(actor);
    building.cycle++;
    context.options.onProductionCycle?.(building, {}, "water");
    if (context.script) emitWareProduced(context, building, "water");
    walkWellOutput(context, actor, building);
    return true;
  }
  if (actor.phase === "wellOutputWalk") {
    if (!moveActor(context, actor, dt)) return true;
    startWareTransfer(actor, "putdown", "water", actor.stockContact!);
    actor.phase = "outputPutdown";
    building.status = "Setting down full bucket";
    return true;
  }
  return false;
};

/** Layout migration changes only the operator's physical contact, never timers, cargo or production. */
export const restoreWellWorkStyles = (context: SettlementContext) => {
  for (const actor of context.actors) {
    if (actor.job !== "Well worker") continue;
    if (actor.phase !== "wellWork" && actor.wellWork?.style !== "hand-rope" &&
      !["wellWorkWalk", "wellRestWalk", "wellWorkBlocked", "wellRestBlocked"].includes(actor.phase)) continue;
    const building = context.buildings.find(entry => entry.uid === actor.building && entry.typeId === 35);
    if (!building) continue;
    if (["wellWorkWalk", "wellRestWalk", "wellWorkBlocked", "wellRestBlocked"].includes(actor.phase)) {
      approachWellWorkstation(context, actor, building, actor.phase.startsWith("wellRest"));
      continue;
    }
    if (actor.phase !== "wellWork") {
      actor.wellWork = undefined;
      if (["wellBucketWalk", "wellBucketBlocked"].includes(actor.phase)) approachFullBucket(context, actor, building);
      continue;
    }
    const station = wellWorkstation(building, buildingNation(context, building));
    if (actor.wellWork && actor.wellWork.style === station.frame.style) continue;
    actor.x = station.point.x; actor.z = station.point.z; actor.yaw = station.yaw;
    actor.wellWork = { ...station.frame, elapsed: building.workTime ?? WELL_CYCLE_SECONDS - actor.timer };
  }
};
