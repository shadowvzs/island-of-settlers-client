import { ROAD_SPEED, SAWMILL_RECIPES } from "@shared/catalog/balance";

import { ROAD_TIERS } from "../../../src/shared/settlement/road-types";
import { COLONY_RESOURCE_TIERS } from "../../../src/shared/world/colony-resource-tiers";
import type { WorldData } from "../../../src/shared/world/world-data";

/** Obligations are never fixtures: these records do not fabricate a historical save. */
export const progressionRequirements = () => ({
  sawmill: SAWMILL_RECIPES.map((recipe, index) => ({ ...recipe, level: index + 1,
    required: "Three source-attributed deliveries, manual next-cycle selection and sequential paid builder upgrades" })),
  roads: ROAD_TIERS.map(tier => ({ tier, speed: ROAD_SPEED[tier], carts: tier !== "dirt",
    required: "Actual UI sequential upgrade, loaded cart traversal, cost ledger, restore and visual review" })),
  colonyPairs: COLONY_RESOURCE_TIERS.map(pair => ({ ...pair,
    fixtureStatus: "uncaptured", required: "Finite discovered/conquered island checkpoint with real paired sources and logistics" })),
  legacy: { status: "uncaptured", required: "Authentic pre-change saves with pending upgrades, legacy sawmills and mixed roads; never reconstructed as historical proof" }
});

export const describeProgressionCheckpoint = (world: WorldData, settlement: {
  buildings: readonly { uid: number; typeId: number; workshopUpgrade?: { level: number }; selectedOutput?: string }[];
  roads?: readonly { tier: string }[];
}) => ({
  schema: 1,
  resourceTier: world.colonyResourceTier ?? null,
  deposits: (world.colonyStoneDeposits ?? world.scenario?.marbleDeposits ?? []).map(source => ({
    id: source.id, material: source.material ?? "marble", remaining: source.remaining, sourceProp: source.sourceProp ?? null
  })),
  sawmills: settlement.buildings.filter(building => building.typeId === 33).map(building => ({
    uid: building.uid, displayedLevel: 1 + (building.workshopUpgrade?.level ?? 0), selectedOutput: building.selectedOutput ?? "planks"
  })),
  roads: Object.fromEntries(ROAD_TIERS.map(tier => [tier, settlement.roads?.filter(road => road.tier === tier).length ?? 0])),
  provenance: "Describes only this exported checkpoint; does not establish prior recruitment, paid upgrades or legacy history"
});
