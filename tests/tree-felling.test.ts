import { describe, expect, it } from "vitest";

import { pickTree } from "../src/app/tree-picking";
import { createCamera } from "../src/render-common/camera-state";
import { createFellingSimulation } from "../src/render-common/felling/felling-simulation";
import { PROP_CUT_HEIGHT } from "../src/render-common/felling/felling-trees";
import { createLeafParticles } from "../src/render-common/felling/leaf-particles";
import {
  createFellingController,
  getFellingState
} from "../src/render-common/felling/tree-felling";
import { getMatureMeshId } from "../src/render-common/growth/stage-meshes";
import { getMeshKind } from "../src/render-common/props/prop-meshes";
import { createStumpMeshes } from "../src/render-common/props/stump-meshes";
import { createRandom } from "../src/shared/world/rng";
import { PROP } from "../src/shared/world/world-data";
import { projectIsoToViewport } from "./iso-view";

describe("felling timeline", () => {
  it("removes harvested trees exactly once after falling, with no permanent stump", () => {
    const removed: number[] = [];
    const body = { canopyHeight: 3, canopyRadius: 1, x: 5, y: 0, z: 5 };
    const simulation = createFellingSimulation(() => body, 7, (id) => removed.push(id));
    expect(simulation.fell(4)).toBe(true);
    expect(simulation.fell(4)).toBe(false);
    simulation.update(3.5);
    expect(simulation.frame.getState(4).phase).toBe("falling");
    expect(simulation.frame.getState(4).showStump).toBe(false);
    expect(removed).toEqual([]);
    simulation.update(9);
    expect(removed).toEqual([4]);
    expect([...simulation.frame.felledIds()]).toEqual([]);
    expect(simulation.countStumps()).toBe(0);
    simulation.update(20);
    expect(removed).toEqual([4]);
  });
  it("chops, falls, rests and leaves a stump", () => {
    const phases = [0.1, 2.5, 3.5, 5.5, 9].map((time) => getFellingState(time, 1).phase);
    expect(phases).toEqual(["chopping", "chopping", "falling", "fallen", "stump"]);
    const chopping = getFellingState(0.3, 1);
    expect(chopping.chop[0]).toBeGreaterThan(0.5);
    expect(chopping.showStump).toBe(false);
    const stump = getFellingState(9, 1);
    expect(stump.showTree).toBe(false);
    expect(stump.showStump).toBe(true);
    expect(stump.chop[1]).toBeGreaterThan(0.9);
  });

  it("emits every axe hit and the impact once", () => {
    const controller = createFellingController();
    controller.fell(7, 0, 0);
    expect(controller.fell(7, 0.5, 0)).toBe(false);
    const events = [1, 2, 3, 4, 5, 6].flatMap((time) => controller.update(time));
    expect(events.filter((event) => event.kind === "hit")).toHaveLength(4);
    expect(events.filter((event) => event.kind === "impact")).toHaveLength(1);
    expect(controller.countStumps(20)).toBe(1);
  });
});

describe("falling leaves", () => {
  it("drift down to the ground and fade out", () => {
    const system = createLeafParticles(32, createRandom(3));
    system.spawn({ count: 10, ground: 0, radius: 1, size: 0.1, x: 0, y: 5, z: 0 });
    system.update(0.5);
    const { alpha, y } = system.particles;
    expect(Math.max(...y.slice(0, 10))).toBeLessThan(5.5);
    for (let step = 0; step < 120; step += 1) system.update(0.1);
    expect(Math.min(...y.slice(0, 10))).toBe(0);
    expect(Math.max(...alpha)).toBe(0);
  });
});

describe("stumps", () => {
  it("exist for every growth line of every tree kind and stay below the cut", () => {
    const stumps = createStumpMeshes(1);
    const kinds = new Set([...stumps.keys()].map(getMeshKind));
    for (const kind of [PROP.broadleafTree, PROP.coniferTree, PROP.palmTree, PROP.birchTree])
      expect(kinds.has(kind)).toBe(true);
    expect([...stumps.keys()].every((line) => getMatureMeshId(line) === line)).toBe(true);
    for (const stump of stumps.values()) {
      const heights = Array.from(stump.positions).filter((_, index) => index % 3 === 1);
      expect(Math.max(...heights)).toBeLessThan(PROP_CUT_HEIGHT + 0.01);
    }
  });
});

describe("tree picking", () => {
  const camera = createCamera(10, 10, 1);
  camera.viewportWidth = 800;
  camera.viewportHeight = 600;
  const project = (x: number, y: number, z: number) => projectIsoToViewport(camera, x, y, z);
  const tree = { canopyHeight: 1.55, canopyRadius: 0.95, x: 10, y: 0, z: 10 };

  it("picks the crown under the pointer, the front tree first", () => {
    const behind = { ...tree, x: 9.8, z: 9.8 };
    expect(pickTree(project, { x: 400, y: 245 }, [[1, tree]])).toBe(1);
    expect(
      pickTree(project, { x: 400, y: 245 }, [
        [2, behind],
        [1, tree]
      ])
    ).toBe(1);
    expect(pickTree(project, { x: 50, y: 50 }, [[1, tree]])).toBeNull();
  });
});

it("plays an upgraded woodcutter's felling (chop hits, fall, landing) faster by its rate, saved with it", () => {
  const normal = createFellingController(), fast = createFellingController();
  normal.fell(1, 10, .5); fast.fell(1, 10, .5, 1.1);
  for (const elapsed of [0, 1, 2.5, 4, 6, 9]) {
    const a = fast.getState(1, 10 + elapsed / 1.1), b = normal.getState(1, 10 + elapsed);
    expect(a.phase).toBe(b.phase);
    a.chop.forEach((value, index) => expect(value).toBeCloseTo(b.chop[index]!, 6));
  }
  const normalHits = normal.update(10 + 3).length, fastHits = fast.update(10 + 3 / 1.1).length;
  expect(fastHits).toBe(normalHits);
  const restored = createFellingController();
  restored.loadState(JSON.parse(JSON.stringify(fast.saveState())));
  expect(restored.getState(1, 12)).toEqual(fast.getState(1, 12));
});
