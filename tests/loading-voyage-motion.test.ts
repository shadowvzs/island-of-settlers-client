import { describe, expect, it } from "vitest";

import { loadingVoyageMotion } from "../src/app/loading-voyage-motion";

const nations = ["chinese", "persian", "maya", "indigenous"] as const;

describe("new voyage illustrations", () => {
  it("uses distinct water and foreground masks for each illustration", () => {
    const motions = nations.map(loadingVoyageMotion);
    for (const property of ["mask", "foreground"] as const) {
      const masks = motions.map(motion => motion[property]);
      expect(new Set(masks).size).toBe(nations.length);
      expect(masks).not.toContain(loadingVoyageMotion("roman")[property]);
      for (const mask of masks) expect(decodeURIComponent(mask)).toContain('<path fill="white"');
    }
  });

});
