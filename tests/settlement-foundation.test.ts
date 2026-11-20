import { expect, it } from "vitest";

import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { levelBuildingFoundation } from "../src/shared/settlement/settlement-foundation";
import { foundationTiles } from "../src/shared/settlement/settlement-foundation-worker";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementBuilding } from "../src/shared/settlement/settlement-types";
import { sampleSmooth } from "../src/shared/world/grid-geometry";
import { computeNormals } from "../src/shared/world/lighting";
import { BUILD, MATERIAL_COUNT, type WorldData } from "../src/shared/world/world-data";

const terrain = () => {
  const size = 40,
    vertices = (size + 1) ** 2,
    cells = size ** 2;
  const world = {
    seed: 9,
    cellsX: size,
    cellsZ: size,
    seaLevel: -1,
    start: { x: 6, z: 6 },
    heights: new Float32Array(vertices),
    waterDepth: new Float32Array(vertices),
    heightLevels: new Uint8Array(vertices),
    splat: new Uint8Array(vertices * MATERIAL_COUNT),
    blocking: new Uint8Array(cells),
    slopeClass: new Uint8Array(cells),
    walkCost: new Uint8Array(cells).fill(10),
    buildCap: new Uint8Array(cells).fill(BUILD.large),
    buildClass: new Uint8Array(cells).fill(BUILD.large),
    oreAmount: new Uint8Array(cells).fill(7),
    mineZone: new Uint16Array(cells),
    mineZones: [],
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array() }
  } as unknown as WorldData;
  for (let z = 0; z <= size; z++)
    for (let x = 0; x <= size; x++) world.heights[z * (size + 1) + x] = 2 + x * 0.035 + z * 0.02;
  world.normals = computeNormals(world, world.heights);
  return world;
};

it.each([0, 1, 2, 3])("visits every tile before supplies and returns the leveler at rotation %i", rotation => {
  const world = terrain(),
    before = world.heights.slice(),
    ore = world.oreAmount.slice();
  const observed: number[] = [];
  const simulation = createSettlementSimulation({
    world,
    roads: createRoadNetwork(world),
    onFoundationLeveled: (building) => {
      if (building.foundationProgress !== 1) return;
      for (let z = building.z - building.depth / 2; z <= building.z + building.depth / 2; z++)
        for (let x = building.x - building.width / 2; x <= building.x + building.width / 2; x++)
          observed.push(Math.abs(world.heights[z * (world.cellsX + 1) + x]! - building.y));
    }
  });
  const beforePlacement = world.heights.slice();
  const placed = simulation.placeBuilding(17, 20, 20, rotation);
  expect(placed.ok, placed.reason).toBe(true);
  expect(world.heights).toEqual(beforePlacement);
  let house = placed.building!;
  expect(house.foundationProgress).toBe(0);
  expect(simulation.connectRoads(simulation.headquarters.access, house.access)).toBe(true);
  const tiles = foundationTiles(house), visited = new Set<number>();
  let sawLeveler = false, resumed = false, levelerId: number | undefined;
  for (let tick = 0; tick < 4000 && (house.foundationProgress ?? 1) < 1; tick++) {
    simulation.update(.05);
    const leveler = simulation.frames().find(actor => actor.job === "Leveler");
    if (leveler) {
      sawLeveler = true; levelerId = leveler.uid;
      expect(leveler.tool).toBe("shovel");
      if (leveler.phase === "levelTile") {
        const index = house.foundationTileIndex ?? 0, tile = tiles[index]!;
        visited.add(index);
        expect(Math.hypot(leveler.x - tile.x - .5, leveler.z - tile.z - .5)).toBeLessThan(.08);
        if (index === 0) {
          // A completed first tile cannot silently flatten the unvisited opposite corner.
          const last = tiles.at(-1)!;
          expect(world.heights[last.z * 41 + last.x]).toBe(beforePlacement[last.z * 41 + last.x]);
        }
      }
    }
    expect(house.construction).toBe(0);
    expect(house.input).toEqual({});
    expect(house.incoming).toEqual({});
    expect(simulation.frames().some(actor => actor.job === "Builder")).toBe(false);
    if (!resumed && (house.foundationProgress ?? 0) > .3) {
      expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
      house = simulation.buildings().find(building => building.uid === house.uid)!;
      resumed = true;
    }
  }
  expect(sawLeveler).toBe(true);
  expect(resumed).toBe(true);
  expect(house.foundationProgress).toBe(1);
  expect(visited.size).toBe(house.width * house.depth);
  expect(simulation.frames().find(actor => actor.uid === levelerId)?.phase).toBe("levelExit");
  // A completed plot with the shovel worker still leaving is also a valid saved state.
  expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
  house = simulation.buildings().find(building => building.uid === house.uid)!;
  // The paid shovel worker must physically leave the plot and return to storage.
  for (let tick = 0; tick < 2000 && simulation.frames().some(actor => actor.uid === levelerId); tick++)
    simulation.update(.05);
  expect(simulation.frames().find(actor => actor.uid === levelerId)).toBeUndefined();
  expect(Math.max(...observed)).toBe(0);
  for (let z = 18; z < 22; z += 0.17)
    for (let x = 18; x < 22; x += 0.17)
      // Road grading may alter the apron read by cubic interpolation at a plot edge.
      // Foundation vertices stay exact; interpolation must remain within 5 mm.
      expect(Math.abs(sampleSmooth(world, world.heights, x, z) - house.y)).toBeLessThan(.005);
  for (let z = 18; z <= 22; z++) for (let x = 18; x <= 22; x++)
    expect(world.heights[z * 41 + x]).toBe(house.y);
  expect(world.heights[20 * 41 + 17]).toBeGreaterThan(before[20 * 41 + 17]!);
  expect(world.heights[20 * 41 + 15]).toBe(before[20 * 41 + 15]);
  expect(world.oreAmount).toEqual(ore);
  expect(world.normals).toEqual(computeNormals(world, world.heights));
  expect(world.walkCost[20 * 40 + 20]).toBe(10);
  const after = world.heights.slice();
  expect(simulation.placeBuilding(17, 20, 20).ok).toBe(false);
  expect(world.heights).toEqual(after);
});

it("preserves wet ground and existing neighboring foundations when blending a new plot", () => {
  const world = terrain();
  const old = { x: 14, z: 20, width: 4, depth: 4, y: 2.7 } as SettlementBuilding;
  levelBuildingFoundation(world, old, []);
  const before = world.heights.slice();
  const wet = 20 * 41 + 23;
  world.waterDepth[wet] = 0.1;
  levelBuildingFoundation(
    world,
    { x: 20, z: 20, width: 4, depth: 4, y: 3.1 } as SettlementBuilding,
    [old]
  );
  expect(world.heights[wet]).toBe(before[wet]);
  for (let z = 18; z <= 22; z++)
    for (let x = 12; x <= 16; x++) expect(world.heights[z * 41 + x]).toBe(before[z * 41 + x]);
  expect(world.normals).toEqual(computeNormals(world, world.heights));
});

it("levels a loaded plot again without drift: its blended apron is not blended a second time", () => {
  const world = terrain();
  const hq = { x: 20, z: 20, width: 4, depth: 4, y: 2.9 } as SettlementBuilding;
  expect(levelBuildingFoundation(world, hq, [])).not.toBeNull();
  const levelled = world.heights.slice();
  // A saved map / game reloads the levelled heights and places the same plot again.
  for (let load = 0; load < 3; load++) {
    expect(levelBuildingFoundation(world, { ...hq }, [])).toBeNull();
    expect(world.heights).toEqual(levelled);
  }
});
