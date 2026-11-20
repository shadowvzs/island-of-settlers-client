import { BUILDING_MENU } from "../../render-common/buildings/building-menu";
import { GARRISON_CAPACITIES } from "../balance/military";
import { DMath } from "../math/deterministic-math";
import { HARBOUR_TYPE_ID, SHIPYARD_TYPE_ID } from "./building-type-ids";
import { ROAD_TARGET_NODES } from "./constants";
import { nearestRoadEndpoints } from "./road-endpoints";
import { hasRoadRoute } from "./road-route-helpers";
import type { RoadPlan, RoadPoint } from "./road-types";
import { shoreCells } from "./settlement-debug-harbour";
import { legalDraft, raiseFinishedBuilding, rotatedFootprint } from "./settlement-debug-raise";
import { demolishSettlementBuilding } from "./settlement-demolition";
import { findHomeBuilding } from "./settlement-home";
import { isMineType, requiredMineOre } from "./settlement-placement";
import { isGentlePlotGround, isPlotLaneFree } from "./settlement-plot-prechecks";
import { invalidateRoadTravel } from "./settlement-road-rerouting";
import { findRoadTarget, isLinkedToHome, samePoint } from "./settlement-road-target";
import { refreshSettlementRoadTerrain } from "./settlement-road-terrain";
import { restoreTerrain, snapshotTerrain, type TerrainSnapshot } from "./settlement-terrain-snapshot";
import { settlementTerritory } from "./settlement-territory";
import type { SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";

/** Legacy specialist sawmills only load from saves; new construction uses the levelled sawmill 33. */
const isDebugBuildable = (id: number) => id !== 0;

/** Place the ordinary town first; military garrisons and mines follow, retaining menu order. */
export const DEBUG_BUILD_ALL_TYPES: readonly number[] = BUILDING_MENU
  .flatMap(group => group.buildings.map(building => building.id)).filter(isDebugBuildable)
  .sort((first, second) => Number(isMineType(first) || GARRISON_CAPACITIES[first] !== undefined) -
    Number(isMineType(second) || GARRISON_CAPACITIES[second] !== undefined));

/** Full placement checks (real rules) per type before it is skipped. */
const MAX_PLACEMENT_CHECKS = 320;
/** Legal plots whose road connection is tried per type before it is skipped. */
const MAX_ROAD_ATTEMPTS = 12;
/** Cheap candidate pre-checks between two pauses of a stepped search. */
const CHECKS_PER_STEP = 64;

export type DebugBuildResult =
  | { ok: true; building: SettlementBuilding }
  | { ok: false; reason: string };

interface DebugBuildHooks {
  allowsBuilding(typeId: number): boolean;
  connectRoads(start: SettlementPoint, end: SettlementPoint): unknown;
  planRoad(start: SettlementPoint, end: SettlementPoint, tier: "dirt"): RoadPlan | null;
}

interface Corner {
  x: number;
  z: number;
}

interface PlotAttempt {
  corner: Corner;
  home: SettlementBuilding;
  /** Buildings that reach the headquarters by road before the attempt. */
  linked: readonly SettlementBuilding[];
  rotation: number;
  typeId: number;
}

const byDistanceFrom = (home: SettlementBuilding) => (first: Corner, second: Corner) =>
  DMath.hypot(first.x - home.x, first.z - home.z) - DMath.hypot(second.x - home.x, second.z - home.z) ||
  first.z - second.z || first.x - second.x;

/** Owned cells as plot corners, nearest to the headquarters first. */
const ownedCorners = (context: SettlementContext, home: SettlementBuilding) => {
  const { cellsX } = context.options.world;
  const { owned } = settlementTerritory(context);
  const corners: Corner[] = [];
  for (let cell = 0; cell < owned.length; cell++) {
    if (owned[cell] === 1) corners.push({ x: cell % cellsX, z: Math.floor(cell / cellsX) });
  }
  return corners.sort(byDistanceFrom(home));
};

/** Zone ids of surveyed deposits holding the mine's ore. */
const surveyedZones = (context: SettlementContext, typeId: number) => {
  const ore = requiredMineOre(typeId);
  return new Set(context.options.world.mineZones.filter(zone => zone.surveyed && zone.ore === ore)
    .map(zone => zone.id));
};

/** Plot corners whose plot may cover a surveyed cell of the mine's ore, nearest first. */
const mineCorners = (context: SettlementContext, typeId: number, home: SettlementBuilding) => {
  const { world } = context.options;
  const zones = surveyedZones(context, typeId);
  if (!zones.size) return [];
  const { depth, width } = rotatedFootprint(typeId, 0);
  const reach = Math.max(depth, width), seen = new Set<number>(), corners: Corner[] = [];
  for (let cell = 0; cell < world.oreAmount.length; cell++) {
    if (!world.oreAmount[cell] || !zones.has(world.mineZone[cell]!)) continue;
    const x = cell % world.cellsX, z = Math.floor(cell / world.cellsX);
    for (let dz = 0; dz < reach; dz++) for (let dx = 0; dx < reach; dx++) {
      const corner = (z - dz) * world.cellsX + x - dx;
      if (x - dx < 0 || z - dz < 0 || seen.has(corner)) continue;
      seen.add(corner);
      corners.push({ x: x - dx, z: z - dz });
    }
  }
  return corners.sort(byDistanceFrom(home));
};

/** Every corner in all four rotations, in order. */
const rotatedPlots = function* (corners: readonly Corner[]) {
  for (const corner of corners) for (let rotation = 0; rotation < 4; rotation++) yield { corner, rotation };
};

const candidateCorners = (context: SettlementContext, typeId: number, home: SettlementBuilding) => {
  if (typeId === HARBOUR_TYPE_ID) return shoreCells(context, home);
  if (typeId === SHIPYARD_TYPE_ID) {
    // Prefer the coast, but keep inland candidates: the authoritative shipyard rule accepts any
    // plot with a reachable hull work site and launch within SHIPYARD_RADIUS.
    const coastal = shoreCells(context, home).map(({ x, z }) => ({ x, z }));
    const seen = new Set(coastal.map(corner => `${corner.x}:${corner.z}`));
    return [...coastal, ...ownedCorners(context, home).filter(corner => !seen.has(`${corner.x}:${corner.z}`))];
  }
  if (isMineType(typeId)) return mineCorners(context, typeId, home);
  const corners = ownedCorners(context, home);
  const endpoints = nearestRoadEndpoints(context.options.roads.segments?.() ?? [],
    () => context.buildings.map(building => building.access), home.access, ROAD_TARGET_NODES)
    .filter(point => isLinkedToHome(context, home, point));
  // Prefer short new links; the headquarters remains the tie-breaker on an empty network.
  const distance = (corner: Corner) => endpoints.reduce((nearest, point) =>
    Math.min(nearest, DMath.hypot(corner.x - point.x, corner.z - point.z)), Infinity);
  const ranked = corners.map(corner => ({ corner, distance: distance(corner) }));
  return ranked.sort((a, b) => a.distance - b.distance || byDistanceFrom(home)(a.corner, b.corner))
    .map(entry => entry.corner);
};

/** The shared cheap pre-checks before the real rules: owned free plot with a lane, on gentle ground. */
const passesPrechecks = (context: SettlementContext, typeId: number, corner: Corner, rotation: number) => {
  const { depth, width } = rotatedFootprint(typeId, rotation);
  return isPlotLaneFree(context, settlementTerritory(context).owned, corner.x, corner.z, width, depth) &&
    isGentlePlotGround(context.options.world, corner.x, corner.z, width, depth);
};

/** A mine plot must reach a cell of a surveyed deposit of its own ore. */
const reachesSurveyedOre = (context: SettlementContext, draft: SettlementBuilding) => {
  const { world } = context.options;
  const zones = surveyedZones(context, draft.typeId);
  const left = draft.x - draft.width / 2, top = draft.z - draft.depth / 2;
  for (let z = top; z < top + draft.depth; z++) for (let x = left; x < left + draft.width; x++) {
    const cell = z * world.cellsX + x;
    if (world.oreAmount[cell] && zones.has(world.mineZone[cell]!)) return true;
  }
  return false;
};

/** The nearest road node on the headquarters' network that a dirt road from the flag can reach. */
const roadTarget = (
  context: SettlementContext, hooks: DebugBuildHooks, home: SettlementBuilding, draft: SettlementBuilding
) => findRoadTarget(context, { draft, flags: () => context.buildings.map(building => building.access), home,
  planRoad: (start, end) => hooks.planRoad(start, end, "dirt") });

/** Joins the raised building's flag to the network; true once the headquarters reaches it. */
const linkRoad = (
  context: SettlementContext, hooks: DebugBuildHooks, home: SettlementBuilding,
  building: SettlementBuilding, target: RoadPoint
) => {
  if (!samePoint(target, building.access) && !hooks.connectRoads(building.access, target)) return false;
  // Grade the new road now, as the next tick would: travel routes test the graded slope.
  refreshSettlementRoadTerrain(context);
  return hasRoadRoute(context.options.roads, home.access, building.access);
};

const segmentKey = (segment: Readonly<Record<"end" | "start", RoadPoint>>) =>
  `${segment.start.x}:${segment.start.z}:${segment.end.x}:${segment.end.z}`;
const roadKeys = (context: SettlementContext) =>
  new Set((context.options.roads.segments?.() ?? []).map(segmentKey));

/** Removes the road sections a failed attempt added (those missing from `before`). */
const removeNewRoads = (context: SettlementContext, before: ReadonlySet<string>) => {
  const { roads } = context.options;
  let removed = false;
  for (const segment of roads.segments?.() ?? [])
    if (!before.has(segmentKey(segment))) removed = roads.removeRoad?.(segment.start, segment.end) || removed;
  if (removed) invalidateRoadTravel(context);
};

const skipReason = (typeId: number) => {
  if (typeId === HARBOUR_TYPE_ID) return "no harbour plot on your coast reachable by road";
  if (typeId === SHIPYARD_TYPE_ID) return "no usable waterfront plot with a reachable launch site";
  if (isMineType(typeId)) return "no surveyed matching deposit in your territory reachable by road";
  return "no free plot in your territory reachable by road";
};

/**
 * Development menu "Build every building": raises one finished building of a type on the
 * nearest legal plot (the real placement and territory rules) and joins its flag to the
 * headquarters' road network with a real dirt road. Workers then arrive as for any building.
 */
export const createDebugBuildAll = (context: SettlementContext, hooks: DebugBuildHooks) => {
  /** Rolls a failed attempt back: its new roads, the building and the leveled ground. */
  const undo = (building: SettlementBuilding, roads: ReadonlySet<string>, terrain: TerrainSnapshot) => {
    removeNewRoads(context, roads);
    demolishSettlementBuilding(context, building.uid);
    restoreTerrain(context, terrain);
  };
  /**
   * Raises the building and joins it by road; kept only when it and every building linked
   * before still reach the headquarters (leveling may cut cliffs beside an older road).
   */
  const tryPlot = (attempt: PlotAttempt) => {
    const { corner, home, linked, rotation, typeId } = attempt;
    const draft = legalDraft(context, typeId, corner.x, corner.z, rotation);
    if (!draft || (isMineType(typeId) && !reachesSurveyedOre(context, draft))) return { legal: false };
    const target = roadTarget(context, hooks, home, draft);
    if (!target) return { legal: true };
    const roads = roadKeys(context), terrain = snapshotTerrain(context);
    const building = raiseFinishedBuilding(context, draft, typeId === HARBOUR_TYPE_ID ? "Harbour" : "Complete");
    if (linkRoad(context, hooks, home, building, target) &&
      linked.every(other => isLinkedToHome(context, home, other.access))) return { building, legal: true };
    undo(building, roads, terrain);
    return { legal: true };
  };
  /**
   * The search for one type, pausing (yield) after every road attempt and every
   * `CHECKS_PER_STEP` candidate checks, so a caller can spread it over frames.
   */
  const steps = function* (typeId: number): Generator<void, DebugBuildResult> {
    if (context.colony?.save() || context.buildings.some(building => building.colonyHome))
      return { ok: false, reason: "Build every building is disabled on colonies" };
    if (context.buildings.some(building => building.typeId === typeId))
      return { ok: false, reason: "building type already exists" };
    const home = findHomeBuilding(context);
    if (!home) return { ok: false, reason: "the island has no headquarters" };
    if (!hooks.allowsBuilding(typeId)) return { ok: false, reason: "not allowed on this island" };
    const linked = context.buildings.filter(building => isLinkedToHome(context, home, building.access));
    let candidates = 0, checks = 0, roadAttempts = 0;
    for (const { corner, rotation } of rotatedPlots(candidateCorners(context, typeId, home))) {
      if (checks >= MAX_PLACEMENT_CHECKS || roadAttempts >= MAX_ROAD_ATTEMPTS) break;
      if (++candidates % CHECKS_PER_STEP === 0) yield;
      if (!passesPrechecks(context, typeId, corner, rotation)) continue;
      checks++;
      const result = tryPlot({ corner, home, linked, rotation, typeId });
      if (result.building) return { building: result.building, ok: true };
      if (!result.legal) { yield; continue; }
      roadAttempts++;
      yield;
    }
    return { ok: false, reason: skipReason(typeId) };
  };
  /** The whole search for one type at once. */
  const build = (typeId: number) => {
    const search = steps(typeId);
    let step = search.next();
    while (!step.done) step = search.next();
    return step.value;
  };
  return { build, steps };
};
