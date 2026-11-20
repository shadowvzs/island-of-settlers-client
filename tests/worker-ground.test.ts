import { describe, expect, it } from "vitest";

import { createIslandNav } from "../src/render-common/wildlife/nav/island-nav";
import { isStandFree } from "../src/render-common/wildlife/nav/nav-query";
import { NAV_RES } from "../src/render-common/wildlife/nav/nav-terrain";
import { createWorkerGroup } from "../src/render-common/workers/worker-group";
import { createWorkerGroundMask, createWorkerNav } from "../src/render-common/workers/worker-nav";
import { resolveWorkerTarget, WORKER_NAV_SPECIES } from "../src/render-common/workers/worker-unit";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { BUILD } from "../src/shared/world/world-data";
import { cachedWorld } from "./helpers/cached-worlds";

const SMALL = { ...DEFAULT_WORLD_OPTIONS, cellsX: 96, cellsZ: 96, erosionDroplets: 8000 };

describe("worker ground", () => {
  it("is the building land: every cell with a build class, never one without", () => {
    const grid = {
      buildClass: Uint8Array.from([BUILD.none, BUILD.flag, BUILD.mine, BUILD.large]),
      cellsX: 2,
      cellsZ: 2
    };
    const width = 2 * NAV_RES;
    const mask = createWorkerGroundMask(grid, width, width);
    expect(mask[0]).toBe(0);
    expect(mask[NAV_RES]).toBe(1);
    expect(mask[NAV_RES * width]).toBe(1);
    expect(mask[width * width - 1]).toBe(1);
  });

  const world = cachedWorld(SMALL);
  const base = createIslandNav(world, []);
  const { nav } = createWorkerNav(world, base, WORKER_NAV_SPECIES);
  const cellOf = (x: number, z: number) => Math.floor(z) * world.cellsX + Math.floor(x);

  it("keeps workers off every cell without a build class (the animals' nav unchanged)", () => {
    let blocked = 0;
    for (let cell = 0; cell < world.buildClass.length; cell += 1) {
      if (world.buildClass[cell] !== BUILD.none) continue;
      const x = (cell % world.cellsX) + 0.5;
      const z = Math.floor(cell / world.cellsX) + 0.5;
      expect(isStandFree(nav, WORKER_NAV_SPECIES, x, z)).toBe(false);
      if (isStandFree(base, WORKER_NAV_SPECIES, x, z)) blocked += 1;
    }
    expect(blocked).toBeGreaterThan(0);
  });

  it("sends a command onto blocked ground to the nearest spot on building land", () => {
    const tree = [...world.buildClass.keys()].find(
      (cell) =>
        world.buildClass[cell] === BUILD.none &&
        world.buildClass[cell + 2] !== BUILD.none &&
        world.waterDepth[
          Math.floor(cell / world.cellsX) * (world.cellsX + 1) + (cell % world.cellsX)
        ] === 0
    )!;
    const x = (tree % world.cellsX) + 0.5;
    const z = Math.floor(tree / world.cellsX) + 0.5;
    const target = resolveWorkerTarget(nav, x, z);
    expect(target).not.toBeNull();
    expect(world.buildClass[cellOf(target!.x, target!.z)]).not.toBe(BUILD.none);
  });

  it("moves workers out of an edited area onto building land", () => {
    const group = createWorkerGroup(world, base, [
      { nation: "roman", variant: "roman-man-white" },
      { nation: "roman", variant: "roman-man-white" }
    ]);
    const centre = { x: group.frames[0]!.x, z: group.frames[0]!.z };
    const isInside = (x: number, z: number) => Math.hypot(x - centre.x, z - centre.z) < 4;
    group.relocateFrom(isInside);
    for (const frame of group.frames) {
      expect(isInside(frame.x, frame.z)).toBe(false);
      expect(world.buildClass[cellOf(frame.x, frame.z)]).not.toBe(BUILD.none);
    }
  });
});
