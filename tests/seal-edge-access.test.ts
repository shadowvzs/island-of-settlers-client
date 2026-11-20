import { expect, it } from "vitest";

import { scoreSealShore } from "../src/render-common/critters/habitat/critter-habitats-shore";
import { createCritterTerrain } from "../src/render-common/critters/habitat/critter-terrain";
import { canHaul } from "../src/render-common/critters/sim/critter-haul";
import { MATERIAL, MATERIAL_COUNT } from "../src/shared/world/world-data";
import { createCritterWorld, critterWorldOptions } from "./critter-test-world";
import { preloadWorlds } from "./helpers/cached-worlds";

preloadWorlds(critterWorldOptions());
it("excludes an edge beach with no real swimming water and accepts its reachable sea inlet", () => {
  const world = createCritterWorld();
  world.waterDepth.fill(0.02);
  world.waterSurface.fill(0);
  world.heights.fill(0);
  world.coastDistance.fill(1);
  world.riverDistance.fill(100);
  world.splat.fill(0);
  for (let vertex = 0; vertex < world.heights.length; vertex++)
    world.splat[vertex * MATERIAL_COUNT + MATERIAL.sand] = 255;
  const terrain = createCritterTerrain(world),
    vertex = 20 * (world.cellsX + 1);
  expect(scoreSealShore(terrain, vertex)).toBe(0);
  world.waterDepth[vertex + 1] = 0.3;
  expect(scoreSealShore(terrain, vertex)).toBeGreaterThan(0);
  const accepts = canHaul({ terrain } as never);
  expect(accepts(-0.1, 20)).toBe(false);
  expect(accepts(world.cellsX + 0.1, 20)).toBe(false);
  expect(accepts(0, 20)).toBe(true);
});
