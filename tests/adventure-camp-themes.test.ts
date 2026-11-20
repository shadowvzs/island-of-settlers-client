import { MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";

import { adventureCampDecorations } from "../src/render-common/adventure/adventure-camp";
import { ADVENTURE_CAMP_THEMES } from "../src/render-common/adventure/adventure-camp-style";
import { createAdventureCampDecoration } from "../src/renderers/three/settlement/adventure-camp-model";
import { attachAdventureCampWind } from "../src/renderers/three/settlement/adventure-camp-wind";

describe("original themed camp architecture and GPU cloth", () => {
  it.each(ADVENTURE_CAMP_THEMES)("authors %s in both qualities with finite bounded geometry and pinned ground", theme => {
    for (const detailed of [false, true]) {
      let triangles = 0;
      for (const decoration of adventureCampDecorations()) {
        const geometry = createAdventureCampDecoration(decoration.kind, detailed, theme, decoration.variant);
        const positions = geometry.getAttribute("position"), wind = geometry.getAttribute("campWind");
        expect(wind.count).toBe(positions.count);
        expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
        for (let vertex = 0; vertex < positions.count; vertex++) {
          expect(wind.getX(vertex)).toBeGreaterThanOrEqual(0);
          expect(wind.getX(vertex)).toBeLessThanOrEqual(1);
          if (positions.getY(vertex) <= .08) expect(wind.getX(vertex)).toBeLessThan(1e-6);
          expect(Math.hypot(positions.getX(vertex), positions.getZ(vertex)) + .18 * wind.getX(vertex))
            .toBeLessThanOrEqual(decoration.radius + .01);
        }
        if (decoration.kind === "tent")
          expect(Array.from(wind.array).some(value => value > .1)).toBe(true);
        else expect(Array.from(wind.array).every(value => value === 0)).toBe(true);
        triangles += geometry.index!.count / 3; geometry.dispose();
      }
      expect(triangles).toBeLessThan(detailed ? 14000 : 4000);
    }
  });
  it("changes architecture, not only colours, between climates", () => {
    const shapes = ADVENTURE_CAMP_THEMES.map(theme => {
      const geometry = createAdventureCampDecoration("tent", true, theme, "command");
      const positions = geometry.getAttribute("position");
      let fingerprint = 0;
      for (let index = 0; index < positions.count; index++)
        fingerprint += Math.round(positions.getY(index) * 1000) * (index % 17 + 1);
      geometry.dispose(); return `${positions.count}:${fingerprint}`;
    });
    expect(new Set(shapes).size).toBe(ADVENTURE_CAMP_THEMES.length);
  });
  it("updates only GPU uniforms and keeps model attributes unchanged", () => {
    const material = new MeshStandardMaterial(), wind = attachAdventureCampWind(material);
    const shader = { uniforms: {}, vertexShader: "#include <begin_vertex>" };
    material.onBeforeCompile(shader as never, {} as never);
    expect(shader.vertexShader).toContain("attribute float campWind");
    expect(shader.vertexShader).toContain("clamp(campWind, 0.0, 1.0)");
    const geometry = createAdventureCampDecoration("tent", true, "tropical", "command");
    const before = geometry.getAttribute("position").array.slice();
    wind.update(2, 3, 4);
    expect(wind.uniforms.campWindTime.value).toBe(2);
    expect(wind.uniforms.campWindStrength.value).toBe(1.2);
    expect(wind.uniforms.campWindVector.value.length()).toBeCloseTo(1);
    expect(geometry.getAttribute("position").array).toEqual(before);
    wind.update(3, 0, 0); expect(wind.uniforms.campWindStrength.value).toBe(0);
    geometry.dispose(); material.dispose();
  });
});
