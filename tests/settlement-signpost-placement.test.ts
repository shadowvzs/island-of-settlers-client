import { expect, it } from "vitest";

import { ARCHER_SCAFFOLD_SITE, placedBanditCamp } from "../src/render-common/buildings/bandit-camp-plan";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { getPlacedBuildingSignpost } from "../src/render-common/buildings/building-road-signpost";
import { claimBuilding, makeBuilding, placementReason } from "../src/shared/settlement/settlement-placement";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import { BLOCKING, BUILD } from "../src/shared/world/world-data";

const fixture = () => {
  const size = 48;
  return {
    options: { world: {
      cellsX: size, cellsZ: size, heights: new Float32Array((size + 1) ** 2),
      blocking: new Uint8Array(size ** 2), walkCost: new Uint8Array(size ** 2).fill(10),
      buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
      props: { count: 0 },
      mineZones: []
    }, roads: { segments: () => [] } },
    nextBuilding: 0, buildings: [], occupied: new Uint8Array(size ** 2)
  } as unknown as SettlementContext;
};

it("reserves only a neutral scaffold's plot, without a signpost or road endpoint", () => {
  const context = fixture();
  const tower = makeBuilding(context, 4, 20, 20);
  Object.assign(tower, placedBanditCamp(ARCHER_SCAFFOLD_SITE, 20, 20), { bandit: ARCHER_SCAFFOLD_SITE, hasDoor: false });
  expect(placementReason(context, tower)).toBeNull();
  claimBuilding(context, tower);
  expect(context.occupied[Math.floor(tower.access.z) * 48 + Math.floor(tower.access.x)]).toBe(0);
});

it.each([0, 1])("reserves the small signboard beyond the entrance point for construction state %i", construction => {
  const context = fixture();
  const headquarters = makeBuilding(context, 0, 23, 23);
  headquarters.construction = construction;
  claimBuilding(context, headquarters);
  const blockingWell = makeBuilding(context, 35, 23, 27);
  // The post is reserved separately from the entrance endpoint and the masonry plot.
  expect(placementReason(context, blockingWell)).toBe("Plot obstructs an existing building signpost");
  const nearbyWell = makeBuilding(context, 35, 25, 27);
  expect(placementReason(context, nearbyWell)).toBeNull();
});

it("rejects a new building whose future signpost would protrude into a neighboring plot", () => {
  const context = fixture();
  const well = makeBuilding(context, 35, 23, 27);
  claimBuilding(context, well);
  const headquarters = makeBuilding(context, 0, 23, 23);
  expect(placementReason(context, headquarters)).toBe("Building signpost overlaps an existing plot");
});

it.each([BLOCKING.water, BLOCKING.cliff])("requires solid ground under the future post, terrain %i", terrain => {
  const context = fixture();
  const well = makeBuilding(context, 35, 23, 27);
  const { post } = getPlacedBuildingSignpost(well.typeId, well.x, well.z, well.rotation);
  context.options.world.blocking[Math.floor(post.z) * 48 + Math.floor(post.x)] = terrain;
  expect(placementReason(context, well)).toBe("Building signpost requires solid passable ground");
});

it.each([1, 2, 3])("reserves only the rotated board rather than the entire neighboring gap, turn %i", turn => {
  const context = fixture();
  const [baseWidth, baseDepth] = getBuildingDefinition(0).gridFootprint;
  const [width, depth] = turn % 2 ? [baseDepth, baseWidth] : [baseWidth, baseDepth];
  const headquarters = makeBuilding(context, 0, 20 + width / 2, 20 + depth / 2, turn);
  claimBuilding(context, headquarters);
  const { post } = getPlacedBuildingSignpost(0, headquarters.x, headquarters.z, turn);
  // An aligned 2×2 well covers the signboard while staying outside the headquarters plot.
  const x = Math.floor(post.x) + (turn === 3 ? 0 : 1);
  const z = Math.floor(post.z) + (turn === 2 ? 0 : 1);
  const covering = makeBuilding(context, 35, x, z);
  expect(placementReason(context, covering)).toBe("Plot obstructs an existing building signpost");
});
