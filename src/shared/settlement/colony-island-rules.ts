import type { BuildingColonyRule } from "@shared/catalog";
import { adventurePoints, colonyConquestExperience } from "@shared/catalog/balance";
import { buildingsWithRules } from "@shared/catalog/building-data/rules";

import {
  banditCampPlan, banditSiteOfMilitaryType, type BanditSiteRef, isOpenArcherTower
} from "../../render-common/buildings/bandit-camp-plan";
import {
  COLONY_DIFFICULTIES, COLONY_FORT_CAPACITY, COLONY_FORT_COMPOSITIONS, COLONY_FORT_DEFENDER_TYPES,
  COLONY_FORT_DOOR_HP, COLONY_FORT_RANKS, COLONY_FORT_TYPE_COMPOSITIONS, COLONY_FORT_TYPES
} from "../balance/colonies";
import { COLONY_SCALED_RANK_CAP } from "../balance/enemy-scaling";
import { colonyResourcePair } from "../world/colony-resource-tiers";
import type { ColonyDifficulty, ColonyOre } from "./colony-expedition-rules";
import type { ColonyIsland } from "./colony-expedition-rules";
import { type DifficultyLevel, difficultyRank, difficultyScaled } from "./difficulty";
import type { MilitaryTroopType } from "./military-combat-rules";

/** Map side in cells of every new colony and adventure island (owner decision 2026-10-12). */
export const EXPEDITION_ISLAND_SIZE = 96;
const COLONY_ORE_WARES: Readonly<Record<ColonyOre, string>> = {
  coal: "coal",
  goldOre: "goldOre",
  ironOre: "ironOre",
  stone: "stone"
};
/** Stone-ore colonies export the committed advanced stone; legacy offers retain ordinary stone. */
export const colonyOreWare = (island: Pick<ColonyIsland, "ore" | "resourceTier">) =>
  island.ore === "stone" && island.resourceTier ? colonyResourcePair(island.resourceTier).stone : COLONY_ORE_WARES[island.ore];

export type ColonyFootTroop = Exclude<MilitaryTroopType, "cavalry">;
export interface ColonyFortPlan {
  typeId: number;
  troops: ColonyFootTroop[];
  ranks: number[];
  doorHp: number;
  /** The bandit compound drawn and garrisoned on the plot; absent: a plain military building. */
  bandit?: BanditSiteRef;
}

/**
 * Counterattacks on forts the player has captured (owner decision 2026-10-13): none on easy; from
 * medium the remaining forts send part of their garrisons over land; on hard, troops also arrive
 * by ship. Seconds between attacks; land parties are drawn from the garrisons, ship troops are new.
 */
export interface ColonyCounterattackRule {
  landInterval: number;
  landSize: number;
  ship?: { interval: number; troops: readonly ColonyFootTroop[]; ranks: readonly number[] };
}

/** Types with a colony rule (rules sidecar `limits.colony`), in ascending code order. */
const colonyTypes = (allowed: (rule: BuildingColonyRule) => boolean) => buildingsWithRules()
  .filter(({ rules }) => rules.limits?.colony && allowed(rules.limits.colony)).map(({ entry }) => entry.code);
/**
 * Barracks, guardhouse, watchtower, fortress and lookout tower (`always`): the only plots before conquest (owner
 * decisions 2026-10-13).
 */
const COLONY_MILITARY_BUILDINGS: readonly number[] = colonyTypes(rule => rule === "always");
/**
 * After the conquest (`always` and `conquered`): the military plots again, the mines, the miners' food chain
 * (Fishery, Hunter, Farm, Mill, Bakery, Well, Pig farm, Slaughterhouse; the drink buildings stay at home), the
 * Sawmill, the advanced-material specialists and the residences (owner 2026-10-20). The colony harbour is the
 * store; materials and soldiers arrive by ship from home.
 */
export const COLONY_ECONOMY_BUILDINGS: readonly number[] = colonyTypes(() => true);

/** Military plots only while the enemy holds forts; after the conquest the colony economy above. */
export const colonyAllowsBuilding = (typeId: number, conquered: boolean) =>
  (conquered ? COLONY_ECONOMY_BUILDINGS : COLONY_MILITARY_BUILDINGS).includes(typeId);

/** Why a plot is refused on a colony, for the placement message. */
export const colonyBuildingRefusal = (conquered: boolean) =>
  conquered
    ? "Colonies build military, mine, food, residence and advanced resource buildings"
    : "Only military plots until every enemy fort is taken";

/**
 * Forts of the given types sharing `defenders` (each at least one, never above its camp's capacity;
 * `COLONY_FORT_CAPACITY` is the preferred fill) with mixed foot troops; ranks cycle through `ranks`
 * inside every fort. The last fort receives the remainder, so a hard island's near stronghold can
 * hold more than the planning capacity but never more than the camp layout allows.
 */
export const fortPlans = (
  types: readonly number[],
  defenders: number,
  ranks: readonly number[],
  compounds = false,
  modelOffset = 0
): ColonyFortPlan[] => {
  let remaining = defenders,
    next = 0;
  return types.map((typeId, fort) => {
    const bandit = compounds ? banditSiteOfMilitaryType(typeId, (fort + modelOffset)) : undefined,
      blueprint = bandit && banditCampPlan(bandit);
    const left = types.length - fort - 1;
    const futureCapacity = compounds
      ? types
          .slice(fort + 1)
          .reduce(
            (sum, id, index) =>
              sum +
              banditCampPlan(banditSiteOfMilitaryType(id, (fort + 1 + index + modelOffset)))
                .capacity,
            0
          )
      : Infinity;
    const preferred = Math.min(blueprint?.capacity ?? Infinity, COLONY_FORT_CAPACITY[typeId]!);
    const count = Math.max(1, remaining - futureCapacity, Math.min(preferred, remaining - left));
    remaining -= count;
    const troops = Array.from({ length: count }, () =>
      blueprint?.kind === "tower"
        ? ("archer" as const)
        : COLONY_FORT_DEFENDER_TYPES[next++ % COLONY_FORT_DEFENDER_TYPES.length]!
    );
    return {
      doorHp: COLONY_FORT_DOOR_HP[typeId]!,
      ranks: troops.map((_, index) => ranks[index % ranks.length]!),
      troops,
      typeId,
      ...(bandit ? { bandit } : {})
    };
  });
};

/** A colony defender's tier at `level`: the tier bonus, never above the island level's cap (enemy scaling table). */
export const colonyDefenderRank = (difficulty: ColonyDifficulty, rank: number, level: DifficultyLevel = "normal") =>
  Math.max(rank, Math.min(COLONY_SCALED_RANK_CAP[difficulty], difficultyRank(rank, level)));

/** The colony's defender total at `level`, before its camps' capacity. */
const colonyDefenderTotal = (difficulty: ColonyDifficulty, level: DifficultyLevel) =>
  difficultyScaled(COLONY_DIFFICULTIES[difficulty].enemyTroops, "soldiers", level);

/** The defenders every camp of the colony holds together (its compounds' capacities). */
const colonyCampCapacity = (difficulty: ColonyDifficulty, modelOffset: number) =>
  COLONY_FORT_TYPES[difficulty].reduce((sum, typeId, fort) =>
    sum + banditCampPlan(banditSiteOfMilitaryType(typeId, fort + modelOffset)).capacity, 0);

const modelOffsetOf = (seed: number) => (seed >>> 0) % 3;

/**
 * Defenders a harder global difficulty adds beyond what the colony's camps hold (0 at Normal, whose totals fit):
 * they man the difficulty's extra archer towers instead (enemy scaling table), so no camp is overfilled.
 */
export const colonyOverflowDefenders = (difficulty: ColonyDifficulty, seed = 0, level: DifficultyLevel = "normal") =>
  Math.max(0, colonyDefenderTotal(difficulty, level) - colonyCampCapacity(difficulty, modelOffsetOf(seed)));

/**
 * Deterministic forts and mixed garrisons; the defender total matches the difficulty. `level`
 * scales the computer side's defender total and tier only (difficulty.ts); rewards and launch requirements
 * keep calling the canonical plan without it.
 */
export const colonyFortPlans = (
  difficulty: ColonyDifficulty, seed = 0, level: DifficultyLevel = "normal"
): ColonyFortPlan[] => {
  const modelOffset = modelOffsetOf(seed);
  const plans = fortPlans(
    COLONY_FORT_TYPES[difficulty],
    Math.min(colonyDefenderTotal(difficulty, level), colonyCampCapacity(difficulty, modelOffset)),
    COLONY_FORT_RANKS[difficulty].map(rank => colonyDefenderRank(difficulty, rank, level)),
    true,
    modelOffset
  );
  // Wide compounds change queue exposure. Keep the intended force thresholds with the same
  // defender totals: medium camps have fewer overlapping bows; easy defenders are rank one.
  const composition = COLONY_FORT_COMPOSITIONS[difficulty];
  const byType = COLONY_FORT_TYPE_COMPOSITIONS[difficulty] ?? {};
  const typeNext = new Map<number, number>();
  let next = 0;
  return plans.map((plan) => {
    const mix = byType[plan.typeId];
    if (isOpenArcherTower(plan)) return plan;
    const start = mix ? typeNext.get(plan.typeId) ?? 0 : next;
    const troops = plan.troops.map((_troop, index) => mix
      ? mix[(start + index) % mix.length]!
      : composition[(start + index) % composition.length]!);
    if (mix) typeNext.set(plan.typeId, start + plan.troops.length);
    else next = start + plan.troops.length;
    return { ...plan, troops };
  });
};

/** Experience for conquering a colony of this difficulty at the player's level (rank-weighted defenders). */
export const colonyConquestReward = (difficulty: ColonyDifficulty, level: number) => {
  const units = colonyFortPlans(difficulty).flatMap((plan) => plan.ranks.map((rank) => ({ rank })));
  return colonyConquestExperience(adventurePoints({ units }), level);
};
