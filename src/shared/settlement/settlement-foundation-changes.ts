import { BLOCKING, type WorldData } from "../world/world-data";
import type { SettlementBuilding } from "./settlement-types";

interface FoundationBounds { minX: number; minZ: number; maxX: number; maxZ: number }
interface Revision { build: number; terrain: number }
interface FoundationChange { after: Revision; before: Revision; bounds: FoundationBounds; topologyStable: boolean }
const changes = new WeakMap<WorldData, FoundationChange[]>();
export const foundationRevision = (world: WorldData): Revision => ({
  build: world.buildRevision ?? 0, terrain: world.terrainRevision ?? 0
});
const same = (first: Revision, second: Revision) =>
  first.build === second.build && first.terrain === second.terrain;

/** Both landmass membership and draft-water connectivity must remain unchanged for a local proof. */
const topology = (world: WorldData, bounds: FoundationBounds) => {
  const result: number[] = [], stride = world.cellsX + 1;
  for (let z = bounds.minZ; z <= bounds.maxZ; z++) for (let x = bounds.minX; x <= bounds.maxX; x++) {
    const vertex = z * stride + x;
    result.push(Number(world.heights[vertex]! < world.seaLevel - .25 && !world.lakeWater?.[vertex]));
    if (x < world.cellsX && z < world.cellsZ)
      result.push(Number(world.blocking?.[z * world.cellsX + x] === BLOCKING.water));
  }
  return result;
};

/** Exact submerged geometry as well as draft membership; unknown/depth edits stay conservative. */
const depths = (world: WorldData, bounds: FoundationBounds) => {
  const result: number[] = [], stride = world.cellsX + 1;
  for (let z = bounds.minZ; z <= bounds.maxZ; z++) for (let x = bounds.minX; x <= bounds.maxX; x++) {
    const vertex = z * stride + x;
    result.push(Math.min(world.heights[vertex]!, world.seaLevel), world.waterDepth?.[vertex] ?? 0);
  }
  return result;
};

/** Caller must cover every editable vertex AND every cell its terrain refresh can touch. */
export const beginTerrainChange = (world: WorldData, bounds: FoundationBounds) => ({
  before: foundationRevision(world), bounds, topology: topology(world, bounds), depths: depths(world, bounds)
});

export const beginFoundationChange = (world: WorldData, building: SettlementBuilding) => {
  // Includes the blended apron and the terrain refresh's neighbouring normal/cell samples.
  const bounds = { minX: Math.max(0, Math.floor(building.x - building.width / 2 - 5)),
    minZ: Math.max(0, Math.floor(building.z - building.depth / 2 - 5)),
    maxX: Math.min(world.cellsX, Math.ceil(building.x + building.width / 2 + 5)),
    maxZ: Math.min(world.cellsZ, Math.ceil(building.z + building.depth / 2 + 5)) };
  return { before: foundationRevision(world), bounds, topology: topology(world, bounds) };
};

export const finishFoundationChange = (world: WorldData,
  receipt: ReturnType<typeof beginFoundationChange> & { depths?: number[] }) => {
  const after = foundationRevision(world);
  if (same(receipt.before, after)) return;
  const current = topology(world, receipt.bounds);
  const currentDepths = receipt.depths && depths(world, receipt.bounds);
  const log = changes.get(world) ?? [];
  log.push({ after, before: receipt.before, bounds: receipt.bounds,
    topologyStable: current.length === receipt.topology.length &&
      current.every((value, index) => value === receipt.topology[index]) &&
      (!currentDepths || currentDepths.every((value, index) => value === receipt.depths![index])) });
  if (log.length > 64) log.shift();
  changes.set(world, log);
};

/** Unknown/editor revisions or a changed coastline deliberately fall back to complete validation. */
export const localFoundationChanges = (world: WorldData, before: Revision): FoundationBounds[] | null => {
  const after = foundationRevision(world);
  if (same(before, after)) return [];
  const log = changes.get(world) ?? [], first = log.findIndex(change => same(change.before, before));
  if (first < 0) return null;
  const bounds: FoundationBounds[] = [];
  let cursor = before;
  for (const change of log.slice(first)) {
    if (!same(change.before, cursor) || !change.topologyStable) return null;
    bounds.push(change.bounds); cursor = change.after;
    if (same(cursor, after)) return bounds;
  }
  return null;
};
