import type { CampaignSoldierType } from "../../../../island-of-settlers-shared/src/campaign/campaign-model";
import type {
  CampaignReadyContext
} from "../../../../island-of-settlers-shared/src/campaign/campaign-ready-context";
import {
  type MapRegion, rasterizeRegion
} from "../../../../island-of-settlers-shared/src/campaign/campaign-regions";
import { BUILDING_CATALOG } from "../../render-common/buildings/building-catalog";
import { WARE_IDS } from "../../render-common/wares/ware-catalog";
import { MAX_BUILDING_LEVEL } from "../balance/building-levels";
import { hasBuildingLevels } from "../settlement/building-levels";
import { HARBOUR_TYPE_ID, TAVERN_TYPE_ID } from "../settlement/building-type-ids";
import { reachableCells } from "../settlement/settlement-colony";
import { createScenarioInspectionContext } from "../settlement/settlement-map-scenario";
import { makeBuilding } from "../settlement/settlement-placement";
import { TAVERN_TROOPS } from "../settlement/tavern-rules";
import type { MapScenario } from "../world/map-scenario";
import type { WorldData } from "../world/world-data";
import { CAMPAIGN_SHIP_CAPACITY } from "./constants";

/** Editor/repository knowledge the game catalog cannot supply. */
export type CampaignMapContextOptions = Pick<CampaignReadyContext, "imageIds"> &
  Partial<Pick<CampaignReadyContext,
    "actorIds" | "languages" | "musicTrackIds" | "namedActorIds" | "soundCueIds" | "speakers">>;

/** Every catalog type with its highest level: 5 for upgradeable types, otherwise 1. */
const CATALOG_MAX_LEVELS: ReadonlyMap<number, number> = new Map(BUILDING_CATALOG.map(entry =>
  [entry.id, hasBuildingLevels(entry.id) ? MAX_BUILDING_LEVEL : 1]));
/** The Tavern recruits every ordinary troop type (cavalry is retired). */
const tavernSources = (type: CampaignSoldierType): readonly number[] =>
  (TAVERN_TROOPS as readonly string[]).includes(type) ? [TAVERN_TYPE_ID] : [];
const SOLDIER_SOURCES: CampaignReadyContext["soldierSources"] =
  { archer: tavernSources("archer"), heavy: tavernSources("heavy"), shield: tavernSources("shield") };

/**
 * "Region reachable" = one of its cells joins the landing harbour's access by walkable, unoccupied land: one flood
 * fill on first use, then a lookup per cell.
 */
const regionReachability = (world: WorldData, plot: NonNullable<MapScenario["harbourPlot"]>) => {
  let reachable: ((point: { x: number; z: number }) => boolean) | undefined;
  return (region: MapRegion) => {
    if (!reachable) {
      const context = createScenarioInspectionContext(world);
      reachable = reachableCells(context, makeBuilding(context, HARBOUR_TYPE_ID, plot.x, plot.z, plot.rotation).access);
    }
    const isReachable = reachable;
    return rasterizeRegion(region, world.cellsX, world.cellsZ).some(cell =>
      isReachable({ x: cell % world.cellsX + 0.5, z: Math.floor(cell / world.cellsX) + 0.5 }));
  };
};

/**
 * The Ready context of a campaign map (C1 `validateCampaignMapReady`) built from the client catalog and the map
 * file: building levels, soldier sources, wares, ship capacity, the map file's authored buildings, its bounds and
 * the region reachability check (only with a landing harbour; its absence is a map-file error of its own).
 */
export const createCampaignMapContext = (world: WorldData, options: CampaignMapContextOptions): CampaignReadyContext => {
  const plot = world.scenario?.harbourPlot;
  return {
    ...options,
    buildingMaxLevels: CATALOG_MAX_LEVELS,
    isRegionReachable: plot && regionReachability(world, plot),
    mapBounds: { cellsX: world.cellsX, cellsZ: world.cellsZ },
    scenarioBuildings: new Map((world.scenario?.buildings ?? []).map(entry => [entry.id, entry.type])),
    shipCapacity: CAMPAIGN_SHIP_CAPACITY,
    soldierSources: SOLDIER_SOURCES,
    wares: new Set(WARE_IDS)
  };
};
