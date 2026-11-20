import { describe, expect, it } from "vitest";

import {
  createIslandTreeStageMesh,
  findTreeVariant,
  getMatureVariant,
  getTreeVariants
} from "../src/render-common/props/island-trees";
import { BIRCH_SPRAY_RECTS, PALM_RECTS } from "../src/render-common/trees/foliage-atlas";
import { PALM_CELL, PALM_CELL_COUNT } from "../src/render-common/trees/palm-atlas";
import { getLeafletLength } from "../src/render-common/trees/palm-frond";
import { createPalmModel } from "../src/render-common/trees/palm-model";
import type { Frond, GrowthStage, TreeModel } from "../src/render-common/trees/tree-model";
import { encodeTreeForm, PALM } from "../src/shared/world/tree-forms";
import { PROP } from "../src/shared/world/world-data";

const PALM_COUNT = Object.keys(PALM).length;

const SEED = 77;
const STAGES: GrowthStage[] = [1, 2, 3, 4, 5];
const VARIANTS = Object.values(PALM);

const palm = (archetype: number, stage: GrowthStage, seed = SEED) =>
  createPalmModel(seed, stage, encodeTreeForm(archetype, 0));

/** Height of the crown top (the trunk axis end below its closing cap). */
const getTrunkHeight = (model: TreeModel) => {
  const points = model.wood[0]!.points;
  return points[points.length - 2]![1];
};

/** Elevation (radians) of a frond's first segment. */
const getElevation = (frond: Frond) => {
  const [a, b] = [frond.points[0]!, frond.points[1]!];
  return Math.atan2(b[1] - a[1], Math.hypot(b[0] - a[0], b[2] - a[2]));
};

const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

const getFrondLength = (frond: Frond) =>
  frond.points.slice(1).reduce((sum, point, index) => {
    const previous = frond.points[index]!;
    return sum + Math.hypot(point[0] - previous[0], point[1] - previous[1], point[2] - previous[2]);
  }, 0);

describe("palm models", () => {
  it("are deterministic per seed and differ between seeds", () => {
    expect(palm(PALM.coconut, 5)).toEqual(palm(PALM.coconut, 5));
    expect(palm(PALM.coconut, 5, 1).fronds[3]!.points).not.toEqual(
      palm(PALM.coconut, 5, 2).fronds[3]!.points
    );
  });

  it("grow juvenile structure per stage (frond counts, trunk), never a scaled adult", () => {
    for (const archetype of VARIANTS) {
      const models = STAGES.map((stage) => palm(archetype, stage));
      const counts = models.map((model) => model.fronds.length);
      const trunks = models.map(getTrunkHeight);
      for (let stage = 1; stage < models.length; stage += 1) {
        expect(counts[stage]).toBeGreaterThanOrEqual(counts[stage - 1]!);
        expect(trunks[stage]).toBeGreaterThanOrEqual(trunks[stage - 1]!);
      }
      expect(trunks[0]).toBeLessThan(0.15);
      expect(counts[0]).toBeGreaterThanOrEqual(3);
      expect(counts[0]).toBeLessThanOrEqual(6);
      const upright = average(models[0]!.fronds.map(getElevation));
      expect(upright).toBeGreaterThan(average(models[4]!.fronds.map(getElevation)) + 0.3);
    }
  });

  it("follow the brief's juvenile frond counts for the tree palms", () => {
    for (const archetype of [PALM.coconut, PALM.date, PALM.leaning]) {
      expect(palm(archetype, 2).fronds.length).toBeGreaterThanOrEqual(5);
      expect(palm(archetype, 2).fronds.length).toBeLessThanOrEqual(9);
      expect(palm(archetype, 3).fronds.length).toBeGreaterThanOrEqual(8);
      expect(palm(archetype, 3).fronds.length).toBeLessThanOrEqual(14);
      expect(getTrunkHeight(palm(archetype, 4))).toBeGreaterThan(
        getTrunkHeight(palm(archetype, 3)) * 2
      );
    }
  });

  it("have three distinct small silhouettes (date stiff and dense, coconut broad, shrub low)", () => {
    const date = palm(PALM.date, 2);
    const coconut = palm(PALM.coconut, 2);
    const ground = palm(PALM.ground, 2);
    const spanRatio = (model: TreeModel) =>
      average(model.fronds.map((frond) => Math.max(...frond.widths) / getFrondLength(frond)));
    expect(date.fronds.length).toBeGreaterThan(coconut.fronds.length);
    expect(spanRatio(coconut)).toBeGreaterThan(spanRatio(date) * 1.3);
    expect(ground.bounds.radius / ground.bounds.height).toBeGreaterThan(
      date.bounds.radius / date.bounds.height
    );
  });

  it("give every leaflet row the base / middle / tip length profile", () => {
    expect(getLeafletLength(0)).toBeLessThan(0.3);
    expect(getLeafletLength(1)).toBeLessThan(0.3);
    expect(getLeafletLength(0.4)).toBeGreaterThan(0.95);
    for (const frond of palm(PALM.coconut, 5).fronds) {
      const leafy = frond.widths.slice(frond.leafletStart);
      const widest = leafy.indexOf(Math.max(...leafy)) / (leafy.length - 1);
      expect(widest).toBeGreaterThan(0.15);
      expect(widest).toBeLessThan(0.75);
      expect(frond.widths.slice(0, frond.leafletStart).every((width) => width === 0)).toBe(true);
    }
  });

  it("layer the crown by age: young fronds upright and on top, damage only outside", () => {
    const model = palm(PALM.coconut, 5);
    const young = model.fronds.filter((frond) => frond.age < 0.25);
    const old = model.fronds.filter((frond) => frond.age > 0.75);
    expect(average(young.map(getElevation))).toBeGreaterThan(average(old.map(getElevation)) + 0.8);
    expect(average(young.map((frond) => frond.points[0]![1]))).toBeGreaterThan(
      average(old.map((frond) => frond.points[0]![1]))
    );
    for (const variant of VARIANTS) {
      for (const frond of palm(variant, 5).fronds) {
        if (frond.cell === PALM_CELL.dryTip01) expect(frond.age).toBeGreaterThan(0.7);
      }
    }
  });

  it("place fronds unevenly around the crown (no wheel spokes)", () => {
    const model = palm(PALM.date, 5);
    const angles = model.fronds
      .map((frond) =>
        Math.atan2(
          frond.points[1]![2] - frond.points[0]![2],
          frond.points[1]![0] - frond.points[0]![0]
        )
      )
      .sort((a, b) => a - b);
    const gaps = angles.slice(1).map((angle, index) => angle - angles[index]!);
    const mean = average(gaps);
    const spread = Math.sqrt(average(gaps.map((gap) => (gap - mean) ** 2)));
    expect(spread / mean).toBeGreaterThan(0.3);
  });

  it("hang date fruit in several small-fruit strands with an even ripening spread", () => {
    const date = palm(PALM.date, 5);
    expect(date.fruit.length).toBeGreaterThanOrEqual(80);
    expect(date.fruit.every((fruit) => fruit.radius <= 0.04)).toBe(true);
    expect(date.fruit.filter((fruit) => fruit.color[1] > fruit.color[0] * 1.15).length)
      .toBeGreaterThan(8);
    expect(date.fruit.filter((fruit) => fruit.color[0] > fruit.color[1] * 1.45).length)
      .toBeGreaterThan(25);
    expect(Math.min(...date.fruit.map((fruit) => fruit.position[1])))
      .toBeLessThan(date.crownCentre[1] - 0.2);
    expect(palm(PALM.date, 4).fruit.length).toBeLessThan(date.fruit.length);
    expect(palm(PALM.pygmyDate, 5).fruit).toHaveLength(0);
  });

  it("give each variant its own silhouette", () => {
    const mature = Object.fromEntries(VARIANTS.map((archetype) => [archetype, palm(archetype, 5)]));
    const lean = (model: TreeModel) => Math.hypot(model.crownCentre[0], model.crownCentre[2]);
    expect(lean(mature[PALM.leaning]!)).toBeGreaterThan(lean(mature[PALM.coconut]!) * 1.5);
    expect(mature[PALM.date]!.fronds.length).toBeGreaterThan(mature[PALM.coconut]!.fronds.length);
    expect(mature[PALM.fan]!.fronds.every((frond) => frond.blade === "fan")).toBe(true);
    expect(mature[PALM.fan]!.fronds.some((frond) => frond.dry === 1)).toBe(true);
    expect(mature[PALM.ground]!.bounds.height).toBeLessThan(2.5);
    expect(mature[PALM.ground]!.bounds.radius).toBeGreaterThan(mature[PALM.ground]!.bounds.height);
    expect(mature[PALM.pygmyDate]!.bounds.height).toBeLessThan(
      mature[PALM.coconut]!.bounds.height / 2
    );
    const stubs = (model: TreeModel) => model.wood.length - 1;
    expect(stubs(mature[PALM.date]!)).toBeGreaterThan(stubs(mature[PALM.coconut]!));
    expect(stubs(palm(PALM.date, 1))).toBe(0);
  });
});

describe("palm island meshes", () => {
  it("stay within the gameplay triangle budget with close-up detail on top", () => {
    for (const archetype of VARIANTS) {
      const mesh = createIslandTreeStageMesh(PROP.palmTree, 5, encodeTreeForm(archetype, 0), SEED);
      const core = (mesh.coreIndexCount ?? mesh.indices.length) / 3;
      expect(core).toBeLessThanOrEqual(1700);
      expect(core).toBeGreaterThan(300);
    }
    const coconut = createIslandTreeStageMesh(PROP.palmTree, 5, 0, SEED);
    expect(coconut.coreIndexCount).toBeLessThan(coconut.indices.length);
  });

  it("bend hierarchically: the trunk almost stable, frond tips most", () => {
    const mesh = createIslandTreeStageMesh(PROP.palmTree, 5, 0, SEED);
    const bends = { high: 0, trunk: 0 };
    for (let vertex = 0; vertex < mesh.wind.length / 2; vertex += 1) {
      const bend = mesh.wind[vertex * 2]!;
      const textured = mesh.uvs[vertex * 2]! >= 0;
      if (!textured)
        bends.trunk = Math.max(bends.trunk, mesh.positions[vertex * 3 + 1]! < 1 ? bend : 0);
      if (textured) bends.high = Math.max(bends.high, bend);
    }
    expect(bends.trunk).toBeLessThan(0.1);
    expect(bends.high).toBeGreaterThan(0.8);
  });

  it("register every variant at the young, established and mature age", () => {
    const variants = getTreeVariants(PROP.palmTree);
    expect(variants.length).toBe(PALM_COUNT * 3);
    for (const archetype of VARIANTS) {
      const form = encodeTreeForm(archetype, 0);
      const young = findTreeVariant(PROP.palmTree, form, 3);
      expect(variants[young]).toEqual({ form, stage: 3 });
      expect(variants[getMatureVariant(PROP.palmTree, young)]).toEqual({ form, stage: 5 });
    }
  });
});

describe("palm atlas cells", () => {
  it("stay inside the palm rows without overlapping each other or the birch strip", () => {
    expect(PALM_RECTS.length).toBe(PALM_CELL_COUNT);
    const overlaps = (a: (typeof PALM_RECTS)[0], b: (typeof PALM_RECTS)[0]) =>
      a.u0 < b.u1 - 1e-6 && b.u0 < a.u1 - 1e-6 && a.v0 < b.v1 - 1e-6 && b.v0 < a.v1 - 1e-6;
    PALM_RECTS.forEach((rect, index) => {
      expect(rect.v0).toBeGreaterThanOrEqual(0.5);
      expect(rect.v1).toBeLessThanOrEqual(0.875);
      for (const other of PALM_RECTS.slice(index + 1)) expect(overlaps(rect, other)).toBe(false);
      for (const birch of BIRCH_SPRAY_RECTS) expect(overlaps(rect, birch)).toBe(false);
    });
  });
});
