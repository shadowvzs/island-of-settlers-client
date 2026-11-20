import { STARTER_STOCK } from "@shared/catalog/balance";
import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { getNationBuildingDefinition } from "../src/render-common/buildings/nation-building-text";
import type { WorkerNation } from "../src/render-common/workers/worker-unit";
import { getConstructionCost } from "../src/shared/settlement/construction-costs";
import {
  DRINK_WARES, isForeignDrinkWare, NATION_DRINK_CHAINS, RAW_DRINK_WARES
} from "../src/shared/settlement/nation-drinks";
import { ALL_PRODUCTION_RULES, getProductionRule, PRODUCTION_RULES } from "../src/shared/settlement/production-rules";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { SETTLEMENT_WARES } from "../src/shared/settlement/settlement-building-policies";
import { createSettlementSimulation, type SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const NATIONS = Object.keys(NATION_DRINK_CHAINS) as WorkerNation[];

const fixture = (playerNation: WorkerNation, stock: Record<string, number>) => {
  const size = 40;
  const world = {
    cellsX: size, cellsZ: size, start: { x: 5.5, z: 5.5 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2), mineZones: [],
    props: { count: 0, types: new Uint8Array(0), scale: new Float32Array(0), x: new Float32Array(0),
      z: new Float32Array(0) }
  } as unknown as WorldData;
  let simulation: SettlementSimulation | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ initialStock: { ...stock }, playerNation, roads, world });
  const advanceUntil = (done: () => boolean, seconds: number) => {
    for (let step = 0; step < seconds * 10 && !done(); step++) simulation!.update(0.1);
  };
  const place = (id: number, x = 12.5, z = 8) => {
    const [width, depth] = getBuildingDefinition(id).gridFootprint;
    const result = simulation!.placeBuilding(id, Math.floor(x - width / 2) + width / 2,
      Math.floor(z - depth / 2) + depth / 2, 0);
    expect(result.ok, result.reason).toBe(true);
    expect(simulation!.connectRoads(simulation!.headquarters.access, result.building!.access)).toBe(true);
    return result.building!;
  };
  return { advanceUntil, place, simulation };
};
const buildStock = (nation: WorkerNation, ...ids: number[]) => ({
  ...STARTER_STOCK,
  cloth: ids.reduce((sum, id) => sum + (getConstructionCost(id, nation).cloth ?? 0), 0),
  planks: ids.reduce((sum, id) => sum + getConstructionCost(id, nation).planks, 0),
  stone: ids.reduce((sum, id) => sum + getConstructionCost(id, nation).stone, 0)
});

describe("nation drink rules", () => {
  it.each(NATIONS)("%s: building 5 grows the raw ware, 6 brews it with water; no building consumes drinks", nation => {
    const { drink, raw } = NATION_DRINK_CHAINS[nation];
    expect(getProductionRule(5, nation)).toMatchObject({ inputs: [], outdoor: "field", outputs: [raw] });
    expect(getProductionRule(6, nation)).toMatchObject({ inputs: [raw, "water"], outputs: [drink] });
    expect(getProductionRule(7, nation)).toBeUndefined();
    expect(ALL_PRODUCTION_RULES.some(rule => rule.inputs.includes(drink))).toBe(false);
    expect(getProductionRule(37, nation)).toBe(PRODUCTION_RULES[37]);
  });

  it("keeps the Roman table for shared callers and lists every nation's wares for storage policies", () => {
    expect(PRODUCTION_RULES[6]).toBe(getProductionRule(6, "roman"));
    for (const ware of [...DRINK_WARES, ...RAW_DRINK_WARES]) expect(SETTLEMENT_WARES).toContain(ware);
    expect(ALL_PRODUCTION_RULES.some(rule => rule.job === "Beekeeper")).toBe(true);
  });

  it("lists only the player nation's drink chain wares", () => {
    expect(isForeignDrinkWare("mead", "viking")).toBe(false);
    expect(isForeignDrinkWare("honey", "viking")).toBe(false);
    expect(isForeignDrinkWare("wine", "viking")).toBe(true);
    expect(isForeignDrinkWare("coconut", "roman")).toBe(true);
    expect(isForeignDrinkWare("logs", "nubian")).toBe(false);
  });

  it("names the drink buildings and workers per nation", () => {
    expect(getNationBuildingDefinition(5, "viking")).toMatchObject({ name: "Apiary", worker: "Beekeeper" });
    expect(getNationBuildingDefinition(6, "viking").name).toBe("Meadery");
    expect(getNationBuildingDefinition(5, "japanese")).toMatchObject({ name: "Rice farm", worker: "Rice farmer" });
    expect(getNationBuildingDefinition(6, "japanese").name).toBe("Rice distillery");
    expect(getNationBuildingDefinition(5, "nubian")).toMatchObject({ name: "Palm grove", worker: "Palm grower" });
    expect(getNationBuildingDefinition(6, "nubian").name).toBe("Toddy maker");
    expect(getNationBuildingDefinition(5, "roman")).toBe(getBuildingDefinition(5));
    expect(getNationBuildingDefinition(5, "nubian").gridFootprint).toEqual(getBuildingDefinition(5).gridFootprint);
    expect(getNationBuildingDefinition(17, "nubian")).toBe(getBuildingDefinition(17));
  });
});

describe("nation drink chains in the settlement", () => {
  it.each(NATIONS)("%s grows its raw ware outdoors and delivers it home", nation => {
    const { plantation, raw } = NATION_DRINK_CHAINS[nation];
    const { advanceUntil, place, simulation } = fixture(nation, buildStock(nation, 5));
    place(5);
    advanceUntil(() => (simulation.headquarters.inventory[raw] ?? 0) > 0, 700);
    expect(simulation.headquarters.inventory[raw]).toBeGreaterThan(0);
    expect(simulation.fieldFrames().every(site => site.kind === plantation)).toBe(true);
    expect(simulation.frames().some(actor => actor.job === NATION_DRINK_CHAINS[nation].grower)).toBe(true);
  });

  it.each(NATIONS)("%s brews its drink from its raw ware", nation => {
    const { drink, raw } = NATION_DRINK_CHAINS[nation];
    const { advanceUntil, place, simulation } = fixture(nation, { ...buildStock(nation, 6), [raw]: 1 });
    place(6);
    advanceUntil(() => (simulation.headquarters.inventory[drink] ?? 0) > 0, 400);
    expect(simulation.headquarters.inventory[drink]).toBe(1);
    expect(simulation.headquarters.inventory[raw] ?? 0).toBe(0);
  });

  it("returns wares a drink building no longer takes from old saves to its output", () => {
    const { place, simulation } = fixture("roman", buildStock("roman", 6));
    const winery = place(6);
    winery.construction = 1;
    winery.input = { bread: 2, grapes: 1 };
    expect(simulation.loadState(JSON.parse(JSON.stringify(simulation.saveState())))).toEqual({ ok: true });
    const loaded = simulation.buildings().find(building => building.uid === winery.uid)!;
    expect(loaded).toMatchObject({ input: { grapes: 1 }, output: { bread: 2 } });
  });
});
