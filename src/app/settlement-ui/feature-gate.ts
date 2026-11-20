import type { I18n } from "@lingui/core";

import { translateMessage } from "../../shared/i18n/translate";
import type { FeatureState } from "../../shared/settlement/feature-rules";
import { SETTLEMENT_MESSAGES as M } from "./messages";

/**
 * Kept apart from `helpers.ts`, which the server bundle reaches (no Lingui there).
 * The entry of a single-player feature (GS4a): hidden while the game switches it off, disabled with "Not available
 * on this island" while only the map narrows it; `reason` is undefined while the feature is on.
 */
export const getFeatureGate = (state: FeatureState | undefined, i18n?: I18n) => ({
  hidden: state === "gameOff",
  reason: state === "mapOff" ? translateMessage(i18n, M.common.featureMapOff) : undefined
});
