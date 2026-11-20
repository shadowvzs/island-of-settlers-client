import { describe, expect, it } from "vitest";

import {
  FOG_VISIBILITY_FADE_END,
  FOG_VISIBILITY_FADE_START,
  getFogVisibilityFade
} from "../src/render-common/atmosphere/fog-visibility";
import { QUALITY_PRESETS } from "../src/render-common/quality";
import { createSharedUniformValues, SCALAR_UNIFORMS } from "../src/render-common/shader-uniforms";
import { FOG_OF_WAR_GLSL } from "../src/render-common/shaders/common-glsl";

describe("fog-of-war cover style (R07)", () => {
  it("lights the cover on Medium+ and keeps the flat cover on Low and Minimal", () => {
    expect(QUALITY_PRESETS.high.fogOfWarStyle).toBe("lit");
    expect(QUALITY_PRESETS.medium.fogOfWarStyle).toBe("lit");
    expect(QUALITY_PRESETS.low.fogOfWarStyle).toBe("flat");
    expect(QUALITY_PRESETS.minimal.fogOfWarStyle).toBe("flat");
    expect(createSharedUniformValues().uFogOfWarLit).toBe(0);
    expect(SCALAR_UNIFORMS).toContain("uFogOfWarLit");
  });

  it("conceals exactly the same cells in both styles: only the cover colour changes", () => {
    // One concealment expression and one blend, shared by both styles.
    expect(FOG_OF_WAR_GLSL).toContain("float hidden = 1.0 - fogVisibilityFade(visibility + drift * 0.35);");
    expect(FOG_OF_WAR_GLSL.match(/float hidden = 1\.0 - fogVisibilityFade/g)).toHaveLength(1);
    expect(FOG_OF_WAR_GLSL).toContain("return mix(mix(color, cloud, hidden * 0.96), revealed, uExplorationFog);");
    expect(FOG_OF_WAR_GLSL).toContain(
      "if (uFogOfWarLit > 0.5 && hidden > 0.004) cloud = litFogCover(puffs, xz);");
    // The concealment band itself is unchanged.
    expect(FOG_VISIBILITY_FADE_START).toBe(0.1);
    expect(FOG_VISIBILITY_FADE_END).toBe(0.45);
    expect(getFogVisibilityFade(0)).toBe(0);
    expect(getFogVisibilityFade(1)).toBe(1);
  });

  it("samples the lit relief with explicit LOD inside its hidden-only branch", () => {
    const lit = FOG_OF_WAR_GLSL.slice(FOG_OF_WAR_GLSL.indexOf("float fogCoverPuffs"),
      FOG_OF_WAR_GLSL.indexOf("vec3 applyFogClouds"));
    expect(lit).toContain("textureLod(uNoiseTexture");
    expect(lit).not.toMatch(/\btexture\(/);
  });
});
