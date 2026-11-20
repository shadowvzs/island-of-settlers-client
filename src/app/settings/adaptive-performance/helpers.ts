import type { I18n } from "@lingui/core";

import { FRAME_RATE_LIMITS, type FrameRateLimit } from "../../../render-common/frame-rate-cap";
import { translateMessage } from "../../../shared/i18n/translate";
import type { SelectOption } from "../../components/helpers";
import { DECORATION_CPU_LEVEL, LOWEST_RENDER_SCALES, PERCENT } from "../../render-budget/constants";
import type { RenderBudgetSnapshot } from "../../render-budget/render-budget";
import type { LowestRenderScale } from "../../render-budget/settings";
import { ADAPTIVE_PERFORMANCE_MESSAGES as M } from "./messages";

const toPercent = (scale: number) => Math.round(scale * PERCENT);

export const getFrameRateLimitOptions = (i18n?: I18n): readonly SelectOption<FrameRateLimit>[] =>
  FRAME_RATE_LIMITS.map(value => ({ label: translateMessage(i18n, M.frameRateLimitChoice[value]), value }));

/** The Detail default shows its own floor, the others their percentage. */
export const getLowestScaleOptions = (
  detailFloor: number,
  i18n?: I18n
): readonly SelectOption<LowestRenderScale>[] =>
  LOWEST_RENDER_SCALES.map(value => {
    if (value === "detail") {
      const label = translateMessage(i18n, M.lowestScaleChoice.detail, { percent: toPercent(detailFloor) });
      return { label, value };
    }
    return { label: translateMessage(i18n, M.lowestScaleChoice.percent, { percent: value }), value };
  });

/** One line of live state below the controls. */
export const getAdaptiveStatus = (snapshot: RenderBudgetSnapshot, i18n?: I18n) => {
  if (!snapshot.settings.auto) return translateMessage(i18n, M.statusOff);
  if (snapshot.renderScale >= 1 && snapshot.cpuLevel === 0) return translateMessage(i18n, M.statusFull);
  return translateMessage(i18n, M.statusReduced, {
    level: snapshot.cpuLevel,
    levels: DECORATION_CPU_LEVEL,
    percent: toPercent(snapshot.renderScale)
  });
};

/** Shown while over budget with every allowed lever at its limit (a suggestion, never a switch). */
export const getExhaustedHint = (snapshot: RenderBudgetSnapshot, i18n?: I18n) =>
  snapshot.settings.auto && snapshot.exhausted ? translateMessage(i18n, M.exhausted) : null;
