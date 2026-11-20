import type { BuildingProgressionTier } from "@shared/catalog";
import { buildingRules } from "@shared/catalog/building-data/rules";

/**
 * Authored progression/architecture tiers captured before workyard expansion (2026-11-02), the rules sidecar's
 * `progressionTier`. These are independent of functional menu groups and of future plot dimensions.
 */
export type BuildingSizeTier = BuildingProgressionTier;
/** The progression tier of a building type; types without rules count as big. */
export const getBuildingProgressionTier = (typeId: number): BuildingSizeTier =>
  buildingRules(typeId)?.progressionTier ?? "big";

export const usesSmallBuildingArchitecture = (typeId: number) => getBuildingProgressionTier(typeId) === "small";
