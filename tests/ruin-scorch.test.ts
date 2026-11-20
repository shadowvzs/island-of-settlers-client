import { DataTexture } from "three";
import { describe, expect, it } from "vitest";

import { TICKS_PER_DAY } from "../../island-of-settlers-shared/src/time/constants";
import { createRuinScorchSource, getScorchStrength, RUIN_SCORCH } from "../src/render-common/ruin-scorch";
import { GROUND_SCORCH_TUNING } from "../src/render-common/shaders/ground-scorch-glsl";
import { TRAFFIC_GRASS_GLSL } from "../src/render-common/shaders/traffic-wear-glsl";
import { TRAFFIC_WEAR_TUNING } from "../src/render-common/traffic-wear-tuning";
import { createGrassRingMaterial } from "../src/renderers/three/grass-ring/grass-ring-material";
import { createPropMaterial } from "../src/renderers/three/three-prop-materials";
import { createTerrainMaterial } from "../src/renderers/three/three-materials";

const ruin = (uid: number, fallTick: number | undefined, x = 10) =>
  ({ depth: 3, fallTick, uid, width: 4, x, z: 20 });

describe("ruin scorch (GROUND-PALETTE step 7)", () => {
  it("fades over a few game days", () => {
    expect(getScorchStrength(0, 0)).toBe(1);
    expect(getScorchStrength(0, TICKS_PER_DAY)).toBeGreaterThan(0.4);
    expect(getScorchStrength(0, RUIN_SCORCH.fadeDays * TICKS_PER_DAY)).toBe(0);
  });

  it("keeps the youngest discs, deterministically, and drops cleared or faded ruins", () => {
    const source = createRuinScorchSource();
    const ruins = Array.from({ length: 20 }, (_, uid) => ruin(uid, uid * 10, uid));
    const state = source.update([...ruins, ruin(99, undefined)], 300);
    expect(state.count).toBe(RUIN_SCORCH.maxDiscs);
    expect(state.discs[0]).toBe(19);
    expect(state.discs[2]).toBeCloseTo(4 * RUIN_SCORCH.plotShare + RUIN_SCORCH.margin);
    const revision = state.revision;
    expect(source.update([...ruins, ruin(99, undefined)], 301).revision).toBe(revision);
    expect(source.update(ruins.slice(0, 2), 302).count).toBe(2);
    expect(source.update([], 303).count).toBe(0);
    expect(source.update([ruin(1, 0)], RUIN_SCORCH.fadeDays * TICKS_PER_DAY).count).toBe(0);
  });

  it("draws the discs in both ground variants (no work without a ruin)", () => {
    const texture = new DataTexture(new Uint8Array(4), 1, 1);
    for (const variant of ["full", "lite"] as const) {
      const material = createTerrainMaterial({}, texture, texture, variant);
      expect(material.fragmentShader).toContain("applyRuinScorch(ground, xz);");
      expect(material.fragmentShader).toContain("if (uScorchCount <= 0) return;");
      expect(material.uniforms.uScorchCount!.value).toBe(0);
    }
  });

  it("thins the grass cover and the ring blades on the burn, and the packed-earth yards' last tufts", () => {
    const texture = new DataTexture(new Uint8Array(4), 1, 1);
    const tufts = createPropMaterial({}, true).vertexShader;
    expect(tufts).toContain("trafficGrassKeep(instanceMatrix[3].xz) * scorchGrassKeep(instanceMatrix[3].xz)");
    expect(tufts).toContain("if (uScorchCount <= 0) return 1.0;");
    const ring = createGrassRingMaterial({ ground: texture, uniforms: {} }).vertexShader;
    expect(ring).toContain("cover * trafficGrassKeep(root) * scorchGrassKeep(root)");
    expect(TRAFFIC_GRASS_GLSL).toContain(TRAFFIC_WEAR_TUNING.grassBare[0].toFixed(4));
    const [bare, full] = GROUND_SCORCH_TUNING.grass;
    expect(bare).toBeLessThan(GROUND_SCORCH_TUNING.ring[0]! + 0.1);
    expect(full).toBeGreaterThan(GROUND_SCORCH_TUNING.ring[1]!);
  });
});
