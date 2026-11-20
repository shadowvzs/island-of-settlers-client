import { SIM_FEATURE_KEYS } from "../../../../../island-of-settlers-shared/src/game-settings/constants";
import type { SimFeatureKey } from "../../../../../island-of-settlers-shared/src/game-settings/game-settings";
import type { RewardPickerTab } from "../reward-picker/constants";
import type { RewardPickerCopy } from "../reward-picker/use-reward-picker";
import { MAP_RULES_MESSAGES as M } from "./messages";

/**
 * The switchable features in display order (GS0 order): settlement and exploring expeditions are separate switches
 * (owner Q7, 2026-11-12).
 */
export const MAP_RULE_FEATURES: readonly SimFeatureKey[] = SIM_FEATURE_KEYS;

/** Editor action icons (`getActionIcon` keys) of the map rule toggles. */
export const MAP_RULE_ICONS = {
  adventures: "action:island-tropical",
  catchUp: "action:theme",
  colonies: "action:territory",
  experience: "action:register",
  explorationExpeditions: "action:scout",
  nationDefault: "camera:reset",
  settlementExpeditions: "action:people",
  startSetup: "action:inventory",
  talents: "action:development",
  trade: "action:handshake"
} as const;
export type MapRuleIcon = keyof typeof MAP_RULE_ICONS;

/** The start setup picker offers wares and people (settlers, soldiers by rank). */
export const START_SETUP_TABS: readonly RewardPickerTab[] = ["wares", "people"];

/** The picker's headings worded for a start setup instead of rewards. */
export const START_SETUP_PICKER_COPY: RewardPickerCopy = {
  empty: M.picker.empty, selected: M.picker.selected, title: M.picker.title
};

/** The dependency rule "nothing to explore while fog of war is off" (plan §5.5 D4). */
export const FOG_DEPENDENCY_ID = "D4";

/** Kinds of map whose rewards the home-island mode pays (adventure and colony coins). */
export const REWARDED_MAP_KINDS: readonly string[] = ["adventure", "colony"];

/** Icons in the collapsed start setup summary before its "+N more" chip. */
export const START_SUMMARY_ICONS = 8;
