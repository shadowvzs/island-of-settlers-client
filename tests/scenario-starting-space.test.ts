import { describe, expect, it } from "vitest";

import { MATERIAL_BUILDING_GROUPS } from "../src/shared/settlement/advanced-material-production";
import { scenarioSpaceCandidates, scenarioSpaceStages } from "../src/shared/settlement/scenario-space-plan";
import { inspectScenarioSpaceAsync } from "../src/shared/settlement/settlement-scenario-space";
import { createMapScenario } from "../src/shared/world/map-scenario";
import type { WorldData } from "../src/shared/world/world-data";

/** Runs the cooperative inspection without yielding to the scheduler. */
const inspectScenarioSpace = (world: WorldData, options: { maxMilliseconds?: number } = {}) =>
  inspectScenarioSpaceAsync(world, { ...options, yieldControl: async () => {} });

describe("authored starting-space obligations", () => {
  it("keeps home startup separate from hidden legacy and colony-only occupations", () => {
    const stages = scenarioSpaceStages({} as WorldData);
    expect(stages.filter(stage => stage.mandatory).flatMap(stage => stage.required)).toEqual([17, 33, 19, 20, 35, 37, 31, 32, 18]);
    const material = MATERIAL_BUILDING_GROUPS.flatMap(group => [group.forester, group.woodcutter, group.quarry]);
    expect(stages.flatMap(stage => stage.required).some(type => material.includes(type as typeof material[number]))).toBe(false);
  });
  it("selects current colony construction professions but keeps one ordinary levelled sawmill", () => {
    const stages = scenarioSpaceStages({ colonyResourceTier: 3 } as WorldData);
    expect(stages[0]!.required).toEqual([50, 33, 51, 49]);
    expect(stages.flatMap(stage => stage.required)).not.toContain(52);
    expect(stages.flatMap(stage => stage.required)).not.toContain(42);
  });
  it("enumerates bounded owned origins without duplicates even on a large map", () => {
    const size = 512, owned = new Uint8Array(size * size).fill(1);
    const points = scenarioSpaceCandidates({ cellsX: size, cellsZ: size }, { x: 256, z: 256 }, owned, 17);
    expect(points).toHaveLength(17);
    expect(points[0]).toEqual({ x: 256, z: 256 });
    expect(new Set(points.map(point => `${point.x}/${point.z}`)).size).toBe(17);
    owned.fill(0); owned[2 * size + 3] = 1;
    expect(scenarioSpaceCandidates({ cellsX: size, cellsZ: size }, { x: 3, z: 2 }, owned)).toEqual([{ x: 3, z: 2 }]);
  });
  it("does not call an empty draft or malformed scenario a successful spatial witness", async () => {
    const world = { cellsX: 32, cellsZ: 32, scenario: createMapScenario() } as WorldData;
    const before = JSON.stringify(world);
    const empty = await inspectScenarioSpace(world);
    expect(empty.startupSpatialProved).toBe(false);
    expect(empty.spatialPlanProved).toBe(false);
    expect(empty.workspaces).toEqual([]);
    expect(JSON.stringify(world)).toBe(before);
    Object.assign(world.scenario!, { headquarters: { x: 8, z: 8, rotation: 0 }, nation: "invalid" });
    expect((await inspectScenarioSpace(world)).authoredErrors).toContain("Invalid scenario definition");
  });
  it("rejects unbounded or invalid inspection deadlines", async () => {
    await expect(inspectScenarioSpace({} as WorldData, { maxMilliseconds: Infinity })).rejects.toThrow("Inspection time budget must be0–10000ms");
    await expect(inspectScenarioSpace({} as WorldData, { maxMilliseconds: -1 })).rejects.toThrow("Inspection time budget must be0–10000ms");
  });
});
