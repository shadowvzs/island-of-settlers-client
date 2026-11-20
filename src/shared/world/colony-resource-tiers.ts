import type { ResourceTier } from "@shared/catalog";
import { RESOURCE_TIER_MINIMUM_LEVEL, RESOURCE_TIERS } from "@shared/catalog/balance";

import { createRandom, deriveSeed } from "./rng";
import { PROP } from "./world-data";

export type { ResourceTier };
export type ColonyResourceTier = 1 | 2 | 3 | 4;
export type ColonyStone = "marble" | "limestone" | "basalt" | "granite";
export type ColonyWood = "hardwood" | "cedar" | "walnut" | "mahogany";
export interface ColonyResourcePair {
  stone: ColonyStone;
  tier: ColonyResourceTier;
  treeKind: number;
  wood: ColonyWood;
}
/** The tree each colony wood grows from. */
const COLONY_TREE_KINDS: Readonly<Record<string, number>> = {
  cedar: PROP.cedarTree, hardwood: PROP.hardwoodTree, mahogany: PROP.mahoganyTree, walnut: PROP.walnutTree
};
/** The colony material tiers 1..4 (shared balance tiers) with the tree their wood grows from. */
export const COLONY_RESOURCE_TIERS: readonly ColonyResourcePair[] = Object.freeze(RESOURCE_TIERS
  .filter(pair => pair.tier > 0).map(({ stone, tier, wood }) => Object.freeze({
    stone: stone as ColonyStone, tier: tier as ColonyResourceTier, treeKind: COLONY_TREE_KINDS[wood]!, wood: wood as ColonyWood
  })));

export const isColonyResourceTier = (value: unknown): value is ColonyResourceTier =>
  Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 4;
export const colonyResourcePair = (tier: ColonyResourceTier) => COLONY_RESOURCE_TIERS[tier - 1]!;
export const isColonyStone = (value: unknown): value is ColonyStone =>
  COLONY_RESOURCE_TIERS.some(pair => pair.stone === value);
/** Independent discovery draw. Persist its result; retries never consult the player's later level. */
export const selectColonyResourceTier = (seed: number, playerLevel: number): ColonyResourceTier => {
  let count = 1;
  if (playerLevel >= RESOURCE_TIER_MINIMUM_LEVEL[2]) count = 2;
  if (playerLevel >= RESOURCE_TIER_MINIMUM_LEVEL[3]) count = 3;
  if (playerLevel >= RESOURCE_TIER_MINIMUM_LEVEL[4]) count = 4;
  const draw = createRandom(deriveSeed(seed, "colony-resource-tier-v1"))();
  return (1 + Math.floor(draw * count)) as ColonyResourceTier;
};
