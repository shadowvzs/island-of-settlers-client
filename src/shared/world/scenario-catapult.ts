import { CATAPULT_AMMO_CAPACITY, CATAPULT_ROOF_CAPACITY } from "../settlement/military-catapult-ammo";

export type HostileCatapultVariant = "bandit" | "pirate";
export interface ScenarioCatapult {
  variant: HostileCatapultVariant;
  /** A finite initial grant, including the roof and the downstairs reserve together. */
  stones: number;
  /** Omitted maps use the canonical roof-first initial allocation. */
  roofStones?: number;
}

export const isHostileCatapultVariant = (value: unknown): value is HostileCatapultVariant =>
  value === "bandit" || value === "pirate";

/** No silent infinite reserve or ignored Catapult settings on another building type. */
export const validScenarioCatapult = (entry: {
  bandit?: unknown; catapult?: unknown; enclosure?: unknown; type: unknown
}) => {
  if (entry.type !== 16) return entry.catapult === undefined;
  if (!entry.catapult || typeof entry.catapult !== "object" || entry.bandit !== undefined ||
    entry.enclosure !== undefined) return false;
  const { roofStones, stones, variant } = entry.catapult as ScenarioCatapult;
  return isHostileCatapultVariant(variant) && Number.isSafeInteger(stones) && stones >= 0 &&
    stones <= CATAPULT_AMMO_CAPACITY && (roofStones === undefined ||
      (Number.isSafeInteger(roofStones) && roofStones >= 0 && roofStones <= Math.min(stones, CATAPULT_ROOF_CAPACITY)));
};
