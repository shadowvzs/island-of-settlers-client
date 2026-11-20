import { expect, it } from "vitest";

import { getIslandRocks, rememberIslandRocks } from "../src/render-common/rocks/island-rock-instances";
import { ROCK_ROLE, type RockInstance } from "../src/render-common/rocks/rock-instances";
import type { RockTerrain } from "../src/render-common/rocks/rock-terrain";
import { updateSettlementGroundClearance } from "../src/shared/settlement/settlement-ground-clearance";
import type { SettlementBuilding } from "../src/shared/settlement/settlement-types";
import type { WorldData } from "../src/shared/world/world-data";

const rock = (x: number, z: number): RockInstance => ({
  axes: [[2, 0, 0], [0, 2, 0], [0, 0, 2]], centre: [x, 1, z],
  exposure: .5, family: 0, high: true, moss: 0, role: ROCK_ROLE.outcrop,
  slab: 1, tint: 0, variant: 0
});
const fixture = () => ({ cellsX: 32, cellsZ: 32, heights: new Float32Array(33 ** 2) } as WorldData);

it("clears the full rock body from saved roads and building plots, preserving unrelated formations", () => {
  const world = fixture();
  const road = { start: { x: 8, z: 12 }, end: { x: 20, z: 12 }, tier: "stone" as const };
  const building = { x: 20, z: 20, width: 4, depth: 4 } as SettlementBuilding;
  const crossing = rock(12, 12), overhanging = rock(12, 13.4), underBuilding = rock(20, 20);
  const natural = rock(26, 26);
  rememberIslandRocks(world, [crossing, overhanging, underBuilding, natural]);
  const heights = world.heights.slice();
  updateSettlementGroundClearance(world, [road], [building]);
  const visible = getIslandRocks(world, {} as RockTerrain);
  expect(visible).toEqual([natural]);
  expect(getIslandRocks(world, {} as RockTerrain)).toBe(visible);
  expect(world.heights).toEqual(heights);
  // A terrain/edit worker returning newly generated instances obeys exactly the same clearance.
  rememberIslandRocks(world, [rock(12, 12), rock(20, 20), natural]);
  expect(getIslandRocks(world, {} as RockTerrain)).toEqual([natural]);
});

it("does not clear preview roads or alter an unsettled island", () => {
  const world = fixture(), natural = rock(12, 12);
  updateSettlementGroundClearance(world, [
    { start: { x: 8, z: 12 }, end: { x: 20, z: 12 }, tier: "dirt", preview: true }
  ], []);
  rememberIslandRocks(world, [natural]);
  expect(getIslandRocks(world, {} as RockTerrain)).toEqual([natural]);
});
