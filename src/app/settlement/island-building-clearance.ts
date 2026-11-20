import { groundCoverCellsForVolumes } from "../../render-common/buildings/building-ground-cover";
import { buildingPartNavigationVolumes, getBuildingNavigationProfile } from "../../render-common/buildings/building-navigation-profile";
import { getBuildingTerrainBase } from "../../render-common/buildings/building-terrain-base";
import { buildingLevelOf } from "../../render-common/buildings/levels/building-level";
import { refreshCanopyField } from "../../render-common/canopy-field";
import type { CritterManager } from "../../render-common/critters/critter-manager";
import { refreshMineVertexField } from "../../render-common/mine-field";
import type { TerrainRenderer } from "../../render-common/renderer-contract";
import { listRegionChunks } from "../../render-common/terrain-chunks";
import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { createBuildingPlotMask } from "../../shared/settlement/settlement-plot-clearance";
import { paintBuildingPlotDirt } from "../../shared/settlement/settlement-plot-ground";
import type { SettlementBuilding, SettlementOptions } from "../../shared/settlement/settlement-types";
import { refreshBuildClassAround } from "../../shared/world/build-class";
import { refreshWalkCost } from "../../shared/world/editing/build-refresh";
import { PLANT_PROPS, TREE_PROPS } from "../../shared/world/editing/prop-removal";
import { isBlockingProp } from "../../shared/world/generation/gameplay";
import type { CellRegion } from "../../shared/world/grid-geometry";
import { markWorldCellChanged } from "../../shared/world/save/world-change-journal";
import type { WorldData } from "../../shared/world/world-data";
import { BLOCKING, PROP_REMOVED } from "../../shared/world/world-data";
import type { createIslandAnimals } from "../island-animals";
import type { createIslandFelling } from "../island-felling";
import type { createIslandGrowth } from "../island-growth";

/** The living island the settlement's hooks change: terrain, forest, wildlife and their renderer. */
export interface IslandHooksOptions {
  world: WorldData;
  renderer: TerrainRenderer;
  animals: ReturnType<typeof createIslandAnimals>;
  felling: ReturnType<typeof createIslandFelling>;
  growth: ReturnType<typeof createIslandGrowth>;
  critters?: CritterManager;
  /** The recipe nation used by the current settlement; defaults to Roman for fixtures. */
  playerNation?: WorkerNation;
}

/**
 * Cells under actual building solids (rooms, walls, props, stock supports and grounded national
 * ornaments), not the whole reserved plot. Empty exterior yard pockets keep their grass;
 * placement/wildlife reservation stays on the full plot mask.
 */
export const buildingGroundCoverCells = (building: SettlementBuilding, nation: WorkerNation, world: WorldData) => {
  if (!Number.isInteger(building.typeId) || building.bandit !== undefined || building.eventCourtyard)
    return [];
  // Plan once for every level: later upgrade props must never grow through restored grass, and
  // the renderer currently has no per-level ground-cover callback.
  const volumes = [0, 1, 2, 3, 4].flatMap(level => {
    const profile = getBuildingNavigationProfile(building.typeId, nation, buildingLevelOf(level));
    return [
      ...profile.interiors,
      ...profile.obstacles,
      ...buildingPartNavigationVolumes(profile.recipe.parts.filter(part => part.stock), profile.scale),
      ...buildingPartNavigationVolumes(profile.recipe.parts.filter(part => part.yardDecoration), profile.scale, true)
    ];
  });
  if (!volumes.length) return [];
  return groundCoverCellsForVolumes(volumes,
    { rotation: building.rotation, x: building.x, z: building.z }, world.cellsX, world.cellsZ);
};

const buildingPlotRegion = (building: SettlementBuilding): CellRegion => ({
  maxX: building.x + building.width / 2 - 1,
  maxZ: building.z + building.depth / 2 - 1,
  minX: building.x - building.width / 2,
  minZ: building.z - building.depth / 2
});

/** The rebuild region of a cover cell list; props may overhang the nominal building plot. */
const coverCellsRegion = (cells: readonly number[], cellsX: number): CellRegion => {
  let maxX = -Infinity, maxZ = -Infinity, minX = Infinity, minZ = Infinity;
  for (const cell of cells) {
    const x = cell % cellsX, z = Math.floor(cell / cellsX);
    maxX = Math.max(maxX, x);
    maxZ = Math.max(maxZ, z);
    minX = Math.min(minX, x);
    minZ = Math.min(minZ, z);
  }
  return { maxX, maxZ, minX, minZ };
};

const mergeRegions = (a: CellRegion, b: CellRegion): CellRegion => ({
  maxX: Math.max(a.maxX, b.maxX),
  maxZ: Math.max(a.maxZ, b.maxZ),
  minX: Math.min(a.minX, b.minX),
  minZ: Math.min(a.minZ, b.minZ)
});

/** Plans clear and level their footprint immediately, relocating nearby wildlife. */
export const createIslandBuildingClearance = (options: IslandHooksOptions) => {
  const { animals, felling, growth, renderer, world } = options;
  const plots = createBuildingPlotMask(world.cellsX, world.cellsZ);
  animals.manager.setExcluded(plots.contains);
  options.critters?.setExcluded(plots.contains);
  const firstPlacedProp=world.props.count;
  const planned:NonNullable<SettlementOptions["onBuildingPlanned"]> = (building, removed) => {
    plots.add(building);
    const base = getBuildingTerrainBase(building.typeId, building.x, building.z, building.rotation);
    if (base) paintBuildingPlotDirt(world, base);
    const plotRegion = buildingPlotRegion(building);
    const coverCells = buildingGroundCoverCells(building, options.playerNation ?? "roman", world);
    if (renderer.mapEdit?.reserveBuildingGroundCover && coverCells.length)
      renderer.mapEdit.reserveBuildingGroundCover(building.uid, coverCells,
        mergeRegions(plotRegion, coverCellsRegion(coverCells, world.cellsX)));
    else renderer.mapEdit?.reserveConstructionGround?.(plotRegion);
    animals.manager.touchArea(plotRegion);
    animals.manager.relocateFrom(plots.contains);
    options.critters?.relocateFrom(plots.contains);
    growth.remove(removed);
    felling.removeTrees(removed, false);
    const region = {
      minX: Math.max(0, building.x - building.width / 2 - 4),
      minZ: Math.max(0, building.z - building.depth / 2 - 4),
      maxX: Math.min(world.cellsX - 1, building.x + building.width / 2 + 4),
      maxZ: Math.min(world.cellsZ - 1, building.z + building.depth / 2 + 4)
    };
    refreshCanopyField(world, region);
    renderer.mapEdit?.removeProps(removed, region);
    // Planted/editor trees live in a separate mesh layer from original world props.
    renderer.mapEdit?.refreshPlacedProps(firstPlacedProp);
    renderer.mapEdit?.previewRegion(listRegionChunks(world, region), false);
    animals.manager.refreshHomes(region, { added: [], removed });
  };
  const demolish:NonNullable<SettlementOptions["onBuildingDemolished"]> = building => {
    plots.remove(building);
    const restored:number[]=[];
    for(const {index,type} of building.clearedProps ?? []) {
      if(!PLANT_PROPS.has(type) || TREE_PROPS.has(type) || world.props.types[index]!==PROP_REMOVED) continue;
      const x=world.props.x[index]!,z=world.props.z[index]!,cx=Math.floor(x),cz=Math.floor(z);
      const cell=cz*world.cellsX+cx;
      if(plots.contains(x,z) || world.blocking[cell]!==BLOCKING.free)continue;
      world.props.types[index]=type;restored.push(index);
      if(isBlockingProp(type)){world.blocking[cell]=BLOCKING.prop;markWorldCellChanged(world,cell);}
      refreshBuildClassAround(world,cx,cz);
      refreshWalkCost(world,{minX:cx,maxX:cx,minZ:cz,maxZ:cz});
    }
    const region={minX:building.x-building.width/2,minZ:building.z-building.depth/2,
      maxX:building.x+building.width/2-1,maxZ:building.z+building.depth/2-1};
    if (renderer.mapEdit?.releaseBuildingGroundCover)
      renderer.mapEdit.releaseBuildingGroundCover(building.uid, region);
    else renderer.mapEdit?.releaseConstructionGround?.(region);
    renderer.mapEdit?.refreshPlacedProps(firstPlacedProp);
    refreshCanopyField(world,region);
    renderer.mapEdit?.refreshChunks(listRegionChunks(world,region),false);
    animals.manager.touchArea(region);
    animals.manager.refreshHomes(region,{added:restored,removed:[]});
  };
  const roadLevelled: NonNullable<SettlementOptions["onRoadGroundLeveled"]> = region => {
    renderer.mapEdit?.refreshRockClearance?.();
    refreshMineVertexField(world, region);
    renderer.mapEdit?.previewRegion(listRegionChunks(world, region), false);
    renderer.mapEdit?.refreshFieldCover(region);
    animals.manager.refreshHomes(region, { added: [], removed: [] });
  };
  const levelled: NonNullable<SettlementOptions["onFoundationLeveled"]> = (_building, region) => roadLevelled(region);
  // A load keeps the saved animals where they are: the plots only exclude them again, as continuous play does
  // (snapshot fidelity, D3). Restored buildings were never planned in this renderer, so register their
  // physical ground cover now or grass grows through their saved stock and yard props.
  const restored: NonNullable<SettlementOptions["onBuildingsRestored"]> = buildings => {
    plots.reset(buildings);
    const nation = options.playerNation ?? "roman";
    const entries = buildings.flatMap(building => {
      const cells = buildingGroundCoverCells(building, nation, world);
      if (!cells.length) return [];
      return [{
        cells,
        region: mergeRegions(buildingPlotRegion(building), coverCellsRegion(cells, world.cellsX)),
        uid: building.uid
      }];
    });
    if (!entries.length) return;
    if (renderer.mapEdit?.reserveBuildingGroundCovers)
      renderer.mapEdit.reserveBuildingGroundCovers(entries);
    else for (const entry of entries)
      renderer.mapEdit?.reserveBuildingGroundCover?.(entry.uid, entry.cells, entry.region);
  };
  return Object.assign(planned, { demolish, levelled, restored, roadLevelled });
};
