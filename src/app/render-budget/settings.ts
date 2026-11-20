import { type FrameRateLimit, isFrameRateLimit } from "../../render-common/frame-rate-cap";
import { DEFAULT_ADAPTIVE_PERFORMANCE, LOWEST_RENDER_SCALES, PERCENT } from "./constants";

/** Lowest render scale the player allows: the Detail level's floor or a percentage. */
export type LowestRenderScale = "detail" | "100" | "90" | "80" | "70" | "60";

/** Settings > Graphics > Adaptive performance (R09/C13). */
export interface AdaptivePerformanceSettings {
  /** The budget controller may lower resolution and presentation detail to hold 40 fps. */
  auto: boolean;
  frameRateLimit: FrameRateLimit;
  lowestScale: LowestRenderScale;
}

export const isLowestRenderScale = (value: unknown): value is LowestRenderScale =>
  (LOWEST_RENDER_SCALES as readonly unknown[]).includes(value);

/** The render-scale floor: the player's percentage, or the Detail level's floor (+ close-view margin). */
export const resolveMinScale = (lowest: LowestRenderScale, detailFloor: number, closeViewMargin: number) => {
  if (lowest !== "detail") return Number(lowest) / PERCENT;
  return Math.min(1, detailFloor + closeViewMargin);
};

export const formatAdaptivePerformance = (settings: AdaptivePerformanceSettings) => JSON.stringify(settings);

/** Tolerant parse: unknown or unreadable fields keep their defaults. */
export const parseAdaptivePerformance = (raw: string | null): AdaptivePerformanceSettings => {
  if (!raw) return DEFAULT_ADAPTIVE_PERFORMANCE;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_ADAPTIVE_PERFORMANCE;
    const { auto, frameRateLimit, lowestScale } = parsed as Record<string, unknown>;
    return {
      auto: typeof auto === "boolean" ? auto : DEFAULT_ADAPTIVE_PERFORMANCE.auto,
      frameRateLimit: isFrameRateLimit(frameRateLimit) ? frameRateLimit : DEFAULT_ADAPTIVE_PERFORMANCE.frameRateLimit,
      lowestScale: isLowestRenderScale(lowestScale) ? lowestScale : DEFAULT_ADAPTIVE_PERFORMANCE.lowestScale
    };
  } catch {
    return DEFAULT_ADAPTIVE_PERFORMANCE;
  }
};
