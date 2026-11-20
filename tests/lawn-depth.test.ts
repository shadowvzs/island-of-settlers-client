import { Vector4 } from "three";
import { describe, expect, it } from "vitest";

import {
  LAWN_DEPTH_UNIFORMS,
  LAWN_DEPTHS,
  QUALITY_LEVELS,
  QUALITY_PRESETS
} from "../src/render-common/quality";
import { GROUND_VARIANT_GLSL } from "../src/render-common/shaders/ground-variants-glsl";
import { createLawnDepthUniform } from "../src/renderers/three/three-renderer-shading";

describe("lawn depth setting", () => {
  it("defaults every Detail preset to Strong", () => {
    for (const level of QUALITY_LEVELS) expect(QUALITY_PRESETS[level].lawnDepth).toBe("strong");
  });

  it("maps each option to its shader uniform", () => {
    expect(LAWN_DEPTHS).toEqual(["off", "normal", "strong"]);
    expect(LAWN_DEPTH_UNIFORMS.off).toEqual([1, 1, 1, 1]);
    expect(LAWN_DEPTH_UNIFORMS.normal).toEqual([0.86, 0.9, 0.84, 0.82]);
    expect(LAWN_DEPTH_UNIFORMS.strong).toEqual([0.74, 0.82, 0.72, 0.65]);
    for (const depth of LAWN_DEPTHS)
      expect(createLawnDepthUniform(depth)).toEqual(new Vector4(...LAWN_DEPTH_UNIFORMS[depth]));
  });

  it("shades through the uniform in both ground variants and skips the fetch when off", () => {
    for (const source of Object.values(GROUND_VARIANT_GLSL)) {
      expect(source).toContain("uniform vec4 uLawnDepth;");
      expect(source).toContain("if (uLawnDepth.w >= 1.0) return 0.0;");
      expect(source).toContain("float lawn = sampleLawnDepth(");
      expect(source).toContain("albedo *= mix(vec3(1.0), uLawnDepth.rgb, lawn);");
      expect(source).toContain("surface.z *= mix(1.0, uLawnDepth.w, lawn);");
    }
  });
});
