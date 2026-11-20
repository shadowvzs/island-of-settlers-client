import type { TalentModifiers } from "@shared/catalog";

import { NEUTRAL_TALENT_MODIFIERS } from "../progression/talents";
import { NO_BONUS_PERCENT } from "../world/constants";
import type { ScenarioFactionAi, ScenarioFactionAiBonus } from "../world/scenario-faction-ai";

/** A bonus percentage as a talent share added to a rate of 1 (150 % → +0.5); absent: none. */
const bonusShare = (percent: number = NO_BONUS_PERCENT) => (percent - NO_BONUS_PERCENT) / NO_BONUS_PERCENT;

/**
 * One faction's handicap as talent modifiers: `construction` speeds its builders' hammering, `production` its
 * producers' work cycles and its fields' growth, `training` its Academy's recruit training. Read by the same owner
 * talent hooks as the player's talents (`talentsOf`), so no rate code changes.
 */
const bonusTalents = ({ construction, production, training }: ScenarioFactionAiBonus): Readonly<TalentModifiers> =>
  Object.freeze({
    ...NEUTRAL_TALENT_MODIFIERS, constructionSpeed: bonusShare(construction), fieldGrowthSpeed: bonusShare(production),
    productionSpeed: bonusShare(production), recruitTrainingSpeed: bonusShare(training)
  });

/**
 * The map's explicit handicap (`ScenarioFactionAi.bonus`, enemy economy AI plan §2.1: the only allowed "cheat",
 * lane EAI5a) as talent modifiers indexed by faction; undefined when no faction has one, so every island without
 * a bonus reads the neutral modifiers as before. Authored map content: fixed for the island's life, never saved.
 */
export const factionBonusTalents = (factionAi: readonly ScenarioFactionAi[] | undefined) => {
  if (!factionAi?.some(entry => entry.bonus)) return undefined;
  const talents: (Readonly<TalentModifiers> | undefined)[] = [];
  for (const { bonus, faction } of factionAi) if (bonus) talents[faction] = bonusTalents(bonus);
  return talents;
};
