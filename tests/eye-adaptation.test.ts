import { describe, expect, it } from "vitest";

import { getAutoExposureSlider } from "../src/app/settings/sections/helpers";
import {
  adaptationRate,
  adaptExposure,
  exposureTarget,
  EYE_ADAPTATION_MAX_STEP_SECONDS,
  EYE_ADAPTATION_TUNING,
  eyeAdaptationLimits,
  scaleEyeAdaptationTuning
} from "../src/render-common/eye-adaptation";
import { QUALITY_PRESETS } from "../src/render-common/quality";
import {
  getAutoExposureChoice,
  parseQualityOverrides,
  resolveQualityPreset,
  setAutoExposureChoice
} from "../src/render-common/quality-overrides";
import {
  EXPOSURE_ADAPT_FRAGMENT_GLSL,
  EXPOSURE_GRID,
  EXPOSURE_LUMINANCE_FRAGMENT_GLSL,
  EXPOSURE_REDUCE_BLOCK
} from "../src/render-common/shaders/frame-exposure-glsl";
import { FRAME_OUTPUT_LINEAR_FRAGMENT_GLSL } from "../src/render-common/shaders/frame-output-glsl";

const tuning = EYE_ADAPTATION_TUNING;
const dayLimits = eyeAdaptationLimits(1, tuning, { keyLog2: 0, maxEv: 0, minEv: 0 });

describe("eye adaptation target (R11c)", () => {
  it("keeps 0 EV at the reference luminance", () => {
    expect(exposureTarget(dayLimits.keyLog2, dayLimits, tuning)).toBe(0);
  });

  it("brightens dark frames and darkens bright ones within the clamp", () => {
    expect(exposureTarget(dayLimits.keyLog2 - 1, dayLimits, tuning)).toBeCloseTo(tuning.brightenCompensation);
    expect(exposureTarget(dayLimits.keyLog2 + 1, dayLimits, tuning)).toBeCloseTo(-tuning.darkenCompensation);
    expect(tuning.darkenCompensation).toBeLessThan(tuning.brightenCompensation);
    expect(exposureTarget(-20, dayLimits, tuning)).toBe(tuning.maxEvDay);
    expect(exposureTarget(20, dayLimits, tuning)).toBe(tuning.minEv);
    expect(tuning.maxEvDay).toBeLessThanOrEqual(1.5);
    expect(tuning.minEv).toBeGreaterThanOrEqual(-1.5);
  });

  it("lowers the key with the daylight, so dusk and night keep their mood", () => {
    const night = eyeAdaptationLimits(0, tuning, { keyLog2: 0, maxEv: 0, minEv: 0 });
    const dusk = eyeAdaptationLimits(0.53, tuning, { keyLog2: 0, maxEv: 0, minEv: 0 });
    expect(dayLimits.keyLog2).toBe(tuning.keyLog2Day);
    expect(night.keyLog2).toBe(tuning.keyLog2Night);
    expect(dusk.keyLog2).toBeGreaterThan(night.keyLog2);
    expect(dusk.keyLog2).toBeLessThan(dayLimits.keyLog2);
    expect(exposureTarget(night.keyLog2, night, tuning)).toBe(0);
  });

  it("lets the night eye brighten less than the day eye", () => {
    const night = eyeAdaptationLimits(0, tuning, { keyLog2: 0, maxEv: 0, minEv: 0 });
    const dusk = eyeAdaptationLimits(tuning.daylightFull / 2, tuning, { keyLog2: 0, maxEv: 0, minEv: 0 });
    expect(night.maxEv).toBe(tuning.maxEvNight);
    expect(dusk.maxEv).toBeGreaterThan(night.maxEv);
    expect(dusk.maxEv).toBeLessThan(dayLimits.maxEv);
    expect(exposureTarget(-20, night, tuning)).toBe(tuning.maxEvNight);
  });
});

describe("eye adaptation step (R11c)", () => {
  it("approaches the target monotonically without overshoot", () => {
    let ev = 0;
    const evs: number[] = [];
    for (let frame = 0; frame < 240; frame++) {
      ev = adaptExposure(ev, 1.2, 1 / 60, tuning);
      evs.push(ev);
    }
    evs.forEach((value, index) => {
      expect(value).toBeLessThanOrEqual(1.2);
      if (index > 0) expect(value).toBeGreaterThan(evs[index - 1]!);
    });
  });

  it("covers 1 − 1/e of the gap after one time constant, rising and falling", () => {
    const run = (target: number, seconds: number) => {
      let ev = 0;
      for (let frame = 0; frame < seconds * 60; frame++) ev = adaptExposure(ev, target, 1 / 60, tuning);
      return ev;
    };
    expect(run(1, tuning.brightenSeconds)).toBeCloseTo(1 - Math.exp(-1), 6);
    expect(run(-1, tuning.darkenSeconds)).toBeCloseTo(-(1 - Math.exp(-1)), 6);
    expect(tuning.brightenSeconds).toBeGreaterThanOrEqual(1);
    expect(tuning.darkenSeconds).toBeLessThanOrEqual(2);
  });

  it("does not depend on the frame rate and caps a stalled frame", () => {
    let at30 = 0;
    let at144 = 0;
    for (let frame = 0; frame < 30; frame++) at30 = adaptExposure(at30, 1, 1 / 30, tuning);
    for (let frame = 0; frame < 144; frame++) at144 = adaptExposure(at144, 1, 1 / 144, tuning);
    expect(at30).toBeCloseTo(at144, 9);
    expect(adaptationRate(10, tuning.darkenSeconds))
      .toBe(adaptationRate(EYE_ADAPTATION_MAX_STEP_SECONDS, tuning.darkenSeconds));
    expect(adaptExposure(0.4, 0.9, 0, tuning)).toBe(0.4);
  });
});

describe("Eye adaptation strength slider", () => {
  const limitsOf = (scaled: typeof tuning, daylight: number) =>
    eyeAdaptationLimits(daylight, scaled, { keyLog2: 0, maxEv: 0, minEv: 0 });

  it("is the R11c tuning at 100 % and scales every adapted EV linearly below", () => {
    expect(scaleEyeAdaptationTuning(tuning, 1)).toEqual(tuning);
    const half = scaleEyeAdaptationTuning(tuning, 0.5);
    for (const daylight of [0, 0.2, 1]) {
      const full = limitsOf(tuning, daylight);
      const scaled = limitsOf(half, daylight);
      expect(scaled.keyLog2).toBe(full.keyLog2);
      for (const offset of [-20, -3, -0.5, 0.5, 3, 20]) {
        const meanLog2 = full.keyLog2 + offset;
        expect(exposureTarget(meanLog2, scaled, half)).toBeCloseTo(0.5 * exposureTarget(meanLog2, full, tuning));
      }
    }
    expect(half.brightenSeconds).toBe(tuning.brightenSeconds);
    expect(half.darkenSeconds).toBe(tuning.darkenSeconds);
  });

  it("never adapts at 0 % and never exceeds the full tuning", () => {
    const off = scaleEyeAdaptationTuning(tuning, 0);
    expect(exposureTarget(-20, limitsOf(off, 1), off)).toBeCloseTo(0);
    expect(exposureTarget(20, limitsOf(off, 1), off)).toBeCloseTo(0);
    expect(scaleEyeAdaptationTuning(tuning, 3)).toEqual(tuning);
  });

  it("0 % resolves to the fixed exposure (no pass) and round-trips through storage", () => {
    const overrides = setAutoExposureChoice("high", {}, 0);
    expect(overrides).toEqual({ autoExposure: 0 });
    expect(resolveQualityPreset("high", overrides).exposureMode).toBe("fixed");
    expect(getAutoExposureChoice("medium", parseQualityOverrides(JSON.stringify(overrides)))).toBe(0);
    expect(setAutoExposureChoice("high", overrides, 100)).toEqual({});
    const half = resolveQualityPreset("medium", setAutoExposureChoice("medium", {}, 50));
    expect(half).toMatchObject({ exposureMode: "fps-auto", exposureStrength: 0.5 });
    expect(parseQualityOverrides('{"autoExposure":250}')).toEqual({ autoExposure: 100 });
  });

  it("is disabled with its reason where the level keeps a fixed exposure", () => {
    expect(setAutoExposureChoice("low", {}, 40)).toEqual({});
    expect(getAutoExposureSlider("low", {})).toMatchObject({ disabled: true, maxPercent: 100, percent: 0 });
    expect(getAutoExposureSlider("minimal", {}).title).toContain("Medium and High detail levels only");
    expect(getAutoExposureSlider("medium", {})).toMatchObject({ disabled: false, percent: 100 });
    expect(getAutoExposureSlider("high", { autoExposure: 35 })).toMatchObject({ disabled: false, percent: 35 });
  });
});

describe("eye adaptation presets and shaders (R11c)", () => {
  it("adapts only on the levels with a scene target", () => {
    expect(QUALITY_PRESETS.high.exposureMode).toBe("fps-auto");
    expect(QUALITY_PRESETS.medium.exposureMode).toBe("fps-auto");
    expect(QUALITY_PRESETS.low.exposureMode).toBe("fixed");
    expect(QUALITY_PRESETS.minimal.exposureMode).toBe("fixed");
  });

  it("reduces the grid exactly and measures linear log luminance", () => {
    expect(EXPOSURE_GRID.width % EXPOSURE_REDUCE_BLOCK.width).toBe(0);
    expect(EXPOSURE_GRID.height % EXPOSURE_REDUCE_BLOCK.height).toBe(0);
    expect(EXPOSURE_LUMINANCE_FRAGMENT_GLSL).toContain("colorSceneToLinear");
    expect(EXPOSURE_LUMINANCE_FRAGMENT_GLSL).toContain("log2(max(");
    expect(EXPOSURE_ADAPT_FRAGMENT_GLSL).toContain("mix(previous, target, rate)");
  });

  it("skips the exposure in the output while its weight is 0", () => {
    expect(FRAME_OUTPUT_LINEAR_FRAGMENT_GLSL).toContain("if (uExposureWeight > 0.0) linear *= exp2(");
  });
});
