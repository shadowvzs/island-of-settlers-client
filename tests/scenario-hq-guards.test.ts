import { describe, expect, it } from "vitest";

import { BuildingType } from "../src/shared/settlement/building-type-ids";
import { createScenarioInspectionContext, validateMapScenario } from "../src/shared/settlement/settlement-map-scenario";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { createMapScenario } from "../src/shared/world/map-scenario";
import { BLOCKING, BUILD, FOG, NO_MINE_ZONE, PROP_REMOVED } from "../src/shared/world/world-data";
import { cachedWorld } from "./helpers/cached-worlds";

const flatWorld = () => {
  const world = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 64, cellsZ: 64, erosionDroplets: 0,
    forest: 0, mountains: 0, rivers: 0, oreCapacity: false });
  world.heights.fill(2);
  world.waterSurface.fill(0);
  world.waterDepth.fill(0);
  world.props.types.fill(PROP_REMOVED);
  world.blocking.fill(0);
  world.walkCost.fill(10);
  world.buildClass.fill(BUILD.large);
  world.buildCap.fill(BUILD.large);
  world.slopeClass.fill(0);
  world.oreAmount.fill(0);
  world.mineZone.fill(NO_MINE_ZONE);
  world.mineZones = [];
  world.fog.fill(FOG.visible);
  world.scenario = { ...createMapScenario(), headquarters: { x: 20, z: 20, rotation: 0 } };
  return world;
};

describe("headquarters authoring guards", () => {
  it("accepts a valid HQ and exposes its canonical entrance", () => {
    const world = flatWorld();
    expect(validateMapScenario(world)).toEqual([]);
    const context = createScenarioInspectionContext(world);
    expect(context.buildings[0]?.typeId).toBe(0);
    expect(context.buildings[0]?.access).toBeDefined();
  });

  it("rejects a water-blocked HQ footprint and a blocked entrance", () => {
    const footprint = flatWorld();
    footprint.blocking[20 * footprint.cellsX + 20] = BLOCKING.water;
    expect(validateMapScenario(footprint).join("; ")).toContain("Foundation is not buildable");

    const entrance = flatWorld();
    const context = createScenarioInspectionContext(entrance);
    const access = context.buildings[0]!.access;
    entrance.blocking[Math.floor(access.z) * entrance.cellsX + Math.floor(access.x)] = BLOCKING.water;
    expect(validateMapScenario(entrance).join("; ")).toMatch(/Entrance must|signpost requires solid/);
  });

  it("rejects a garrison beyond the authored type capacity", () => {
    const world = flatWorld();
    world.scenario = { ...world.scenario!, buildings: [{ id: 1, x: 30, z: 20, type: BuildingType.Guardhouse, rotation: 0,
      defenders: 12, faction: 2 }] };
    expect(validateMapScenario(world).join("; ")).toContain("Invalid scenario definition");
  });
});
