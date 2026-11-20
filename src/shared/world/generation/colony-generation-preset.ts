import { STARTER_STOCK } from "@shared/catalog/balance";

import { getBuildingDefinition } from "../../../render-common/buildings/building-catalog";
import { type ColonyResourceTier,isColonyResourceTier } from "../colony-resource-tiers";
import { createMapScenario } from "../map-scenario";
import type { WorldData } from "../world-data";
import { populateColonyHardwood } from "./colony-hardwood";

/** Standalone authoring preset only; discovered expedition worlds apply their own committed pair. */
export const applyGeneratedColonyPreset = (world: WorldData, tier: ColonyResourceTier) => {
  if (!isColonyResourceTier(tier)) throw new RangeError("Unknown colony resource preset");
  world.expeditionKind = "colony"; world.colonyResourceTier = tier;
  populateColonyHardwood(world);
  const [width, depth] = getBuildingDefinition(0).gridFootprint;
  const snap = (value: number, size: number) => Math.round(value - size % 2 / 2) + size % 2 / 2;
  world.scenario = { ...createMapScenario(), kind: "colony", stock: { ...STARTER_STOCK },
    headquarters: { x: snap(world.start.x, width), z: snap(world.start.z, depth), rotation: 0 } };
  return world;
};
