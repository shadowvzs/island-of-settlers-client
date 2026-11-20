import {
  arrayOf, checkValue, enumOf, guard, integer, literal, objectOf, optional
} from "../../../../../island-of-settlers-shared/src/validation/index";
import { FACTION_AI_LEVELS, FACTION_AI_MODES, FACTION_AI_STYLES } from "../../world/constants";
import { scriptableFactionAi } from "../../world/scenario-faction-ai-script";
import { MAX_FACTION } from "../../world/scenario-players";
import { computerEconomies, hasEconomy } from "../settlement-ownership";
import type { SettlementContext } from "../settlement-types";
import { FACTION_AI_LAYERS, INVALID_FACTION_AI_SAVE } from "./constants";
import { developSaveError } from "./develop-state";
import type { FactionAiSave } from "./faction-ai-types";
import { isFactionGoal } from "./faction-goal";
import { strategySaveCheck } from "./faction-strategy-state";
import { maintainSaveError } from "./maintain-state";
import { plannerSaveError } from "./planner-state";

const saveCheck = arrayOf(objectOf({
  develop: optional(guard(value => developSaveError(value) === null)),
  due: arrayOf(integer(0), FACTION_AI_LAYERS.length),
  economy: optional(literal(true)),
  faction: integer(1, MAX_FACTION),
  goal: optional(guard(isFactionGoal)),
  level: optional(enumOf(FACTION_AI_LEVELS)),
  maintain: optional(guard(value => maintainSaveError(value) === null)),
  mode: enumOf(FACTION_AI_MODES),
  paused: optional(literal(true)),
  planner: optional(guard(value => plannerSaveError(value) === null)),
  strategy: optional(strategySaveCheck),
  style: optional(enumOf(FACTION_AI_STYLES))
}), MAX_FACTION);

/**
 * The factions a save must and may carry: the map's AI factions, and every faction a script may address; and the
 * island's cell count (the discovered bits' size).
 */
export interface FactionAiSaveFactions {
  allowed: readonly number[];
  cells: number;
  required: readonly number[];
}

/** The island's factions for `factionAiSaveError`: its map's AI factions and its scriptable factions. */
export const savedFactionAiFactions = (context: Pick<SettlementContext, "options">): FactionAiSaveFactions => ({
  allowed: scriptableFactionAi(context.options.world.scenario).map(entry => entry.faction),
  cells: context.options.world.cellsX * context.options.world.cellsZ,
  required: computerEconomies({ options: context.options })
});

/**
 * Whether a faction runs an economy in a save: the map's AI factions, and the ones the save's faction AI state
 * records as woken by a script (EAI2b). Reads the save, never the live island's set.
 */
export const savedEconomyFaction = (context: Pick<SettlementContext, "options">, saved: unknown) => {
  const map = { options: context.options };
  const woken = Array.isArray(saved) ? saved.filter(entry => entry?.economy === true).map(entry => entry.faction) : [];
  return (faction: number) => hasEconomy(map, faction) || woken.includes(faction);
};

const wellFormedEntries = (entries: readonly FactionAiSave[], { allowed, cells }: FactionAiSaveFactions) =>
  entries.every((entry, index) => allowed.includes(entry.faction) &&
    developSaveError(entry.develop, cells) === null && entry.due.length === FACTION_AI_LAYERS.length &&
    (index === 0 || entries[index - 1]!.faction < entry.faction));

/**
 * Null when the saved faction AI state is well formed (shared validation kit, strict objects): factions ascending,
 * each a faction of the map a script may address, every AI faction of the map present, one due tick per layer.
 * Absent (settlement format ≤ 16, or a map without AI) is valid: the AI then starts from the map.
 */
export const factionAiSaveError = (saved: unknown, factions: FactionAiSaveFactions) => {
  if (saved === undefined) return null;
  if (checkValue(saveCheck, saved).length) return INVALID_FACTION_AI_SAVE;
  const entries = saved as readonly FactionAiSave[];
  const complete = factions.required.every(faction => entries.some(entry => entry.faction === faction));
  return complete && wellFormedEntries(entries, factions) ? null : INVALID_FACTION_AI_SAVE;
};
