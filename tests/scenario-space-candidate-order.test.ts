import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { orderScenarioSpaceCandidates } from "../src/shared/settlement/scenario-space-candidate-order";
import { scenarioSpaceCandidates } from "../src/shared/settlement/scenario-space-plan";
import { legalDraft } from "../src/shared/settlement/settlement-debug-raise";
import { createScenarioInspectionContext } from "../src/shared/settlement/settlement-map-scenario";
import { settlementTerritory } from "../src/shared/settlement/settlement-territory";
import { applyStampChanges, refreshEditedTerrain } from "../src/shared/world/editing/terrain/terrain-apply";
import { createTerrainEditState } from "../src/shared/world/editing/terrain/terrain-edit-state";
import { createMapScenario } from "../src/shared/world/map-scenario";
import { ORE } from "../src/shared/world/world-data";
import { SMALL_EDITOR_WORLD } from "./editor-spots";
import { cachedWorld } from "./helpers/cached-worlds";

const coastalFixture = () => {
  const world = cachedWorld({ ...SMALL_EDITOR_WORLD, rivers: 0 });
  world.props.count = 0; world.mineZone.fill(0); world.mineZones = []; world.oreAmount.fill(0);
  world.generatedRivers = []; world.authoredRivers = []; world.flow.fill(0); world.riverDistance.fill(100);
  for (let z = 0; z <= 96; z++) for (let x = 0; x <= 96; x++) {
    const i = z * 97 + x;
    world.heights[i] = x < 48 ? 2 : -3; world.waterSurface[i] = 0; world.waterDepth[i] = x < 48 ? 0 : 3;
  }
  refreshEditedTerrain(world, { minX: 0, minZ: 0, maxX: 95, maxZ: 95 }, true);
  applyStampChanges(world, createTerrainEditState(), [], null, [{ x: 48, z: 48, radius: 16, mode: "beach" }]);
  const [width, depth] = getBuildingDefinition(0).gridFootprint;
  world.scenario = { ...createMapScenario(), headquarters: { x: 20 + width % 2 / 2,
    z: 48 + depth % 2 / 2, rotation: 0 } };
  return world;
};

describe("bounded spatial prerequisite candidate ordering", () => {
  it("includes native legal shore-side drafts beyond the inland nearest-HQ prefix without relaxing placement", () => {
    const world = coastalFixture(), context = createScenarioInspectionContext(world), home = context.buildings[0]!;
    expect(home).toBeDefined();
    const points = scenarioSpaceCandidates(world, home, settlementTerritory(context).owned);
    const nativeLegal = (list: readonly { x: number; z: number }[]) => list.slice(0, 48).some(point =>
      [0, 1, 2, 3].some(rotation => legalDraft(context, 18, point.x, point.z, rotation) !== null));
    const before = structuredClone(world), ordered = orderScenarioSpaceCandidates(world, points, 18);
    expect(nativeLegal(ordered)).toBe(true);
    const coast = (point: { x: number; z: number }) => world.coastDistance[point.z * 97 + point.x]!;
    expect(Math.min(...ordered.slice(0, 48).map(coast)))
      .toBeLessThan(Math.min(...points.slice(0, 48).map(coast)));
    expect(ordered).toHaveLength(points.length);
    expect(new Set(ordered.map(point => `${point.x},${point.z}`)))
      .toEqual(new Set(points.map(point => `${point.x},${point.z}`)));
    expect(world).toEqual(before);
    expect(orderScenarioSpaceCandidates(world, points, 17)).toEqual(points);
  });

  it("prioritizes the actual matching finite deposit while leaving empty/exhausted alternatives available", () => {
    const world = coastalFixture(), points = [{ x: 20, z: 20 }, { x: 30, z: 20 }, { x: 40, z: 20 }];
    world.mineZones = [{ id: 1, ore: ORE.iron, centreX: 30, centreZ: 20, cellCount: 1, richness: 1, surveyed: false }];
    const [width, depth] = getBuildingDefinition(12).gridFootprint;
    const cell = (20 + Math.floor(depth / 2)) * 96 + 30 + Math.floor(width / 2);
    world.mineZone[cell] = 1; world.oreAmount[cell] = 1;
    expect(orderScenarioSpaceCandidates(world, points, 12)[0]).toEqual(points[1]);
    expect(orderScenarioSpaceCandidates(world, points, 12)).toHaveLength(3);
    world.oreAmount[cell] = 0;
    expect(orderScenarioSpaceCandidates(world, points, 12)).toHaveLength(3);
  });
});
