import { DMath } from "../math/deterministic-math";
import { isSingleLeg } from "./military-long-routes";
import { STORAGE_IDS } from "./production-rules";
import { withBuildingNavigationSearch } from "./settlement-building-navigation";
import { isOwnBuilding } from "./settlement-home";
import { findGroundPath, isMountedNavigationClear, isNavigationClear }
  from "./settlement-navigation";
import { groundPath } from "./settlement-paths";
import {
  publicTerrainLegPath as militaryLegPath,
  publicTerrainLocalDetour as localDetour, publicTerrainPath as militaryGroundPath
} from "./settlement-terrain-routing";
import { actorSeparation } from "./settlement-traffic";
import type { SettlementActor, SettlementContext, SettlementPoint } from "./settlement-types";

export {
  followPublicTerrainCorridor as followCorridor, isPublicTerrainLineClear as isLineClear,
publicTerrainPath as militaryGroundPath,
  publicTerrainLegPath as militaryLegPath} from "./settlement-terrain-routing";

/**
 * Order check for a group sent to `destination`: a short way to a soldier's place is searched (and
 * handed back, to be walked at once); long marches only need the start and the place inside the
 * destination's corridor flood fill. Null when the place cannot be reached.
 */
export const createMilitaryReach = (context: SettlementContext, _destination: SettlementPoint) => {
  return (from: SettlementPoint, goal: SettlementPoint, mounted: boolean) => {
    if (!isSingleLeg(from, goal)) return { path: null };
    // Long routes are proved by nextLeg/followCorridor before dispatch. A whole-island
    // reachability flood here duplicated that proof, especially expensive for mounted clearance.
    const path = militaryLegPath(context, from, goal, mounted);
    return path && { path };
  };
};

/** A clear off-centre yard position may need a short physical join to a coarse corridor cell. */
const militaryStorageFootPath = (context: SettlementContext, actor: SettlementActor, to: SettlementPoint) => {
  const direct = militaryGroundPath(context, actor, to);
  if (direct) return direct;
  const centre = { x: Math.floor(actor.x) + .5, z: Math.floor(actor.z) + .5 };
  for (const radius of [.5, 1, 1.5, 2]) {
    for (const [dx, dz] of [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const point = { x: centre.x + dx! * radius, z: centre.z + dz! * radius };
      if (!isNavigationClear(context, point)) continue;
      const local = localDetour(context, actor, point, false);
      if (!local || local.some(step => DMath.hypot(step.x - actor.x, step.z - actor.z) > 3)) continue;
      const onward = militaryGroundPath(context, point, to);
      if (onward) return [...local, ...onward];
    }
  }
  return null;
};

/** Prefer the cheapest reachable friendly storage, rather than geometric distance or birthplace. */
export const nearestMilitaryStorage = (...args: Parameters<typeof nearestMilitaryStorageImpl>) =>
  withBuildingNavigationSearch(args[0], () => nearestMilitaryStorageImpl(...args));
const nearestMilitaryStorageImpl = (context: SettlementContext, actor: SettlementActor, destination?: number) => {
  const homes = context.buildings.filter(home => (destination === undefined || home.uid === destination) && STORAGE_IDS.has(home.typeId) &&
    home.construction === 1 && isOwnBuilding(home));
  const distance = (home: typeof homes[number]) => DMath.hypot(actor.x - home.access.x, actor.z - home.access.z);
  if (!actor.mounted) homes.sort((a, b) => distance(a) - distance(b) || a.uid - b.uid);
  let bestCost = Infinity;
  const choices = homes.flatMap(home => {
    // Every physical foot path is at least its straight-line distance; retain near-equal UID ties.
    if (!actor.mounted && distance(home) > bestCost + 1e-6) return [];
    const dx = home.access.x - home.workerApproach.x, dz = home.access.z - home.workerApproach.z;
    const length = DMath.hypot(dx, dz) || 1;
    let path: SettlementPoint[] | null = null;
    let approachCost = 0;
    if (actor.mounted) {
      const reserved = context.actors.filter(other => other !== actor &&
        other.phase === "militaryMountedReturn" && other.home === home.uid).flatMap(other => {
        const goal = other.path.at(-1);
        return goal ? [goal] : [];
      });
      const offsets = [3.2, 5.8, 8.4, 11].flatMap(forward =>
        [0, -2.6, 2.6, -5.2, 5.2].map(side => ({ forward, side })));
      for (const { forward, side } of offsets) {
        const staging = { x: home.access.x + dx / length * forward + dz / length * side,
          z: home.access.z + dz / length * forward - dx / length * side };
        if (!isMountedNavigationClear(context, staging) ||
          reserved.some(point => DMath.hypot(point.x - staging.x, point.z - staging.z) < 2.5)) continue;
        const mountedLeg = militaryGroundPath(context, actor, staging, true);
        const approach = groundPath(context, staging, home.access);
        if (!mountedLeg || !approach) continue;
        path = mountedLeg;
        approachCost = DMath.hypot(staging.x - home.access.x, staging.z - home.access.z);
        break;
      }
    } else {
      // Returning foot soldiers use the same long-distance corridor as ordinary military marches.
      // A whole-town fine search can exhaust its local budget despite a valid storage route.
      path = militaryStorageFootPath(context, actor, home.access);
    }
    if (!path) return [];
    let cost = approachCost, previous: SettlementPoint = actor;
    for (const point of path) {
      cost += DMath.hypot(point.x - previous.x, point.z - previous.z);
      previous = point;
    }
    bestCost = Math.min(bestCost, cost);
    return [{ home, path, cost }];
  });
  return choices.sort((a, b) => a.cost - b.cost || a.home.uid - b.home.uid)[0];
};

/** Resting soldiers are physical obstacles, including riders arriving at a formation. */
export const militaryCrowdPath = (context: SettlementContext, actor: SettlementActor, to: SettlementPoint) => {
  // Across the island: the corridor route (resting horses are only a local obstacle near the start).
  if (!isSingleLeg(actor, to)) return militaryGroundPath(context, actor, to, Boolean(actor.mounted));
  const blockers = context.actors.filter(other => other !== actor && other.visible &&
    (other.mounted || other.job === "Soldier") && other.action === "idle");
  if (!blockers.length) return militaryLegPath(context, actor, to, Boolean(actor.mounted));
  const blocked = (point: SettlementPoint) =>
    (actor.mounted && !isMountedNavigationClear(context, point)) || blockers.some(other => {
    const clearance = actorSeparation(actor, other) + .03;
    const distance = DMath.hypot(point.x - other.x, point.z - other.z);
    if (distance >= clearance) return false;
    const initial = DMath.hypot(actor.x - other.x, actor.z - other.z);
    return initial >= clearance || distance <= initial + 1e-8;
  });
  return findGroundPath(context, actor, to, blocked, undefined, .25);
};
