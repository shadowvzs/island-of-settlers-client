import { CustomToneMapping, type IUniform, type WebGLRenderer } from "three";

import {
  COLOR_OUTPUT_MODE,
  COLOR_TONE_MAPPER_INDEX,
  type ColorOutputMode,
  type ColorOutputSettings,
  type ColorToneMapper,
  exposureForWeight,
  isColorToneMapper,
  resolveColorOutput
} from "../../../render-common/color-output";
import type { SharedUniformValues } from "../../../render-common/shader-uniforms";
import { COLOR_DISPLAY_UNIFORM_NAMES } from "../../../render-common/shaders/color-output-glsl";

/**
 * Built-in materials keep Three's tonemapping slot, but with the identity CustomToneMapping:
 * the slot only marks screen programs (TONE_MAPPING), and the standard tail then runs the shared
 * tonemapper, so raw and built-in materials use one implementation and one Tone weight.
 */
export const isColorContractRenderer = (renderer?: Pick<WebGLRenderer, "toneMapping">) =>
  renderer?.toneMapping === CustomToneMapping;

/** Weight changes below this are skipped (the endpoints 0 and 1 are always reached exactly). */
const TONE_WEIGHT_STEP = 0.002;

const isSettledWeight = (current: number, next: number) =>
  next === current || (next > 0 && next < 1 && Math.abs(next - current) <= TONE_WEIGHT_STEP);

export interface ColorOutputControl {
  /** Ends a development override: the player's Tone weight applies again from the next frame. */
  release: () => ColorOutputSettings;
  /** Development override of the tonemapper and/or exposure (uniform values; nothing recompiles). */
  set: (settings: Partial<ColorOutputSettings>) => ColorOutputSettings;
  /**
   * The player's Tone weight (0 Vivid .. 1 Filmic). Ignored while a development tonemapper
   * override is active; a development exposure override is kept.
   */
  setWeight: (weight: number) => void;
  settings: () => ColorOutputSettings;
}

/** Binds the renderer to the colour contract; development may start from another tonemapper. */
export const createColorOutputControl = (
  renderer: WebGLRenderer,
  values: Pick<SharedUniformValues, "uColorToneMapper">,
  initial: Partial<ColorOutputSettings> = {}
): ColorOutputControl => {
  renderer.toneMapping = CustomToneMapping;
  const start = resolveColorOutput(initial.toneMapper, initial.exposure);
  let weight = COLOR_TONE_MAPPER_INDEX[start.toneMapper];
  let exposureOverride = initial.exposure ?? null;
  let toneMapperOverride = isColorToneMapper(initial.toneMapper);
  const apply = () => {
    values.uColorToneMapper = weight;
    renderer.toneMappingExposure = exposureOverride ?? exposureForWeight(weight);
  };
  const settings = (): ColorOutputSettings => ({
    exposure: renderer.toneMappingExposure,
    toneMapper: weight > 0.5 ? "agx" : "neutral"
  });
  apply();
  return {
    release: () => {
      toneMapperOverride = false;
      exposureOverride = null;
      apply();
      return settings();
    },
    set: ({ exposure, toneMapper }) => {
      if (toneMapper === undefined && exposure === undefined) return settings();
      if (isColorToneMapper(toneMapper)) {
        toneMapperOverride = true;
        weight = COLOR_TONE_MAPPER_INDEX[toneMapper];
        // A new tonemapper starts from its fitted exposure; an exposure alone keeps the tonemapper.
        exposureOverride = null;
      }
      if (exposure !== undefined) exposureOverride = exposure;
      apply();
      return settings();
    },
    setWeight: next => {
      if (toneMapperOverride || isSettledWeight(weight, next)) return;
      weight = next;
      apply();
    },
    settings
  };
};

/** The shared colour uniforms a display-space feedback shader binds (DISPLAY_COLOR_OUTPUT_GLSL). */
export const pickColorDisplayUniforms = (uniforms: Record<string, IUniform>): Record<string, IUniform> =>
  Object.fromEntries(COLOR_DISPLAY_UNIFORM_NAMES.flatMap(name => {
    const uniform = uniforms[name];
    return uniform ? [[name, uniform]] : [];
  }));

/** Runs `render` with every shader in one output mode, restoring the previous mode (also on throw). */
export const withColorOutputMode = <T>(
  uniforms: Record<string, IUniform>,
  mode: ColorOutputMode,
  render: () => T
): T => {
  const outputMode = uniforms.uColorOutputMode;
  if (!outputMode) return render();
  const previous = outputMode.value;
  outputMode.value = mode;
  try { return render(); }
  finally { outputMode.value = previous; }
};

/**
 * Runs a capture into the sRGB refraction target with linear output on every raw shader, always
 * restoring display output (also when rendering throws).
 */
export const withLinearColorCapture = <T>(uniforms: Record<string, IUniform>, render: () => T): T =>
  withColorOutputMode(uniforms, COLOR_OUTPUT_MODE.linearCapture, render);

type ToneMapperHook = (toneMapper?: ColorToneMapper | null, exposure?: number) => ColorOutputSettings;

declare global {
  interface Window {
    /**
     * Development only: `__toneMapper("agx")`, `__toneMapper("neutral", 1.1)`, `__toneMapper()`
     * (read), `__toneMapper(null)` (back to the player's Tone setting).
     */
    __toneMapper?: ToneMapperHook;
  }
}

/** Development console switch for same-frame A/B captures; returns its remover. */
export const exposeColorOutputDevHook = (control: ColorOutputControl): (() => void) => {
  if (!import.meta.env.DEV || typeof window === "undefined") return () => {};
  const hook: ToneMapperHook = (toneMapper, exposure) => {
    if (toneMapper === null) return control.release();
    return control.set({ exposure, toneMapper });
  };
  window.__toneMapper = hook;
  return () => {
    if (window.__toneMapper === hook) delete window.__toneMapper;
  };
};
