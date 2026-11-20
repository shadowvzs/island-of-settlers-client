import { describe, expect, it } from "vitest";

import { GROUND_VARIANT_GLSL } from "../src/render-common/shaders/ground-variants-glsl";

describe("slope-correct ground normals", () => {
  it("builds the perturbation in the geometric tangent basis in both variants", () => {
    for (const source of Object.values(GROUND_VARIANT_GLSL)) {
      expect(source).toContain("mat3 groundTangentBasis(vec3 normal)");
      expect(source).toContain("groundTangentBasis(geometryNormal)");
    }
  });

  it("keeps the lite ground free of loops, arrays and integer ops", () => {
    const lite = GROUND_VARIANT_GLSL.lite;
    expect(lite).not.toMatch(/\bfor\s*\(|\bwhile\s*\(/);
    expect(lite).not.toMatch(/\[/);
    expect(lite).not.toMatch(/\bint\b/);
  });
});
