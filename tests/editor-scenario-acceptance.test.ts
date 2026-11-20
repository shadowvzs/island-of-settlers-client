import { describe, expect, it } from "vitest";

import { updateAuthoredPatrols, validAuthoredPatrolProgress } from "../src/shared/settlement/authored-scenario-patrol";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { ROAD_TIERS } from "../src/shared/settlement/road-types";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { createMapScenario } from "../src/shared/world/map-scenario";
import { readMapFile } from "../src/shared/world/save/map-reader";
import { writeMapFile } from "../src/shared/world/save/map-writer";
import { BUILD, type WorldData } from "../src/shared/world/world-data";
import { SMALL_EDITOR_WORLD } from "./editor-spots";
import { cachedWorld } from "./helpers/cached-worlds";

const runtimeWorld = () => {
  const size = 40;
  return { seed: 9, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 5.5, z: 5.5 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2), mineZones: [],
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(), scale: new Float32Array() }
  } as unknown as WorldData;
};

describe("editor authored scenario integration matrix", () => {
  it.each(["shield", "heavy", "archer"] as const)("restores actual %s garrison troops at all three ranks", type => {
    for (const rank of [0, 1, 2]) {
      const world = runtimeWorld();
      world.scenario = { ...createMapScenario(), kind: "adventure", headquarters: { x: 8, z: 8, rotation: 0 },
        buildings: [{ id: 1, x: 29, z: 12, rotation: 0, type: 1, faction: 2, defenders: 1,
          garrison: [{ type, rank, count: 1 }] }] };
      const simulation = createSettlementSimulation({ world, roads: createRoadNetwork(world) });
      const before = simulation.militarySoldiers();
      expect(before).toHaveLength(1);
      expect(before[0]).toMatchObject({ rank, combat: { type } });
      const saved = simulation.saveState();
      expect(simulation.loadState(saved)).toEqual({ ok: true });
      expect(simulation.militarySoldiers()).toEqual(before);
    }
  });

  it("roundtrips all six authored road tiers, patrols, harbour reservation and each weather default", async () => {
    const world = cachedWorld(SMALL_EDITOR_WORLD);
    world.scenario = { ...createMapScenario(), kind: "adventure", harbourPlot: { x: 12, z: 15, rotation: 2 },
      nextObjectId: 2, roads: ROAD_TIERS.map((tier, index) => ({ tier, start: { x: 20 + index, z: 20 },
        end: { x: 20.5 + index, z: 20 } })),
      units: [{ id: 1, type: "archer", rank: 2, x: 30, z: 30, faction: 2, group: 0, heading: 0,
        patrol: [{ x: 33, z: 30 }, { x: 33, z: 33 }] }] };
    for (const weather of ["clear", "rain", "snow"]) {
      world.environmentDefaults = { hour: 19.5, cycling: false, rain: weather === "rain", snow: weather === "snow" };
      const result = (await readMapFile(await writeMapFile(world,
        { name: "Editor matrix", source: "acceptance", savedAt: 1, animals: [] }))).world;
      expect(result.scenario).toEqual(world.scenario);
      expect(result.environmentDefaults).toEqual(world.environmentDefaults);
      expect(result.scenario!.roads!.map(road => road.tier)).toEqual(ROAD_TIERS);
      expect(result.scenario!.harbourPlot).toEqual({ x: 12, z: 15, rotation: 2 });
    }
  });

  it("persists patrol progress and yields its route to live combat before resuming", () => {
    const world = runtimeWorld();
    world.scenario = { ...createMapScenario(), kind: "adventure", headquarters: { x: 8, z: 8, rotation: 0 },
      units: [{ id: 7, type: "shield", rank: 0, x: 25, z: 25, faction: 2, group: 0, heading: 0,
        patrol: [{ x: 28, z: 25 }] }] };
    const simulation = createSettlementSimulation({ world, roads: createRoadNetwork(world) });
    const saved = simulation.saveState();
    expect(saved.authoredScenario?.patrols).toHaveLength(1);
    expect(validAuthoredPatrolProgress(saved.authoredScenario?.patrols, world.scenario)).toBe(true);
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    expect(simulation.saveState().authoredScenario?.patrols).toEqual(saved.authoredScenario?.patrols);
    const progress = structuredClone(saved.authoredScenario)!;
    const context = { options: { world }, authoredScenario: progress } as Parameters<typeof updateAuthoredPatrols>[0];
    const calls: unknown[] = [];
    let result = "busy";
    const combat = { patrolOpponent: (...args: unknown[]) => { calls.push(args); return result; } } as unknown as Parameters<typeof updateAuthoredPatrols>[2];
    progress.patrols![0]!.next = 0;
    const before = structuredClone(progress.patrols);
    updateAuthoredPatrols(context, .05, combat);
    expect(progress.patrols).toEqual(before); expect(calls).toHaveLength(1);
    result = "arrived"; updateAuthoredPatrols(context, .05, combat);
    expect(progress.patrols![0]).toMatchObject({ next: 1, wait: .5 });
    result = "ordered"; updateAuthoredPatrols(context, .5, combat);
    expect(calls.at(-1)).toEqual([progress.patrols![0]!.actor, { x: 28, z: 25 }, 2]);
    expect(progress.patrols![0]!.wait).toBe(.25);
  });
});
