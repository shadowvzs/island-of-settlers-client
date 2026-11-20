import { DataTexture } from "three";
import { describe, expect, it } from "vitest";

import { QUALITY_PRESETS } from "../src/render-common/quality";
import {
  PARALLAX_LAYER_DEPTHS,
  PARALLAX_RELIEF_WEIGHTS_GLSL
} from "../src/render-common/shaders/ground-parallax-glsl";
import { GROUND_VARIANT_GLSL } from "../src/render-common/shaders/ground-variants-glsl";
import { createTerrainMaterial } from "../src/renderers/three/three-materials";
import { MATERIAL } from "../src/shared/world/world-data";

const texture = () => new DataTexture(new Uint8Array(4), 1, 1);

describe("R14c possessed ground parallax", () => {
  it("is a High-only preset flag", () => {
    expect(QUALITY_PRESETS.high.groundParallax).toBe(true);
    expect(QUALITY_PRESETS.medium.groundParallax).toBe(false);
    expect(QUALITY_PRESETS.low.groundParallax).toBe(false);
    expect(QUALITY_PRESETS.minimal.groundParallax).toBe(false);
  });

  it("lives only in the full ground, behind its define", () => {
    const full = GROUND_VARIANT_GLSL.full;
    expect(full).toContain("#ifdef GROUND_PARALLAX");
    expect(full).toContain("uv += parallax;");
    expect(full).toContain("sampleMicroDetail(microCell(dominant), detailXz,");
    expect(GROUND_VARIANT_GLSL.lite).not.toContain("GROUND_PARALLAX");
  });

  it("marches only the path, sand and gravel layers, gated by the possession weight", () => {
    const full = GROUND_VARIANT_GLSL.full;
    expect(Object.keys(PARALLAX_LAYER_DEPTHS).sort()).toEqual(["dirt", "gravel", "mine", "sand"]);
    Object.entries(PARALLAX_LAYER_DEPTHS).forEach(([name, depth], index) => {
      const layer = MATERIAL[name as keyof typeof MATERIAL];
      expect(full).toContain(`considerParallaxLayer(pick, reliefWeights[${index}], ParallaxLayer(` +
        `groundLayer(${layer}), materialScale(${layer}), ${depth!.toFixed(3)}, layerTurn(${layer})));`);
    });
    expect(full).toContain(`getGroundParallax(${PARALLAX_RELIEF_WEIGHTS_GLSL}, world,`);
    expect(full).toMatch(/float near = uExplorationFog \*/);
  });

  it("sets the define only when the preset asks for it", () => {
    const albedo = texture();
    const normal = texture();
    const high = createTerrainMaterial({}, albedo, normal, "full", true);
    expect(high.defines?.GROUND_PARALLAX).toBe("");
    const plain = createTerrainMaterial({}, albedo, normal, "full");
    expect(plain.defines?.GROUND_PARALLAX).toBeUndefined();
    for (const material of [high, plain]) material.dispose();
    albedo.dispose();
    normal.dispose();
  });
});
