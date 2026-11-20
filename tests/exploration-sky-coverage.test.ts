import { describe, expect, it } from "vitest";

import { explorationSkyCoverage } from "../src/renderers/three/exploration-weather/exploration-sky-coverage";

describe("FPS sky coverage", () => {
  it("allows almost clear, sparse and cloudier dry skies without changing the weather input", () => {
    const dry = Array.from({ length: 6 }, (_, index) => explorationSkyCoverage(index * 150, 0, 0.45));
    expect(Math.min(...dry)).toBeLessThan(0.025);
    expect(dry.some(cover => cover > 0.1 && cover < 0.3)).toBe(true);
    expect(Math.max(...dry)).toBeGreaterThan(0.6);
  });

  it("keeps heavy rain overcast through every dry-sky phase and fades rain smoothly", () => {
    for (let time = 0; time < 900; time += 30) {
      expect(explorationSkyCoverage(time, 1, 0.95)).toBeGreaterThan(0.9);
      expect(explorationSkyCoverage(time, 0.5, 0.7)).toBeGreaterThan(explorationSkyCoverage(time, 0, 0.7));
    }
  });

  it("crosses phase and cycle boundaries continuously and contains invalid input", () => {
    for (const time of [0, 150, 300, 450, 600, 750, 900])
      expect(Math.abs(explorationSkyCoverage(time - 0.001, 0, 0.45) -
        explorationSkyCoverage(time + 0.001, 0, 0.45))).toBeLessThan(0.0001);
    expect(Number.isFinite(explorationSkyCoverage(Number.NaN, Number.NaN, Number.NaN))).toBe(true);
  });
});
