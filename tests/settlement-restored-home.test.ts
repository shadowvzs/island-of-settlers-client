import { expect, it } from "vitest";

import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, PROP, type WorldData } from "../src/shared/world/world-data";

it("restores the saved home identity without grading a new start into the decoded world", () => {
  const size = 48, heights = new Float32Array((size + 1) ** 2);
  for (let z = 0; z <= size; z++) for (let x = 0; x <= size; x++)
    heights[z * (size + 1) + x] = 2 + x * .08 + z * .04;
  const world = { seed: 19, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 8, z: 8 },
    heights, walkCost: new Uint8Array(size ** 2).fill(10), blocking: new Uint8Array(size ** 2),
    buildClass: new Uint8Array(size ** 2).fill(BUILD.large), mineZones: [],
    props: { count: 1, types: new Uint8Array([PROP.broadleafTree]), x: new Float32Array([32]),
      z: new Float32Array([32]), scale: new Float32Array([1]) } } as unknown as WorldData;
  const original = createSettlementSimulation({ world, roads: createRoadNetwork(world) });
  const saved = original.saveState(), home = saved.buildings.find(building => building.typeId === 0)!;
  world.start = { x: 32, z: 32 };
  const terrain = world.heights.slice(), walk = world.walkCost.slice(), props = world.props.types.slice();
  const restored = createSettlementSimulation({ world, roads: createRoadNetwork(world), restoredHome: home });
  const identity = restored.home();
  expect(identity).not.toBe(home);
  expect(world.heights).toEqual(terrain);
  expect(world.walkCost).toEqual(walk);
  expect(world.props.types).toEqual(props);
  expect(restored.loadState(saved)).toEqual({ ok: true });
  expect(restored.home()).toBe(identity);
  expect(restored.home()?.uid).toBe(home.uid);
  expect(JSON.parse(JSON.stringify(restored.home()!.inventory))).toEqual(home.inventory);
  expect(restored.saveState().storagePools).toEqual(saved.storagePools);
  expect(world.heights).toEqual(terrain);
  expect(world.walkCost).toEqual(walk);
  expect(world.props.types).toEqual(props);
});
