const clamp01 = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const DRY_COVER_TARGETS = [0.01, 0.16, 0.43, 0.67, 0.24, 0.04];

/** Presentation-only weather variety; no simulation clock, RNG, saved state or weather writes. */
export const explorationSkyCoverage = (timeSeconds: number, rain: number, weatherCover: number) => {
  const time = Number.isFinite(timeSeconds) ? timeSeconds : 0;
  const phase = (time / 150) % 6;
  const index = Math.floor(phase + 6) % 6;
  const fraction = ((phase % 1) + 1) % 1;
  const blend = fraction * fraction * (3 - 2 * fraction);
  const dry = DRY_COVER_TARGETS[index]! +
    (DRY_COVER_TARGETS[(index + 1) % DRY_COVER_TARGETS.length]! - DRY_COVER_TARGETS[index]!) * blend;
  const wet = clamp01(rain);
  const ordinary = clamp01(weatherCover);
  const dryCover = clamp01(dry + Math.max(0, ordinary - 0.5) * 0.25);
  return dryCover + (Math.max(dryCover, 0.96) - dryCover) * wet;
};
