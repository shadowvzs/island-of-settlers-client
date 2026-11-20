import { expect, it } from "vitest";

import { createSettlementRenderFrames } from "../src/app/settlement/settlement-render-frames";
import type { WorkerFrame, WorkerNation } from "../src/render-common/workers/worker-unit";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const session = (beer = 4, coins = 0, wine = 4) => {
  const size = 40;
  const world = {
    seed: 9, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 5.5, z: 5.5 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2), mineZones: [],
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(), scale: new Float32Array() }
  } as unknown as WorldData;
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world, roads, initialSettlers: 20,
    initialStock: { sword: 4, shield: 4, beer, coins, wine, planks: 48, stone: 48 },
    canWorkerEnterPlot: () => true });
  const result = simulation.placeBuilding(1, 15, 12);
  if (!result.ok || !result.building) throw new Error(result.reason);
  const building = result.building;
  building.construction = 1; building.required = {};
  expect(roads.addRoad(simulation.headquarters.access, building.access)).toBe(true);
  const advance = (seconds: number) => { for (let tick = 0; tick < seconds * 20; tick++) simulation.update(.05); };
  // Military buildings no longer recruit: two swordsmen are stored first (settler, sword, shield, beer each).
  const storeSwordsmen = () => {
    for (let index = 0; index < 2; index++) simulation.recruitStoredMilitary(simulation.headquarters.uid, "shield");
  };
  storeSwordsmen();
  return { simulation, building, advance, storeSwordsmen };
};

const totalPeople = (simulation: ReturnType<typeof createSettlementSimulation>) =>
  simulation.availableSettlers() + simulation.frames().filter(actor => actor.phase !== "retired").length;

it("public simulation recruits finite equipped soldiers, saves ranks and returns/redeploys the same reserve", () => {
  const { advance, building, simulation } = session();
  simulation.setMilitaryCoins(building.uid, false);
  advance(120);
  expect(simulation.militaryBuildings()[0]?.stationed).toBe(2);
  expect(simulation.militarySoldiers()).toHaveLength(2);
  expect(totalPeople(simulation)).toBe(20 + simulation.settlerBirths());
  for (const ware of ["sword", "shield", "beer"]) expect(simulation.headquarters.inventory[ware]).toBe(2);
  building.input.coins = 1; building.input.wine = 1; advance(30);
  const identities = simulation.militarySoldiers().map(soldier => soldier.actor);
  const ranks = simulation.militaryBuildings()[0]!.ranks.slice().sort((a, b) => a - b);
  expect(ranks).toEqual([0, 1]);
  const saved = simulation.saveState();
  expect(simulation.loadState(saved)).toEqual({ ok: true });
  expect(simulation.militaryBuildings()[0]?.ranks.slice().sort()).toEqual(ranks);
  simulation.setMilitaryTarget(building.uid, 0); advance(1);
  expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
  advance(120);
  // A building that claimed territory keeps one soldier; the other returns to the reserve.
  expect(simulation.frames().filter(actor => actor.job === "Soldier").map(actor => actor.phase).sort())
    .toEqual(["garrison", "militaryReserve"]);
  expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
  simulation.setMilitaryTarget(building.uid, 2); advance(120);
  expect(simulation.militaryBuildings()[0]?.stationed).toBe(2);
  expect(simulation.militarySoldiers().map(soldier => soldier.actor)).toEqual(identities);
  expect(simulation.militaryBuildings()[0]?.ranks.slice().sort()).toEqual(ranks);
  expect(totalPeople(simulation)).toBe(20 + simulation.settlerBirths());
  expect(simulation.headquarters.inventory.sword).toBe(2);
});

it("demolition returns real garrison soldiers as reserves, conserving rank, identity and equipment", () => {
  const { advance, building, simulation } = session();
  advance(120);
  const identities = simulation.militarySoldiers().map(soldier => soldier.actor);
  expect(simulation.demolishBuilding(building.uid).ok).toBe(true);
  expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
  advance(120);
  expect(simulation.militaryBuildings()).toEqual([]);
  expect(simulation.militarySoldiers().map(soldier => soldier.actor)).toEqual(identities);
  expect(simulation.frames().filter(actor => actor.job === "Soldier").every(actor => actor.phase === "militaryReserve")).toBe(true);
  expect(totalPeople(simulation)).toBe(20 + simulation.settlerBirths());
  expect(simulation.headquarters.inventory.sword).toBe(2);
  expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
});

it("carriers deliver the nation's drink into the military building itself", () => {
  const { building, simulation } = session(4, 0);
  simulation.setMilitaryCoins(building.uid, false);
  let sawWineCarrier = false, sawIncoming = false;
  const initialWine = building.input.wine ?? 0;
  for (let tick = 0; tick < 200 * 20; tick++) {
    simulation.update(.05);
    sawWineCarrier ||= simulation.frames().some(actor => actor.job === "Carrier" &&
      actor.ware === "wine" && actor.delivery?.destination === building.uid);
    sawIncoming ||= (building.incoming.wine ?? 0) > 0;
  }
  expect(sawWineCarrier).toBe(true);
  expect(sawIncoming).toBe(true);
  expect(building.input.wine ?? 0).toBeGreaterThan(initialWine);
  // Beer is a recruit ingredient, not the promotion drink.
  expect(building.input.beer ?? 0).toBe(0);
});

it("never recruits by itself, then delivers capped coins and wine through carriers and promotes soldiers", () => {
  const { advance, building, simulation, storeSwordsmen } = session(0, 4);
  advance(60);
  expect(simulation.militarySoldiers()).toEqual([]);
  expect(simulation.headquarters.inventory.sword).toBe(4);
  simulation.headquarters.inventory.beer = 2;
  advance(60);
  expect(simulation.militarySoldiers()).toEqual([]);
  storeSwordsmen();
  simulation.setMilitaryCoins(building.uid, false);
  advance(120);
  expect(simulation.militaryBuildings()[0]?.stationed).toBe(2);
  expect(simulation.headquarters.inventory.coins).toBe(4);
  simulation.setMilitaryCoins(building.uid, true);
  let sawCarrier = false, sawDrinkCarrier = false;
  for (let tick = 0; tick < 1600; tick++) {
    simulation.update(.05);
    sawCarrier ||= simulation.frames().some(actor => actor.job === "Carrier" && actor.ware === "coins");
    sawDrinkCarrier ||= simulation.frames().some(actor => actor.job === "Carrier" && actor.ware === "wine");
    expect((building.input.coins ?? 0) + (building.incoming.coins ?? 0)).toBeLessThanOrEqual(6);
    expect((building.input.wine ?? 0) + (building.incoming.wine ?? 0)).toBeLessThanOrEqual(3);
  }
  expect(sawCarrier).toBe(true);
  expect(sawDrinkCarrier).toBe(true);
  expect(simulation.militaryBuildings()[0]?.ranks.some(rank => rank > 0)).toBe(true);
});

it("rejects corrupted military references before mutation and loads older saves without military state", () => {
  const empty = session(0);
  const legacy = empty.simulation.saveState(); delete legacy.military;
  expect(empty.simulation.loadState(legacy)).toEqual({ ok: true });
  const { advance, simulation } = session(); advance(120);
  const saved = simulation.saveState();
  saved.military!.soldiers[0]!.actor = 999;
  const before = simulation.saveState();
  expect(simulation.loadState(saved).ok).toBe(false);
  expect(simulation.saveState()).toEqual(before);
});

it.each([[0, 0], [1, 1], [2, 1], [3, 2], [4, 2]])(
  "migrates legacy rank %i to %i once, preserving garrisons, stock and local population",
  (legacyRank, modernRank) => {
    const { advance, simulation } = session(); advance(120);
    const historical = simulation.saveState();
    delete historical.military!.rankVersion;
    historical.military!.soldiers[0]!.rank = legacyRank;
    const ids = historical.military!.soldiers.map(soldier => soldier.actor);
    const stock = { ...historical.buildings.find(building => building.typeId === 0)!.inventory };
    expect(simulation.loadState(historical)).toEqual({ ok: true });
    expect(historical.military!.soldiers[0]!.rank).toBe(legacyRank);
    const modern = simulation.saveState();
    expect(modern.military!.rankVersion).toBe(1);
    expect(modern.military!.soldiers[0]!.rank).toBe(modernRank);
    expect(modern.military!.soldiers.map(soldier => soldier.actor)).toEqual(ids);
    expect(modern.military!.soldiers.every(soldier => soldier.stationed)).toBe(true);
    expect(modern.settlers).toBe(historical.settlers);
    expect(modern.buildings.map(building => building.idleSettlers))
      .toEqual(historical.buildings.map(building => building.idleSettlers));
    expect(modern.buildings.find(building => building.typeId === 0)!.inventory).toEqual(stock);
    expect(modern.nextActor).toBe(historical.nextActor);
    expect(modern.reservations).toEqual(historical.reservations);
    expect(modern.naval).toEqual(historical.naval);
    expect(simulation.loadState(modern)).toEqual({ ok: true });
    expect(simulation.saveState()).toEqual(modern);
  }
);

it("rejects unsupported schemes and out-of-range modern or legacy ranks before mutation", () => {
  const { advance, simulation } = session(); advance(120);
  const before = simulation.saveState();
  for (const [version, rank] of [[1, 3], [undefined, 5], [2, 1]]) {
    const invalid = JSON.parse(JSON.stringify(before));
    invalid.military.rankVersion = version;
    invalid.military.soldiers[0].rank = rank;
    expect(simulation.loadState(invalid).ok).toBe(false);
    expect(simulation.saveState()).toEqual(before);
  }
});


it.each([
  ["viking", "viking-man-blond"], ["nubian", "nubian-man-kilt"], ["japanese", "japanese-man-grey"],
])("recruited %s soldiers retain all three equipment tiers through training and load", (nation, variant) => {
  const { advance, building, simulation } = session();
  simulation.setMilitaryCoins(building.uid, false); advance(120);
  const templates: WorkerFrame[] = [{ nation: nation as WorkerNation, variant, x: 0, y: 0, z: 0,
    heading: 0, action: "idle_breathe", animationTime: 0, gaitPhase: 0, runBlend: 0,
    target: null, selected: false }];
  const renderer = createSettlementRenderFrames(templates);
  const tiers = new Set<string>();
  const ids = simulation.militarySoldiers().map(soldier => soldier.actor);
  for (let cycle = 0; cycle < 9; cycle++) {
    const soldiers = simulation.militarySoldiers();
    renderer.updateWorkers(simulation.frames().map(actor => ({ ...actor, visible: true })), .05, soldiers);
    for (const soldier of soldiers) {
      const frame = renderer.workers.find(entry => entry.actorId === soldier.actor)!;
      expect(frame.nation).toBe(nation); expect(frame.variant).toBe(variant);
      expect(frame.workerJob).toBe("Soldier"); expect(frame.workerTool).toBe("sword");
      tiers.add(frame.armourRank!);
    }
    const before = soldiers.map(soldier => soldier.rank);
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
    expect(simulation.militarySoldiers().map(soldier => soldier.rank)).toEqual(before);
    const current = simulation.buildings().find(entry => entry.uid === building.uid)!;
    current.input.coins = 1; current.input.wine = 1; advance(30);
  }
  expect(tiers).toEqual(new Set(["recruit", "soldier", "centurion"]));
  expect(simulation.militarySoldiers().every(soldier => soldier.rank === 2)).toBe(true);
  expect(simulation.militarySoldiers().map(soldier => soldier.actor)).toEqual(ids);
  expect(totalPeople(simulation)).toBe(20 + simulation.settlerBirths());
  for (const ware of ["sword", "shield", "beer"]) expect(simulation.headquarters.inventory[ware]).toBe(2);
});
