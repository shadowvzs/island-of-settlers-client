import { isBuildingCourtyardPointWalkable } from "../../render-common/buildings/building-courtyard";
import { stockStyleFor } from "../../render-common/buildings/building-stock-layout";
import { DMath } from "../math/deterministic-math";
import { sampleSmooth } from "../world/grid-geometry";
import { isCatapultPorter } from "./military-catapult-resupply";
import { STORAGE_IDS } from "./production-rules";
import { isOwnDoorLane, isOwnStockCourtyard } from "./settlement-entrance";
import { isFishingShoreStep, isFishingStanceClear } from "./settlement-fishing";
import { buildingNation } from "./settlement-nation";
import { NAVAL_DECK_PHASES } from "./settlement-naval-phases";
import { isNavigationClear, isNavigationFootprintClear } from "./settlement-navigation";
import { recordMovementOutcome } from "./settlement-navigation-recovery";
import { groundPath } from "./settlement-paths";
import type { ShipWorkpoint } from "./settlement-ship-workpoint";
import type { SettlementActor, SettlementContext, SettlementPoint } from "./settlement-types";
import { wellWorkstation } from "./settlement-well-work";

const NO_SHIP_PASSENGERS: ReadonlySet<number> = new Set();

const onPier = (actor: SettlementActor, pier: ShipWorkpoint) => {
  const shipwright = actor.job === "Shipwright" &&
    ["shipPierOut", "shipPierReturn", "shipWork"].includes(actor.phase);
  const landingSoldier = actor.job === "Soldier" && actor.phase === "adventureGangway";
  const foundingCrew = ["foundingLandingPier", "foundingCargoOut", "foundingCargoBack"].includes(actor.phase);
  if (!shipwright && !landingSoldier && !foundingCrew) return false;
  const dx = pier.point.x - pier.shore.x, dz = pier.point.z - pier.shore.z, length = dx * dx + dz * dz;
  const t = length ? ((actor.x - pier.shore.x) * dx + (actor.z - pier.shore.z) * dz) / length : 0;
  if (t < -.01 || t > 1.01) return false;
  return DMath.hypot(actor.x - pier.shore.x - dx * t, actor.z - pier.shore.z - dz * t) < .2 &&
    Math.abs(actor.y - (pier.shoreY * (1 - t) + pier.y * t)) < .08;
};

export const isLoadedWorkerPositionValid = (
  context: SettlementContext, actor: SettlementActor, piers: readonly ShipWorkpoint[] = [],
  shipPassengers: ReadonlySet<number> = NO_SHIP_PASSENGERS
) => {
  if (!actor.visible) return true;
  // Passengers on deck, and the commander's horse a troop ship carries (led aboard or on deck), stay as saved.
  if (shipPassengers.has(actor.uid) && (actor.job === "Mount" ||
    [...NAVAL_DECK_PHASES, "adventureAboard", "foundingLandingDeck"].includes(actor.phase))) return true;
  if (piers.some(pier => onPier(actor, pier))) return true;
  const building = context.buildings.find(entry => entry.uid === actor.building);
  // Its validated saved route/timer owns an elevated roof or hatch pose, never a terrain stance.
  if (actor.catapultEvacuation) return true;
  if (actor.phase === "catapultResupply" && isCatapultPorter(building, actor.uid)) return true;
  const ownCourt = (point: SettlementPoint) => Boolean(building &&
    Math.abs(point.x - building.x) <= building.width / 2 &&
    Math.abs(point.z - building.z) <= building.depth / 2 &&
    (context.options.canWorkerEnterPlot?.(building, point) ??
      isBuildingCourtyardPointWalkable(building.typeId, building.x, building.z, building.rotation,
        point, building.output, building.input, stockStyleFor(buildingNation(context, building), building))));
  const permission = (point: SettlementPoint) =>
    isOwnDoorLane(context, actor, point) || isOwnStockCourtyard(context, actor, point) || ownCourt(point);
  if (actor.job === "Leveler") {
    const plot = context.buildings.find(building => building.uid === actor.building && building.construction < 1);
    if (plot && Math.abs(actor.x - plot.x) <= plot.width / 2 &&
      Math.abs(actor.z - plot.z) <= plot.depth / 2) return true;
  }
  if (actor.job === "Well worker" && building?.typeId === 35) {
    const station = wellWorkstation(building, buildingNation(context, building)).point;
    if (DMath.hypot(actor.x - station.x, actor.z - station.z) < .025 &&
      isNavigationClear(context, actor, true)) return true;
  }
  const stance = actor.target?.approach;
  if (actor.job !== "Fisher" && actor.phase === "work" && stance &&
    DMath.hypot(actor.x - stance.x, actor.z - stance.z) < .025 && isNavigationClear(context, actor)) return true;
  if (isFishingShoreStep(context, actor, actor)) {
    const target = actor.target!;
    return isFishingStanceClear(context, actor, { x: target.x, y: target.approach!.waterY!, z: target.z });
  }
  if (isOwnDoorLane(context, actor, actor)) return true;
  if (Math.abs(actor.y - sampleSmooth(context.options.world, context.options.world.heights, actor.x, actor.z)) > .15)
    return false;
  // Authored court contacts already provide model clearance; adjacent reserved cells must not
  // invalidate a correctly positioned feeding, stock or interior worker on save/load.
  if (permission(actor) && isNavigationClear(context, actor, true)) return true;
  // Match ordinary movement's center-based clearance. Loaded queues must not be moved merely
  // because their foot disk touches an adjacent reserved plot; Fishers retain dry-shore clearance.
  if (actor.job !== "Fisher") return isNavigationClear(context, actor, permission(actor));
  return isNavigationFootprintClear(context, actor, permission);
};

/**
 * A returned carrier can be reused while still away from the storage it is about to serve. If its
 * saved route starts at that storage, it was fabricated from the wrong place and cannot be walked.
 */
const staleCarrierRoute = (context: SettlementContext, actor: SettlementActor) => {
  if (actor.job !== "Carrier" || !["exitLoaded", "pickup"].includes(actor.phase) ||
    actor.pathIndex !== 0 || actor.path.length === 0) return false;
  // A carrier legitimately waiting indoors has a route that starts at that storage's exit. A
  // pickup route may start at the carrier's home storage rather than its delivery source.
  const storages = [actor.delivery?.source, actor.home].map(uid =>
    context.buildings.find(building => building.uid === uid));
  if (storages.some(storage => storage && STORAGE_IDS.has(storage.typeId) &&
    Math.abs(actor.x - storage.x) <= storage.width / 2 + 1 &&
    Math.abs(actor.z - storage.z) <= storage.depth / 2 + 1)) return false;
  const first = actor.path[0]!;
  return DMath.hypot(actor.x - first.x, actor.z - first.z) > 1;
};

/**
 * Repair only at load time. Cargo, occupation, task reservations and actor identity are conserved. A save that
 * retains the navigation revision epoch (D3) keeps a unit frozen by a failed route proof where it stands, as the
 * running island keeps it (EAI4-FOLLOWUP: moving it at load made the reload drift).
 */
export const reconcileLoadedWorkerPositions = (
  context: SettlementContext, piers: readonly ShipWorkpoint[] = [],
  shipPassengers: ReadonlySet<number> = NO_SHIP_PASSENGERS, retainedRevisionEpoch = false
) => {
  const { world } = context.options;
  for (const actor of context.actors) {
    if (retainedRevisionEpoch && actor.navigationRecovery?.blocked) continue;
    const staleRoute = staleCarrierRoute(context, actor);
    if (!staleRoute && isLoadedWorkerPositionValid(context, actor, piers, shipPassengers)) continue;
    const goal = actor.path.at(-1);
    const building = context.buildings.find(entry => entry.uid === actor.building);
    const anchors = building ? [building.access] : [];
    const home = context.buildings.find(entry => entry.uid === actor.home);
    if (home) anchors.push(home.access);
    let repaired = false;
    for (let radius = 0; radius <= Math.max(world.cellsX, world.cellsZ) && !repaired; radius++) {
      const candidates: SettlementPoint[] = [];
      // Quarter-tile samples near the obstruction avoid jumping a worker a whole tile unnecessarily.
      const spacing = radius < 3 ? .25 : 1;
      const extent = radius + 1;
      for (let z = -extent; z <= extent; z += spacing) {
        const outer = Math.sqrt(Math.max(0, extent * extent - z * z));
        const inner = Math.sqrt(Math.max(0, radius * radius - z * z));
        for (const sign of [-1, 1]) {
          for (let x = Math.ceil(inner / spacing) * spacing; x <= outer; x += spacing) {
            if (sign === -1 && x === 0) continue;
            if (DMath.hypot(x, z) >= extent) continue;
            candidates.push({ x: actor.x + x * sign, z: actor.z + z });
          }
        }
      }
      candidates.sort((a, b) => DMath.hypot(a.x - actor.x, a.z - actor.z) -
        DMath.hypot(b.x - actor.x, b.z - actor.z) || a.z - b.z || a.x - b.x);
      for (const point of candidates) {
        const candidate = { ...actor, ...point, y: sampleSmooth(world, world.heights, point.x, point.z),
          ...(staleRoute ? { path: [], pathIndex: 0 } : {}) };
        if (!isLoadedWorkerPositionValid(context, candidate) || context.actors.some(other =>
          other !== actor && other.visible &&
          DMath.hypot(other.x - point.x, other.z - point.z) < .28)) continue;
        const path = goal ? groundPath(context, candidate, goal, actor.building) : null;
        const reachable = path || anchors.some(anchor => groundPath(context, candidate, anchor, actor.building));
        if ((goal || anchors.length) && !reachable) continue;
        actor.x = point.x; actor.z = point.z; actor.y = candidate.y;
        if (path) { actor.path = path; actor.pathIndex = 0; }
        else if (staleRoute) { actor.path = []; actor.pathIndex = 0; }
        actor.queueTarget = undefined; actor.queueWait = 0;
        recordMovementOutcome(actor, "interaction");
        repaired = true; break;
      }
    }
  }
};
