import { describe, expect, it } from "vitest";

import { createIslandGrowth } from "../src/app/island-growth";
import { getChoppableTree } from "../src/render-common/felling/felling-trees";
import {
  createTreeStageMeshes,
  getGrowthScale,
  getMatureMeshId
} from "../src/render-common/growth/stage-meshes";
import {
  createStaticTreeForms,
  type StaticTreeForm
} from "../src/render-common/growth/static-tree-forms";
import {
  createTreeGrowth, getGrowthState, MATURE_STAGE, pickSproutingTrees
} from "../src/render-common/growth/tree-growth";
import {
  findTreeVariant,
  getMatureVariant,
  getStumpScale,
  getTreeVariant,
  getTreeVariants
} from "../src/render-common/props/island-trees";
import type { PropMesh } from "../src/render-common/props/mesh-builder";
import { createPropMeshes, getMeshId } from "../src/render-common/props/prop-meshes";
import { TREE_GROWTH_SECONDS } from "../src/shared/balance/economy";
import { BIRCH, encodeTreeForm } from "../src/shared/world/tree-forms";
import { PROP, type WorldData } from "../src/shared/world/world-data";

const createGrowth = (canGrow: (id: number) => boolean = () => true) =>
  createTreeGrowth([1, 2, 3], 3, canGrow);

/** A one tree world (only the fields felling reads). */
const createTreeWorld = (scale: number) =>
  ({
    props: {
      count: 1,
      form: [0],
      scale: [scale],
      types: [PROP.broadleafTree],
      x: [4],
      y: [1],
      z: [6]
    }
  }) as unknown as WorldData;

describe("tree growth", () => {
  it("keeps job-planted seedlings growing when decorative sprouting is toggled", () => {
    const growth = createGrowth();
    growth.update(10);
    growth.plant(99);
    growth.stop();
    expect(growth.frame.isGrowing(99)).toBe(true);
    growth.update(40);
    expect([...growth.frame.growing()].find((tree) => tree.id === 99)?.stage).toBe(2);
    growth.start();
    growth.update(10 + TREE_GROWTH_SECONDS);
    expect(growth.frame.isGrown(99)).toBe(true);
    growth.stop();
    expect(growth.frame.isGrown(99)).toBe(true);
  });
  it("starts as a stage 1 sprout", () => {
    expect(getGrowthState(0)).toEqual({ progress: 0, stage: 1 });
  });

  it("reaches the mature stage after the growth time", () => {
    expect(MATURE_STAGE).toBe(5);
    expect(getGrowthState(TREE_GROWTH_SECONDS)).toBeNull();
    expect(getGrowthState(TREE_GROWTH_SECONDS - 0.01)?.stage).toBe(MATURE_STAGE - 1);
  });

  it("moves through the stages without going back", () => {
    let previous = 0;
    for (let age = 0; age < TREE_GROWTH_SECONDS; age += 0.5) {
      const state = getGrowthState(age)!;
      const position = state.stage + state.progress;
      expect(position).toBeGreaterThanOrEqual(previous);
      previous = position;
    }
  });

  it("grows every allowed tree to maturity and keeps it grown", () => {
    const growth = createGrowth((id) => id !== 2);
    growth.start();
    growth.update(30);
    expect(growth.frame.isGrowing(1)).toBe(true);
    expect(growth.frame.isGrowing(2)).toBe(false);
    growth.update(TREE_GROWTH_SECONDS + 30);
    expect([...growth.frame.growing()]).toHaveLength(0);
    expect([...growth.frame.grownIds()].sort((a, b) => a - b)).toEqual([1, 3]);
    growth.update(TREE_GROWTH_SECONDS * 3);
    expect(growth.frame.isGrown(1)).toBe(true);
  });

  it("brings back the world forest when stopped, felled grown trees stay mature", () => {
    const standing = new Set([1, 2, 3]);
    const growth = createGrowth((id) => standing.has(id));
    growth.start();
    growth.update(TREE_GROWTH_SECONDS + 30);
    standing.delete(3);
    growth.stop();
    growth.update(TREE_GROWTH_SECONDS + 31);
    expect([...growth.frame.growing()]).toHaveLength(0);
    expect([...growth.frame.grownIds()]).toEqual([3]);
  });
});

describe("tree growth event-core boundaries", () => {
  it("reports a planted tree that is already mature as due now, not as finished", () => {
    const growth = createTreeGrowth([], 1, () => true);
    growth.start();
    growth.update(0);
    growth.plant(99);
    expect(growth.frame.isGrowing(99)).toBe(true);
    expect(growth.nextBoundary(0)).toBe(30);
    expect(growth.nextBoundary(119.95)).toBe(TREE_GROWTH_SECONDS);
    // Maturity has no later stage: while the tree is still planted, the update that moves it to
    // grown is due on this tick. Reporting null here lets the event core drop that update.
    expect(growth.nextBoundary(TREE_GROWTH_SECONDS)).toBe(TREE_GROWTH_SECONDS);
    expect(growth.nextBoundary(TREE_GROWTH_SECONDS + 5)).toBe(TREE_GROWTH_SECONDS + 5);
    growth.update(TREE_GROWTH_SECONDS + 5);
    expect(growth.frame.isGrown(99)).toBe(true);
    expect(growth.nextBoundary(TREE_GROWTH_SECONDS + 5)).toBeNull();
  });
});

describe("static tree forms", () => {
  it("turns a finishing tree mature in the same frame (no pop back) and restores on stop", () => {
    const applied: [number, StaticTreeForm][] = [];
    const forms = createStaticTreeForms((id, form) => applied.push([id, form]));
    const growth = createTreeGrowth([1], 3, () => true);
    growth.start();
    growth.update(1);
    forms.sync(growth.frame);
    expect(applied).toEqual([[1, "hidden"]]);
    let time = 1;
    while (growth.frame.isGrowing(1)) {
      time += 0.25;
      growth.update(time);
      forms.sync(growth.frame);
    }
    expect(applied).toEqual([
      [1, "hidden"],
      [1, "mature"]
    ]);
    growth.update(time + 60);
    forms.sync(growth.frame);
    growth.stop();
    forms.sync(growth.frame);
    expect(applied.at(-1)).toEqual([1, "world"]);
  });

  it("ends the last stage at the mature mesh's size", () => {
    const heights = [0.2, 0.5, 1, 1.4, 2];
    const meshes = heights.map((height) => ({ height }) as PropMesh);
    const lastStage = 4;
    expect(lastStage).toBe(MATURE_STAGE - 1);
    expect(getGrowthScale(meshes, lastStage, 1) * heights[lastStage - 1]!).toBeCloseTo(2);
  });
});

describe("growing birches", () => {
  const propMeshes = createPropMeshes(2024);
  const lines = createTreeStageMeshes(propMeshes, 2024);

  it("transforms newly generated saplings without transforming canonical grown meshes twice", () => {
    const transformed = new Set<PropMesh>();
    const seasonal = createTreeStageMeshes(propMeshes, 2024, mesh => {
      const converted = { ...mesh, colors: mesh.colors.slice() };
      transformed.add(converted);
      return converted;
    });
    for (const [id, stages] of seasonal) {
      expect(transformed.has(stages[0]!)).toBe(true);
      expect(transformed.has(stages[1]!)).toBe(true);
      for (let index = 2; index < stages.length; index++) expect(stages[index]).toBe(lines.get(id)![index]);
    }
  });

  it("grow every birch structure from a sapling to its own mature mesh with no pop", () => {
    for (const archetype of Object.values(BIRCH)) {
      const form = encodeTreeForm(archetype, 0);
      const young = findTreeVariant(PROP.birchTree, form, 3);
      const mature = getMatureVariant(PROP.birchTree, young);
      expect(getTreeVariants(PROP.birchTree)[mature]).toEqual({ form, stage: 5 });
      const line = lines.get(getMatureMeshId(getMeshId(PROP.birchTree, young)))!;
      expect(line).toHaveLength(5);
      const heights = line.map((mesh) => mesh.height);
      for (let stage = 1; stage < 5; stage += 1) {
        expect(heights[stage]!).toBeGreaterThan(heights[stage - 1]!);
      }
      expect(getGrowthScale(line, 4, 1) * heights[3]!).toBeCloseTo(heights[4]!);
    }
  });
});

describe("felling grown trees", () => {
  it("uses the mature mesh, crown and stump", () => {
    const mature = getMatureVariant(PROP.palmTree, 0);
    expect(getMatureMeshId(getMeshId(PROP.palmTree, 0))).toBe(getMeshId(PROP.palmTree, mature));
    expect(getStumpScale(PROP.palmTree, mature)).toBe(1);
    const world = createTreeWorld(0.7);
    expect(getTreeVariant(PROP.palmTree, 0.7)).toBe(0);
    const young = getChoppableTree(world, 0)!;
    const grown = getChoppableTree(world, 0, true)!;
    expect(grown.canopyHeight).toBeGreaterThan(young.canopyHeight * 1.5);
    expect(grown.canopyRadius).toBeGreaterThan(young.canopyRadius * 1.5);
    expect(grown.x).toBe(young.x);
  });
});

describe("pickSproutingTrees", () => {
  it("picks about the share, the same trees for the same seed", () => {
    const ids = Array.from({ length: 4000 }, (_, index) => index);
    const picked = pickSproutingTrees(ids, 1234, 0.05);
    expect(picked.length / ids.length).toBeGreaterThan(0.04);
    expect(picked.length / ids.length).toBeLessThan(0.06);
    expect(pickSproutingTrees(ids, 1234, 0.05)).toEqual(picked);
  });
});

describe("trees removed while playing (map editor)", () => {
  it("stop growing and are no longer grown", () => {
    const growth = createTreeGrowth([4, 7], 1, () => true);
    growth.start();
    growth.update(30);
    expect(growth.frame.isGrowing(7)).toBe(true);
    growth.remove([7]);
    growth.update(31);
    expect(growth.frame.isGrowing(7)).toBe(false);
    growth.update(30 + TREE_GROWTH_SECONDS * 2);
    expect(growth.frame.isGrown(7)).toBe(false);
    expect(growth.frame.isGrown(4)).toBe(true);
    growth.stop();
    growth.start();
    growth.update(30 + TREE_GROWTH_SECONDS * 2 + 20);
    expect(growth.frame.isGrowing(7)).toBe(false);
  });
});

describe("trees restored by undo (map editor)", () => {
  it("grow again: a growing one restarts, a grown one stands grown, others stay out", () => {
    const growth = createTreeGrowth([4, 7], 1, () => true);
    growth.start();
    growth.update(30 + TREE_GROWTH_SECONDS * 2);
    growth.remove([4, 7, 9]);
    growth.restore([4, 9]);
    growth.update(31 + TREE_GROWTH_SECONDS * 2);
    expect(growth.frame.isGrown(4)).toBe(true);
    expect(growth.frame.isGrowing(9)).toBe(false);
    expect(growth.frame.isGrown(9)).toBe(false);
    growth.stop();
    growth.start();
    growth.update(40 + TREE_GROWTH_SECONDS * 2);
    growth.remove([4]);
    growth.restore([4]);
    growth.update(41 + TREE_GROWTH_SECONDS * 2);
    expect(growth.frame.isGrowing(4)).toBe(true);
    growth.update(42 + TREE_GROWTH_SECONDS * 4);
    expect(growth.frame.isGrown(4)).toBe(true);
  });

  it("join the growth list while growth is off", () => {
    const growth = createTreeGrowth([4], 1, () => true);
    growth.remove([4]);
    growth.restore([4]);
    growth.start();
    growth.update(20);
    expect(growth.frame.isGrowing(4)).toBe(true);
  });
});

it("island seedlings grow automatically without a settings toggle", () => {
  const world = { ...createTreeWorld(1), seed: 42 } as WorldData;
  const growth = createIslandGrowth(world, () => true);
  growth.update(10);
  growth.plant(99);
  expect(growth.isGrowing(99)).toBe(true);
  growth.update(70);
  expect(growth.isGrowing(99)).toBe(true);
  growth.update(10 + TREE_GROWTH_SECONDS);
  expect(growth.isGrowing(99)).toBe(false);
  expect(growth.isGrown(99)).toBe(true);
});

it("starts a generated forest mature without needing the standing-tree dependency", () => {
  const world = { ...createTreeWorld(1), seed: 42 } as WorldData;
  world.props = {
    ...world.props, count: 300,
    form: new Uint8Array(300), scale: new Float32Array(300).fill(1),
    types: new Uint8Array(300).fill(PROP.broadleafTree),
    x: new Float32Array(300), y: new Float32Array(300), z: new Float32Array(300)
  } as WorldData["props"];
  let calls = 0;
  let standing: ((id: number) => boolean) | undefined;
  const growth = createIslandGrowth(world, id => {
    if (!standing) throw new Error("felling not initialized");
    calls++;
    return standing(id);
  });
  standing = () => true;
  growth.update(0);
  // New generated maps have no decorative sprouts, so startup does not need felling yet.
  expect(calls).toBe(0);
  growth.plant(99);
  growth.update(TREE_GROWTH_SECONDS);
  expect(growth.isGrown(99)).toBe(true);
});
