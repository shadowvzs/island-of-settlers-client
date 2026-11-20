import { useLingui } from "@lingui/react";

import type { FrameRateLimit } from "../../../render-common/frame-rate-cap";
import { Checkbox } from "../../components/checkbox";
import type { SelectOption } from "../../components/helpers";
import { Section } from "../../components/section";
import { Select } from "../../components/select";
import type { LowestRenderScale } from "../../render-budget/settings";
import { ADAPTIVE_PERFORMANCE_MESSAGES as M } from "./messages";
import { type AdaptivePerformanceOptions, useAdaptivePerformance } from "./use-adaptive-performance";

interface AdaptivePerformanceViewProps {
  auto: boolean;
  exhaustedHint: string | null;
  frameRateLimit: FrameRateLimit;
  frameRateLimitOptions: readonly SelectOption<FrameRateLimit>[];
  lowestScale: LowestRenderScale;
  lowestScaleOptions: readonly SelectOption<LowestRenderScale>[];
  status: string;
  onAutoChange: (auto: boolean) => void;
  onFrameRateLimitChange: (limit: FrameRateLimit) => void;
  onLowestScaleChange: (scale: LowestRenderScale) => void;
}

const AdaptivePerformanceView = ({
  auto, exhaustedHint, frameRateLimit, frameRateLimitOptions, lowestScale, lowestScaleOptions, status,
  onAutoChange, onFrameRateLimitChange, onLowestScaleChange
}: AdaptivePerformanceViewProps) => {
  const { i18n } = useLingui();
  return (
    <Section icon="settings" title={i18n._(M.title)}>
      <Checkbox checked={auto}
        info={{ label: i18n._(M.auto), text: i18n._(M.autoTitle) }}
        label={i18n._(M.auto)} onChange={onAutoChange} />
      <Select
        choices={lowestScaleOptions}
        label={i18n._(M.lowestScale)}
        selected={lowestScale}
        onChange={onLowestScaleChange}
      />
      <Select
        choices={frameRateLimitOptions}
        label={i18n._(M.frameRateLimit)}
        selected={frameRateLimit}
        title={i18n._(M.frameRateLimitTitle)}
        onChange={onFrameRateLimitChange}
      />
      <p className="settings-panel__hint" role="status">{status}</p>
      {exhaustedHint && <p className="settings-panel__hint">{exhaustedHint}</p>}
    </Section>
  );
};

/** Auto budget controller switch, its resolution floor and the frame-rate limit (all live). */
export const AdaptivePerformanceSection = (props: AdaptivePerformanceOptions) =>
  <AdaptivePerformanceView {...useAdaptivePerformance(props)} />;
