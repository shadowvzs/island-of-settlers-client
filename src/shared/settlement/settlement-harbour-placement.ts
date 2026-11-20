import { SAILING_SHIP_TURN_RADIUS } from "../../render-common/ships/ship-dimensions";
import { DMath } from "../math/deterministic-math";
import { harbourSpotAt } from "./harbour-spot-index";
import { createHarbourBerths } from "./settlement-harbour-berths";
import { findHarbourDockAt } from "./settlement-harbour-docks";
import { HARBOUR_WIDE_SHORE_REACH } from "./settlement-harbour-pier-geometry";
import { findGroundPath } from "./settlement-navigation";
import {
  type CoastalWorkSite, createSeaMask, findCoastalWorkSite, findCoastalWorkSiteAt
} from "./settlement-sea-navigation";
import { createShipRoutePlanner } from "./settlement-ship-routes";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";

const HARBOUR_SHORE_RADIUS = 8;
/** Portal's 20-tile window plus eight opening keel steps and one cell of position rounding. */
const MAX_OFFSHORE_CELL_DISTANCE = 29;
const UNREACHABLE_CELL = 0xffff_ffff;
const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
const PLACEMENT_REASON =
  "Harbour needs a reachable ocean shore within 8 tiles of its entrance and room for a ship to approach";
interface CoastalNavigation {
  width: number;
  height: number;
  revision: string;
  heights: Float32Array;
  lakeWater: unknown;
  seaLevel: number;
  sea: Uint8Array;
  oceanTurning: Uint8Array;
  oceanSeaDistance: Uint32Array;
  oceanCellDistance: Uint32Array;
  oceanAvailable: boolean;
  planner: ReturnType<typeof createShipRoutePlanner>;
  reasons: Map<string, string | null>;
  /** Berths a harbour planned on a plot would get (placement preview), per plot key. */
  berthCounts: Map<string, number>;
}
const navigation = new WeakMap<SettlementContext, CoastalNavigation>();

/** Full turning clearance must lead to the ocean; the final dock needs only its oriented hull. */
const oceanTurningMask = (context: SettlementContext, turning: Uint8Array) => {
  const { world } = context.options;
  const oceanTurning = new Uint8Array(turning.length), queue: number[] = [];
  const margin = Math.ceil(SAILING_SHIP_TURN_RADIUS);
  for (let z = margin; z < world.cellsZ - margin; z++) for (let x = margin; x < world.cellsX - margin; x++) {
    const cell = z * world.cellsX + x;
    if (!turning[cell] || (x !== margin && z !== margin && x !== world.cellsX - margin - 1 &&
      z !== world.cellsZ - margin - 1)) continue;
    oceanTurning[cell] = 1;
    queue.push(cell);
  }
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const cell = queue[cursor]!, x = cell % world.cellsX, z = Math.floor(cell / world.cellsX);
    for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = x + dx!, nz = z + dz!, next = nz * world.cellsX + nx;
      if (nx < 0 || nz < 0 || nx >= world.cellsX || nz >= world.cellsZ ||
        !turning[next] || oceanTurning[next]) continue;
      oceanTurning[next] = 1;
      queue.push(next);
    }
  }
  return oceanTurning;
};

/** Sea-only distance proves connectivity; unrestricted distance is a safe geometric lower bound. */
const distancesFromOceanTurning = (
  width: number, height: number, oceanTurning: Uint8Array, sea?: Uint8Array
) => {
  const distances = new Uint32Array(oceanTurning.length).fill(UNREACHABLE_CELL), queue: number[] = [];
  for (let cell = 0; cell < oceanTurning.length; cell++) {
    if (!oceanTurning[cell]) continue;
    distances[cell] = 0;
    queue.push(cell);
  }
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const cell = queue[cursor]!, x = cell % width, z = Math.floor(cell / width);
    for (const [dx, dz] of NEIGHBOURS) {
      const nx = x + dx, nz = z + dz, next = nz * width + nx;
      if (nx < 0 || nz < 0 || nx >= width || nz >= height ||
        distances[next] !== UNREACHABLE_CELL || (sea && !sea[next])) continue;
      distances[next] = distances[cell]! + 1;
      queue.push(next);
    }
  }
  return distances;
};

/** Terrain masks and exact placement answers are retained between hover frames. */
const coastalNavigation = (context: SettlementContext) => {
  const { world } = context.options;
  const revision = [world.buildRevision ?? 0, world.terrainRevision ?? 0,
    context.navigationRevision ?? 0, world.props.count].join(":");
  const cached = navigation.get(context);
  if (cached && cached.revision === revision && cached.heights === world.heights &&
    cached.lakeWater === world.lakeWater && cached.seaLevel === world.seaLevel) return cached;
  const freshSea = createSeaMask(world);
  const sameSea = cached && cached.width === world.cellsX && cached.height === world.cellsZ &&
    cached.sea.length === freshSea.length && freshSea.every((value, index) => value === cached.sea[index]);
  // Ground/plot answers still invalidate; exact offshore pose proofs depend only on the sea mask.
  const sea = sameSea ? cached.sea : freshSea;
  const planner = sameSea ? cached.planner : createShipRoutePlanner(world, sea);
  const oceanTurning = oceanTurningMask(context, planner.masks.turning);
  const result = { heights: world.heights, lakeWater: world.lakeWater, oceanAvailable: oceanTurning.some(Boolean),
    oceanTurning,
    oceanSeaDistance: distancesFromOceanTurning(world.cellsX, world.cellsZ, oceanTurning, sea),
    oceanCellDistance: distancesFromOceanTurning(world.cellsX, world.cellsZ, oceanTurning),
    berthCounts: new Map<string, number>(), planner, reasons: new Map<string, string | null>(),
    revision, sea, seaLevel: world.seaLevel, width: world.cellsX, height: world.cellsZ };
  navigation.set(context, result);
  return result;
};

/** A proposed foundation cannot become its own public shore route. */
const placementContext = (context: SettlementContext, building: SettlementBuilding,
  radius = HARBOUR_SHORE_RADIUS * 1.875) => {
  const { world } = context.options, width = world.cellsX, occupied = context.occupied.slice();
  for (let z = Math.floor(building.z - building.depth / 2); z < Math.ceil(building.z + building.depth / 2); z++)
    for (let x = Math.floor(building.x - building.width / 2); x < Math.ceil(building.x + building.width / 2); x++)
      occupied[z * width + x] = 1;
  const reachable = new Uint8Array(occupied.length);
  const first = Math.floor(building.access.z) * width + Math.floor(building.access.x), queue = [first];
  reachable[first] = 1;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const cell = queue[cursor]!, x = cell % width, z = Math.floor(cell / width);
    for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = x + dx!, nz = z + dz!, next = nz * width + nx;
      if (nx < 0 || nz < 0 || nx >= width || nz >= world.cellsZ || reachable[next] || occupied[next] ||
        !world.walkCost[next] || world.blocking[next] ||
        DMath.hypot(nx + .5 - building.access.x, nz + .5 - building.access.z) > radius) continue;
      reachable[next] = 1;
      queue.push(next);
    }
  }
  const paths = new Map<string, ReturnType<typeof findGroundPath>>();
  const draftContext: SettlementContext = { ...context, occupied, options: { ...context.options,
    findWorkerPath: (from, to) => {
      const key = `${to.x},${to.z}`;
      if (!reachable[Math.floor(to.z) * width + Math.floor(to.x)]) return null;
      if (!paths.has(key)) paths.set(key, findGroundPath(draftContext, from, to,
        point => DMath.hypot(point.x - building.access.x, point.z - building.access.z) > radius,
        undefined, .5, 4096));
      return paths.get(key) ?? null;
    } } };
  return draftContext;
};

const plotKey = (building: SettlementBuilding) =>
  `${building.x},${building.z},${building.rotation}:${building.width},${building.depth}` +
  `:${building.access.x},${building.access.z}`;
/** Plots whose berth counts are kept (a session hovers over far fewer). */
const MAX_CACHED_PLOTS = 256;

export const harbourPlacementReason = (context: SettlementContext, building: SettlementBuilding) => {
  if (building.typeId !== 39) return null;
  const cached = coastalNavigation(context);
  if (!cached.oceanAvailable) return PLACEMENT_REASON;
  const key = plotKey(building);
  if (cached.reasons.has(key)) return cached.reasons.get(key)!;
  const draft = placementContext(context, building);
  const accepts = (candidate: CoastalWorkSite) => {
    const pose = { ...candidate.water, yaw: candidate.yaw ?? 0 };
    const cell = Math.floor(pose.z) * context.options.world.cellsX + Math.floor(pose.x);
    if (cached.oceanSeaDistance[cell] === UNREACHABLE_CELL ||
      cached.oceanCellDistance[cell]! > MAX_OFFSHORE_CELL_DISTANCE) return false;
    const offshore = cached.planner.offshore(pose);
    if (!offshore || !cached.oceanTurning[Math.floor(offshore.z) * context.options.world.cellsX +
      Math.floor(offshore.x)]) return false;
    return Boolean(findHarbourDockAt(draft, building, pose, cached.sea));
  };
  // HARBOUR-SPOTS: a stored spot's own shore cell first; the full coast scan only when it fails.
  const spot = harbourSpotAt(context.options.world, building.x, building.z, building.rotation);
  const site = (spot && findCoastalWorkSiteAt(draft, building, cached.sea, spot.land, HARBOUR_SHORE_RADIUS,
    undefined, accepts, 4)) ??
    findCoastalWorkSite(draft, building, cached.sea, new Set(), HARBOUR_SHORE_RADIUS, undefined, accepts, 4);
  const reason = site ? null : PLACEMENT_REASON;
  if (cached.reasons.size >= MAX_CACHED_PLOTS) cached.reasons.delete(cached.reasons.keys().next().value!);
  cached.reasons.set(key, reason);
  return reason;
};

/**
 * Placement preview (owner, 2026-10-15): how many berths a harbour planned on this plot would get,
 * 1 or 2, by the same berth search the fleet uses on the finished harbour (`settlement-harbour-berths`);
 * null for any other building or a refused plot. Kept per plot and rotation: a still ghost costs nothing.
 */
export const harbourBerthCount = (context: SettlementContext, building: SettlementBuilding) => {
  if (building.typeId !== 39 || harbourPlacementReason(context, building) !== null) return null;
  const cached = coastalNavigation(context), key = plotKey(building);
  const known = cached.berthCounts.get(key);
  if (known !== undefined) return known;
  const draft = placementContext(context, building, HARBOUR_WIDE_SHORE_REACH * 1.875);
  // The plot's berths at the harbour's best: a second one comes with level 3 (owner, 2026-10-21).
  const harbour = { ...building, construction: 1, workshopUpgrade: { level: 2 as const } };
  const berths = createHarbourBerths({ ...draft, buildings: [...context.buildings, harbour] }, cached.sea,
    cached.planner).forHarbour(harbour.uid, true).length;
  if (cached.berthCounts.size >= MAX_CACHED_PLOTS) cached.berthCounts.delete(cached.berthCounts.keys().next().value!);
  cached.berthCounts.set(key, berths);
  return berths;
};

/** Immutable predicate view of the placement planner's exact masks; no voyage feasibility claim. */
export const inspectHarbourNavigation = (context: SettlementContext) => {
  const cached = coastalNavigation(context);
  return {
    sea: (cell: number) => Boolean(cached.sea[cell]),
    parallelX: (cell: number) => Boolean(cached.planner.masks.parallelX[cell]),
    parallelZ: (cell: number) => Boolean(cached.planner.masks.parallelZ[cell]),
    turning: (cell: number) => Boolean(cached.planner.masks.turning[cell]),
    oceanTurning: (cell: number) => Boolean(cached.oceanTurning[cell])
  };
};
