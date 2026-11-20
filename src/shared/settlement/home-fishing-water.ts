import { TERRITORY_RADII } from "../balance/territory";
import { DMath } from "../math/deterministic-math";
import { floodStartLand } from "../world/generation/home-resources";
import type { WorldData } from "../world/world-data";
import { fishingSites } from "./settlement-fishing";
import { createScenarioInspectionContext } from "./settlement-map-scenario";
import { resourceWorkRadius } from "./settlement-work-ranges";

/** A fishery inside the HQ territory casts this far from the HQ at most. */
const HOME_FISHING_REACH = TERRITORY_RADII[0]! + resourceWorkRadius("fish");

const knownFishingWater = new WeakMap<WorldData, boolean>();

/** First legal shore/cast pair (the fisher's own rules) whose shore stand is on the start's land. */
const findHomeFishingWater = (world: WorldData) => {
  const { cellsX, cellsZ, start } = world;
  const land = floodStartLand(world), context = createScenarioInspectionContext(world);
  const reach = HOME_FISHING_REACH;
  for (let z = Math.max(0, Math.floor(start.z - reach)); z < Math.min(cellsZ, start.z + reach); z++)
    for (let x = Math.max(0, Math.floor(start.x - reach)); x < Math.min(cellsX, start.x + reach); x++) {
      if (DMath.hypot(x + .5 - start.x, z + .5 - start.z) > reach) continue;
      const target = { id: z * cellsX + x, kind: "fish" as const, x: x + .5, z: z + .5 };
      const onHomeLand = fishingSites(context, target).some(({ approach }) =>
        approach !== undefined && land[Math.floor(approach.z) * cellsX + Math.floor(approach.x)] === 1);
      if (onHomeLand) return true;
    }
  return false;
};

/**
 * Whether a fishery in the home territory can reach fishable water: open water past the shore
 * foam with a clear, dry shore stand connected to the HQ (cached per world).
 */
export const hasHomeFishingWater = (world: WorldData) => {
  const known = knownFishingWater.get(world);
  if (known !== undefined) return known;
  const found = findHomeFishingWater(world);
  knownFishingWater.set(world, found);
  return found;
};
