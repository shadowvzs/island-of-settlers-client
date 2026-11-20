import { PREFERENCES } from "../preferences/keys";
import type { AdaptivePerformanceSettings, LowestRenderScale } from "./settings";

/** Stored Settings > Graphics > Adaptive performance choice (JSON); bench tools seed it. */
export const ADAPTIVE_PERFORMANCE_KEY = PREFERENCES.adaptivePerformance.key;

/** Auto on, the Detail level's own resolution floor, no frame-rate limit (today's pacing). */
export const DEFAULT_ADAPTIVE_PERFORMANCE: AdaptivePerformanceSettings = {
  auto: true,
  frameRateLimit: "display",
  lowestScale: "detail"
};

/** "detail" follows the Detail level's floor; the numbers are percent of the full resolution. */
export const PERCENT = 100;

export const LOWEST_RENDER_SCALES: readonly LowestRenderScale[] = ["detail", "100", "90", "80", "70", "60"];

/** CPU levels: 1 and 2 coarsen the pose cadence of small characters, 3 hides decorative life. */
export const CADENCE_CPU_LEVELS = 2;
export const DECORATION_CPU_LEVEL = 3;

/** The FPS / cinematic view keeps this much more resolution: blur is more visible up close. */
export const CLOSE_VIEW_SCALE_MARGIN = 0.1;

/** No samples right after the first frame (shader warm-up, streaming). */
export const STARTUP_FREEZE_MS = 3000;
/** A view change (possession, cinematic) streams and compiles: its first frames are no sample. */
export const VIEW_FREEZE_MS = 2000;
/** The drawing-buffer reallocation of a resize costs one or two slow frames. */
export const RESIZE_FREEZE_MS = 500;
export const RESUME_FREEZE_MS = 1000;
/** Battery below this share while discharging is a weak signal: the levers are not raised again. */
export const LOW_BATTERY_LEVEL = 0.2;
export const BATTERY_EVENTS = ["chargingchange", "levelchange"] as const;
