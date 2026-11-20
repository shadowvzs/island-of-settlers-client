import type { IUniform, Texture, WebGLRenderer } from "three";

import {
  EYE_ADAPTATION_TUNING,
  type EyeAdaptationLimits,
  eyeAdaptationLimits,
  type EyeAdaptationTuning,
  scaleEyeAdaptationTuning
} from "../../render-common/eye-adaptation";
import { markRenderPass } from "../../render-common/frame-profiler";
import type { ExposureMode } from "../../render-common/quality";
import { createFrameExposure, type FrameExposureProbe } from "./frame-exposure";

declare global {
  interface Window {
    /**
     * Development only: `__autoExposure(false)` binds 0 EV from the next frame while the eye keeps its
     * adaptation state, `__autoExposure()` reads whether it applies (same-frame A/B captures).
     */
    __autoExposure?: (active?: boolean) => boolean;
    /** Development only: reads the last measured mean log2 luminance and EV back (GPU stall). */
    __exposureProbe?: () => FrameExposureProbe | null;
    /** Development only: live eye-adaptation tuning from the next frame. */
    __exposureTuning?: (patch?: Partial<EyeAdaptationTuning>) => EyeAdaptationTuning;
  }
}

/** The linear output pass's exposure inputs: weight 0 (and no texture) outside the possessed eye. */
export interface EyeAdaptationUniforms {
  uExposureTexture: IUniform<Texture | null>;
  uExposureWeight: IUniform<number>;
}

export interface EyeAdaptationControl {
  dispose: () => void;
  outputUniforms: EyeAdaptationUniforms;
  /** Measures the resolved frame and adapts when the eye wants it; sets the output uniforms. */
  render: (resolved: Texture) => void;
  /** The possessed weight of the coming frames (0: strategic or cinematic view, fixed exposure). */
  setWeight: (weight: number) => void;
  /** 1 while this frame's output applies the adapted exposure. */
  stats: () => number;
  /** True when the next finish must draw the linear output pass for the exposure. */
  wanted: () => boolean;
}

const MILLISECONDS_PER_SECOND = 1000;

interface EyeAdaptationOptions {
  graded: boolean;
  mode: ExposureMode;
  /** The Auto-exposure slider (0..1, default 1): scales the compensation and the EV range. */
  strength?: number;
}

/** The shared daylight, 1 when the shading has none (tests). */
const readDaylight = (uniforms: Record<string, IUniform>) =>
  (uniforms.uDaylight?.value as number | undefined) ?? 1;

const exposeDevHooks = (
  setActive: (active?: boolean) => boolean,
  probe: () => FrameExposureProbe | null,
  tuning: EyeAdaptationTuning
): (() => void) => {
  if (!import.meta.env.DEV || typeof window === "undefined") return () => {};
  const tune = (patch?: Partial<EyeAdaptationTuning>) => Object.assign(tuning, patch ?? {});
  window.__autoExposure = setActive;
  window.__exposureProbe = probe;
  window.__exposureTuning = tune;
  return () => {
    if (window.__autoExposure === setActive) delete window.__autoExposure;
    if (window.__exposureProbe === probe) delete window.__exposureProbe;
    if (window.__exposureTuning === tune) delete window.__exposureTuning;
  };
};

/**
 * R11c: the compositor's possessed auto-exposure. The strategic view (weight 0) never runs a pass
 * and binds weight 0, so its output stays bit-identical; the first possessed frame starts the eye
 * at its target, and the weight fades the exposure in and out with the possession blend.
 */
export const createEyeAdaptationControl = (
  renderer: WebGLRenderer,
  uniforms: Record<string, IUniform>,
  { graded, mode, strength = 1 }: EyeAdaptationOptions
): EyeAdaptationControl => {
  const tuning = scaleEyeAdaptationTuning(EYE_ADAPTATION_TUNING, strength);
  const exposure = mode === "fps-auto" && strength > 0 ? createFrameExposure(renderer, uniforms, { graded, tuning }) : null;
  const outputUniforms: EyeAdaptationUniforms = {
    uExposureTexture: { value: null },
    uExposureWeight: { value: 0 }
  };
  const limits: EyeAdaptationLimits = { keyLog2: 0, maxEv: 0, minEv: 0 };
  const step = { dtSeconds: 0, limits, reset: true };
  let active = true;
  let weight = 0;
  let lastFrameMs = 0;

  const setActive = (next?: boolean) => {
    if (next !== undefined) active = next;
    return active;
  };
  const removeDevHooks = exposure
    ? exposeDevHooks(setActive, () => exposure.probe(), tuning)
    : () => {};

  const wanted = () => exposure !== null && active && weight > 0;

  return {
    dispose: () => {
      removeDevHooks();
      exposure?.dispose();
    },
    outputUniforms,
    render: resolved => {
      if (!exposure || !wanted()) {
        outputUniforms.uExposureWeight.value = 0;
        return;
      }
      const now = performance.now();
      step.dtSeconds = step.reset ? 0 : (now - lastFrameMs) / MILLISECONDS_PER_SECOND;
      lastFrameMs = now;
      eyeAdaptationLimits(readDaylight(uniforms), tuning, limits);
      markRenderPass("exposure");
      outputUniforms.uExposureTexture.value = exposure.render(resolved, step);
      markRenderPass("output");
      outputUniforms.uExposureWeight.value = weight;
      step.reset = false;
    },
    setWeight: next => {
      weight = exposure ? Math.min(1, Math.max(0, next)) : 0;
      if (weight <= 0) step.reset = true;
    },
    stats: () => (wanted() ? 1 : 0),
    wanted
  };
};
