import { DMath } from "../math/deterministic-math";
import { countIslandAction } from "../script-world/script-action-counters";
import { FORESTER_PLANT_SECONDS } from "./outdoor-work-timing";
import { groundPath, moveActor, setActorPath } from "./settlement-paths";
import { canPlantAt, consumeWorkTarget, targetKey } from "./settlement-resources";
import { stockContact } from "./settlement-stock-transfers";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";
import { stockErrandPath } from "./settlement-worker-stock-paths";


type CheckedSite = { target: SettlementActor["target"]; navigation: number; roads: number; build: number; terrain: number };
const checkedSites = new WeakMap<SettlementActor, CheckedSite>();
/** Recheck topology edits once per target/revision, rather than scanning plots every walking frame. */
const plantingSiteValid = (context: SettlementContext, actor: SettlementActor) => {
  const target = actor.target;
  if (!target) return false;
  const navigation = context.navigationRevision ?? 0, roads = context.options.roads.revision ?? 0;
  const build = context.options.world.buildRevision ?? 0, terrain = context.options.world.terrainRevision ?? 0;
  const checked = checkedSites.get(actor);
  if (checked?.target === target && checked.navigation === navigation && checked.roads === roads &&
    checked.build === build && checked.terrain === terrain && actor.phase !== "foresterPlantBlocked") return true;
  checkedSites.set(actor, { target, navigation, roads, build, terrain });
  return canPlantAt(context, target.x, target.z);
};

export const startForesterPickup = (
  context: SettlementContext, actor: SettlementActor, building: SettlementBuilding
) => {
  actor.target = actor.preparedTarget;
  actor.preparedTarget = undefined;
  actor.productionPath = undefined;
  const contact = stockContact(context, building, "output", "seedling", 5);
  actor.stockContact = contact;
  actor.stockBuilding = building.uid;
  const path = stockErrandPath(context, actor, building, contact.approach);
  if (!path) {
    actor.phase = "foresterPickupBlocked"; actor.timer = 1; actor.action = "idle";
    return;
  }
  setActorPath(actor, path, "foresterPickupWalk");
  building.door = 1;
};
const travelToPlant = (context: SettlementContext, actor: SettlementActor, building: SettlementBuilding) => {
  const target = actor.target!;
  // Plant sites are cell centres. Keep the half-metre standing offset on the outdoor route
  // lattice: a direction-normalized offset can be clear but unreachable by its half-cell search.
  const approaches = [[.5, 0], [-.5, 0], [0, .5], [0, -.5]].map(([x, z]) =>
    ({ x: target.x + x!, z: target.z + z! }));
  approaches.sort((a, b) => DMath.hypot(actor.x - a.x, actor.z - a.z) -
    DMath.hypot(actor.x - b.x, actor.z - b.z));
  if (target.approach) approaches.unshift(target.approach);
  for (const approach of approaches) {
    const path = groundPath(context, actor, approach, building.uid);
    if (!path) continue;
    setActorPath(actor, path, "foresterPlantWalk");
    return;
  }
  actor.phase = "foresterPlantBlocked"; actor.timer = 1; actor.action = "idle";
};
const returnSeedling = (context: SettlementContext, actor: SettlementActor, building: SettlementBuilding) => {
  const contact = stockContact(context, building, "output", "seedling", 5);
  actor.stockContact = contact;
  actor.stockBuilding = building.uid;
  const path = groundPath(context, actor, contact.approach, building.uid);
  if (path) setActorPath(actor, path, "foresterReturnWalk");
  else { actor.phase = "foresterReturnBlocked"; actor.timer = 1; actor.action = "idle"; }
};
const complete = (context: SettlementContext, actor: SettlementActor, building: SettlementBuilding) => {
  if (actor.target) context.reservations.delete(targetKey(actor.target));
  building.nurserySeedlingTaken = false;
  building.working = false;
  actor.foresterSeedling = undefined;
  actor.stockContact = undefined;
  actor.target = undefined;
  const path = groundPath(context, actor, building.access, building.uid);
  if (path) setActorPath(actor, path, "outputWalk");
  else { actor.phase = "returnBlocked"; actor.timer = 1; actor.action = "idle"; }
};

/** Nursery stock represents the actual sapling: one leaves, and is replaced only after planting. */
export const updateForester = (
  context: SettlementContext, actor: SettlementActor, building: SettlementBuilding, dt: number
) => {
  if (!actor.phase.startsWith("forester")) return false;
  if (actor.phase.startsWith("foresterPlant") && !plantingSiteValid(context, actor)) {
    if (actor.target) context.reservations.delete(targetKey(actor.target));
    actor.navigationRecovery = undefined;
    if (actor.foresterSeedling) actor.foresterSeedling.planting = undefined;
    building.working = false;
    building.status = "Planting site occupied; returning seedling";
    returnSeedling(context, actor, building);
    return true;
  }
  if (actor.phase.endsWith("Blocked")) {
    actor.timer -= dt;
    if (actor.timer > 0) return true;
    if (actor.phase === "foresterPickupBlocked") {
      actor.preparedTarget = actor.target; startForesterPickup(context, actor, building);
    } else if (actor.phase === "foresterPlantBlocked") travelToPlant(context, actor, building);
    else returnSeedling(context, actor, building);
    return true;
  }
  if (actor.phase.endsWith("Walk")) {
    if (!moveActor(context, actor, dt)) return true;
    if (actor.phase === "foresterPickupWalk") {
      actor.phase = "foresterPickup"; actor.timer = 1; actor.action = "idle";
      const contact = actor.stockContact!;
      actor.foresterSeedling = { target: { ...contact.stock }, scale: contact.scale3?.x ?? contact.scale ?? 1, progress: 0 };
      actor.yaw = DMath.atan2(contact.stock.x - actor.x, contact.stock.z - actor.z);
    } else if (actor.phase === "foresterReturnWalk") {
      actor.phase = "foresterReturn"; actor.timer = 1; actor.action = "idle";
      actor.foresterSeedling!.target = { ...actor.stockContact!.stock };
      actor.foresterSeedling!.progress = 1;
    } else {
      actor.phase = "foresterPlant"; actor.timer = FORESTER_PLANT_SECONDS; actor.action = "plant"; actor.animationTime = 0;
      actor.yaw = DMath.atan2(actor.target!.x - actor.x, actor.target!.z - actor.z);
      actor.foresterSeedling!.target = { x: actor.target!.x, y: actor.target!.y ?? actor.y, z: actor.target!.z };
      actor.foresterSeedling!.progress = undefined;
      building.working = true;
      context.options.onWorkerPhase?.(actor);
    }
    return true;
  }
  actor.timer -= dt;
  if (actor.phase === "foresterPickup") {
    const progress = Math.min(1, 1 - actor.timer);
    actor.foresterSeedling!.progress = progress;
    building.nurserySeedlingTaken = progress >= .5;
    if (actor.timer <= 0) { actor.foresterSeedling!.progress = undefined; travelToPlant(context, actor, building); }
  } else if (actor.phase === "foresterReturn") {
    actor.foresterSeedling!.progress = Math.max(0, actor.timer);
    if (actor.timer <= 0) complete(context, actor, building);
  } else {
    actor.foresterSeedling!.planting = Math.max(0, Math.min(1, (1 - actor.timer / FORESTER_PLANT_SECONDS - .75) / .25));
    if (actor.timer <= 0) {
      if (consumeWorkTarget(context, actor.target!, building, actor)) {
        countIslandAction(context, "plant");
        context.options.onProductionCycle?.(building, {}, undefined);
        complete(context, actor, building);
      }
      else { actor.foresterSeedling!.planting = undefined; returnSeedling(context, actor, building); }
    }
  }
  return true;
};

/** Event-plan entry point: finish a scheduled planting timer. */
export const completeForesterPlant = (
  context: SettlementContext, actor: SettlementActor, building: SettlementBuilding
) => {
  if (consumeWorkTarget(context, actor.target!, building, actor)) {
    countIslandAction(context, "plant");
    context.options.onProductionCycle?.(building, {}, undefined);
    complete(context, actor, building);
    return true;
  }
  actor.foresterSeedling!.planting = undefined;
  returnSeedling(context, actor, building);
  return false;
};
