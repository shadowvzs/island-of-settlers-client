import { getRomanPartBounds, getRomanRecipeBounds } from "../buildings/building-recipe-fit";
import { getRomanBuildingWorldSizing } from "../buildings/building-world-sizing";
import type { BuildingLevel } from "../buildings/levels/building-level";
import type { WorkerNation } from "../workers/worker-unit";
import {
  type BirdBuilding,
  birdBuildingLevel,
  birdBuildingNation,
  birdModelKey,
  getBirdBuildingModel
} from "./bird-building-models";

export type { BirdBuilding } from "./bird-building-models";
export interface BirdBuildingBounds {
  uid: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  visited: number;
}
interface BoundsTemplate { width: number; depth: number; top: number; bottom: number }
const templates = new Map<number, BoundsTemplate>();

const createTemplate = (typeId: number, nation: WorkerNation, level: BuildingLevel): BoundsTemplate => {
  const { definition, recipes } = getBirdBuildingModel(typeId, nation, level);
  const sizing = getRomanBuildingWorldSizing(definition);
  let width = 0,
    depth = 0,
    top = 0,
    bottom = 0;
  for (const recipe of recipes) {
    const bounds = getRomanRecipeBounds(definition, recipe, false);
    width = Math.max(width, bounds.extentX);
    depth = Math.max(depth, bounds.extentZ);
    for (const part of recipe.parts) {
      const box = getRomanPartBounds(part);
      top = Math.max(top, box.max[1]);
      bottom = Math.min(bottom, box.min[1]);
    }
    top = Math.max(top, recipe.mechanism[1] + 0.65, (recipe.flagAnchor?.[1] ?? 0) + 0.5);
    for (const rotor of sizing.overhead) top = Math.max(top, rotor.center[1] + rotor.radius);
  }
  // Small sculpted-edge jitter is outside the nominal recipe boxes.
  return {
    width: width * sizing.scale + 0.08,
    depth: depth * sizing.scale + 0.08,
    top: top * sizing.scale,
    bottom: bottom * sizing.scale
  };
};

const templateFor = (typeId: number, nation: WorkerNation, level: BuildingLevel) => {
  const key = birdModelKey(typeId, nation, level);
  let template = templates.get(key);
  if (!template) {
    template = createTemplate(typeId, nation, level);
    templates.set(key, template);
  }
  return template;
};

/**
 * Both quality levels and the full moving sail sweep share the same flight reservation; the
 * model is the building's current level in the settlement's nation (cached per type, nation, level).
 */
export const getBirdBuildingBounds = (building: BirdBuilding): BirdBuildingBounds => {
  const template = templateFor(building.typeId, birdBuildingNation(building), birdBuildingLevel(building));
  const swapped = Math.abs(building.rotation % 2) === 1;
  const x = swapped ? template.depth : template.width,
    z = swapped ? template.width : template.depth;
  return {
    uid: building.uid,
    minX: building.x - x,
    maxX: building.x + x,
    minY: building.y + template.bottom,
    maxY: building.y + template.top,
    minZ: building.z - z,
    maxZ: building.z + z,
    visited: 0
  };
};
