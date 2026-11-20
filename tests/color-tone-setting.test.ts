import type { WebGLRenderer } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import { settingsStorage } from "../src/app/settings/graphics-settings";
import { getToneOptions } from "../src/app/settings/sections/helpers";
import {
  COLOR_TONES,
  DEFAULT_COLOR_TONE,
  exposureForWeight,
  isColorTone,
  toneWeightFor
} from "../src/render-common/color-output";
import { computeEnvironment, TIME_PRESETS } from "../src/render-common/environment";
import { QUALITY_PRESETS } from "../src/render-common/quality";
import { createSharedUniformValues } from "../src/render-common/shader-uniforms";
import { COLOR_OUTPUT_GLSL } from "../src/render-common/shaders/color-output-glsl";
import { createColorOutputControl } from "../src/renderers/three/color/color-output-control";

const stubStorage = () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value)
  });
  return values;
};

const createRenderer = () => ({ toneMapping: 0, toneMappingExposure: 1 }) as WebGLRenderer;

afterEach(() => vi.unstubAllGlobals());

const BASE_SUN = { azimuthX: -0.77, azimuthZ: 0, elevation: 0.7 };

/** Auto weight of a clear-sky hour, from the real environment (daylight and sun height). */
const autoWeightAt = (hour: number, rain = 0) => {
  const { daylight, sun } = computeEnvironment(BASE_SUN, hour, rain);
  return toneWeightFor("auto", daylight, rain, sun.elevation);
};

describe("Tone weight", () => {
  it("keeps Vivid and Filmic fixed whatever the light", () => {
    expect(toneWeightFor("vivid", 0, 1, 0.5)).toBe(0);
    expect(toneWeightFor("filmic", 1, 0, 1)).toBe(1);
  });

  it("turns Auto filmic at night and in rain, vivid by clear day", () => {
    expect(autoWeightAt(TIME_PRESETS.day)).toBe(0);
    expect(autoWeightAt(TIME_PRESETS.night)).toBe(1);
    expect(autoWeightAt(0)).toBe(1);
    expect(autoWeightAt(TIME_PRESETS.day, 1)).toBeGreaterThanOrEqual(0.9);
  });

  it("leans filmic at the dawn and dusk presets", () => {
    expect(autoWeightAt(TIME_PRESETS.dawn)).toBeGreaterThanOrEqual(0.6);
    expect(autoWeightAt(TIME_PRESETS.dusk)).toBeGreaterThanOrEqual(0.6);
  });

  it("is vivid again once the morning sun is high", () => {
    expect(autoWeightAt(9)).toBe(0);
    expect(autoWeightAt(15)).toBe(0);
  });

  it("never turns more filmic as daylight grows", () => {
    let previous = Infinity;
    for (let daylight = 0; daylight <= 1.0001; daylight += 0.05) {
      const weight = toneWeightFor("auto", daylight, 0.1, 0.97);
      expect(weight).toBeLessThanOrEqual(previous);
      previous = weight;
    }
  });

  it("never turns more filmic as the morning sun rises", () => {
    let previous = Infinity;
    for (let hour = 4; hour <= 12.0001; hour += 0.1) {
      const weight = autoWeightAt(hour);
      expect(weight).toBeLessThanOrEqual(previous + 1e-9);
      previous = weight;
    }
  });

  it("mixes the fitted exposures of both curves", () => {
    expect(exposureForWeight(0)).toBe(1);
    expect(exposureForWeight(1)).toBe(1);
  });
});

describe("Tone setting", () => {
  it("defaults to Auto and rejects other strings", () => {
    expect(DEFAULT_COLOR_TONE).toBe("auto");
    expect(COLOR_TONES.every(isColorTone)).toBe(true);
    expect(isColorTone("agx")).toBe(false);
    expect(isColorTone("Auto")).toBe(false);
    expect(isColorTone(null)).toBe(false);
  });

  it("round trips through the stored graphics settings", () => {
    const values = stubStorage();
    expect(settingsStorage.readTone()).toBe("auto");
    settingsStorage.writeTone("filmic");
    expect(settingsStorage.readTone()).toBe("filmic");
    values.set("island-of-settlers.graphics.tone", "neon");
    expect(settingsStorage.readTone()).toBe("auto");
  });

  it("lists the three choices in menu order", () => {
    expect(getToneOptions().map(option => option.value)).toEqual(["auto", "vivid", "filmic"]);
  });
});

describe("Tone weight binding", () => {
  it("sets the uniform weight and skips needless small steps", () => {
    const values = createSharedUniformValues();
    const control = createColorOutputControl(createRenderer(), values);
    control.setWeight(0.5);
    expect(values.uColorToneMapper).toBe(0.5);
    control.setWeight(0.501);
    expect(values.uColorToneMapper).toBe(0.5);
    control.setWeight(0.51);
    expect(values.uColorToneMapper).toBe(0.51);
    control.setWeight(1);
    expect(values.uColorToneMapper).toBe(1);
    expect(control.settings().toneMapper).toBe("agx");
  });

  it("lets a development tonemapper override win over the player setting", () => {
    const values = createSharedUniformValues();
    const renderer = createRenderer();
    const control = createColorOutputControl(renderer, values, { exposure: 1.3, toneMapper: "agx" });
    control.setWeight(0);
    expect(values.uColorToneMapper).toBe(1);
    expect(renderer.toneMappingExposure).toBe(1.3);
    control.release();
    control.setWeight(0);
    expect(values.uColorToneMapper).toBe(0);
    expect(renderer.toneMappingExposure).toBe(1);
  });

  it("keeps a development exposure while the player weight moves", () => {
    const values = createSharedUniformValues();
    const renderer = createRenderer();
    const control = createColorOutputControl(renderer, values, { exposure: 1.2 });
    control.setWeight(0.4);
    expect(values.uColorToneMapper).toBe(0.4);
    expect(renderer.toneMappingExposure).toBe(1.2);
  });
});

describe("Tone shader", () => {
  it("blends the curves only between the settled weights", () => {
    expect(COLOR_OUTPUT_GLSL).toContain("if (weight < 0.001) return colorNeutralToneMap(exposed);");
    expect(COLOR_OUTPUT_GLSL).toContain("if (weight > 0.999) return colorAgxToneMap(exposed);");
    expect(COLOR_OUTPUT_GLSL).toContain(
      "return mix(colorNeutralToneMap(exposed), colorAgxToneMap(exposed), weight);"
    );
  });

  it("fades the Vivid saturation boost out towards Filmic", () => {
    expect(COLOR_OUTPUT_GLSL).toContain(
      "float vividBoost = 1.0 + uColorVividBoost * (1.0 - clamp(uColorToneMapper, 0.0, 1.0));"
    );
  });

  it("calibrates the Vivid boost per quality preset", () => {
    expect(QUALITY_PRESETS.high.vividSaturationBoost).toBe(0.1);
    expect(QUALITY_PRESETS.medium.vividSaturationBoost).toBe(0.1);
    expect(QUALITY_PRESETS.low.vividSaturationBoost).toBe(0.1);
    expect(QUALITY_PRESETS.minimal.vividSaturationBoost).toBe(0);
  });
});
