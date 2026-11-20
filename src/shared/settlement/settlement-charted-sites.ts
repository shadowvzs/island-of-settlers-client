import { getBuildingDefinition } from "../../render-common/buildings/building-catalog";
import { getPlacedBuildingLogistics } from "../../render-common/buildings/building-grid-metrics";
import { FOG, type WorldData } from "../world/world-data";
import { isSaveInteger, isSaveObject, isSavePoint } from "./save-validation";
import type { SettlementPoint } from "./settlement-types";

/** Whether the map exposes the whole world as known, or needs real scout/sight observations. */
export type ExplorationMode = "fog" | "revealed";
export const MAX_CHARTED_SITES = 512;
const HARBOUR_TYPE = 39;

export interface ChartedSiteMap {
  seed: number;
  cellsX: number;
  cellsZ: number;
}
/** A player-specific remembered harbour site; usability is checked separately on every use. */
export interface ChartedSite {
  x: number;
  z: number;
  map: ChartedSiteMap;
  rotation: number;
  rotations: number[];
  water: SettlementPoint;
  /** Terrain revision its geometry proof was last confirmed against. */
  geometryRevision: number;
}
export interface ChartedSitesSave {
  mode: ExplorationMode;
  sites: ChartedSite[];
}

export const chartedSiteMapFor = (world: WorldData): ChartedSiteMap => ({
  cellsX: world.cellsX, cellsZ: world.cellsZ, seed: world.seed
});

export const chartedSiteMatchesMap = (site: ChartedSite, world: WorldData) =>
  site.map.seed === world.seed && site.map.cellsX === world.cellsX && site.map.cellsZ === world.cellsZ;

export const cloneChartedSite = (site: ChartedSite): ChartedSite => ({
  ...site, map: { ...site.map }, rotations: site.rotations.slice(), water: { ...site.water }
});

/** The footprint of a harbour at this location and rotation (rotation is normalised). */
export const chartedSiteFootprintCells = (world: WorldData, site: Pick<ChartedSite, "x" | "z" | "rotation">) => {
  const definition = getBuildingDefinition(HARBOUR_TYPE);
  const turns = ((Math.round(site.rotation) % 4) + 4) % 4;
  const width = turns % 2 ? definition.gridFootprint[1] : definition.gridFootprint[0];
  const depth = turns % 2 ? definition.gridFootprint[0] : definition.gridFootprint[1];
  const left = site.x - width / 2, top = site.z - depth / 2;
  const cells: number[] = [];
  for (let z = top; z < top + depth; z++)
    for (let x = left; x < left + width; x++)
      if (x >= 0 && z >= 0 && x < world.cellsX && z < world.cellsZ) cells.push(z * world.cellsX + x);
  return cells;
};

/** Cells that must be genuinely observed before a location can be charted. */
const chartedSiteSightCells = (world: WorldData, site: ChartedSite) => {
  const cells = new Set<number>(chartedSiteFootprintCells(world, site));
  const logistics = getPlacedBuildingLogistics(HARBOUR_TYPE, site.x, site.z, site.rotation);
  const accessX = Math.floor(logistics.road.x), accessZ = Math.floor(logistics.road.z);
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++) {
      const x = accessX + dx, z = accessZ + dz;
      if (x >= 0 && z >= 0 && x < world.cellsX && z < world.cellsZ) cells.add(z * world.cellsX + x);
    }
  const waterX = Math.floor(site.water.x), waterZ = Math.floor(site.water.z);
  if (waterX >= 0 && waterZ >= 0 && waterX < world.cellsX && waterZ < world.cellsZ)
    cells.add(waterZ * world.cellsX + waterX);
  return [...cells];
};

/** True when the footprint, entrance and landing water are known from real sight (not presentation fog). */
export const chartedSiteObserved = (world: WorldData, site: ChartedSite) => {
  if (!world.fog) return false;
  return chartedSiteSightCells(world, site).every(cell => world.fog[cell] !== FOG.hidden);
};

const validMap = (value: unknown, world: Pick<WorldData, "seed" | "cellsX" | "cellsZ">) =>
  isSaveObject(value) && value.seed === world.seed && value.cellsX === world.cellsX && value.cellsZ === world.cellsZ;

/** Optional additive v1 field; absent means no records yet (their current sight is derived separately). */
export const validChartedSitesSave = (value: unknown, world: Pick<WorldData, "seed" | "cellsX" | "cellsZ">) => {
  if (value === undefined) return null;
  if (!isSaveObject(value) || (value.mode !== "fog" && value.mode !== "revealed") ||
    !Array.isArray(value.sites) || value.sites.length > MAX_CHARTED_SITES)
    return "Invalid charted site records";
  const keys = new Set<string>();
  for (const site of value.sites) {
    if (!isSaveObject(site) || !validMap(site.map, world) ||
      !isSaveInteger(site.x) || !isSaveInteger(site.z) ||
      site.x < 0 || site.z < 0 || site.x >= world.cellsX || site.z >= world.cellsZ ||
      !isSaveInteger(site.rotation) || site.rotation < 0 || site.rotation > 3 ||
      !Array.isArray(site.rotations) || site.rotations.length < 1 || site.rotations.length > 4 ||
      !site.rotations.every(rotation => isSaveInteger(rotation) && rotation >= 0 && rotation <= 3) ||
      new Set(site.rotations).size !== site.rotations.length || !site.rotations.includes(site.rotation) ||
      !isSavePoint(site.water) || site.water.x < 0 || site.water.z < 0 ||
      site.water.x >= world.cellsX || site.water.z >= world.cellsZ ||
      !isSaveInteger(site.geometryRevision) || site.geometryRevision < 0)
      return "Invalid charted site records";
    const key = `${String(site.x)}:${String(site.z)}`;
    if (keys.has(key)) return "Duplicate charted site records";
    keys.add(key);
  }
  return null;
};
