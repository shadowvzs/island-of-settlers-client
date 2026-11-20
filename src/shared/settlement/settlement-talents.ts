import { HUNTER_FISHER_TYPES, type TalentModifiers } from "@shared/catalog/balance";

import { isTalentRanksShape, NEUTRAL_TALENT_MODIFIERS, talentModifiers, timeReductionRate } from "../progression/talents";
import { nationProductionShare } from "./nation-bonuses";
import { nationOf } from "./settlement-nation";
import { PLAYER_FACTION } from "./settlement-ownership";
import type { SettlementContext } from "./settlement-types";
import { adoptContextGameRules, rulesOf } from "./sim-rules";

/** The island's talent modifiers; neutral until the player session applies the player's ranks. */
export const contextTalents = (context: Pick<SettlementContext, "talents">): Readonly<TalentModifiers> =>
  context.talents ?? NEUTRAL_TALENT_MODIFIERS;

/**
 * The talent modifiers of a faction: the player's ranks; a computer faction's map handicap (`faction-bonus.ts`),
 * else neutral.
 */
export const talentsOf = (
  context: Pick<SettlementContext, "factionTalents" | "talents">, owner: number
): Readonly<TalentModifiers> => {
  if (owner === PLAYER_FACTION) return contextTalents(context);
  return context.factionTalents?.[owner] ?? NEUTRAL_TALENT_MODIFIERS;
};

type TalentContext = Pick<SettlementContext, "talents"> & Partial<Pick<SettlementContext, "playerNation">> & {
  options?: Pick<SettlementContext["options"], "homeBuilding"> & Partial<Pick<SettlementContext["options"], "world">>;
};
/** A colony island starts from its harbour (39); the Economy capstone speeds production there. */
const isColonyIsland = (context: TalentContext) => context.options?.homeBuilding === 39;

const HUNTER_FISHERS: ReadonlySet<number> = new Set(HUNTER_FISHER_TYPES);

/**
 * Production speed share added to a production building's work rate: every type, plus the hunter and
 * fisher talent for those two types (`typeId`), plus the nation share of the economy `owner` (pass
 * `economyOwnerOf(building)`): the player's talents, neutral talents for a computer economy.
 */
export const productionTalentBonus = (context: TalentContext, typeId: number, owner = PLAYER_FACTION) => {
  const talents = talentsOf(context, owner);
  const colony = isColonyIsland(context) ? talents.colonyProductionSpeed : 0;
  const hunterFisher = HUNTER_FISHERS.has(typeId) ? talents.hunterFisherSpeed : 0;
  return talents.productionSpeed + colony + hunterFisher + nationProductionShare(nationOf(context, owner), typeId);
};

/** Carriers' walking speed factor (carrier speed talent of `owner`'s economy); soldiers and workers keep their pace. */
export const carrierSpeedFactor = (context: Pick<SettlementContext, "talents">, owner = PLAYER_FACTION) =>
  1 + talentsOf(context, owner).carrierSpeed;

/** The voyage time reduction of a colony or adventure expedition (labels and estimates). */
export const voyageTalentReduction = (context: Pick<SettlementContext, "talents">, adventure: boolean) => {
  const talents = contextTalents(context);
  return adventure ? talents.adventureSailingReduction : talents.shippingTimeReduction;
};

/** Seconds per settler of a growth timer of `seconds` with the settler growth talent (the timers run faster). */
export const settlerGrowthSeconds = (seconds: number, growthBonus: number) => seconds / (1 + growthBonus);

/** Ships sail faster by the voyage's time reduction: adventures have their own talent. */
export const voyageTalentRate = (context: Pick<SettlementContext, "talents">, adventure: boolean) => {
  const talents = contextTalents(context);
  return timeReductionRate(adventure ? talents.adventureSailingReduction : talents.shippingTimeReduction);
};

/**
 * Talent factor of one blow or arrow between soldiers (player soldiers only): the soldier capstone's
 * damage plus, from a tower post or a door, the tower archer talent (additive); a player soldier struck
 * takes the damage divided by its health bonus, which equals that much more health.
 */
export const soldierBlowTalentFactor = (
  context: Pick<SettlementContext, "talents">, attackerFaction: number, defenderFaction: number, archerPost: boolean
) => {
  const talents = contextTalents(context);
  let factor = 1;
  if (attackerFaction === PLAYER_FACTION)
    factor *= 1 + talents.soldierDamage + (archerPost ? talents.towerArcherDamage : 0);
  if (defenderFaction === PLAYER_FACTION) factor /= 1 + talents.soldierHealth;
  return factor;
};

/** Siege talent factor of a player soldier's blow or arrow against walls. */
export const siegeTalentFactor = (context: Pick<SettlementContext, "talents">, attackerFaction: number) =>
  attackerFaction === PLAYER_FACTION ? 1 + contextTalents(context).siegeDamage : 1;

/**
 * Journalled command (bug replays record it): the player's applied ranks become the island's frozen
 * modifiers. Ranks are checked for shape only; the player session already enforced levels and gates.
 * Refused while the island's rules switch talents off (plan §9.1): its modifiers stay neutral.
 */
export const setContextTalentRanks = (context: SettlementContext, ranks: unknown) => {
  if (!rulesOf(context).talents || !isTalentRanksShape(ranks)) return false;
  context.talents = talentModifiers(ranks);
  context.options.onTalentsChanged?.(context.talents);
  return true;
};

/** Rules that switch talents off leave no applied modifiers behind (the readers stay ungated and cheap). */
const clearTalentsWhenOff = (context: SettlementContext) => {
  if (!context.talents || rulesOf(context).talents) return;
  context.talents = undefined;
  context.options.onTalentsChanged?.(NEUTRAL_TALENT_MODIFIERS);
};

/**
 * The recorded `adoptGameRules` with its talent consequence (plan §9.1): part of the same command, so every replay
 * drops the modifiers at the same tick. Rules that switch talents back on wait for the session's next ranks.
 */
export const adoptGameRulesWithTalents = (context: SettlementContext, rules: unknown): true | string => {
  const adopted = adoptContextGameRules(context, rules);
  if (adopted === true) clearTalentsWhenOff(context);
  return adopted;
};
