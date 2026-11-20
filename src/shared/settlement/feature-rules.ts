import { SIM_FEATURE_KEYS } from "../../../../island-of-settlers-shared/src/game-settings/constants";
import type { SimFeatureKey } from "../../../../island-of-settlers-shared/src/game-settings/game-settings";
import { LEGACY_SIM_RULES, type SimRules } from "../../../../island-of-settlers-shared/src/game-settings/sim-rules";
import type { SettlementContext } from "./settlement-types";
import { contextGameRules, rulesOf } from "./sim-rules";

/**
 * Single-player feature gates (plan §8, lane GS4a). Every gate reads `rulesOf(context)` only, so live play, the
 * headless replay, the verifier and catch-up refuse alike. `gameOff` = the game's rules switch the feature off
 * (the UI hides its entries); `mapOff` = only this island's map narrows it (the UI shows them disabled).
 */
export type FeatureState = "gameOff" | "mapOff" | "on";
export type FeatureStates = Readonly<Record<SimFeatureKey, FeatureState>>;

/** Player-facing refusals of a switched-off feature (the sim's `featureOff` refusal). */
export const FEATURE_REASONS = Object.freeze({
  featureOff: "This feature is switched off in this game",
  mapOff: "Not available on this island"
});

/** The game's own switch (map narrowing aside); exploring also needs fog of war (D4). */
const gameAllows = (rules: SimRules, key: SimFeatureKey) =>
  rules[key] && (key !== "explorationExpeditions" || rules.fogOfWar);

export const featureState = (context: SettlementContext, key: SimFeatureKey): FeatureState => {
  if (rulesOf(context)[key]) return "on";
  return gameAllows(contextGameRules(context) ?? LEGACY_SIM_RULES, key) ? "mapOff" : "gameOff";
};

/** The refusal of a command that starts `key`; null while the feature is on. */
export const featureRefusal = (context: SettlementContext, key: SimFeatureKey): string | null => {
  const state = featureState(context, key);
  if (state === "on") return null;
  return state === "mapOff" ? FEATURE_REASONS.mapOff : FEATURE_REASONS.featureOff;
};

export const isFeatureOn = (context: SettlementContext, key: SimFeatureKey) => rulesOf(context)[key];

/** Every feature's state at once (the UI snapshot reads it each refresh; `rulesOf` is cached). */
export const featureStates = (read: (key: SimFeatureKey) => FeatureState): FeatureStates =>
  Object.fromEntries(SIM_FEATURE_KEYS.map(key => [key, read(key)])) as Record<SimFeatureKey, FeatureState>;
