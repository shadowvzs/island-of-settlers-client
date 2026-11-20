import { Matrix4, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { QUALITY_PRESETS } from "../src/render-common/quality";
import { EXPLORATION_LOD_DEFAULTS, EXPLORATION_SHADOW_RADIUS } from "../src/renderers/three/exploration/exploration-lod";
import {
  getCascadeHalfExtent,
  getCascadeRadii,
  getDynamicCascadeCount,
  getFarStrip,
  getShadowAtlasLayout,
  getSlotOrigin,
  SHADOW_CASCADE_BAND,
  SHADOW_CASCADE_KERNEL_TEXELS,
  SHADOW_FAR_STRIPS
} from "../src/renderers/three/shadow-cascades";
import { createCascadeCamera } from "../src/renderers/three/shadow-light-cameras";
import { SUN_SHADOW_GLSL, SUN_SHADOW_UNIFORM_NAMES } from "../src/renderers/three/three-shadows";

describe("R08 shadow cascade plan", () => {
  it("keeps one map without cascades and packs 2048² slots with them", () => {
    expect(getShadowAtlasLayout(1024, 1, 16384)).toEqual(
      { cascades: 1, columns: 1, farSlots: [0], height: 1024, isoSize: 1024, tile: 1024, width: 1024 });
    expect(getShadowAtlasLayout(2048, 2, 16384)).toEqual(
      { cascades: 2, columns: 3, farSlots: [1, 2], height: 2048, isoSize: 2048, tile: 2048, width: 6144 });
    expect(getShadowAtlasLayout(4096, 3, 16384)).toEqual(
      { cascades: 3, columns: 2, farSlots: [2, 3], height: 4096, isoSize: 4096, tile: 2048, width: 4096 });
    expect(getShadowAtlasLayout(4096, 3, 2048).tile).toBe(1024);
    expect(getShadowAtlasLayout(2048, 2, 4096).tile).toBe(1365);
  });

  it("follows D7 per preset: High 3 (Poisson), Medium 2, Low and Minimal one map", () => {
    expect(QUALITY_PRESETS.high.shadowCascadesFps).toBe(3);
    expect(QUALITY_PRESETS.high.shadowFilter).toBe("poisson12");
    expect(QUALITY_PRESETS.medium.shadowCascadesFps).toBe(2);
    expect(QUALITY_PRESETS.low.shadowCascadesFps).toBe(1);
    expect(QUALITY_PRESETS.minimal.shadowCascadesFps).toBe(1);
    expect(QUALITY_PRESETS.minimal.sunShadows).toBe(false);
  });

  it("ends the detailed cascades at the exploration shadow radius and the last at the view distance", () => {
    const far = EXPLORATION_LOD_DEFAULTS.maxViewDistance;
    expect(getCascadeRadii(3)).toEqual([20, EXPLORATION_SHADOW_RADIUS, far]);
    expect(getCascadeRadii(2)).toEqual([EXPLORATION_SHADOW_RADIUS, far]);
    expect(getDynamicCascadeCount(getCascadeRadii(3))).toBe(2);
    expect(getDynamicCascadeCount(getCascadeRadii(2))).toBe(1);
    expect(far).toBeGreaterThanOrEqual(150);
  });

  it("gives every radius full quality inside the blend band and kernel border, in steps", () => {
    for (const [radius, last] of [[20, false], [60, false], [185, true]] as const) {
      const half = getCascadeHalfExtent(radius, last, 2048);
      const border = SHADOW_CASCADE_BAND + SHADOW_CASCADE_KERNEL_TEXELS / 2048;
      expect(half % 4).toBe(0);
      expect(half * (1 - 2 * border)).toBeGreaterThanOrEqual(radius);
    }
  });

  it("splits a far slot into quadrants whose remap is texel-exact", () => {
    const tile = 2048;
    expect(getSlotOrigin(3, tile, 2)).toEqual({ x: 2048, y: 2048 });
    expect(getSlotOrigin(2, tile, 3)).toEqual({ x: 4096, y: 0 });
    const cascade = createCascadeCamera(2);
    cascade.fit(new Vector3(40, 3, 70), 236, { azimuthX: 0.6, azimuthZ: 0.8, elevation: 0.6 }, tile);
    const projection = new Matrix4().multiplyMatrices(cascade.camera.projectionMatrix,
      cascade.camera.matrixWorldInverse);
    const point = new Vector3(95, 0, 20);
    const ndc = point.clone().applyMatrix4(projection);
    const texelX = (ndc.x + 1) / 2 * tile;
    const texelY = (ndc.y + 1) / 2 * tile;
    const quadrant = (texelX >= tile / 2 ? 1 : 0) + (texelY >= tile / 2 ? 2 : 0);
    expect(SHADOW_FAR_STRIPS).toBe(4);
    const { offsetX, offsetY, rect } = getFarStrip(quadrant, 3, tile, 2);
    const remap = new Matrix4().makeScale(2, 2, 1).setPosition(offsetX, offsetY, 0);
    const local = point.clone().applyMatrix4(remap.multiply(projection));
    expect(rect.x + (local.x + 1) / 2 * rect.width).toBeCloseTo(2048 + texelX, 6);
    expect(rect.y + (local.y + 1) / 2 * rect.height).toBeCloseTo(2048 + texelY, 6);
  });

  it("shares every uniform the lookup reads", () => {
    for (const name of SUN_SHADOW_UNIFORM_NAMES) expect(SUN_SHADOW_GLSL).toMatch(new RegExp(`uniform \\w+ ${name};`));
  });
});
