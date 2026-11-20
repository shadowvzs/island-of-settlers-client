import type { RewardPickerTab } from "../../reward-picker/constants";
import type { RewardPickerCopy } from "../../reward-picker/use-reward-picker";
import { FACTION_AI_MESSAGES as M } from "./messages";

/**
 * Action icon keys (`getActionIcon`) of the mode and style buttons: the 3D renders in
 * `assets/ui-icons/ai/<name>.webp` (`tools/bench/ui-action-icons.ts --set=ai`).
 */
export const FACTION_AI_ICONS = {
  aggressive: "ai:aggressive",
  balanced: "ai:balanced",
  develop: "ai:develop",
  maintain: "ai:maintain",
  none: "ai:none",
  turtle: "ai:turtle"
} as const;

/** The bonus inputs in display order (`ScenarioFactionAiBonus` keys). */
export const FACTION_AI_BONUS_KEYS = ["construction", "production", "training"] as const;
export type FactionAiBonusKey = (typeof FACTION_AI_BONUS_KEYS)[number];

/** The limit inputs in display order (`ScenarioFactionAiLimits` keys). */
export const FACTION_AI_LIMIT_KEYS = ["buildings", "population", "soldiers"] as const;
export type FactionAiLimitKey = (typeof FACTION_AI_LIMIT_KEYS)[number];

/** An absent `style` plays balanced. */
export const DEFAULT_FACTION_AI_STYLE = "balanced";

/** The level select's value for "no level: the island's difficulty". */
export const ISLAND_LEVEL_VALUE = "";

/** The depot start picker offers wares and people (settlers, soldiers by rank). */
export const FACTION_AI_START_TABS: readonly RewardPickerTab[] = ["wares", "people"];

export const FACTION_AI_PICKER_COPY: RewardPickerCopy = {
  empty: M.picker.empty, selected: M.picker.selected, title: M.picker.title
};

/** Icons in a collapsed depot start summary before its "+N more" chip. */
export const DEPOT_SUMMARY_ICONS = 6;
