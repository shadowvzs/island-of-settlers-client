import { expect, it } from "vitest";

import { DEFAULT_ISLAND_CHOICE, readIslandChoice, toWorldOptions } from "../src/app/map-generator/helpers";
import { getPlacedBuildingSignpost } from "../src/render-common/buildings/building-road-signpost";
import { makeBuilding, placementReason } from "../src/shared/settlement/settlement-placement";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { cachedWorldBeforeAll } from "./helpers/cached-worlds";

// A 512 island takes seconds (more under a parallel suite): generated in a hook, not the test.
const largeIsland = cachedWorldBeforeAll({ ...DEFAULT_WORLD_OPTIONS, ...toWorldOptions(readIslandChoice(
  new URLSearchParams("size=512&landform=island&mountains=2&forest=0"), DEFAULT_ISLAND_CHOICE
)), seed: 1234 });

it("retains native harbour, signpost and ocean approach on an actual 512 single-island recipe", () => {
  const world = largeIsland();
  expect(world.playableIslands?.sites).toHaveLength(1);
  const harbour = world.playableIslands!.sites[0]!.harbour;
  const context: SettlementContext = {
    options: { world, roads: { route: () => null, addRoad: () => {}, upgradeRoad: () => {} } },
    buildings: [], actors: [], occupied: new Uint8Array(world.cellsX * world.cellsZ),
    reservations: new Set(), nextBuilding: 0, nextActor: 0, settlers: 0,
    resourceAmounts: new Map(), accumulator: 0, scheduling: 0, transfers: []
  };
  const building = makeBuilding(context, 39, harbour.x, harbour.z, harbour.rotation);
  // This invokes the real foundation, entrance/road, signpost, hull and ocean-turning rules.
  expect(placementReason(context, building)).toBeNull();
  const { post } = getPlacedBuildingSignpost(39, building.x, building.z, building.rotation);
  expect(world.blocking[Math.floor(post.z) * world.cellsX + Math.floor(post.x)]).toBe(0);
  // No mine land (generated or a home outcrop) on the harbour plot or its approach.
  for (let z = harbour.z - 12; z <= harbour.z + 12; z++) for (let x = harbour.x - 12; x <= harbour.x + 12; x++)
    expect(world.mineZone[z * world.cellsX + x]).toBe(0);
}, 45000);
