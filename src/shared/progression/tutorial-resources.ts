import { DMath } from "../math/deterministic-math";
import { hasHomeFishingWater } from "../settlement/home-fishing-water";
import type { ResourceTarget, SettlementPoint } from "../settlement/settlement-types";
import { ORE, type WorldData } from "../world/world-data";
import type { TutorialResource } from "../quests/home-quest-types";

type ResourceTargets = (kind: ResourceTarget["kind"], near: SettlementPoint, range: number) =>
  ResourceTarget[] | undefined;

const DEPOSIT_ORES: Readonly<Record<"coal" | "gold" | "iron" | "ore", readonly number[]>> = {
  coal: [ORE.coal], gold: [ORE.gold], iron: [ORE.iron], ore: [ORE.coal, ORE.iron, ORE.gold]
};

/**
 * Whether the world lacks a tutorial step's natural resource: no deposit of that ore at all, or no
 * surface rock / huntable animal anywhere (an island without resource services reports nothing missing),
 * or no fishable water within a home fishery's reach. `countHuntable` answers for wildlife without
 * a hunter's scan (a UI check must not wake simulated wildlife regions).
 */
export const isTutorialResourceMissing = (
  resource: TutorialResource, world: WorldData, resourceTargets?: ResourceTargets, countHuntable?: () => number
) => {
  if (resource === "fish") return !hasHomeFishingWater(world);
  if (resource !== "rock" && resource !== "wildlife") {
    const ores = DEPOSIT_ORES[resource];
    return !(world.mineZones ?? []).some(zone => ores.includes(zone.ore));
  }
  if (resource === "wildlife" && countHuntable) return countHuntable() === 0;
  const kind = resource === "rock" ? "stone" : "wildlife";
  const found = resourceTargets?.(kind, world.start, DMath.hypot(world.cellsX, world.cellsZ));
  return found !== undefined && found.length === 0;
};
