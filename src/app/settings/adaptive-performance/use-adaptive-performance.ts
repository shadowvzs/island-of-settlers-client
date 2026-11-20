import { useLingui } from "@lingui/react";
import { useSyncExternalStore } from "react";

import type { FrameRateLimit } from "../../../render-common/frame-rate-cap";
import type { RenderBudgetControls } from "../../render-budget/render-budget";
import type { LowestRenderScale } from "../../render-budget/settings";
import {
  getAdaptiveStatus,
  getExhaustedHint,
  getFrameRateLimitOptions,
  getLowestScaleOptions
} from "./helpers";

export interface AdaptivePerformanceOptions {
  budget: RenderBudgetControls;
  /** The Detail level's own render-scale floor (QualityPreset.renderScaleMin). */
  detailFloor: number;
}

/** Live choices: each one applies at once (no reload, no ✓ tick). */
export const useAdaptivePerformance = ({ budget, detailFloor }: AdaptivePerformanceOptions) => {
  const { i18n } = useLingui();
  const snapshot = useSyncExternalStore(budget.snapshot.subscribe, budget.snapshot.getSnapshot);
  const { settings } = snapshot;
  return {
    auto: settings.auto,
    exhaustedHint: getExhaustedHint(snapshot, i18n),
    frameRateLimit: settings.frameRateLimit,
    frameRateLimitOptions: getFrameRateLimitOptions(i18n),
    lowestScale: settings.lowestScale,
    lowestScaleOptions: getLowestScaleOptions(detailFloor, i18n),
    status: getAdaptiveStatus(snapshot, i18n),
    onAutoChange: (auto: boolean) => budget.setSettings({ ...settings, auto }),
    onFrameRateLimitChange: (frameRateLimit: FrameRateLimit) => budget.setSettings({ ...settings, frameRateLimit }),
    onLowestScaleChange: (lowestScale: LowestRenderScale) => budget.setSettings({ ...settings, lowestScale })
  };
};
