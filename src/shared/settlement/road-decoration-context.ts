import { getBuildingDefinition } from "../../render-common/buildings/building-catalog";
import { getPlacedBuildingEntranceBounds, getPlacedBuildingOverheadBounds } from "../../render-common/buildings/building-model-clearance";
import { getBuildingNavigationProfile } from "../../render-common/buildings/building-navigation-profile";
import { getRomanPartBounds } from "../../render-common/buildings/building-recipe-fit";
import { buildingLevelOf } from "../../render-common/buildings/levels/building-level";
import { createNationBuildingRecipe } from "../../render-common/buildings/nation-building-recipe";
import { getTreeSpecies } from "../../render-common/props/island-trees";
import type { RoadDecorationBounds } from "../../render-common/road-decoration-clearance";
import { DMath } from "../math/deterministic-math";
import { sampleSmooth } from "../world/grid-geometry";
import { somePropNear } from "../world/prop-cell-index";
import { BLOCKING, PROP, PROP_REMOVED } from "../world/world-data";
import { boatJettyReservedAt } from "./harbour-boat-reservations";
import { createRoadDecorationFieldClearance } from "./road-decoration-fields";
import type { RoadDecorationPlacementContext } from "./road-decoration-placement";
import { createRoadDecorationPropClearance } from "./road-decoration-props";
import { createRoadDecorationRoadIndex } from "./road-decoration-road-index";
import { nearbyDecorationRoadYaw } from "./road-decoration-traffic";
import { buildingNation } from "./settlement-nation";
import { getPlacedTreeClearanceBox } from "./settlement-rotor-clearance";
import { ownsTerritoryPoint } from "./settlement-territory";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";

const overlaps = (a: RoadDecorationBounds, b: RoadDecorationBounds) =>
  [0, 1, 2].every(axis => a.min[axis]! < b.max[axis]! - .000001 && a.max[axis]! > b.min[axis]! + .000001);
const union = (volumes: readonly RoadDecorationBounds[]): RoadDecorationBounds => ({
  min: [0, 1, 2].map(axis => Math.min(...volumes.map(box => box.min[axis]!))) as [number, number, number],
  max: [0, 1, 2].map(axis => Math.max(...volumes.map(box => box.max[axis]!))) as [number, number, number]
});
const keys = (box: RoadDecorationBounds) => {
  const result: string[] = [];
  for (let z = Math.floor(box.min[2] / 4); z <= Math.floor(box.max[2] / 4); z++)
    for (let x = Math.floor(box.min[0] / 4); x <= Math.floor(box.max[0] / 4); x++) result.push(`${x}:${z}`);
  return result;
};

export interface RoadDecorationContextOptions {
  /** Props that never obstruct (editor authoring: ground decorations use centre spacing instead). */
  ignoreProp?: (kind: number) => boolean;
}

/** Real world adapter. Cached national High+Minimal solids include roofs, maximum stocks and door/rotor sweeps. */
export const createRoadDecorationContext = (context: SettlementContext,
  { ignoreProp }: RoadDecorationContextOptions = {}) => {
  const { world } = context.options;
  const props = createRoadDecorationPropClearance(world);
  const roadIndex = createRoadDecorationRoadIndex(context.options.roads);
  const fieldsOverlap = createRoadDecorationFieldClearance(context);
  const localModels = new Map<string, readonly RoadDecorationBounds[]>();
  let epoch = "", buckets = new Map<string, Set<SettlementBuilding>>();
  let boxes = new Map<SettlementBuilding, readonly RoadDecorationBounds[]>();
  const buildingBoxes = (building: SettlementBuilding) => {
    const nation = buildingNation(context, building) ?? "roman";
    const level = buildingLevelOf(building.workshopUpgrade?.level);
    const key = `${building.typeId}:${nation}:${level}:${building.rotation}`;
    let local = localModels.get(key);
    if (!local) {
      const profile = getBuildingNavigationProfile(building.typeId, nation, level), definition = getBuildingDefinition(building.typeId);
      const recipeParts = [...profile.recipe.parts, ...createNationBuildingRecipe(definition, nation, false, level).parts];
      local = recipeParts.map(part => {
        const source = getRomanPartBounds(part, building.rotation * Math.PI / 2), scale = profile.scale;
        const padding = part.stock ? .35 : .04;
        return { min: [source.min[0] * scale - padding, source.min[1] * scale, source.min[2] * scale - padding],
          max: [source.max[0] * scale + padding, source.max[1] * scale + (part.stock ? 1.2 : 0), source.max[2] * scale + padding] } satisfies RoadDecorationBounds;
      });
      localModels.set(key, local);
    }
    const result = local.map(box => ({ min: [box.min[0] + building.x, box.min[1] + building.y, box.min[2] + building.z],
      max: [box.max[0] + building.x, box.max[1] + building.y, box.max[2] + building.z] } as RoadDecorationBounds));
    result.push(...getPlacedBuildingEntranceBounds(building), ...getPlacedBuildingOverheadBounds(building));
    // Reserve the existing complete plot and dry door/porter approach, not only a currently empty stock mesh.
    result.push({ min: [building.x - building.width / 2, building.y, building.z - building.depth / 2],
      max: [building.x + building.width / 2, building.y + 2.1, building.z + building.depth / 2] });
    result.push({ min: [Math.min(building.access.x, building.doorThreshold.x) - .4, building.y,
      Math.min(building.access.z, building.doorThreshold.z) - .4],
    max: [Math.max(building.access.x, building.doorThreshold.x) + .4, building.y + 2.1,
      Math.max(building.access.z, building.doorThreshold.z) + .4] });
    return result;
  };
  const refresh = () => {
    const next = `${world.buildRevision ?? 0}:${context.buildings.length}:${context.playerNation ?? "roman"}`;
    if (epoch === next) return;
    epoch = next; buckets = new Map(); boxes = new Map();
    for (const building of context.buildings) {
      let solids: readonly RoadDecorationBounds[];
      if (building.bandit?.layout || building.eventCourtyard || !Number.isInteger(building.typeId))
        solids = [{ min: [building.x - building.width / 2, building.y, building.z - building.depth / 2],
          max: [building.x + building.width / 2, building.y + 8, building.z + building.depth / 2] }];
      else solids = buildingBoxes(building);
      boxes.set(building, solids);
      for (const key of keys(union(solids))) {
        const list = buckets.get(key) ?? new Set<SettlementBuilding>(); list.add(building); buckets.set(key, list);
      }
    }
  };
  const isFree = (bounds: RoadDecorationBounds) => {
    if (props.rocksOverlap(bounds) || fieldsOverlap(bounds)) return false;
    refresh();
    const seen = new Set<SettlementBuilding>();
    for (const key of keys(bounds)) for (const building of buckets.get(key) ?? []) {
      if (seen.has(building)) continue; seen.add(building);
      if (boxes.get(building)!.some(box => overlaps(box, bounds))) return false;
    }
    const centreX = (bounds.min[0] + bounds.max[0]) / 2, centreZ = (bounds.min[2] + bounds.max[2]) / 2;
    const reach = DMath.hypot(bounds.max[0] - centreX, bounds.max[2] - centreZ) + 10;
    return !somePropNear(world, centreX, centreZ, reach, id => {
      const kind = world.props.types[id]!; if (kind === PROP_REMOVED || ignoreProp?.(kind)) return false;
      if (getTreeSpecies(kind) !== undefined) return overlaps(getPlacedTreeClearanceBox(world, id), bounds);
      if (kind !== PROP.largeRock && kind !== PROP.smallRock) return props.plantsOverlap(id, bounds);
      const scale = world.props.scale[id] ?? 1, radius = (kind === PROP.largeRock ? 1.55 : .5) * scale;
      const x = world.props.x[id]!, z = world.props.z[id]!, y = world.props.y[id] ?? sampleSmooth(world, world.heights, x, z);
      return overlaps({ min: [x - radius, y, z - radius], max: [x + radius, y + radius * 2, z + radius] }, bounds);
    });
  };
  const create = (): RoadDecorationPlacementContext => ({
    nation: context.playerNation ?? "roman", roads: [], roadsNear: bounds => roadIndex.near(bounds),
    heightAt: (x, z) => {
      if (x < 0 || z < 0 || x >= world.cellsX || z >= world.cellsZ) return Number.NaN;
      const block = world.blocking[Math.floor(z) * world.cellsX + Math.floor(x)];
      return block === BLOCKING.water || block === BLOCKING.cliff ? Number.NaN : sampleSmooth(world, world.heights, x, z);
    }, isOwned: point => ownsTerritoryPoint(context, point), isFree,
    canPlaceGround: point => {
      const cell = Math.floor(point.z) * world.cellsX + Math.floor(point.x);
      if (world.blocking[cell] !== BLOCKING.free || boatJettyReservedAt(context, point, 1.2)) return false;
      return true;
    }
  });
  return { create, invalidate: () => { epoch = ""; }, isFree, buildingBoxes,
    roadYaw: (point: { x: number; z: number }) => nearbyDecorationRoadYaw(point,
      roadIndex.near({ min: [point.x, 0, point.z], max: [point.x, 0, point.z] })) };
};
