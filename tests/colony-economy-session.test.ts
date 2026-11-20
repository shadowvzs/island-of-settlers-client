import { describe, expect, it } from "vitest";

import { coveredColonyCursor } from "../src/app/settlement/archived-relief-coordinator";
import { createColonyEconomy } from "../src/app/settlement/colony-economy-session";
import { NEUTRAL_TALENT_MODIFIERS } from "../src/shared/progression/talents";
import type { Archipelago } from "../src/shared/settlement/archipelago";
import { colonyAdvancedCargo } from "../src/shared/settlement/colony-advanced-material-trade";
import { addToHome, takeFromStorages } from "../src/shared/settlement/colony-economy";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import type { SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { Goods } from "../src/shared/settlement/settlement-types";
import { cargoBoxes } from "../src/shared/settlement/ship-cargo-boxes";

const HOUR = 3600_000;
const island = { difficulty: "easy" as const, id: 0, name: "Gull Rock", ore: "coal" as const, seed: 1, voyageSeconds: 120 };
const store = (typeId: number, inventory: Goods, extra = {}) => ({ construction: 1, inventory, typeId, ...extra });
const fakeSimulation = (buildings: object[], colony?: object, modifiers = NEUTRAL_TALENT_MODIFIERS) => {
  const ships: Array<{ cargo: Goods; pickup: readonly string[] }> = [];
  const simulation = {
    buildings: () => buildings, colony: () => colony, garrisonShortfall: () => ({ archer: 0, melee: 0 }),
    resourceTotal: (ware: string) => buildings.reduce((sum: number, entry: any) => sum + (entry.inventory[ware] ?? 0), 0),
    receiveHomeGoods: (goods: Goods) => addToHome(buildings as never, goods),
    sendVisitorShip: (cargo: Goods, pickup: readonly string[] = []) => { ships.push({ cargo, pickup }); return ships.length; },
    takeStoredGoods: (goods: Goods) => takeFromStorages(buildings as never, goods),
    talentModifiers: () => modifiers
  } as unknown as SettlementSimulation;
  return { ships, simulation };
};
const economy = (simulation: SettlementSimulation, group: Archipelago, now: number,
  ownsArchivedIsland?: (id: number | null) => boolean) => {
  const messages: string[] = [];
  let current = group;
  const session = createColonyEconomy({ group: () => current, notify: text => messages.push(text), now: () => now,
    setGroup: next => { current = next; }, simulation, ownsArchivedIsland });
  return { group: () => current, messages, session };
};

describe("colony economy session", () => {
  it("sends home planks and food to a colony every minute and files its ore at home", () => {
    const home = store(0, { bread: 10, planks: 50 });
    const colonyBuildings = [store(39, {}, { colonyHome: true }), store(11, {}, { input: {} }),
      { construction: .2, input: {}, inventory: {}, required: { planks: 4 }, typeId: 2 }];
    const group: Archipelago = { active: 0, colonies: [{ expeditionId: 0, island, nextOreShipAt: 10 * HOUR,
      status: "conquered" }], home: { settlement: { buildings: [home] } } as unknown as GameSaveV1, version: 1 };
    const { ships, simulation } = fakeSimulation(colonyBuildings, { status: "conquered" });
    const { group: current, messages, session } = economy(simulation, group, 10 * HOUR + 1);
    session.update(59);
    expect(ships).toEqual([{ cargo: {}, pickup: ["coal"] }]);
    expect(current().colonies[0]!.nextOreShipAt).toBe(11 * HOUR + 1);
    session.update(1);
    expect(ships[1]).toEqual({ cargo: { bread: 4, planks: 10 }, pickup: [] });
    expect(home.inventory).toEqual({ bread: 6, planks: 40 });
    session.receiveAbroad({ coal: 120 });
    expect(home.inventory.coal).toBe(120);
    expect(messages.join(" ")).toMatch(/Supply ship.*Ore ship sailed home/);
  });

  it("uses every colony resource ship talent rank from 0 to 5", () => {
    for (const rank of [0, 1, 2, 3, 4, 5]) {
      const colonySave = { settlement: { buildings: [store(11, {}), store(11, {})] } } as unknown as GameSaveV1;
      const group: Archipelago = { active: null, colonies: [{ expeditionId: 0, island, nextOreShipAt: 10 * HOUR,
        save: colonySave, status: "conquered" }], version: 1 };
      const { simulation } = fakeSimulation([store(0, { bread: 400 })], undefined,
        { ...NEUTRAL_TALENT_MODIFIERS, colonyShipIntervalReduction: rank * .05 });
      const { group: current, session } = economy(simulation, group, 10 * HOUR + 1);
      session.update(5);
      expect(current().colonies[0]!.nextOreShipAt).toBe(10 * HOUR + (60 - rank * 3) * 60_000);
    }
  });

  it("ships off-screen ore home for whole hours, paid with home food", () => {
    const harbour = store(39, { fish: 50 });
    const colonySave = { settlement: { buildings: [store(11, {}), store(11, {})] } } as unknown as GameSaveV1;
    const group: Archipelago = { active: null, colonies: [{ expeditionId: 0, island, nextOreShipAt: HOUR,
      save: colonySave, status: "conquered" }], version: 1 };
    const { ships, simulation } = fakeSimulation([store(0, { bread: 40 }), harbour]);
    const { group: current, session } = economy(simulation, group, 2.5 * HOUR);
    session.update(5);
    // Two mines, two whole hours: 240 ore wanted, but only 90 food at home.
    expect(ships).toEqual([{ cargo: { coal: 90 }, pickup: [] }]);
    expect(simulation.resourceTotal("fish") + simulation.resourceTotal("bread")).toBe(0);
    expect(current().colonies[0]!.nextOreShipAt).toBe(3 * HOUR);
  });
});

it("settles only uncovered future time after native relief ownership ends", () => {
  const source = store(39, {}, { colonyHome: true });
  const colonySave = { savedAt: 0, settlement: { buildings: [source, store(11, {}), store(11, {})] } } as GameSaveV1;
  const group: Archipelago = { active: null, colonies: [{ expeditionId: 0, island, nextOreShipAt: HOUR,
    save: colonySave, status: "conquered" }], version: 1 };
  const { ships, simulation } = fakeSimulation([store(0, { bread: 400 })]);
  economy(simulation, group, 2.5 * HOUR, id => id === 0).session.update(5);
  expect(ships).toEqual([]); expect(simulation.resourceTotal("bread")).toBe(400);
  const cursor = coveredColonyCursor({ expeditionId: 0, beforeNextOreShipAt: HOUR }, colonySave, 2.5 * HOUR)!;
  expect(cursor.afterNextOreShipAt).toBe(HOUR);
  const covered: Archipelago = { ...group, colonies: [{ ...group.colonies[0]!, nativeEconomy: cursor.afterNativeEconomy }] };
  const settled = economy(simulation, covered, 2.5 * HOUR); settled.session.update(5);
  expect(ships).toEqual([]); expect(simulation.resourceTotal("bread")).toBe(400);
  expect(settled.group().colonies[0]!.nextOreShipAt).toBe(3 * HOUR);
  economy(simulation, settled.group(), 3 * HOUR).session.update(5);
  expect(ships).toEqual([{ cargo: { coal: 60 }, pickup: [] }]); // Half of the next slot was native, half remains earned abstract work.
  expect(simulation.resourceTotal("bread")).toBe(340);
});

it("exports actual stored hardwood and marble from a filed colony even without mines or home food", () => {
  const source = store(39, { hardwoodLogs: 8, marble: 6 }, { colonyHome: true });
  const colonySave = { settlement: { buildings: [source] } } as unknown as GameSaveV1;
  const group: Archipelago = { active: null, colonies: [{ expeditionId: 0, island, nextOreShipAt: HOUR,
    save: colonySave, status: "conquered" }], version: 1 };
  const { ships, simulation } = fakeSimulation([store(0, {})]);
  const { session } = economy(simulation, group, HOUR + 1);
  session.update(5);
  expect(ships).toEqual([{ cargo: { hardwoodLogs: 8, marble: 6 }, pickup: [] }]);
  expect(source.inventory).toEqual({ hardwoodLogs: 0, marble: 0 });
});

it("ships a large off-screen ore and advanced material export in one ship (no hold limit)", () => {
  const source = store(39, { hardwoodLogs: 2000, marble: 900 }, { colonyHome: true });
  const colonySave = { settlement: { buildings: [source, store(11, {}), store(11, {})] } } as unknown as GameSaveV1;
  const group: Archipelago = { active: null, colonies: [{ expeditionId: 0, island, nextOreShipAt: HOUR,
    save: colonySave, status: "conquered" }], version: 1 };
  const { ships, simulation } = fakeSimulation([store(0, { bread: 400 })]);
  economy(simulation, group, 2.5 * HOUR).session.update(5);
  expect(ships).toHaveLength(1);
  expect(ships[0]!.cargo).toMatchObject({ hardwoodLogs: 2000, marble: 900 });
  expect(ships[0]!.cargo.coal).toBeGreaterThan(0);
  expect(source.inventory).toEqual({ hardwoodLogs: 0, marble: 0 });
});

it("retains staged upgrade marble on the colony and sends its missing hardwood planks from home", () => {
  const source = store(39, { hardwoodLogs: 2, marble: 3, planks: 10, stone: 10 }, { colonyHome: true });
  const workshop = store(31, {}, { input: {}, incoming: {}, worker: 1,
    workshopUpgrade: { level: 0, requested: true } });
  const home = store(0, { hardwoodPlanks: 8 });
  const group: Archipelago = { active: 0, colonies: [{ expeditionId: 0, island, nextOreShipAt: HOUR,
    status: "conquered" }], home: { settlement: { buildings: [home] } } as unknown as GameSaveV1, version: 1 };
  const { ships, simulation } = fakeSimulation([source, workshop], { status: "conquered" });
  const { session } = economy(simulation, group, HOUR + 1);
  session.update(60);
  expect(ships[0]).toEqual({ cargo: { hardwoodPlanks: 4 }, pickup: [] });
  expect(ships[1]?.pickup).toEqual(["hardwoodLogs", "marble", "coal"]);
  expect(source.inventory.marble).toBe(3); // Pickup is only a request; arrival recomputes its reserve.
  expect(home.inventory.hardwoodPlanks).toBe(4);
});

it("keeps finite export inventory on its colony if no home berth can receive a resource ship", () => {
  const source = store(39, { hardwoodLogs: 8, marble: 6 }, { colonyHome: true });
  const colonySave = { settlement: { buildings: [source] } } as unknown as GameSaveV1;
  const group: Archipelago = { active: null, colonies: [{ expeditionId: 0, island, nextOreShipAt: HOUR,
    save: colonySave, status: "conquered" }], version: 1 };
  const { simulation } = fakeSimulation([store(0, {})]);
  simulation.sendVisitorShip = () => null;
  economy(simulation, group, HOUR + 1).session.update(5);
  expect(source.inventory).toEqual({ hardwoodLogs: 8, marble: 6 });
  expect(simulation.resourceTotal("hardwoodLogs")).toBe(0);
});

it("exports all advanced cargo in one ship and reserves only the missing local upgrade materials", () => {
  const source = store(39, { hardwoodLogs: 1000, marble: 1000 }, { colonyHome: true });
  const workshop = store(31, {}, { input: {}, incoming: {},
    workshopUpgrade: { level: 0, requested: true as const } });
  // Owner 2026-10-19: resource ships carry everything (no 33-box hold), only the upgrade reserve stays.
  const reserve = 1000 - colonyAdvancedCargo([source, workshop]).marble!;
  expect(colonyAdvancedCargo([source, workshop])).toEqual({ hardwoodLogs: 1000, marble: 1000 - reserve });
  expect(cargoBoxes(colonyAdvancedCargo([source, workshop]))).toBeGreaterThan(33);
  source.inventory.hardwoodLogs = 0; source.inventory.marble = 6;
  expect(colonyAdvancedCargo([source, workshop])).toEqual({ marble: 4 });
  Object.assign(workshop, { input: { marble: 1 }, incoming: { marble: 1 } });
  expect(colonyAdvancedCargo([source, workshop])).toEqual({ marble: 6 });
});

it("does not send a second hunter bow while the first supply ship waits for the berth", () => {
  const home = store(0, { bow: 2 });
  const colonyBuildings = [store(39, { planks: 10, stone: 10 }, { colonyHome: true }),
    store(22, {}, { worker: undefined, input: {}, incoming: {} })];
  const group: Archipelago = { active: 0, colonies: [{ expeditionId: 0, island,
    nextOreShipAt: 100 * HOUR, status: "conquered" }],
    home: { settlement: { buildings: [home] } } as unknown as GameSaveV1, version: 1 };
  const { ships, simulation } = fakeSimulation(colonyBuildings, { status: "conquered" });
  simulation.ships = (() => ships.map((ship, id) => ({ id, cargo: ship.cargo,
    visitor: true, incoming: true, raid: false, phase: "stranded" }))) as unknown as SettlementSimulation["ships"];
  const { session } = economy(simulation, group, HOUR);
  session.update(60);
  session.update(60);
  expect(ships).toHaveLength(1);
  expect(ships[0]!.cargo).toEqual({ bow: 1 });
  expect(home.inventory.bow).toBe(1);
});


it("requests stored iron ore before the hourly deadline and never duplicates its pending pickup", () => {
  const source = store(39, { ironOre: 90, planks: 10, stone: 10 }, { colonyHome: true });
  const group: Archipelago = { active: 0, colonies: [{ expeditionId: 0,
    island: { ...island, ore: "ironOre" }, nextOreShipAt: 2 * HOUR, status: "conquered" }],
    home: { settlement: { buildings: [store(0, {})] } } as unknown as GameSaveV1, version: 1 };
  const { ships, simulation } = fakeSimulation([source], { status: "conquered" });
  simulation.ships = (() => ships.map(() => ({ visitorRole: "ore" }))) as unknown as SettlementSimulation["ships"];
  const { session } = economy(simulation, group, HOUR);
  session.update(5); session.update(5);
  expect(ships).toEqual([{ cargo: {}, pickup: ["ironOre"] }]);
  expect(source.inventory.ironOre).toBe(90); // Only the physical arriving ship may take the ore.
});
