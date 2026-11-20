import { expect, it } from "vitest";

import { BEHAVIOUR } from "../src/render-common/critters/critter-colonies";
import { CRITTER } from "../src/render-common/critters/critter-species";
import type { CritterContext } from "../src/render-common/critters/sim/critter-context";
import { createCritterPool } from "../src/render-common/critters/sim/critter-pool";
import { relocateGroundCritters } from "../src/render-common/critters/sim/critter-relocation";
import { createForestDepth } from "../src/render-common/wildlife/nav/forest-depth";
import { createColliderSet } from "../src/render-common/wildlife/nav/nav-colliders";
import { createPathFinder, MAX_PATH_POINTS } from "../src/render-common/wildlife/nav/nav-path";
import {
  isBodyFree,
  isSegmentWalkable,
  isStandFree,
  type NavWorld
} from "../src/render-common/wildlife/nav/nav-query";
import { createNavTerrain } from "../src/render-common/wildlife/nav/nav-terrain";
import { createSpeciesNav } from "../src/render-common/wildlife/nav/species-nav";
import { moveOutside } from "../src/render-common/wildlife/sim/animal-placement";
import { createAnimalPool } from "../src/render-common/wildlife/sim/animal-pool";
import type { WildlifeContext } from "../src/render-common/wildlife/sim/wildlife-context";
import {
  SPECIES,
  SPECIES_IDS,
  SPECIES_PROFILES
} from "../src/render-common/wildlife/wildlife-species";
import { createBuildingPlotMask } from "../src/shared/settlement/settlement-plot-clearance";

const fixture = () => {
  const terrain = createNavTerrain({
    cellsX: 40,
    cellsZ: 40,
    height: () => 1,
    isBlockedGround: () => false,
    waterDepth: () => 0
  });
  const colliders = createColliderSet(40, 40, []);
  const forestDepth = createForestDepth(terrain, colliders);
  const plots = createBuildingPlotMask(40, 40);
  const nav: NavWorld = {
    terrain,
    colliders,
    isExcluded: plots.contains,
    species: SPECIES_IDS.map((id) =>
      createSpeciesNav(terrain, colliders, SPECIES_PROFILES[id]!, id, forestDepth)
    )
  };
  return { nav, plots };
};

it("reserves rotated rectangular plots exactly and accounts for an animal's body radius", () => {
  const { plots } = fixture();
  plots.add({ x: 20, z: 20, width: 4, depth: 6 });
  expect(plots.contains(18, 17)).toBe(true);
  expect(plots.contains(21.99, 22.99)).toBe(true);
  expect(plots.contains(22, 20)).toBe(false);
  expect(plots.contains(22.1, 20, 0.2)).toBe(true);
  expect(plots.contains(22.3, 20, 0.2)).toBe(false);
});

it("relocates a living animal from a new plan without killing it and blocks reentry", () => {
  const { nav, plots } = fixture();
  const pool = createAnimalPool(1);
  pool.x[0] = 20;
  pool.z[0] = 20;
  pool.species[0] = SPECIES.deer;
  pool.active[0] = 1;
  pool.bodyScale[0] = 1;
  pool.pathCount[0] = 4;
  const context = { nav, pool } as WildlifeContext;
  plots.add({ x: 20, z: 20, width: 4, depth: 6 });
  expect(moveOutside(context, 0, plots.contains)).toBe(true);
  expect(plots.contains(pool.x[0]!, pool.z[0]!)).toBe(false);
  expect(pool.active[0]).toBe(1);
  expect(pool.carcass[0]).toBe(0);
  expect(pool.pathCount[0]).toBe(0);
  expect(isBodyFree(nav, SPECIES.deer, pool.x[0]!, pool.z[0]!, pool.heading[0]!)).toBe(true);
  expect(isStandFree(nav, SPECIES.deer, 20, 20)).toBe(false);
  expect(isSegmentWalkable(nav, SPECIES.deer, pool.x[0]!, pool.z[0]!, 20, 20)).toBe(false);
});

it("plans wildlife paths around construction plots instead of through them", () => {
  const { nav, plots } = fixture();
  const finder = createPathFinder(nav);
  plots.add({ x: 20, z: 20, width: 4, depth: 6 });
  const path = new Float32Array(MAX_PATH_POINTS * 2);
  const count = finder.findPath(SPECIES.deer, 15, 20, 25, 20, path);
  expect(count).toBeGreaterThan(1);
  let x = 15,
    z = 20;
  for (let i = 0; i < count; i++) {
    const nextX = path[i * 2]!,
      nextZ = path[i * 2 + 1]!;
    expect(plots.contains(nextX, nextZ)).toBe(false);
    expect(isSegmentWalkable(nav, SPECIES.deer, x, z, nextX, nextZ)).toBe(true);
    x = nextX;
    z = nextZ;
  }
});

it("moves ambient ground critters outside while allowing flying creatures above the plot", () => {
  const { nav, plots } = fixture();
  plots.add({ x: 20, z: 20, width: 4, depth: 6 });
  const pool = createCritterPool(2);
  pool.active.fill(1);
  pool.x.fill(20);
  pool.z.fill(20);
  pool.behaviour.set([BEHAVIOUR.roam, BEHAVIOUR.soar]);
  pool.species.set([CRITTER.fox, CRITTER.eagle]);
  pool.lift[1] = 4;
  const context = {
    nav,
    random: () => 0.5,
    terrain: { ground: () => 1, hidden: () => false }
  } as unknown as CritterContext;
  const remembered: number[] = [];
  relocateGroundCritters(pool, context, plots.contains, (id) => remembered.push(id));
  expect(plots.contains(pool.x[0]!, pool.z[0]!)).toBe(false);
  expect(pool.active[0]).toBe(1);
  expect(pool.carcass[0]).toBe(0);
  expect(pool.y[0]).toBe(1);
  expect(remembered).toEqual([0]);
  expect(pool.x[1]).toBe(20);
  expect(pool.z[1]).toBe(20);
  expect(pool.lift[1]).toBe(4);
});
