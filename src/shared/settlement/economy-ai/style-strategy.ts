import type { StyleRaids } from "@shared/catalog";
import { styleStrategyOf } from "@shared/catalog/ai/build-programs";

import type { CommanderLevel } from "../../balance/commander-profiles";
import { FACTION_AI_STYLES } from "../../world/constants";
import { FULL_PERCENT, STRATEGY_LEVELS, type StrategyLevel } from "./constants";

const scaled = (value: number, percent: number) => Math.round(value * percent / FULL_PERCENT);

const raidsOf = (level: StrategyLevel, raids: StyleRaids) => {
  if (raids === "level") return level.raids;
  return raids === "always";
};

/** The level's offensive row as the style plays it (its program's `strategy` percentages, EAI5a). */
const styleRow = (level: StrategyLevel, style: string): StrategyLevel => {
  const strategy = styleStrategyOf(style);
  return Object.freeze({
    attackRatioPercent: scaled(level.attackRatioPercent, strategy.attackRatioPercent),
    attackStrength: scaled(level.attackStrength, strategy.attackStrengthPercent),
    attacks: level.attacks,
    firstAttackTicks: scaled(level.firstAttackTicks, strategy.firstAttackPercent),
    offensiveRestTicks: scaled(level.offensiveRestTicks, strategy.retryPercent),
    raidParty: level.raidParty,
    raids: raidsOf(level, strategy.raids),
    retryTicks: scaled(level.retryTicks, strategy.retryPercent)
  });
};

const styleRows = (style: string): Readonly<Record<CommanderLevel, StrategyLevel>> => Object.freeze({
  easy: styleRow(STRATEGY_LEVELS.easy, style),
  hard: styleRow(STRATEGY_LEVELS.hard, style),
  medium: styleRow(STRATEGY_LEVELS.medium, style)
});

/** Every style's row per level, resolved once (catalog data is frozen), so a decision only looks one up. */
const STYLE_LEVEL_ROWS: Readonly<Record<string, Readonly<Record<CommanderLevel, StrategyLevel>>>> = Object.freeze(
  Object.fromEntries(FACTION_AI_STYLES.map(style => [style, styleRows(style)])));

/**
 * The offensive row a faction plays (plan §3.4 `styleFactor` on the strategic intents, EAI5a): its level's (EAI4b)
 * scaled by its style. A turtle sets out later with more and needs a larger edge, never raids and waits longer
 * after a failure; an aggressive faction sets out sooner with less, raids at every level and retries sooner.
 */
export const strategyRowOf = (style: string, level: CommanderLevel): StrategyLevel =>
  STYLE_LEVEL_ROWS[style]?.[level] ?? STRATEGY_LEVELS[level];
