import type { Goods } from "../../../../island-of-settlers-shared/src/goods";
import { buildingVolumeClearance, prepareBuildingVolumeClearance } from "../../render-common/buildings/building-navigation-geometry";
import {
  type BuildingNavigationData, buildingStockNavigationVolumesFromData, getBuildingNavigationData
} from "../../render-common/buildings/building-navigation-data";
import type { BuildingNavigationVolume } from "../../render-common/buildings/building-navigation-types";
import { buildingLevelOf } from "../../render-common/buildings/levels/building-level";
import { WORKER_RADIUS } from "../../render-common/workers/worker-dimensions";
import { DMath } from "../math/deterministic-math";
import { NAVIGATION_BLOCK, type TileRect } from "../world/navigation-change-log";
import type { WorldData } from "../world/world-data";
import { buildingNation } from "./settlement-nation";
import { createTransientMap } from "./settlement-transient-state";
import {
  isRoadWorkShell, type SettlementBuilding, type SettlementContext, type SettlementPoint
} from "./settlement-types";

interface BuildingIndex {
  revision: number;
  buildings: SettlementBuilding[];
  count: number;
  cells: Map<number, SettlementBuilding[]>;
  /** The same buildings per block of `NAVIGATION_BLOCK` tiles (the change journal's building lookup). */
  blocks: Map<number, SettlementBuilding[]>;
  blocksX: number;
}
const indices = createTransientMap<BuildingIndex>();
const EMPTY: readonly SettlementBuilding[] = [];
/**
 * Tiles whose point queries consult `building` (its index cells): the plot plus nearby body
 * clearance outside the reserved cell boundary, and national eaves/posts.
 */
export const buildingNavigationReach = (world: Pick<WorldData, "cellsX" | "cellsZ">,
  building: SettlementBuilding): TileRect => {
  const reachX = building.width / 2 + 2, reachZ = building.depth / 2 + 2;
  return { maxX: Math.min(world.cellsX - 1, Math.floor(building.x + reachX)),
    maxZ: Math.min(world.cellsZ - 1, Math.floor(building.z + reachZ)),
    minX: Math.max(0, Math.floor(building.x - reachX)), minZ: Math.max(0, Math.floor(building.z - reachZ)) };
};
const addToBlocks = (blocks: Map<number, SettlementBuilding[]>, blocksX: number, reach: TileRect,
  building: SettlementBuilding) => {
  for (let z = Math.floor(reach.minZ / NAVIGATION_BLOCK); z <= Math.floor(reach.maxZ / NAVIGATION_BLOCK); z++)
    for (let x = Math.floor(reach.minX / NAVIGATION_BLOCK); x <= Math.floor(reach.maxX / NAVIGATION_BLOCK); x++) {
      const block = z * blocksX + x, list = blocks.get(block) ?? [];
      list.push(building); blocks.set(block, list);
    }
};
const indexFor = (context: SettlementContext) => {
  const previous = indices.get(context), revision = context.navigationRevision ?? 0;
  if (previous?.revision === revision && previous.buildings === context.buildings &&
    previous.count === context.buildings.length) return previous;
  const { world } = context.options, cells = new Map<number, SettlementBuilding[]>();
  const blocks = new Map<number, SettlementBuilding[]>(), blocksX = Math.ceil(world.cellsX / NAVIGATION_BLOCK);
  for (const building of context.buildings) {
    // A road work shell is bookkeeping for its stock, never an obstacle on the road.
    if (isRoadWorkShell(building)) continue;
    const reach = buildingNavigationReach(world, building);
    for (let z = reach.minZ; z <= reach.maxZ; z++)
      for (let x = reach.minX; x <= reach.maxX; x++) {
        const cell = z * world.cellsX + x, list = cells.get(cell) ?? [];
        list.push(building); cells.set(cell, list);
      }
    if (reach.minX <= reach.maxX && reach.minZ <= reach.maxZ) addToBlocks(blocks, blocksX, reach, building);
  }
  const result = { revision, buildings: context.buildings, count: context.buildings.length, cells, blocks, blocksX };
  indices.set(context, result);
  return result;
};
/** The indexed buildings per journal block (exactly the buildings point queries can consult). */
export const navigationBuildingBlocks = (context: SettlementContext) => {
  const { blocks, blocksX } = indexFor(context);
  return { blocks: blocks as ReadonlyMap<number, readonly SettlementBuilding[]>, blocksX };
};
/** Fine path edges are needed only near real buildings; open island ground keeps its coarse step. */
export const hasBuildingNavigationNearby = (context: SettlementContext, point: SettlementPoint) => {
  const width = context.options.world.cellsX;
  return (indexFor(context).cells.get(Math.floor(point.z) * width + Math.floor(point.x))?.length ?? 0) > 0;
};
/** Per world cell, the buildings its point queries consult (cells without one are absent). */
export const buildingNavigationCells = (context: SettlementContext) =>
  indexFor(context).cells as ReadonlyMap<number, readonly SettlementBuilding[]>;
/**
 * Compounds with an authored breached-wall/tent occupancy mask (no national model): their plot blocks
 * through the occupancy grid only.
 */
export const isLegacyNavigationBuilding = (building: SettlementBuilding) =>
  !Number.isInteger(building.typeId) || building.bandit !== undefined || Boolean(building.eventCourtyard);
const inPlot = (building: SettlementBuilding, point: SettlementPoint) =>
  Math.abs(point.x - building.x) < building.width / 2 && Math.abs(point.z - building.z) < building.depth / 2;
const localPoint = (building: SettlementBuilding, point: SettlementPoint) => {
  const angle = building.rotation * Math.PI / 2, cosine = Math.round(DMath.cos(angle)), sine = Math.round(DMath.sin(angle));
  const x = point.x - building.x, z = point.z - building.z;
  return { x: x * cosine - z * sine, z: x * sine + z * cosine };
};
const stockKey = (building: SettlementBuilding) => {
  let key = "";
  for (const goods of [building.input, building.output]) {
    for (const ware in goods) if (goods[ware]! > 0) key += `${ware}:${goods[ware]},`;
    key += ";";
  }
  return key + (building.nurserySeedlingTaken ? "taken" : "");
};
const sameGoods = (first: Readonly<Goods>, second: Readonly<Goods>) => {
  for (const ware in first) if ((first[ware] ?? 0) !== (second[ware] ?? 0)) return false;
  for (const ware in second) if ((first[ware] ?? 0) !== (second[ware] ?? 0)) return false;
  return true;
};
const stocks = new WeakMap<SettlementBuilding, { input: Readonly<Goods>; output: Readonly<Goods>; taken?: boolean;
  profile: object; volumes: readonly BuildingNavigationVolume[] }>();
const stockVolumes = (building: SettlementBuilding, profile: BuildingNavigationData) => {
  const previous = stocks.get(building);
  if (previous?.profile === profile && previous.taken === building.nurserySeedlingTaken &&
    sameGoods(previous.input, building.input) && sameGoods(previous.output, building.output)) return previous.volumes;
  const input = building.typeId >= 10 && building.typeId <= 13 ? {} : building.input;
  const output = [20, 41].includes(building.typeId)
    ? { ...building.output, seedling: building.nurserySeedlingTaken ? 5 : 6 } : building.output;
  const volumes = buildingStockNavigationVolumesFromData(profile, input, output);
  stocks.set(building, { input: { ...building.input }, output: { ...building.output },
    taken: building.nurserySeedlingTaken, profile, volumes });
  return volumes;
};
/**
 * Everything of a building that point queries read: plot and rotation, construction stage, legacy
 * occupancy mask, and for a finished building its national profile and live stock volumes. Stock
 * counts that leave the volumes unchanged leave the shape unchanged.
 */
export interface BuildingNavigationShape {
  depth: number;
  legacy: boolean;
  profile: object | null;
  rotation: number;
  /** 0: not started (an escapable plot), 1: under construction, 2: finished. */
  stage: number;
  volumes: readonly BuildingNavigationVolume[];
  width: number;
  x: number;
  z: number;
}
const EMPTY_VOLUMES: readonly BuildingNavigationVolume[] = [];
const constructionStage = (building: SettlementBuilding) => {
  if (building.construction >= 1) return 2;
  return building.construction === 0 ? 0 : 1;
};
export const buildingNavigationShape = (context: SettlementContext, building: SettlementBuilding):
  BuildingNavigationShape => {
  const legacy = isLegacyNavigationBuilding(building);
  const stage = constructionStage(building);
  const profile = legacy || stage < 2 ? null : getBuildingNavigationData(building.typeId,
    buildingNation(context, building) ?? "roman", buildingLevelOf(building.workshopUpgrade?.level));
  return { depth: building.depth, legacy, profile, rotation: building.rotation, stage,
    volumes: profile ? stockVolumes(building, profile) : EMPTY_VOLUMES, width: building.width,
    x: building.x, z: building.z };
};
const samePoint = (first: readonly number[], second: readonly number[]) =>
  first[0] === second[0] && first[1] === second[1] && first[2] === second[2];
const sameVolume = (first: BuildingNavigationVolume, second: BuildingNavigationVolume) =>
  samePoint(first.min, second.min) && samePoint(first.max, second.max) &&
  first.shape === second.shape && first.yaw === second.yaw;
const sameVolumes = (first: readonly BuildingNavigationVolume[], second: readonly BuildingNavigationVolume[]) =>
  first === second || (first.length === second.length && first.every((volume, index) => sameVolume(volume, second[index]!)));
/** Equal shapes answer every point query identically (the volumes are compared in their order). */
export const sameBuildingNavigationShape = (first: BuildingNavigationShape, second: BuildingNavigationShape) =>
  first.x === second.x && first.z === second.z && first.width === second.width && first.depth === second.depth &&
  first.rotation === second.rotation && first.stage === second.stage && first.legacy === second.legacy &&
  first.profile === second.profile && sameVolumes(first.volumes, second.volumes);
/**
 * A12: half-tile bucket keys of building-local points as one integer (was a template string per point
 * query). `z * stride + x` is unique while |x| < stride / 2; local half-tiles stay far below that.
 */
const HALF_TILE_KEY_STRIDE = 4_194_304;
const halfTileKey = (x: number, z: number) => z * HALF_TILE_KEY_STRIDE + x;
const pointHalfTileKey = (point: SettlementPoint) => halfTileKey(Math.floor(point.x * 2), Math.floor(point.z * 2));
const volumeIndices = new WeakMap<readonly BuildingNavigationVolume[], Map<number, BuildingNavigationVolume[]>>();
const volumeIndex = (volumes: readonly BuildingNavigationVolume[]) => {
  const cached = volumeIndices.get(volumes);
  if (cached) return cached;
  const cells = new Map<number, BuildingNavigationVolume[]>();
  for (const volume of volumes) {
    const cx = (volume.min[0] + volume.max[0]) / 2, cz = (volume.min[2] + volume.max[2]) / 2;
    const rx = (volume.max[0] - volume.min[0]) / 2, rz = (volume.max[2] - volume.min[2]) / 2;
    const cosine = Math.abs(DMath.cos(volume.yaw ?? 0)), sine = Math.abs(DMath.sin(volume.yaw ?? 0));
    const ex = rx * cosine + rz * sine + 1.05, ez = rx * sine + rz * cosine + 1.05;
    for (let z = Math.floor((cz - ez) * 2); z <= Math.floor((cz + ez) * 2); z++)
      for (let x = Math.floor((cx - ex) * 2); x <= Math.floor((cx + ex) * 2); x++) {
        const key = halfTileKey(x, z), list = cells.get(key) ?? [];
        list.push(volume); cells.set(key, list);
      }
  }
  volumeIndices.set(volumes, cells);
  return cells;
};
const clearVolumes = (volumes: readonly BuildingNavigationVolume[], point: SettlementPoint, radius: number) => {
  const nearby = radius <= 1.05
    ? volumeIndex(volumes).get(pointHalfTileKey(point)) ?? [] : volumes;
  return nearby.every(volume => buildingVolumeClearance(volume, point.x, point.z) >= radius - 1e-7);
};

const combinedVolumes = new WeakMap<object, WeakMap<object, readonly BuildingNavigationVolume[]>>();
const searchVolumes = (profile: BuildingNavigationData, stock: readonly BuildingNavigationVolume[]) => {
  let byStock = combinedVolumes.get(profile);
  if (!byStock) { byStock = new WeakMap(); combinedVolumes.set(profile, byStock); }
  let volumes = byStock.get(stock);
  if (!volumes) {
    // Preserve the exact interior, obstacle, stock predicate order in each spatial bucket.
    volumes = [...profile.interiors, ...profile.obstacles, ...stock];
    byStock.set(stock, volumes);
  }
  return volumes;
};

type VolumeClearance = ReturnType<typeof prepareBuildingVolumeClearance>;
interface SearchBuildingGeometry {
  cosine: number;
  sine: number;
  profile: BuildingNavigationData;
  volumes: readonly BuildingNavigationVolume[];
  clearances: Map<BuildingNavigationVolume, VolumeClearance>;
  buckets: Map<number, readonly VolumeClearance[]>;
}
/** One synchronous search's snapshots: building geometry, plus read-only memos other navigation reads keep. */
interface NavigationSearchScope {
  buildings: Map<SettlementBuilding, SearchBuildingGeometry>;
  memos: Map<object, unknown>;
}
const searches = new WeakMap<SettlementContext, NavigationSearchScope>();
/** One synchronous search observes one stock/geometry state; the next search always observes live stock. */
export const withBuildingNavigationSearch = <T>(context: SettlementContext, search: () => T): T => {
  const previous = searches.get(context);
  searches.set(context, { buildings: new Map(), memos: new Map() });
  try { return search(); }
  finally {
    if (previous) searches.set(context, previous);
    else searches.delete(context);
  }
};
/** `run` inside a navigation search: the open one, or a new one round it. */
export const withinBuildingNavigationSearch = <T>(context: SettlementContext, run: () => T): T =>
  searches.has(context) ? run() : withBuildingNavigationSearch(context, run);
/**
 * A12: a memo that lives exactly as long as the innermost open navigation search (undefined outside
 * one). Nothing a search reads changes inside it, so values derived from world state stay exact.
 */
export const navigationSearchMemo = <T>(context: SettlementContext, slot: object, create: () => T): T | undefined => {
  const scope = searches.get(context);
  if (!scope) return undefined;
  let memo = scope.memos.get(slot) as T | undefined;
  if (memo === undefined) {
    memo = create();
    scope.memos.set(slot, memo);
  }
  return memo;
};
const searchGeometry = (context: SettlementContext, building: SettlementBuilding) => {
  const search = searches.get(context)?.buildings;
  if (!search || building.construction < 1) return undefined;
  let geometry = search.get(building);
  if (!geometry) {
    const angle = building.rotation * Math.PI / 2;
    const profile = getBuildingNavigationData(building.typeId, buildingNation(context, building) ?? "roman",
      buildingLevelOf(building.workshopUpgrade?.level));
    geometry = { cosine: Math.round(DMath.cos(angle)), sine: Math.round(DMath.sin(angle)),
      profile, volumes: searchVolumes(profile, stockVolumes(building, profile)),
      clearances: new Map(), buckets: new Map() };
    search.set(building, geometry);
  }
  return geometry;
};

const preparedClearance = (geometry: SearchBuildingGeometry, volume: BuildingNavigationVolume) => {
  let clearance = geometry.clearances.get(volume);
  if (!clearance) { clearance = prepareBuildingVolumeClearance(volume); geometry.clearances.set(volume, clearance); }
  return clearance;
};
/** The building-local point (`x`, `z`) keeps `radius` from every prepared volume (A12: no point object). */
const clearSearchVolumes = (geometry: SearchBuildingGeometry, x: number, z: number, radius: number) => {
  if (radius > 1.05)
    return geometry.volumes.every(volume => preparedClearance(geometry, volume)(x, z) >= radius - 1e-7);
  const key = halfTileKey(Math.floor(x * 2), Math.floor(z * 2));
  let nearby = geometry.buckets.get(key);
  if (!nearby) {
    nearby = (volumeIndex(geometry.volumes).get(key) ?? []).map(volume => preparedClearance(geometry, volume));
    geometry.buckets.set(key, nearby);
  }
  for (const clearance of nearby) if (!(clearance(x, z) >= radius - 1e-7)) return false;
  return true;
};

/**
 * The volumes the open navigation search tests for a finished building, with its quarter-turn rotation
 * (undefined outside a search or for a building under construction).
 */
export const searchBuildingVolumes = (context: SettlementContext, building: SettlementBuilding):
  Pick<SearchBuildingGeometry, "cosine" | "sine" | "volumes"> | undefined => searchGeometry(context, building);

/**
 * The yard rule of a point query: an occupied cell is walkable only inside a building's plot (or the
 * asker's own unbuilt site); a legacy compound's plot never is.
 */
const isYardClaimed = (context: SettlementContext, point: SettlementPoint, cell: number,
  nearby: readonly SettlementBuilding[], ownUnbuiltSite?: SettlementBuilding) => {
  const occupied = context.occupied[cell] === 1;
  let claimed = !occupied;
  for (const building of nearby) {
    if (building === ownUnbuiltSite && building.construction === 0) {
      claimed ||= Math.abs(point.x - building.x) <= building.width / 2 &&
        Math.abs(point.z - building.z) <= building.depth / 2;
      continue;
    }
    const inside = inPlot(building, point);
    // These compounds already author a breached-wall/tent occupancy mask. Retain that independent
    // saved model until it is queried through its own geometry, never substitute a national house.
    if (isLegacyNavigationBuilding(building)) {
      if (inside && occupied) return false;
      continue;
    }
    claimed ||= inside;
  }
  // Bare occupied cells in authored worlds/test fixtures remain blocked without a real owner/model.
  return claimed;
};
/** The yard rule alone (`isPublicBuildingPointClear` without the building bodies). */
export const isYardPointClaimed = (context: SettlementContext, point: SettlementPoint) => {
  const cell = Math.floor(point.z) * context.options.world.cellsX + Math.floor(point.x);
  return isYardClaimed(context, point, cell, indexFor(context).cells.get(cell) ?? EMPTY);
};
/** The point keeps `radius` from the body of one non-legacy building (its foundation while unfinished). */
const isBuildingBodyClear = (context: SettlementContext, building: SettlementBuilding, point: SettlementPoint,
  radius: number) => {
  if (building.construction < 1) {
    const foundation: BuildingNavigationVolume = { min: [-building.width / 2, 0, -building.depth / 2],
      max: [building.width / 2, 2, building.depth / 2] };
    return !(buildingVolumeClearance(foundation, point.x - building.x, point.z - building.z) < radius);
  }
  // A12: inside a search the local point goes straight to the prepared volumes (same arithmetic).
  const geometry = searchGeometry(context, building);
  if (geometry) {
    const dx = point.x - building.x, dz = point.z - building.z;
    return clearSearchVolumes(geometry, dx * geometry.cosine - dz * geometry.sine,
      dx * geometry.sine + dz * geometry.cosine, radius);
  }
  const local = localPoint(building, point);
  const profile = getBuildingNavigationData(building.typeId, buildingNation(context, building) ?? "roman",
    buildingLevelOf(building.workshopUpgrade?.level));
  return clearVolumes(profile.interiors, local, radius) && clearVolumes(profile.obstacles, local, radius) &&
    clearVolumes(stockVolumes(building, profile), local, radius);
};

/** Public yard access never grants admission to a room, even through its currently open door. */
export const isPublicBuildingPointClear = (context: SettlementContext, point: SettlementPoint,
  radius = WORKER_RADIUS, ownUnbuiltSite?: SettlementBuilding) => {
  const { world } = context.options, cell = Math.floor(point.z) * world.cellsX + Math.floor(point.x);
  const nearby = indexFor(context).cells.get(cell) ?? EMPTY;
  for (const building of nearby) {
    if ((building === ownUnbuiltSite && building.construction === 0) || isLegacyNavigationBuilding(building)) continue;
    if (!isBuildingBodyClear(context, building, point, radius)) return false;
  }
  return isYardClaimed(context, point, cell, nearby, ownUnbuiltSite);
};

/** Flow caches refresh stock geometry once per simulation tick; exact body queries always use live counts. */
const revisionCache = createTransientMap<{ tick: number; revision: number; nation: string; count: number; key: string }>();
export const buildingNavigationRevision = (context: SettlementContext) => {
  const tick = context.clock?.tick(), cached = revisionCache.get(context);
  const revision = context.navigationRevision ?? 0, nation = context.playerNation ?? "roman";
  if (tick !== undefined && cached?.tick === tick && cached.revision === revision &&
    cached.nation === nation && cached.count === context.buildings.length) return cached.key;
  let key = `${context.navigationRevision ?? 0}:${context.playerNation ?? "roman"}:`;
  for (const building of context.buildings) key += `${building.uid}:${building.construction < 1 ? 0 : 1}:` +
    `${building.workshopUpgrade?.level ?? 0}:${stockKey(building)}|`;
  if (tick !== undefined) revisionCache.set(context, { tick, revision, nation, count: context.buildings.length, key });
  return key;
};
