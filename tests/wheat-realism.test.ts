import { describe, expect, it } from "vitest";

import { createGrainStubbleData, createWheatMeshData, wheatPatchRadius } from "../src/render-common/wheat-field";
import {
  createWheatSoilData, FIELD_ROW_SPACING, fieldRowOffset, wheatSoilRelief
} from "../src/render-common/wheat-soil";
import { SOWING_GRAVITY, sowingSeedPosition } from "../src/render-common/workers/worker-sowing-seeds";
import {
  WHEAT_NORMAL_GLSL,
  WHEAT_WIND_DISPLACEMENT_GLSL,
  WHEAT_WIND_MARGIN,
  WHEAT_WIND_SAMPLE_GLSL,
  WHEAT_WIND_SCALE
} from "../src/renderers/three/settlement/three-wheat-field";

describe("cultivated wheat surface", () => {
  it("follows sloping terrain, lifts small furrows and rejoins the ground at every boundary vertex", () => {
    for (const detailed of [false, true]) {
      const height = (x: number, z: number) => x * .08 - z * .03;
      const data = createWheatSoilData(17, detailed, height);
      let maximumRelief = 0;
      for (let i = 0; i < data.edges.length; i++) {
        const [x, y, z] = data.positions.slice(i * 3, i * 3 + 3) as [number, number, number];
        const relief = y - height(x, z);
        maximumRelief = Math.max(maximumRelief, relief);
        if (data.edges[i] === 0) expect(relief).toBeCloseTo(0, 8);
        expect(relief).toBeGreaterThanOrEqual(-.001);
      }
      expect(maximumRelief).toBeGreaterThan(.02);
      expect(maximumRelief).toBeLessThan(.032);
      expect(data.indices.length / 3).toBeLessThan(detailed ? 1200 : 200);
    }
  });
  it("has surface relief without moving the logical field perimeter", () => {
    const radius = wheatPatchRadius(.8, 3);
    expect(wheatSoilRelief(3, Math.cos(.8) * radius, Math.sin(.8) * radius)).toBeCloseTo(0, 8);
    const full = createWheatMeshData(3, true), cards = createWheatMeshData(3, false);
    expect(full.positions.length / 9).toBeLessThan(6500);
    expect(full.normals).toHaveLength(full.positions.length);
    expect(full.normals.every(Number.isFinite)).toBe(true);
    expect(cards.positions.length / 9).toBe(112);
  });

  it("lays harvested grain stubble in straight rows on the furrow ridges, inside the patch", () => {
    const originX = 189.5, offset = fieldRowOffset(originX);
    const ridge = (x: number) => Math.sin((x + originX) / FIELD_ROW_SPACING * Math.PI * 2);
    expect(ridge(offset)).toBeCloseTo(1, 6);
    for (const detailed of [false, true]) {
      const stubble = createGrainStubbleData(9, detailed, offset, FIELD_ROW_SPACING);
      const roots = new Set<number>();
      for (let index = 0; index < stubble.positions.length; index += 9) {
        const [x, , z] = stubble.positions.slice(index, index + 3) as [number, number, number];
        expect(Math.hypot(x, z)).toBeLessThan(wheatPatchRadius(Math.atan2(z, x), 9) * .81);
        expect(ridge(x)).toBeGreaterThan(.95);
        roots.add(Math.round((x - offset) / FIELD_ROW_SPACING));
      }
      expect(roots.size).toBeGreaterThanOrEqual(3);
      expect(stubble.positions.length / 9).toBeLessThan(detailed ? 260 : 80);
    }
    expect(wheatSoilRelief(3, offset, 0, originX)).toBeGreaterThan(wheatSoilRelief(3, offset + .21, 0, originX));
  });

  it("uses the shared wind field and keeps a safe sway bound", () => {
    expect(WHEAT_WIND_SAMPLE_GLSL).toContain("windDisplacement");
    expect(WHEAT_WIND_DISPLACEMENT_GLSL).toContain("transformed.xz");
    expect(WHEAT_NORMAL_GLSL).toContain("objectNormal");
    expect(WHEAT_WIND_SCALE).toBeGreaterThan(0);
    expect(WHEAT_WIND_MARGIN).toBeGreaterThanOrEqual(WHEAT_WIND_SCALE * 0.6);
  });
});

describe("seed scatter", () => {
  it("starts at the captured hand and follows gravity while its origin remains unchanged", () => {
    const hand = { x: 4, y: .72, z: 9 }, velocity = { x: .3, y: .15, z: .6 };
    expect(sowingSeedPosition(hand, velocity, 0, 0)).toMatchObject(hand);
    const first = sowingSeedPosition(hand, velocity, .1, 0);
    const second = sowingSeedPosition(hand, velocity, .2, 0);
    expect(second.x - hand.x).toBeCloseTo(2 * (first.x - hand.x));
    expect(second.y).toBeCloseTo(.72 + .15 * .2 - SOWING_GRAVITY * .04 / 2);
    expect(sowingSeedPosition(hand, velocity, .8, 0).visible).toBe(false);
    expect(hand).toEqual({ x: 4, y: .72, z: 9 });
  });
});
