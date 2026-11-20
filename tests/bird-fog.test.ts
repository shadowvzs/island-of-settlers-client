import { RawShaderMaterial } from "three";
import { describe, expect, it } from "vitest";

import {
  FOG_VISIBILITY_FADE_END,
  FOG_VISIBILITY_FADE_START,
  getFogVisibilityFade
} from "../src/render-common/atmosphere/fog-visibility";
import { createSharedUniformValues } from "../src/render-common/shader-uniforms";
import { FOG_OF_WAR_GLSL } from "../src/render-common/shaders/common-glsl";
import { createThreeBirds } from "../src/renderers/three/three-birds";
import { createThreeUniforms } from "../src/renderers/three/three-materials";

const birdMaterialShader = (caster: boolean) => {
  const birds = createThreeBirds(createThreeUniforms(createSharedUniformValues(null)));
  const mesh = caster ? birds.caster : birds.mesh;
  return (mesh.material as RawShaderMaterial).fragmentShader;
};

describe("bird fog fade", () => {
  it("fades smoothly from fully hidden to fully visible", () => {
    expect(getFogVisibilityFade(0)).toBe(0);
    expect(getFogVisibilityFade(FOG_VISIBILITY_FADE_START)).toBe(0);
    expect(getFogVisibilityFade(FOG_VISIBILITY_FADE_END)).toBe(1);
    expect(getFogVisibilityFade(1)).toBe(1);
    expect(getFogVisibilityFade(0.05)).toBe(0);
    expect(getFogVisibilityFade(0.24)).toBeGreaterThan(0);
    expect(getFogVisibilityFade(0.24)).toBeLessThan(1);
  });

  it("is monotonic with no step large enough to read as a pop", () => {
    let previous = 0;
    for (let visibility = 0; visibility <= 1; visibility += 0.005) {
      const fade = getFogVisibilityFade(visibility);
      expect(fade).toBeGreaterThanOrEqual(previous - 1e-12);
      expect(fade - previous).toBeLessThan(0.03);
      previous = fade;
    }
  });

  it("uses the same reveal band as the fog cloud shader", () => {
    expect(FOG_OF_WAR_GLSL).toContain(FOG_VISIBILITY_FADE_START.toFixed(2));
    expect(FOG_OF_WAR_GLSL).toContain(FOG_VISIBILITY_FADE_END.toFixed(2));
    expect(FOG_OF_WAR_GLSL).toContain("visibility + drift * 0.35");
  });
});

describe("bird fog shader path", () => {
  it("combines the reveal fade, distance and map edge before one screen-door discard", () => {
    const fragment = birdMaterialShader(false);
    expect(fragment).toContain("float visibility = sampleLiveFog(vFogFade.x, vWorld.xz);");
    expect(fragment).toContain("float fade = min(vFogFade.y, fogVisibilityFade(visibility));");
    expect(fragment).toContain("fade = min(fade, getMapInterior(vWorld.xz));");
    expect(fragment).toContain("if (isDitheredOut(fade)) discard;");
    expect(fragment).not.toContain("isHiddenByFog");
  });

  it("fades the shadow caster through the same band but keeps the old distance cutoff", () => {
    const depth = birdMaterialShader(true);
    expect(depth).toContain("float fogFade = min(fogVisibilityFade(visibility), getMapInterior(vWorld.xz));");
    expect(depth).toContain("if (vFogFade.y < 0.5 || isDitheredOut(fogFade)) discard;");
    expect(depth).not.toContain("isHiddenByFog");
  });
});
