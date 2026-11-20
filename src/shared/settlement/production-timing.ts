import { RESOURCE_TIERS } from "@shared/catalog/balance";

import { MATERIAL_TIER_TIME_STEP, PRODUCTION_SPEED_FACTOR } from "../balance/economy";
import { materialBuildingGroup } from "./advanced-material-production";

const MATERIAL_TIER_BY_WARE: ReadonlyMap<string, number> = new Map(RESOURCE_TIERS.flatMap(entry =>
  [entry.logs, entry.planks, entry.stone].map(ware => [ware, entry.tier] as const)));

/**
 * Building-material tier of a production cycle: the tier of its logs/planks/stone output
 * (RESOURCE_TIERS), else the tier of a specialist forester/woodcutter/quarry, else 0.
 */
export const productionMaterialTier = (typeId: number, output?: string) => {
  const outputTier = output === undefined ? undefined : MATERIAL_TIER_BY_WARE.get(output);
  return outputTier ?? materialBuildingGroup(typeId)?.tier ?? 0;
};

/** Real time per authored rule second: halved production times, +20% per material tier. */
export const productionTimeScale = (typeId: number, output?: string) =>
  (1 + MATERIAL_TIER_TIME_STEP * productionMaterialTier(typeId, output)) / PRODUCTION_SPEED_FACTOR;

/** Real seconds of a cycle authored as `seconds` (before upgrades and talents). */
export const effectiveProductionSeconds = (seconds: number, typeId: number, output?: string) =>
  seconds * productionTimeScale(typeId, output);
