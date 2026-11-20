import { describe, expect, it } from "vitest";

import { type CameraState, createCamera } from "../src/render-common/camera-state";
import { createAnimalManager } from "../src/render-common/wildlife/animal-manager";
import { createIslandNav } from "../src/render-common/wildlife/nav/island-nav";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { cachedWorld } from "./helpers/cached-worlds";
import { runHunt } from "./helpers/wildlife-hunt-run";

/**
 * Measured: a forested 512² island, 163 animals, 0.127 ms per tick; this 128² island, 11 animals,
 * 0.02 ms. The budget leaves ~3× headroom for loaded test machines.
 */
const BUDGET_BASE_MS = 0.05;
const BUDGET_MS_PER_ANIMAL = 0.002;
const BUDGET_TICKS = 600;

const view = (x: number, z: number, zoom: number, viewport = { height: 900, width: 1600 }): CameraState =>
  ({ ...createCamera(x, z, zoom), viewportHeight: viewport.height, viewportWidth: viewport.width });

describe("camera-independent wildlife (D2)", () => {
  it("gives the same hunting results and wildlife state for every camera", () => {
    const cameras = [createCamera(10, 10, .2), view(30, 32, 1), view(2, 62, 3),
      view(32, 32, .01, { height: 1e5, width: 1e5 })];
    const [headless, ...others] = cameras.map(camera => runHunt(camera, 6));
    expect(headless!.meat).toBeGreaterThanOrEqual(2);
    for (const result of others) {
      expect(result.kills).toEqual(headless!.kills);
      expect(result.halfway).toBe(headless!.halfway);
      expect(result.end).toBe(headless!.end);
    }
  });

  it("steps a forested island's wildlife within the per-tick budget", () => {
    const world = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 128, cellsZ: 128 });
    const animals = createAnimalManager(world, createIslandNav(world, []));
    for (let tick = 0; tick < 200; tick++) animals.step();
    const alive = animals.countAlive();
    expect(alive).toBeGreaterThan(5);
    const started = performance.now();
    for (let tick = 0; tick < BUDGET_TICKS; tick++) animals.step();
    const msPerTick = (performance.now() - started) / BUDGET_TICKS;
    expect(msPerTick).toBeLessThan(BUDGET_BASE_MS + alive * BUDGET_MS_PER_ANIMAL);
  });
});
