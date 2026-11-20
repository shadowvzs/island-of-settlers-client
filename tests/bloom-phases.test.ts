import { describe, expect, it } from "vitest";

import {
  bloomPhaseWeights,
  createBloomFrameValues,
  createBloomRuntimeTuning,
  resolveBloomFrame
} from "../src/render-common/bloom-phases";
import { computeEnvironment, getSunVector, TIME_PRESETS } from "../src/render-common/environment";
import { BLOOM_TUNING } from "../src/render-common/shaders/frame-bloom-glsl";

const SUN = { azimuthX: 0.6, azimuthZ: 0.8, elevation: 0.9 };

const lightAt = (hour: number) => {
  const environment = computeEnvironment(SUN, hour, 0, 0, 0.45, 0);
  return { daylight: environment.daylight, sunHeight: getSunVector(environment.sun)[1] };
};

const frameAt = (hour: number, quality: "low" | "on" = "on", highlights = 1) =>
  resolveBloomFrame(createBloomRuntimeTuning(quality), lightAt(hour), highlights, createBloomFrameValues());

describe("bloom time-of-day phases (BLOOM-REFINEMENT)", () => {
  it("weights day, golden hour and night by the scene light and always sums to one", () => {
    const ramp = BLOOM_TUNING.phaseRamp;
    expect(bloomPhaseWeights(lightAt(TIME_PRESETS.day), ramp).day).toBe(1);
    expect(bloomPhaseWeights(lightAt(TIME_PRESETS.dusk), ramp).golden).toBeGreaterThan(0.95);
    // The dawn preset (6:36) is already past the lowest sun: partly golden.
    expect(bloomPhaseWeights(lightAt(TIME_PRESETS.dawn), ramp).golden).toBeGreaterThan(0.25);
    expect(bloomPhaseWeights(lightAt(6.2), ramp).golden).toBeGreaterThan(0.95);
    expect(bloomPhaseWeights(lightAt(TIME_PRESETS.night), ramp).night).toBe(1);
    for (let hour = 0; hour < 24; hour += 0.25) {
      const { day, golden, night } = bloomPhaseWeights(lightAt(hour), ramp);
      expect(day + golden + night).toBeCloseTo(1, 10);
    }
  });

  it("keeps the R11b night values exactly (lit windows unchanged)", () => {
    const night = frameAt(TIME_PRESETS.night);
    expect(night.threshold).toBe(0.55);
    expect(night.intensity).toBe(0.18);
    expect(night.clippedBoost).toBe(8);
    expect(night.clipWhiteOnly).toBe(0);
    expect(night.radiusScale).toBe(1);
    expect(night.tint).toEqual([1, 1, 1]);
    expect(frameAt(TIME_PRESETS.night, "low").intensity).toBe(0.14);
  });

  it("gives dusk a stronger, wider and warmer glow than noon, and Full more than Soft", () => {
    const day = frameAt(TIME_PRESETS.day), dusk = frameAt(TIME_PRESETS.dusk);
    expect(dusk.intensity).toBeGreaterThan(day.intensity);
    expect(dusk.radiusScale).toBeGreaterThan(day.radiusScale);
    expect(dusk.tint[2]).toBeLessThan(dusk.tint[0]);
    expect(day.threshold).toBeGreaterThan(dusk.threshold - 1e-9);
    for (const hour of [TIME_PRESETS.day, TIME_PRESETS.dusk, TIME_PRESETS.night])
      expect(frameAt(hour, "on").intensity).toBeGreaterThan(frameAt(hour, "low").intensity);
  });

  it("changes smoothly across the whole day (no jump at a phase change)", () => {
    const read = (frame: ReturnType<typeof frameAt>) =>
      [frame.intensity, frame.threshold, frame.radiusScale, frame.clippedBoost, frame.clipWhiteOnly, ...frame.tint];
    const series: number[][] = [];
    // One game minute (about 3 real seconds) per step.
    for (let minute = 0; minute < 24 * 60; minute++) series.push(read(frameAt(minute / 60)));
    series[0]!.forEach((_, channel) => {
      const values = series.map(values => values[channel]!);
      const range = Math.max(...values) - Math.min(...values);
      // The sunset fade takes about 18 game minutes: no step moves more than a tenth of the range.
      for (let index = 1; index < values.length; index++)
        expect(Math.abs(values[index]! - values[index - 1]!)).toBeLessThanOrEqual(range * 0.1 + 1e-9);
    });
  });

  it("multiplies the intensity and clipped boost by Highlights / glare", () => {
    const full = frameAt(TIME_PRESETS.dusk, "on", 1), default75 = frameAt(TIME_PRESETS.dusk, "on", 0.75);
    expect(default75.intensity).toBeCloseTo(full.intensity * 0.75, 10);
    expect(default75.clippedBoost).toBeCloseTo(full.clippedBoost * 0.75, 10);
    expect(default75.threshold).toBe(full.threshold);
  });

  it("resolves each phase's intensity for the preset and keeps Off at zero", () => {
    expect(createBloomRuntimeTuning("off").phases.day.intensity).toBe(0);
    for (const phase of Object.values(BLOOM_TUNING.phases)) {
      expect(phase.intensity.off).toBe(0);
      expect(phase.intensity.low).toBeLessThan(phase.intensity.on);
    }
  });
});
