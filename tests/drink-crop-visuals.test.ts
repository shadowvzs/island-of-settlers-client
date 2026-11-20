import { describe, expect, it } from "vitest";

import { createDrinkCropMesh, getPalmGrowthDraw } from "../src/render-common/props/drink-crops/drink-crop-meshes";
import {
type DrinkCropFrame,
  getHiveVisual, getPalmVisual, getRiceVisual, getVineVisual} from "../src/render-common/props/drink-crops/drink-crop-stages";
import { createPaddyDikeData } from "../src/render-common/props/drink-crops/paddy-dikes";

const frame = (kind: string, state: string, progress: number, harvest?: number): DrinkCropFrame =>
  ({ harvest, id: 1, kind, progress, state, step: 0, x: 0, z: 0 });

const KEYS = [
  "vine-trellis", "vine-plant-dormant-0", "vine-plant-budding-1", "vine-plant-leafy-2", "vine-bunch-small-0",
  "vine-bunch-full-2", "rice-seedling", "rice-tillering", "rice-heading", "rice-ripe", "rice-stubble", "hive-stand",
  "hive-eke", "hive-skep", "hive-drip", "palm-tree-1", "palm-tree-5", "palm-fruit-small",
  "palm-fruit-full", "palm-fallen-0", "palm-fallen-2"
];
/** Per-site triangle budgets of the crop meshes (a building owns up to six sites). */
const BUDGET = { high: 5000, minimal: 900 };

describe("drink crop visual states", () => {
  it("grows vines from bare wood to purple bunches, emptied vine by vine at harvest", () => {
    expect(getVineVisual(frame("vine", "growing", 0.1))).toMatchObject({ bunches: null, plant: "dormant" });
    expect(getVineVisual(frame("vine", "growing", 0.25))).toMatchObject({ bunches: null, plant: "budding" });
    expect(getVineVisual(frame("vine", "growing", 0.6))).toMatchObject({ bunches: "small", plant: "leafy" });
    expect(getVineVisual(frame("vine", "ripe", 1))).toMatchObject({ bunchVines: 3, bunches: "full", ripeness: 1 });
    expect(getVineVisual(frame("vine", "ripe", 1, 0.5)).bunchVines).toBe(2);
    expect(getVineVisual(frame("vine", "stubble", 0))).toMatchObject({ bunches: null, plant: "leafy" });
  });

  it("floods the paddy until harvest and turns the heads golden", () => {
    expect(getRiceVisual(frame("rice", "growing", 0.1))).toMatchObject({ flooded: true, stage: "seedling" });
    expect(getRiceVisual(frame("rice", "growing", 0.9)).ripeness).toBeGreaterThan(0.5);
    expect(getRiceVisual(frame("rice", "ripe", 1))).toMatchObject({ stage: "ripe" });
    expect(getRiceVisual(frame("rice", "stubble", 0))).toMatchObject({ flooded: false, stage: "stubble" });
  });

  it("fills hives with ekes and bees, opening them while the beekeeper harvests", () => {
    expect(getHiveVisual(frame("hive", "growing", 0.5)).ekes).toBe(0);
    expect(getHiveVisual(frame("hive", "fruiting", 0.8)).ekes).toBe(2);
    expect(getHiveVisual(frame("hive", "ripe", 1))).toMatchObject({ honeyRun: true, open: false });
    expect(getHiveVisual(frame("hive", "ripe", 1, 0.3))).toMatchObject({ honeyRun: false, open: true });
  });

  it("grows palms first, then coconuts green to brown; shakes, drops and gathers them at harvest", () => {
    expect(getPalmVisual(frame("palm", "growing", 0.4))).toMatchObject({ fruit: null, growth: 0.4 });
    expect(getPalmVisual(frame("palm", "fruiting", 0.3))).toMatchObject({ fruit: "small", growth: 1 });
    expect(getPalmVisual(frame("palm", "ripe", 1))).toMatchObject({ drop: null, fruit: "full", ripeness: 1, shake: 0 });
    expect(getPalmVisual(frame("palm", "ripe", 1, 0.1)).shake).toBeGreaterThan(0.5);
    expect(getPalmVisual(frame("palm", "ripe", 1, 0.36)).drop).toBeCloseTo(0.5, 1);
    expect(getPalmVisual(frame("palm", "ripe", 1, 0.45))).toMatchObject({ fallen: 3, fruit: null });
    expect(getPalmVisual(frame("palm", "ripe", 1, 0.99)).fallen).toBe(0);
  });

  it("swells palm stages into each other without popping", () => {
    const before = getPalmGrowthDraw(0.3999), after = getPalmGrowthDraw(0.4);
    expect(after.stage).toBe(before.stage + 1);
    expect(before.scale).toBeGreaterThan(1.2);
    expect(after.scale).toBeCloseTo(1, 2);
    expect(getPalmGrowthDraw(1)).toEqual({ scale: 1, stage: 5 });
  });
});

describe("drink crop meshes", () => {
  for (const detailed of [true, false]) it(`builds every crop mesh in budget (${detailed ? "High" : "Minimal"})`, () => {
    for (const key of KEYS) {
      const mesh = createDrinkCropMesh(key, detailed);
      expect(mesh.positions.every(Number.isFinite), key).toBe(true);
      expect(mesh.indices.length / 3, key).toBeGreaterThan(0);
      if (!key.startsWith("palm-tree"))
        expect(mesh.indices.length / 3, key).toBeLessThan(detailed ? BUDGET.high : BUDGET.minimal);
    }
  });

  it("keeps the hives and fallen coconuts out of the wind", () => {
    for (const key of ["hive-stand", "hive-skep", "palm-fallen-1"])
      expect(createDrinkCropMesh(key, true).wind.every(value => value === 0), key).toBe(true);
  });

  it("lets vine leaves and rice blades sway", () => {
    for (const key of ["vine-plant-leafy-0", "rice-heading"])
      expect(Math.max(...createDrinkCropMesh(key, true).wind), key).toBeGreaterThan(0.2);
  });
});

describe("paddy dikes", () => {
  const alone = { east: false, north: false, south: false, west: false };
  it("drops the outer slope where a neighbouring paddy shares the dike", () => {
    const single = createPaddyDikeData(alone, true), joined = createPaddyDikeData({ ...alone, east: true }, true);
    expect(joined.positions.length).toBeLessThan(single.positions.length);
    expect(Math.max(...joined.positions.filter((_, index) => index % 3 === 0))).toBeCloseTo(0.5, 5);
  });

  it("gives both paddies of a shared edge the same crest", () => {
    const crest = (data: ReturnType<typeof createPaddyDikeData>, x: number) => {
      const heights: number[] = [];
      for (let index = 0; index < data.positions.length; index += 3)
        if (Math.abs(data.positions[index]! - x) < 1e-6) heights.push(data.positions[index + 1]!);
      return Math.max(...heights);
    };
    const west = createPaddyDikeData({ ...alone, east: true }, true);
    const east = createPaddyDikeData({ ...alone, west: true }, true);
    expect(crest(west, 0.5)).toBeCloseTo(crest(east, -0.5), 6);
  });
});
