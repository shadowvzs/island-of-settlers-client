import type {
  BuildingGeometry, BuildingNavigationLevel, BuildingStockNavigation, StockSlotPlacement
} from "@shared/catalog";
import { encodeNavigationVolume } from "@shared/catalog/building-data/navigation";

import type { WorkerNation } from "../workers/worker-nation";
import type { BuildingDefinition } from "./building-catalog";
import { createBuildingLogisticsAnchors } from "./building-logistics-anchors";
import { buildingPartNavigationVolumes, getBuildingNavigationProfile } from "./building-navigation-profile";
import type { BuildingNavigationVolume } from "./building-navigation-types";
import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { getRomanBuildingWorldSizing } from "./building-world-sizing";
import type { BuildingLevel } from "./levels/building-level";
import { DEFAULT_ROMAN_DOOR } from "./roman-door-profile";
import { getRomanWareStockSlots, isCanonicalRomanWareStock, type RomanWareStockSlot } from "./roman-ware-stock";

/**
 * Recipe-evaluated gameplay geometry (content catalog plan §10.3): the source of `npm run building-geometry` and of
 * the permanent contract test, never of the game. The game reads the stored sidecars
 * (`@shared/catalog/building-data/geometry`).
 */
const point = (value: readonly number[]) => [value[0]!, value[1]!, value[2]!] as Point3;
const scaled = (value: readonly number[], scale: number) => point(value.map(axis => axis * scale));

/** The nation-independent placement contract of one building (the Roman High recipe, as placement uses it). */
export const computeBuildingGeometry = (definition: BuildingDefinition): BuildingGeometry => {
  const sizing = getRomanBuildingWorldSizing(definition);
  const { recipe, scale } = sizing;
  const dimensions = recipe.doorDimensions ?? DEFAULT_ROMAN_DOOR;
  const logistics = createBuildingLogisticsAnchors(recipe, sizing.cells, scale);
  return {
    plot: { cells: [sizing.cells[0], sizing.cells[1]], scale },
    door: { height: dimensions.height, hinge: point(recipe.door), profile: recipe.doorProfile,
      spring: dimensions.spring, width: dimensions.width },
    entrance: sizing.entrance.map(({ max, min }) => ({ max: point(max), min: point(min) })),
    ground: definition.style === "mine" ? "mine" : "building",
    logistics: { carrierApproach: logistics.carrierApproach, carrierHandoff: logistics.carrierHandoff,
      carrierQueue: logistics.carrierQueue, doorThreshold: logistics.doorThreshold,
      roadConnection: logistics.roadConnection, workerApproach: logistics.workerApproach,
      workerExit: logistics.workerExit },
    mechanism: point(recipe.mechanism),
    ...(recipe.modelOriginOffset ? { modelOriginOffset: point(recipe.modelOriginOffset) } : {}),
    overhead: sizing.overhead.map(({ center, halfDepth, radius }) => ({ center: point(center), halfDepth, radius })),
    workerExit: scaled(recipe.workerExit, scale)
  };
};

const encode = (volume: BuildingNavigationVolume) => encodeNavigationVolume({
  ...(volume.id === undefined ? {} : { id: volume.id }),
  max: point(volume.max), min: point(volume.min),
  ...(volume.shape === undefined ? {} : { shape: volume.shape }),
  ...(volume.yaw === undefined ? {} : { yaw: volume.yaw })
});

const kindOf = (stock: NonNullable<BuildingPart["stock"]>): "input" | "output" =>
  stock.kind === "input" ? "input" : "output";

const placementOf = (slot: RomanWareStockSlot): StockSlotPlacement => ({
  bottom: slot.bottom, center: point(slot.center), horizontalSpan: [slot.horizontalSpan[0], slot.horizontalSpan[1]],
  ...(slot.support ? { support: placementOf(slot.support) } : {}), yaw: slot.yaw
});

/**
 * Stock displays as `getRomanWareStockInventoryParts` seats them for live counts: fixed (non-canonical) stock solids
 * in recipe order, then every canonical slot's placement after bay packing (its ware model is seated at runtime).
 */
const computeStockNavigation = (recipe: BuildingRecipe, scale: number): BuildingStockNavigation => {
  const fixed = recipe.parts.filter(part => part.stock && !isCanonicalRomanWareStock(part.stock)).flatMap(part => {
    const stock = part.stock!;
    return buildingPartNavigationVolumes([part], scale).map(volume => ({
      kind: kindOf(stock), slot: stock.slot, volume: encode(volume), ware: stock.ware,
      ...(stock.wares ? { wares: [...stock.wares] } : {}) }));
  });
  const slots = getRomanWareStockSlots(recipe, scale).filter(slot => isCanonicalRomanWareStock(slot.stock))
    .map(slot => ({ ...placementOf(slot), kind: kindOf(slot.stock), slot: slot.stock.slot, ware: slot.stock.ware,
      ...(slot.stock.wares ? { wares: [...slot.stock.wares] } : {}) }));
  return { fixed, slots };
};

/** The finished building's public-navigation solids for one nation and level (High recipe, fitted grid units). */
export const computeBuildingNavigationLevel = (typeId: number, nation: WorkerNation, level: BuildingLevel):
  BuildingNavigationLevel => {
  const { interiors, obstacles, recipe, scale } = getBuildingNavigationProfile(typeId, nation, level);
  return { interiors: interiors.map(encode), obstacles: obstacles.map(encode),
    stock: computeStockNavigation(recipe, scale) };
};
