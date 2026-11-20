import { describe, expect, it } from "vitest";

import type { RoadDecorationItemId } from "../../island-of-settlers-shared/src/road-decoration-items";
import { createMapScenario, isMapScenario, type MapScenario, type ScenarioUnit } from "../src/shared/world/map-scenario";
import { readMapFile } from "../src/shared/world/save/map-reader";
import { writeMapFile } from "../src/shared/world/save/map-writer";
import {
  allocateScenarioObjectId, assignScenarioObjectIds, findAuthoredObject, listAuthoredObjects, MAX_SCENARIO_OBJECT_ID
} from "../src/shared/world/scenario-object-ids";
import { SMALL_EDITOR_WORLD } from "./editor-spots";
import { cachedWorld, preloadWorlds } from "./helpers/cached-worlds";

preloadWorlds(SMALL_EDITOR_WORLD);

const POT: RoadDecorationItemId = "roadDecoration:indigenous-flower-pot:native";
const unit = (id: number, x = 10): ScenarioUnit =>
  ({ faction: 1, group: 0, heading: 0, id, rank: 0, type: "shield", x, z: 10 });
const adventure = (change: Partial<MapScenario>): MapScenario =>
  ({ ...createMapScenario(), kind: "adventure", ...change });

describe("stable map-file object ids (ACT1)", () => {
  it("never hands out a deleted object's id again", () => {
    const scenario = adventure({ units: [unit(1), unit(2)] });
    const third = allocateScenarioObjectId(scenario)!;
    scenario.units.push(unit(third));
    expect(third).toBe(3);
    scenario.units = scenario.units.filter(entry => entry.id !== third);
    const fourth = allocateScenarioObjectId(scenario);
    expect(fourth).toBe(4);
    expect(fourth).not.toBe(third);
  });

  it("starts above every existing id and stops at the end of the id space", () => {
    expect(allocateScenarioObjectId(adventure({ nextObjectId: 2, units: [unit(9)] }))).toBe(10);
    expect(allocateScenarioObjectId(adventure({ nextObjectId: MAX_SCENARIO_OBJECT_ID + 1 }))).toBeNull();
  });

  it("migrates legacy maps deterministically and leaves maps without objects untouched", () => {
    const legacy = () => adventure({ units: [unit(5)],
      decorations: [{ item: POT, x: 3, yaw: 0, z: 4 }, { id: 7, item: POT, x: 6, yaw: 0, z: 4 },
        { item: POT, x: 9, yaw: 0, z: 4 }] });
    const first = legacy(), second = legacy();
    expect(assignScenarioObjectIds(first)).toBe(true);
    assignScenarioObjectIds(second);
    expect(first).toEqual(second);
    expect(first.decorations!.map(row => row.id)).toEqual([8, 7, 9]);
    expect(first.nextObjectId).toBe(10);
    expect(assignScenarioObjectIds(first)).toBe(false);
    const empty = createMapScenario();
    expect(assignScenarioObjectIds(empty)).toBe(false);
    expect(empty).toEqual(createMapScenario());
    expect(listAuthoredObjects(first).map(row => `${row.kind}:${row.id}`))
      .toEqual(["unit:5", "decoration:8", "decoration:7", "decoration:9"]);
    expect(findAuthoredObject(first, 9)).toMatchObject({ kind: "decoration", x: 9 });
  });

  it("validates one id space across units, buildings and decorations, and the counter", () => {
    const decoration = (id: number) => ({ id, item: POT, x: 3, yaw: 0, z: 4 });
    expect(isMapScenario(adventure({ units: [unit(1)], decorations: [decoration(2)], nextObjectId: 3 }), 64, 64))
      .toBe(true);
    expect(isMapScenario(adventure({ units: [unit(1)], decorations: [decoration(1)] }), 64, 64)).toBe(false);
    expect(isMapScenario(adventure({ units: [unit(4)], nextObjectId: 4 }), 64, 64)).toBe(false);
    expect(isMapScenario(adventure({ decorations: [decoration(0)] }), 64, 64)).toBe(false);
    expect(isMapScenario(adventure({ nextObjectId: 0 }), 64, 64)).toBe(false);
  });

  it("keeps ids and the counter through a map file round trip", async () => {
    const world = cachedWorld(SMALL_EDITOR_WORLD);
    world.scenario = adventure({ units: [unit(1, 20), unit(4, 22)], nextObjectId: 6,
      decorations: [{ id: 5, item: POT, x: 30.25, yaw: 1.5, z: 31.75 }] });
    const input = { animals: [], name: "Ids", savedAt: 1_700_000_000_000, source: "test" };
    const { world: restored } = await readMapFile(await writeMapFile(world, input));
    expect(restored.scenario).toEqual(world.scenario);
    expect(allocateScenarioObjectId(restored.scenario!)).toBe(6);
  });
});
