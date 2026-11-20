import { describe, expect, it } from "vitest";

import { meadowMacroTint, sampleMeadowMacro } from "../src/render-common/props/terrain-tint";
import { createSharedUniformValues } from "../src/render-common/shader-uniforms";
import { RAIN_LUSH_TINT_GLSL } from "../src/render-common/shaders/ground-common-glsl";
import { createThreeUniforms } from "../src/renderers/three/three-materials";
import { createPropMaterial } from "../src/renderers/three/three-prop-materials";

describe("grass terrain tint", () => {
  it("mirrors the meadow macro formula for cool, warm and dry regions", () => {
    const cool = meadowMacroTint([0.2, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]);
    const warm = meadowMacroTint([0.8, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]);
    const dry = meadowMacroTint([0.5, 0.5, 0.8, 0.5], [0.5, 0.5, 0.8, 0.5]);
    expect(warm[0]).toBeGreaterThan(cool[0]);
    expect(warm[2]).toBeLessThan(cool[2]);
    expect(dry).not.toEqual(warm);
    expect(dry.every(Number.isFinite)).toBe(true);
  });

  it("samples deterministic finite macro values with a bounded brightness", () => {
    for (const [x, z] of [[0, 0], [12.5, -8.25], [64, 64], [-31.75, 7.5]]) {
      const first = sampleMeadowMacro(x!, z!);
      const second = sampleMeadowMacro(x!, z!);
      expect(second).toEqual(first);
      expect(first.tint.every(Number.isFinite)).toBe(true);
      expect(first.brightness).toBeGreaterThanOrEqual(0.9);
      expect(first.brightness).toBeLessThanOrEqual(1.08);
    }
  });

  it("applies the same rain hue to grass instances", () => {
    const uniforms = createThreeUniforms(createSharedUniformValues());
    const material = createPropMaterial(uniforms, true);
    try {
      expect(material.vertexShader).toContain(RAIN_LUSH_TINT_GLSL);
      expect(material.vertexShader).toContain("if (uIsGrass > 0.5)");
    } finally {
      material.dispose();
    }
  });
});
