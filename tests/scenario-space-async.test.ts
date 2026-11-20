import { describe, expect, it } from "vitest";

import { inspectScenarioSpaceAsync } from "../src/shared/settlement/settlement-scenario-space";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { createMapScenario } from "../src/shared/world/map-scenario";
import {
  BUILD,
  FOG,
  NO_MINE_ZONE,
  PROP_REMOVED,
  type WorldData
} from "../src/shared/world/world-data";
import { cachedWorld } from "./helpers/cached-worlds";

const emptyDraft = () => ({ cellsX: 64, cellsZ: 64, scenario: createMapScenario() }) as WorldData;
const flatDraft = () => {
  const world = cachedWorld({
    ...DEFAULT_WORLD_OPTIONS,
    cellsX: 64,
    cellsZ: 64,
    forest: 0,
    mountains: 0,
    rivers: 0,
    erosionDroplets: 0,
    oreCapacity: false
  });
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

describe("cooperative starting-space inspection", () => {
  it("rejects pre-cancelled work before any progress or scheduler callbacks", async () => {
    const signal = new AbortController();
    signal.abort();
    let calls = 0;
    await expect(
      inspectScenarioSpaceAsync(emptyDraft(), {
        signal: signal.signal,
        onProgress: () => {
          calls++;
        },
        yieldControl: async () => {
          calls++;
        }
      })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(0);
  });

  it("yields before validation and returns the same empty-draft conclusion as an unyielding run", async () => {
    const world = emptyDraft(),
      before = structuredClone(world),
      expected = await inspectScenarioSpaceAsync(world, { yieldControl: async () => {} });
    const progress: string[] = [];
    let yielded = 0;
    const result = await inspectScenarioSpaceAsync(world, {
      onProgress: (step) => progress.push(step.stage),
      yieldControl: async () => {
        yielded++;
      }
    });
    expect(yielded).toBeGreaterThan(0);
    expect(progress).toContain("Authored scenario");
    expect(result.messages).toEqual(expected.messages);
    expect(result.startupSpatialProved).toBe(false);
    expect(result.spatialPlanProved).toBe(false);
    expect(world).toEqual(before);
  });

  it("rejects changed map revisions and replaced scenario data instead of publishing stale evidence", async () => {
    for (const change of [
      (world: WorldData) => {
        world.terrainRevision = 1;
      },
      (world: WorldData) => {
        world.scenario = createMapScenario();
      }
    ]) {
      const world = emptyDraft();
      await expect(
        inspectScenarioSpaceAsync(world, { yieldControl: async () => change(world) })
      ).rejects.toMatchObject({
        name: "AbortError",
        message: expect.stringContaining("Map changed")
      });
    }
  });

  it("lets the caller cancel when its panel/context becomes stale", async () => {
    let current = true;
    await expect(
      inspectScenarioSpaceAsync(emptyDraft(), {
        isCurrent: () => current,
        yieldControl: async () => {
          current = false;
        }
      })
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("cancels after entering real placement search without publishing or changing live map data", async () => {
    const world = flatDraft(),
      controller = new AbortController();
    const before = {
      heights: world.heights.slice(),
      water: world.waterSurface.slice(),
      props: structuredClone(world.props),
      scenario: structuredClone(world.scenario)
    };
    let enteredSearch = false;
    await expect(
      inspectScenarioSpaceAsync(world, {
        signal: controller.signal,
        maxMilliseconds: 10000,
        onProgress: (step) => {
          if (step.stage === "Authored scenario") return;
          enteredSearch = true;
          controller.abort();
        },
        yieldControl: async () => {}
      })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(enteredSearch).toBe(true);
    expect(world.heights).toEqual(before.heights);
    expect(world.waterSurface).toEqual(before.water);
    expect(world.props).toEqual(before.props);
    expect(world.scenario).toEqual(before.scenario);
  });
});
