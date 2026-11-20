import { createFrameRateCap, limitFps } from "../../render-common/frame-rate-cap";
import type { QualityPreset } from "../../render-common/quality";
import {
  BUDGET_LOWER_FPS,
  BUDGET_TARGET_FPS,
  createRenderBudgetController,
  type RenderBudgetLevers,
  type RenderBudgetLimits,
  type RenderBudgetStatus
} from "../../render-common/render-budget-controller";
import type { TerrainRenderer } from "../../render-common/renderer-contract";
import { applyRenderScale, type ResolutionState } from "../../render-common/resolution";
import { createExternalStore, type ReadableStore } from "../components/ui-store";
import type { RenderLoopBudget } from "../render-loop";
import {
  CADENCE_CPU_LEVELS,
  CLOSE_VIEW_SCALE_MARGIN,
  DECORATION_CPU_LEVEL,
  PERCENT,
  RESIZE_FREEZE_MS,
  RESUME_FREEZE_MS,
  STARTUP_FREEZE_MS,
  VIEW_FREEZE_MS
} from "./constants";
import { type AdaptivePerformanceSettings, resolveMinScale } from "./settings";
import { watchWeakSignals } from "./weak-signals";

/** The camera the frames are drawn for; a change freezes the controller and may change its floor. */
export type BudgetView = "cinematic" | "fps" | "iso";

/** What the Settings section shows: the stored choice and the controller's live state. */
export interface RenderBudgetSnapshot extends RenderBudgetStatus {
  settings: AdaptivePerformanceSettings;
}

/** Settings-side controls (Settings > Graphics > Adaptive performance). */
export interface RenderBudgetControls {
  setSettings: (settings: AdaptivePerformanceSettings) => void;
  snapshot: ReadableStore<RenderBudgetSnapshot>;
}

/** Decorative life the CPU branch may hide for a while (never stored, never the player's choice). */
export interface BudgetDecoration {
  isEnabled: () => boolean;
  setSuppressed: (suppressed: boolean) => void;
}

export interface RenderBudgetOptions {
  decoration: BudgetDecoration;
  quality: Pick<QualityPreset, "renderScaleMin">;
  renderer: Pick<TerrainRenderer, "setAnimationCadenceBias">;
  resolution: ResolutionState;
  settings: AdaptivePerformanceSettings;
  getView: () => BudgetView;
  saveSettings: (settings: AdaptivePerformanceSettings) => void;
}

declare global {
  interface Window {
    /** DEV: the budget controller's live state, and a fixed scale for review captures (Auto off). */
    __renderBudget?: { setRenderScale: (scale: number) => void; snapshot: () => RenderBudgetSnapshot };
  }
}

/**
 * Wires the R09/C13 controller to the app: the render loop's frames go in, the render scale, the
 * pose-cadence bias and the decorative-life suppression come out. Never touches the simulation.
 */
// oxlint-disable-next-line max-lines-per-function -- one closure owns the adapter state
export const createRenderBudget = (options: RenderBudgetOptions) => {
  const { decoration, quality, renderer, resolution } = options;
  let settings = options.settings;
  /** Read per frame only: the runtime wires the view sources after the budget exists. */
  let view: BudgetView = "iso";
  let decorationEnabled = decoration.isEnabled();
  let displayHz = 0;
  let started = false;
  const cap = createFrameRateCap(settings.frameRateLimit);

  const limits = (): RenderBudgetLimits => {
    const capFps = limitFps(settings.frameRateLimit, cap.displayHz()) ?? Infinity;
    const margin = view === "iso" ? 0 : CLOSE_VIEW_SCALE_MARGIN;
    return {
      lowerFps: Math.min(BUDGET_LOWER_FPS, capFps),
      maxCpuLevel: decoration.isEnabled() ? DECORATION_CPU_LEVEL : CADENCE_CPU_LEVELS,
      minScale: resolveMinScale(settings.lowestScale, quality.renderScaleMin, margin),
      targetFps: Math.min(BUDGET_TARGET_FPS, capFps)
    };
  };
  const controller = createRenderBudgetController(limits());
  const snapshot = createExternalStore<RenderBudgetSnapshot>({ ...controller.status(), settings });
  const publish = () => snapshot.set({ ...controller.status(), settings });

  const apply = (levers: RenderBudgetLevers | null) => {
    if (!levers) return;
    applyRenderScale(resolution, levers.renderScale);
    renderer.setAnimationCadenceBias?.(Math.min(levers.cpuLevel, CADENCE_CPU_LEVELS));
    decoration.setSuppressed(levers.cpuLevel >= DECORATION_CPU_LEVEL);
    publish();
  };

  /** A view change freezes and re-limits; a changed decoration choice or display rate re-limits. */
  const watchInputs = (now: number) => {
    const nextView = options.getView();
    const viewChanged = nextView !== view;
    if (!viewChanged && decoration.isEnabled() === decorationEnabled && cap.displayHz() === displayHz) return;
    view = nextView;
    decorationEnabled = decoration.isEnabled();
    displayHz = cap.displayHz();
    if (viewChanged) controller.freeze(now, VIEW_FREEZE_MS);
    apply(controller.setLimits(now, limits()));
  };

  const recordFrame = (now: number, intervalMs: number, cpuMs: number) => {
    if (!settings.auto) return;
    if (!started) {
      started = true;
      controller.freeze(now, STARTUP_FREEZE_MS);
    }
    watchInputs(now);
    const before = controller.status().exhausted;
    apply(controller.recordFrame(now, intervalMs, cpuMs));
    if (controller.status().exhausted !== before) publish();
  };

  const loop: RenderLoopBudget = {
    frameDue: cap.due,
    recordFrame,
    recordGpu: (now, milliseconds) => controller.recordGpu(now, milliseconds),
    resized: now => controller.freeze(now, RESIZE_FREEZE_MS),
    resume: now => {
      cap.resume();
      controller.freeze(now, RESUME_FREEZE_MS);
    }
  };

  const setSettings = (next: AdaptivePerformanceSettings) => {
    const now = performance.now();
    const autoChanged = next.auto !== settings.auto;
    settings = next;
    options.saveSettings(next);
    cap.setLimit(next.frameRateLimit);
    if (autoChanged) apply(controller.reset(now));
    else apply(controller.setLimits(now, limits()));
    controller.freeze(now, VIEW_FREEZE_MS);
    publish();
  };

  const stopSignals = watchWeakSignals(controller.setIncreasesBlocked);
  const devHook = import.meta.env.DEV && typeof window !== "undefined";
  if (devHook) window.__renderBudget = {
    setRenderScale: scale => applyRenderScale(resolution, scale),
    snapshot: snapshot.getSnapshot
  };

  /** One diagnostics line (info panel): scale percent, CPU level, frame-rate limit. */
  const describe = () => {
    if (!settings.auto) return `off, limit ${settings.frameRateLimit}`;
    const { cpuLevel, exhausted, renderScale } = controller.status();
    const state = exhausted ? ", over budget" : "";
    return `${Math.round(renderScale * PERCENT)}% cpu ${cpuLevel}/${DECORATION_CPU_LEVEL}${state}, ` +
      `limit ${settings.frameRateLimit}, ${cap.displayHz()} Hz`;
  };

  return {
    controls: { setSettings, snapshot } satisfies RenderBudgetControls,
    describe,
    dispose: () => {
      stopSignals();
      if (devHook) delete window.__renderBudget;
    },
    loop
  };
};

export type RenderBudget = ReturnType<typeof createRenderBudget>;
