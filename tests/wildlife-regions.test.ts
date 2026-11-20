import { describe, expect, it } from "vitest";

import {
  apportionTargets,
  createWildlifeRegions,
  getRegionCapacity,
  ISLAND_ANIMAL_CAP,
  REGION_SIZE
} from "../src/render-common/wildlife/population/wildlife-regions";
import { placeProp } from "../src/shared/world/editing/prop-placement";
import { PROP, type WorldData } from "../src/shared/world/world-data";
import { huntingWorld } from "./helpers/hunting-world";

/** A tree at (x, z); the world's prop id. */
const plantTree = (world: WorldData, x: number, z: number) => {
  const id = placeProp(world, { kind: PROP.broadleafTree, seed: Math.round(x * 131 + z), x, z });
  if (typeof id !== "number") throw new Error("the test tree did not fit");
  return id;
};

/** Trees per region counted from scratch (the counters' reference). */
const recount = (world: WorldData, regions: ReturnType<typeof createWildlifeRegions>, counted: Set<number>) => {
  const trees = new Int32Array(regions.count);
  for (const id of counted) {
    const region = regions.regionOf(world.props.x[id]!, world.props.z[id]!);
    trees[region] = trees[region]! + 1;
  }
  return trees;
};

describe("region capacity", () => {
  it.each([
    [0, 0],
    [9, 0],
    [10, 1],
    [31, 1],
    [32, 2],
    [100, 5],
    [252, 12],
    [500, 12]
  ])("%i standing trees support %i animals", (trees, animals) => {
    expect(getRegionCapacity(trees)).toBe(animals);
  });

  it("keeps the capacities as targets while their sum fits the island cap", () => {
    const capacities = Int32Array.from([3, 0, 12, 7]);
    const targets = new Int32Array(4);
    apportionTargets(capacities, ISLAND_ANIMAL_CAP, targets);
    expect([...targets]).toEqual([3, 0, 12, 7]);
  });

  it("apportions the cap by largest remainder, never above a capacity, ties to the lower index", () => {
    const capacities = Int32Array.from([5, 5, 5, 0, 3]);
    const targets = new Int32Array(5);
    apportionTargets(capacities, 10, targets);
    expect([...targets].reduce((sum, value) => sum + value, 0)).toBe(10);
    for (let region = 0; region < 5; region += 1) expect(targets[region]).toBeLessThanOrEqual(capacities[region]!);
    // Scaled shares 50/18, 50/18, 50/18, 0, 30/18: floors 2, 2, 2, 0, 1; remainders 14, 14, 14, 0, 12.
    expect([...targets]).toEqual([3, 3, 3, 0, 1]);
    const again = new Int32Array(5);
    apportionTargets(capacities, 10, again);
    expect([...again]).toEqual([...targets]);
  });
});

describe("region counters", () => {
  it("counts trees in O(1) per event and always equals a full recount", () => {
    const world = huntingWorld();
    const changed: number[] = [];
    const regions = createWildlifeRegions(world, (region) => changed.push(region));
    expect(regions.count).toBe(4);
    expect(regions.regionOf(5, 5)).toBe(0);
    expect(regions.regionOf(REGION_SIZE + 1, 5)).toBe(1);
    expect(regions.regionOf(5, REGION_SIZE + 1)).toBe(2);
    const counted = new Set<number>();
    const ids: number[] = [];
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 6; column += 1) ids.push(plantTree(world, 4 + column * 2.5, 4 + row * 2.5));
    }
    for (let column = 0; column < 12; column += 1) ids.push(plantTree(world, 34 + column * 2.2, 40));
    for (const id of ids) {
      expect(regions.countTree(id)).toBe(regions.regionOf(world.props.x[id]!, world.props.z[id]!));
      counted.add(id);
      expect([...regions.trees]).toEqual([...recount(world, regions, counted)]);
    }
    expect(regions.countTree(ids[0]!)).toBe(-1);
    expect(regions.trees[0]).toBe(24);
    expect(regions.capacity[0]).toBe(getRegionCapacity(24));
    expect(regions.target[0]).toBe(regions.capacity[0]);
    expect(regions.capacity[3]).toBe(1);
    // 24 trees: one capacity step (0 -> 1 at the 10th tree), so one target change.
    expect(changed.filter((region) => region === 0)).toEqual([0]);
    for (const id of ids.slice(0, 15)) {
      expect(regions.uncountTree(id)).toBe(0);
      counted.delete(id);
      expect([...regions.trees]).toEqual([...recount(world, regions, counted)]);
    }
    expect(regions.uncountTree(ids[0]!)).toBe(-1);
    expect(regions.capacity[0]).toBe(0);
    expect(regions.target[0]).toBe(0);
    expect(regions.isCounted(ids[20]!)).toBe(true);
    expect(regions.isCounted(ids[0]!)).toBe(false);
  });

  it("lists the regions a circle or a cell region reaches", () => {
    const world = huntingWorld();
    const regions = createWildlifeRegions(world, () => {});
    const inCircle: number[] = [];
    regions.forEachRegionInCircle(30, 30, 3, (region) => inCircle.push(region));
    expect(inCircle).toEqual([0, 1, 2, 3]);
    const inCorner: number[] = [];
    regions.forEachRegionInCircle(2, 2, 3, (region) => inCorner.push(region));
    expect(inCorner).toEqual([0]);
    const inCells: number[] = [];
    regions.forEachRegionInCells({ maxX: 40, maxZ: 10, minX: 36, minZ: 2 }, (region) => inCells.push(region));
    expect(inCells).toEqual([1]);
    const outside: number[] = [];
    regions.forEachRegionInCircle(200, 200, 3, (region) => outside.push(region));
    expect(outside).toEqual([]);
  });

  it("rescales targets under the island cap when the capacities exceed it", () => {
    const world = huntingWorld();
    const changed = new Set<number>();
    const regions = createWildlifeRegions(world, (region) => changed.add(region), 3);
    const ids: number[] = [];
    for (let row = 0; row < 5; row += 1) {
      for (let column = 0; column < 7; column += 1) {
        ids.push(plantTree(world, 1 + column * 2, 2 + row * 2));
        ids.push(plantTree(world, 1 + column * 2, REGION_SIZE + 2 + row * 2));
      }
    }
    for (const id of ids) regions.countTree(id);
    expect([...regions.capacity]).toEqual([2, 0, 2, 0]);
    expect([...regions.target].reduce((sum, value) => sum + value, 0)).toBe(3);
    // Equal shares: the seeded per-region tie order (not the map edge) decides who gets the extra.
    expect([[2, 0, 1, 0], [1, 0, 2, 0]]).toContainEqual([...regions.target]);
    expect([...changed].sort()).toEqual([0, 2]);
    for (const id of ids.filter((_, index) => index % 2 === 1)) regions.uncountTree(id);
    expect([...regions.target]).toEqual([2, 0, 0, 0]);
    const again = createWildlifeRegions(world, () => undefined, 3);
    for (const id of ids.filter((_, index) => index % 2 === 0)) again.countTree(id);
    expect([...again.target]).toEqual([...regions.target]);
  });
});
