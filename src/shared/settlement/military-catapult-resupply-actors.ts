import { getAuthoredBuildingPlot } from "../../render-common/buildings/building-plot-profile";
import { catapultStairManeuver } from "../../render-common/buildings/catapult-hatch";
import {
  catapultDropStoneShape, catapultRestingStoneLift
} from "../../render-common/buildings/catapult-stone-presentation";
import { DMath } from "../math/deterministic-math";
import { DEFAULT_CATAPULT_AMMO } from "./catapult-ammo-kinds";
import { catapultNextRackSlot } from "./military-catapult-ammo";
import {
  advanceCatapultResupply, CATAPULT_SUPPLY_SECONDS, catapultCarriedKind, catapultGroundStone, type CatapultPorter,
  catapultPorterStairPose, type CatapultPorterWalk, chooseCatapultPorter, detachCatapultPorter,
  isCatapultPorter, isCatapultPorterOutside
} from "./military-catapult-resupply";
import { canEnterDoor, canLeaveDoor } from "./settlement-entrance";
import { moveActor, setActorPath } from "./settlement-paths";
import { clearWareTransfer, startWareTransfer, stockContact } from "./settlement-stock-transfers";
import type {
  SettlementActor, SettlementBuilding, SettlementContext, SettlementPoint, SettlementStockContact
} from "./settlement-types";
import { stockErrandPath, stockToDoorPath } from "./settlement-worker-stock-paths";

type LocalPoint = readonly [number, number, number];
export interface CatapultSupplyLayout {
  /** Hatch first, then the unobstructed roof aisle, ending at the rack's handling stand. */
  roofRoute: readonly LocalPoint[];
  rackStone: (slot: number) => LocalPoint;
}
interface ResupplyActorOptions {
  layout: CatapultSupplyLayout;
  collapseWorker?: (site: SettlementBuilding) => void;
  isStanding: (building: number) => boolean;
  /** Transfers a held stone exactly once, at the real actor's location, before removal/reassignment. */
  releaseCargo: (site: SettlementBuilding, porter: CatapultPorter, actor: SettlementActor | undefined) => void;
  roofSafe: (site: SettlementBuilding) => boolean;
  threatened: (site: SettlementBuilding) => boolean;
}
const worldPoint = (site: SettlementBuilding, local: LocalPoint) => {
  const yaw = site.rotation * Math.PI / 2, sine = DMath.sin(yaw), cosine = DMath.cos(yaw);
  const scale = getAuthoredBuildingPlot(16)!.structureScale;
  return { x: site.x + (local[0] * cosine + local[2] * sine) * scale, y: site.y + local[1] * scale,
    z: site.z + (local[2] * cosine - local[0] * sine) * scale };
};
const stairBottom = (site: SettlementBuilding, layout: CatapultSupplyLayout, descending = false) => {
  const hatch = worldPoint(site, layout.roofRoute[0]!);
  const maneuver = catapultStairManeuver(hatch.y - site.y, descending), yaw = site.rotation * Math.PI / 2;
  return { x: hatch.x + maneuver.x * DMath.cos(yaw) + maneuver.z * DMath.sin(yaw), y: site.y,
    z: hatch.z + maneuver.z * DMath.cos(yaw) - maneuver.x * DMath.sin(yaw) };
};
const inboundPath = (context: SettlementContext, actor: SettlementActor, site: SettlementBuilding, layout: CatapultSupplyLayout) => {
  const path = stockToDoorPath(context, actor, site);
  return path && [...path, stairBottom(site, layout)];
};
const outboundPath = (context: SettlementContext, actor: SettlementActor, site: SettlementBuilding, stock: SettlementPoint) => {
  const path = stockErrandPath(context, actor, site, stock);
  return path && (actor.visible ? path : [{ ...site.doorThreshold }, ...path]);
};
const roofContact = (
  site: SettlementBuilding, layout: CatapultSupplyLayout, ware: string
): SettlementStockContact => ({
  approach: worldPoint(site, layout.roofRoute[layout.roofRoute.length - 1]!),
  slot: catapultNextRackSlot(site) ?? 0, stock: worldPoint(site, layout.rackStone(catapultNextRackSlot(site) ?? 0)), ware
});
/** The pile's next unit: a casualty drop keeps its own kind, the entrance pile hands out its oldest unit. */
const pickupKind = (site: SettlementBuilding, dropIndex?: number) => {
  const supply = site.catapultSupply;
  if (dropIndex !== undefined) return supply?.drops?.[dropIndex]?.kind ?? DEFAULT_CATAPULT_AMMO;
  return supply?.groundKinds?.[0] ?? DEFAULT_CATAPULT_AMMO;
};
const groundContact = (context: SettlementContext, site: SettlementBuilding, dropIndex?: number) => {
  const contact = stockContact(context, site, "input", "stone", Math.max(0, site.catapultSupply!.ground - 1));
  const drop = site.catapultSupply?.drops?.[dropIndex ?? -1];
  if (!drop) return contact;
  const scale = getAuthoredBuildingPlot(16)!.structureScale;
  const lift = catapultRestingStoneLift(catapultDropStoneShape(drop.y, site.y, scale), scale);
  return { ...contact, approach: { ...drop }, stock: { ...drop, y: drop.y + lift } };
};
const applyStairPose = (
  site: SettlementBuilding, actor: SettlementActor, porter: CatapultPorter, layout: CatapultSupplyLayout
) => {
  Object.assign(actor, worldPoint(site, layout.roofRoute[0]!));
  const pose = catapultPorterStairPose(porter);
  actor.y = site.y + pose.height; actor.visible = pose.visible; actor.action = "idle";
  const roof = site.y + layout.roofRoute[0]![1] * getAuthoredBuildingPlot(16)!.structureScale;
  const maneuver = catapultStairManeuver(roof - actor.y, porter.phase === "stairs-down");
  const yaw = site.rotation * Math.PI / 2;
  actor.x += maneuver.x * DMath.cos(yaw) + maneuver.z * DMath.sin(yaw);
  actor.z += maneuver.z * DMath.cos(yaw) - maneuver.x * DMath.sin(yaw);
  actor.yaw = yaw + maneuver.heading;
};

/** Roof movement uses the authored fixed-floor aisle; ground navigation must never project it to terrain. */
const walkRoof = (actor: SettlementActor, dt: number) => {
  let distance = .65 * dt;
  while (actor.pathIndex < actor.path.length) {
    const target = actor.path[actor.pathIndex]!, dx = target.x - actor.x, dz = target.z - actor.z;
    const length = DMath.hypot(dx, dz), step = Math.min(length, distance);
    if (length > 1e-9) {
      actor.x += dx / length * step; actor.z += dz / length * step; actor.yaw = DMath.atan2(dx, dz);
    }
    actor.action = actor.ware ? "carry" : "walk"; actor.locomotionSpeed = .65;
    if (length > distance + 1e-9) return false;
    actor.pathIndex++; distance -= step;
    if (distance <= 1e-9) break;
  }
  return actor.pathIndex >= actor.path.length;
};

const preparePorterPhase = (
  context: SettlementContext, site: SettlementBuilding, actor: SettlementActor,
  porter: CatapultPorter, layout: CatapultSupplyLayout
) => {
  clearWareTransfer(actor); actor.ware = catapultCarriedKind(porter) ?? null;
  actor.catapultStoneCargo = porter.carrying ? true : undefined;
  actor.wareUnits = undefined; actor.tool = undefined; actor.lean = undefined;
  actor.stockBuilding = site.uid; actor.building = site.uid; actor.timer = 0;
  const outside = isCatapultPorterOutside(porter.phase);
  let phase = "catapultResupply";
  if (porter.phase === "outbound") phase = "inputApproach";
  if (porter.phase === "pickup") phase = "inputPickup";
  if (porter.phase === "inbound") phase = "inputReturn";
  if (porter.phase === "outbound") {
    const contact = groundContact(context, site, porter.drop);
    const path = outboundPath(context, actor, site, contact.approach);
    actor.stockContact = contact;
    setActorPath(actor, path ?? [], phase); actor.visible = true; return;
  }
  actor.phase = phase; actor.visible = outside;
  if (porter.phase === "pickup") {
    const contact = groundContact(context, site, porter.drop);
    actor.stockContact = contact; startWareTransfer(actor, "pickup", pickupKind(site, porter.drop), contact); return;
  }
  if (porter.phase === "inbound") {
    setActorPath(actor, inboundPath(context, actor, site, layout) ?? [], phase); return;
  }
  actor.path = []; actor.pathIndex = 0; actor.action = "idle";
  if (porter.phase === "stairs-up" || porter.phase === "stairs-down") {
    applyStairPose(site, actor, porter, layout); return;
  }
  if (porter.phase === "roof") {
    Object.assign(actor, worldPoint(site, layout.roofRoute[0]!)); actor.visible = true;
    setActorPath(actor, layout.roofRoute.slice(1).map(point => worldPoint(site, point)), phase); return;
  }
  if (porter.phase === "roof-return") {
    actor.visible = true;
    setActorPath(actor, layout.roofRoute.slice(0, -1).reverse().map(point => worldPoint(site, point)), phase);
    return;
  }
  if (porter.phase === "place") {
    const ware = catapultCarriedKind(porter) ?? DEFAULT_CATAPULT_AMMO;
    actor.visible = true; startWareTransfer(actor, "putdown", ware, roofContact(site, layout, ware));
  }
};

const restorePorter = (
  site: SettlementBuilding, porter: CatapultPorter, actor: SettlementActor | undefined,
  options: ResupplyActorOptions, completed: boolean
) => {
  if (porter.carrying) options.releaseCargo(site, porter, actor);
  if (!actor) return;
  clearWareTransfer(actor); actor.stockBuilding = undefined;
  actor.ware = null; actor.wareUnits = undefined; actor.catapultStoneCargo = undefined; actor.wareScale = undefined; actor.locomotionSpeed = undefined;
  actor.tool = undefined;
  if (!completed || site.worker !== actor.uid || actor.demolitionReturning) return;
  // The timed, hidden descent has completed; the same actor is now inside the ground-floor hall.
  if (porter.phase === "stairs-down") {
    porter.elapsed = CATAPULT_SUPPLY_SECONDS["stairs-down"]; applyStairPose(site, actor, porter, options.layout);
  }
  actor.phase = "inside"; actor.visible = false; actor.action = "idle";
  actor.path = []; actor.pathIndex = 0;
};

/** The validated indoor corridor joins the actual threshold to the interior stair foot, never through navigation walls. */
const walkInteriorLeg = (actor: SettlementActor, dt: number) => {
  const target = actor.path[actor.pathIndex];
  if (!target) return true;
  const dx = target.x - actor.x, dz = target.z - actor.z, distance = DMath.hypot(dx, dz);
  const step = Math.min(distance, .65 * dt);
  actor.action = actor.ware ? "carry" : "walk"; actor.locomotionSpeed = .65;
  if (distance > 1e-9) {
    actor.x += dx / distance * step; actor.z += dz / distance * step;
    actor.yaw = DMath.atan2(dx, dz); actor.animationTime += dt;
  }
  if (distance > step + 1e-9) return false;
  actor.pathIndex++; return actor.pathIndex >= actor.path.length;
};

/** Real actors, canonical stock contacts and saved routes adapt the pure ammunition ownership machine. */
export const createCatapultResupplyActors = (
  context: SettlementContext, options: ResupplyActorOptions
) => {
  const actorById = (id: number) => context.actors.find(actor => actor.uid === id);
  const owns = (id: number) => context.buildings.some(site => isCatapultPorter(site, id));
  const release = (site: SettlementBuilding, actor?: SettlementActor) => {
    const porter = detachCatapultPorter(site);
    if (porter) restorePorter(site, porter, actor ?? actorById(porter.actor), options, false);
  };
  const advanceSite = (site: SettlementBuilding, dt: number) => {
    if (!site.catapultSupply?.porter && catapultGroundStone(site) < 1) return;
    const actor = () => actorById(site.catapultSupply!.porter!.actor);
    advanceCatapultResupply(site, dt, options.threatened(site), {
      choosePorter: () => {
        const id = chooseCatapultPorter(site, actorById), body = id === undefined ? undefined : actorById(id);
        if (!body) return undefined;
        if (!canLeaveDoor(context, body)) { site.catapultSupply!.paused = "blocked"; return undefined; }
        const contact = groundContact(context, site, site.catapultSupply?.drops?.length ? 0 : undefined);
        if (!stockErrandPath(context, body, site, contact.approach)) {
          site.catapultSupply!.paused = "blocked"; return undefined;
        }
        return id;
      },
      enterPhase: porter => {
        const body = actorById(porter.actor);
        if (body) preparePorterPhase(context, site, body, porter, options.layout);
      },
      finish: porter => {
        const body = actorById(porter.actor);
        const completed = body?.building === site.uid && site.worker === body.uid &&
          (porter.phase === "stairs-down" || (porter.phase === "inbound" && !porter.carrying));
        restorePorter(site, porter, body, options, completed);
      },
      isAvailable: id => {
        const body = actorById(id);
        return !!body && site.worker === id && body.building === site.uid && body.job === "Carrier" &&
          !body.demolitionReturning && ["inputApproach", "inputPickup", "inputReturn", "catapultResupply"].includes(body.phase);
      },
      roofSafe: () => options.roofSafe(site),
      walk: (phase: CatapultPorterWalk, seconds: number) => {
        const body = actor(); if (!body) return false;
        if (phase === "roof" || phase === "roof-return") return walkRoof(body, seconds);
        if (!body.path.length) {
          const contact = groundContact(context, site, site.catapultSupply!.porter!.drop);
          let path: SettlementPoint[] | null = inboundPath(context, body, site, options.layout);
          if (phase === "outbound") path = outboundPath(context, body, site, contact.approach);
          if (!path) { site.catapultSupply!.paused = "blocked"; return false; }
          if (site.catapultSupply!.paused === "blocked") delete site.catapultSupply!.paused;
          setActorPath(body, path, phase === "outbound" ? "inputApproach" : "inputReturn");
        }
        const indoor = phase === "inbound" && body.pathIndex === body.path.length - 1;
        const leavingHall = phase === "outbound" && body.pathIndex === 0 &&
          Math.abs(body.path[0]!.x - site.doorThreshold.x) < 1e-8 && Math.abs(body.path[0]!.z - site.doorThreshold.z) < 1e-8;
        if (indoor || leavingHall) return walkInteriorLeg(body, seconds);
        if (phase === "inbound" && !canEnterDoor(context, body, site)) return false;
        return moveActor(context, body, seconds);
      }
    });
    const porter = site.catapultSupply?.porter;
    if (porter && (porter.phase === "stairs-up" || porter.phase === "stairs-down")) {
      const body = actorById(porter.actor);
      if (body) applyStairPose(site, body, porter, options.layout);
      return;
    }
    if (!porter || (porter.phase !== "pickup" && porter.phase !== "place")) return;
    const body = actorById(porter.actor);
    if (body?.wareTransfer) body.wareTransfer.progress = porter.elapsed / CATAPULT_SUPPLY_SECONDS[porter.phase];
  };
  return { owns, release, updateActor: (actor: SettlementActor) => owns(actor.uid), update: (dt: number) => {
    for (const site of context.buildings) {
      if (site.typeId !== 16) continue;
      if (site.construction !== 1) { release(site); continue; }
      if (!options.isStanding(site.uid)) {
        if (options.collapseWorker) options.collapseWorker(site);
        else release(site);
        continue;
      }
      if (site.catapultSupply) advanceSite(site, dt);
    }
  } };
};
