import { describe, expect, it } from "vitest";

import {
  FOG_VISIBILITY_FADE_END,
  getFogVisibilityFade
} from "../src/render-common/atmosphere/fog-visibility";
import { FOG_OF_WAR_GLSL } from "../src/render-common/shaders/common-glsl";
import { WATER_GLSL } from "../src/render-common/shaders/water-glsl";

describe("invisible shader work is skipped", () => {
  it("returns before the caustics fetch on dry ground", () => {
    const earlyOut = "if (shallow <= 0.0) return lit;";
    expect(WATER_GLSL).toContain(earlyOut);
    expect(WATER_GLSL.indexOf("float shallow =")).toBeLessThan(WATER_GLSL.indexOf(earlyOut));
  });

  it("returns before the fog clouds on fully visible ground", () => {
    const earlyOut = "if (visibility >= FOG_CLEAR_VISIBILITY) return color;";
    expect(FOG_OF_WAR_GLSL).toContain("const float FOG_CLEAR_VISIBILITY = 0.95;");
    expect(FOG_OF_WAR_GLSL).toContain(earlyOut);
    expect(FOG_OF_WAR_GLSL.indexOf("sampleLiveFog(visibility,xz)")).toBeLessThan(
      FOG_OF_WAR_GLSL.indexOf(earlyOut)
    );
    expect(FOG_OF_WAR_GLSL).toContain(
      "float discovered = 1.0 - smoothstep(0.55, FOG_CLEAR_VISIBILITY, visibility);"
    );
  });

  it("proves the skipped values were weighted zero", () => {
    expect(FOG_VISIBILITY_FADE_END + 0.5 * 0.35).toBeLessThan(0.95);
    for (let visibility = 0.95; visibility <= 1.0001; visibility += 0.01) {
      for (let drift = -0.5; drift <= 0.5001; drift += 0.05) {
        expect(getFogVisibilityFade(visibility + drift * 0.35)).toBe(1);
      }
    }
  });
});
