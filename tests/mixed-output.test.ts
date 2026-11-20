import { describe, expect, it } from "vitest";

import { getOutputRadioChoices, getProductionOutputChoices } from "../src/app/settlement-ui/building-details/production-mode-helpers";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import {
  METALWORKS_TYPE, mixedCycleOutput, mixedProductionChoice, PRODUCTS_IN_TURN, RANDOM_TOOLS
} from "../src/shared/settlement/mixed-output";
import { PRODUCTION_RULES } from "../src/shared/settlement/production-rules";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const tools = PRODUCTION_RULES[METALWORKS_TYPE]!.outputs;
const metalworks = (cycle: number, uid = 7) => ({ cycle, typeId: METALWORKS_TYPE, uid });

const placedMetalworks = () => {
  const size = 48;
  const world = { seed: 3, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 8, z: 8 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array() }
  } as unknown as WorldData;
  const simulation = createSettlementSimulation({ world, roads: createRoadNetwork(world), initialSettlers: 4,
    initialStock: { planks: 40, stone: 40 }, resourceTargets: () => [] });
  const [width, depth] = getBuildingDefinition(METALWORKS_TYPE).gridFootprint;
  const placed = simulation.placeBuilding(METALWORKS_TYPE, 26 + width % 2 / 2, 9 + depth % 2 / 2);
  expect(placed.ok, placed.reason).toBe(true);
  return { building: placed.building!, simulation };
};

describe("metalworks random tools", () => {
  it("names the mixed choices after what they make and preselects Random tools", () => {
    expect(mixedProductionChoice(METALWORKS_TYPE)).toBe(RANDOM_TOOLS);
    expect(mixedProductionChoice(24)).toBe(PRODUCTS_IN_TURN);
    expect(getProductionOutputChoices(METALWORKS_TYPE)?.[0]).toEqual({ label: "Random tools", value: RANDOM_TOOLS });
  });

  it("maps random and selected choices to real native ware icons without changing command semantics", () => {
    const random = getOutputRadioChoices({ completed: true, id: "7", type: METALWORKS_TYPE })!;
    expect(random[0]).toMatchObject({ name: "Random tools", selected: true, value: RANDOM_TOOLS });
    expect(random[0]!.wares).toEqual(tools.slice(0, 3));
    const selected = getOutputRadioChoices({ completed: true, id: "7", selectedOutput: "spyglass", type: METALWORKS_TYPE })!;
    expect(selected.filter(choice => choice.selected)).toMatchObject([{ value: "spyglass", wares: ["spyglass"] }]);
    expect(getOutputRadioChoices({ completed: true, id: "7", type: 24 })).toBeNull();
  });

  it("accepts Random tools as the metalworks' production choice and back from a single tool", () => {
    const { building, simulation } = placedMetalworks();
    expect(simulation.setProductionMode(building.uid, "axe")).toBe(true);
    expect(building.selectedOutput).toBe("axe");
    expect(simulation.setProductionMode(building.uid, PRODUCTS_IN_TURN)).toBe(false);
    expect(building.selectedOutput).toBe("axe");
    expect(simulation.setProductionMode(building.uid, RANDOM_TOOLS)).toBe(true);
    expect(building.selectedOutput).toBeUndefined();
  });

  it("picks a varied, repeatable tool per cycle", () => {
    const picks = Array.from({ length: 120 }, (_, cycle) => mixedCycleOutput(metalworks(cycle), tools));
    expect(picks.every(tool => tools.includes(tool))).toBe(true);
    expect(new Set(picks).size).toBe(tools.length);
    expect(picks).not.toEqual(Array.from({ length: 120 }, (_, cycle) => tools[cycle % tools.length]));
    expect(Array.from({ length: 120 }, (_, cycle) => mixedCycleOutput(metalworks(cycle), tools))).toEqual(picks);
  });

  it("keeps other workshops making all their products in turn", () => {
    const outputs = ["a", "b", "c"];
    expect([0, 1, 2, 3].map(cycle => mixedCycleOutput({ cycle, typeId: 24, uid: 1 }, outputs)))
      .toEqual(["a", "b", "c", "a"]);
  });

  // The old fixture injected iron/planks/tongs into HQ local inventory. Shared storage now keeps
  // those wares in the island pool, so a faithful cycle needs a shared-storage-aware harness.
  // oxlint-disable-next-line vitest/no-disabled-tests -- fixture rewrite tracked in docs/todo.md
  it.skip("makes a selected spyglass with one iron and plank, then waits without more inputs", () => {
    const { building, simulation } = placedMetalworks();
    // Isolate an already-built workshop; this tests its production, not construction acceptance.
    building.construction = 1;
    building.foundationProgress = 1;
    building.required = {};
    const pool = simulation.saveState().storagePools.pools.find(entry =>
      entry.id === simulation.headquarters.storagePoolId)!;
    pool.available = {};
    simulation.headquarters.inventory = { tongs: 1 };
    building.input = { iron: 1, planks: 1 };
    expect(simulation.connectRoads(simulation.headquarters.access, building.access)).toBeTruthy();
    expect(simulation.setProductionMode(building.uid, "spyglass")).toBe(true);
    for (let tick = 0; tick < 1600 && (building.output.spyglass ?? 0) < 1; tick++) simulation.update(.25);
    expect(building.output.spyglass).toBe(1);
    expect(building.input.iron ?? 0).toBe(0);
    expect(building.input.planks ?? 0).toBe(0);
    expect(simulation.frames().find(actor => actor.uid === building.worker)?.tool).toBe("tongs");
    expect(simulation.setProductionMode(building.uid, RANDOM_TOOLS)).toBe(true);
    expect(tools).toContain("spyglass");
    for (let tick = 0; tick < 400; tick++) simulation.update(.25);
    const spyglasses = simulation.saveState().buildings.reduce((sum, entry) =>
      sum + (entry.inventory.spyglass ?? 0) + (entry.output.spyglass ?? 0), 0) +
      simulation.saveState().storagePools.pools.reduce((sum, pool) => sum + (pool.available.spyglass ?? 0), 0);
    expect(spyglasses).toBe(1);
  });
});
