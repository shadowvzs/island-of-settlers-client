import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { TAVERN_TYPE_ID } from "../src/shared/settlement/building-type-ids";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { Goods } from "../src/shared/settlement/settlement-types";
import { missingTavernIngredients, TAVERN_RECIPES } from "../src/shared/settlement/tavern-rules";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

/** Whole recruiting journeys run hundreds of simulated seconds. */
const JOURNEY_TIMEOUT = 60_000;
const FULL_KIT: Goods = { armor: 4, axe: 4, beer: 4, bow: 4, shield: 4, sword: 4 };

const fixture = (stock: Goods = FULL_KIT, settlers = 20) => {
  const size = 48;
  const world = { seed: 9, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 8.5, z: 8.5 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2), mineZones: [],
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(), scale: new Float32Array() }
  } as unknown as WorldData;
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world, roads, initialSettlers: settlers,
    initialStock: { planks: 40, stone: 40, ...stock }, canWorkerEnterPlot: () => true });
  const [width, depth] = getBuildingDefinition(TAVERN_TYPE_ID).gridFootprint;
  const placed = simulation.placeBuilding(TAVERN_TYPE_ID, 20 + width % 2 / 2, 12 + depth % 2 / 2);
  if (!placed.ok || !placed.building) throw new Error(placed.reason);
  const tavern = placed.building;
  Object.assign(tavern, { construction: 1, foundationProgress: 1, required: {} });
  expect(roads.addRoad(simulation.headquarters.access, tavern.access)).toBe(true);
  const advance = (seconds: number) => { for (let tick = 0; tick < seconds * 20; tick++) simulation.update(.05); };
  const reserves = () => simulation.militarySoldiers().filter(soldier =>
    simulation.frames().find(actor => actor.uid === soldier.actor)?.phase === "militaryReserve");
  return { advance, reserves, simulation, tavern };
};

it("keeps armour and beer recipes for ordinary troops and retires the cavalry recipe", () => {
  expect(TAVERN_RECIPES).toEqual({
    shield: { armor: 1, beer: 1, shield: 1, sword: 1 },
    heavy: { armor: 1, axe: 1, beer: 1 },
    archer: { armor: 1, beer: 1, bow: 1 }
  });
  expect("cavalry" in TAVERN_RECIPES).toBe(false);
  expect(missingTavernIngredients("archer", 2, { goods: { armor: 2, beer: 1, bow: 5 }, settlers: 1 })).toEqual([
    { count: 1, ware: "settler" }, { count: 1, ware: "beer" }
  ]);
  expect(missingTavernIngredients("heavy", 1, { goods: { armor: 1, axe: 1, beer: 1 }, settlers: 1 })).toEqual([]);
});

it("refuses an order unless the connected storages hold every ingredient, without touching stock", () => {
  const { advance, simulation, tavern } = fixture({ beer: 2, shield: 2, sword: 2 });
  advance(5);
  expect(simulation.orderTavernRecruits(tavern.uid, "shield", 1)).toEqual({ ok: false, reason: "Missing 1 armor set" });
  expect(simulation.orderTavernRecruits(tavern.uid, "cavalry", 1))
    .toEqual({ ok: false, reason: "Ordinary cavalry is retired" });
  expect(simulation.orderTavernRecruits(tavern.uid, "shield", 0).ok).toBe(false);
  expect(simulation.orderTavernRecruits(tavern.uid, "general", 1).ok).toBe(false);
  expect(simulation.headquarters.inventory).toMatchObject({ beer: 2, shield: 2, sword: 2 });
  expect(simulation.tavernOrders()[0]?.queue).toEqual([]);
}, JOURNEY_TIMEOUT);

it.each(["shield", "heavy", "archer"] as const)("carriers stock the Tavern and the settler leaves as a stored %s", type => {
  const { advance, reserves, simulation, tavern } = fixture();
  advance(5);
  const freeSettlers = () => simulation.availableSettlers() - simulation.settlerBirths();
  const settlers = freeSettlers();
  expect(simulation.orderTavernRecruits(tavern.uid, type, 1)).toEqual({ ok: true });
  let delivered = false, recruitSeen = false;
  for (let tick = 0; tick < 20 * 240 && !reserves().length; tick++) {
    simulation.update(.05);
    delivered ||= simulation.frames().some(actor => actor.job === "Carrier" && actor.ware === "armor");
    recruitSeen ||= simulation.frames().some(actor => actor.job === "Recruit");
  }
  expect(delivered).toBe(true); expect(recruitSeen).toBe(true);
  expect(reserves().map(soldier => soldier.combat?.type)).toEqual([type]);
  for (const [ware, count] of Object.entries(TAVERN_RECIPES[type]))
    expect(simulation.headquarters.inventory[ware], ware).toBe(FULL_KIT[ware]! - count);
  expect(tavern.input).toEqual(Object.fromEntries(Object.keys(TAVERN_RECIPES[type]).map(ware => [ware, 0])));
  // One settler became the soldier (carriers return home).
  expect(freeSettlers()).toBeLessThanOrEqual(settlers - 1);
  expect(simulation.tavernOrders()[0]?.queue).toEqual([]);
  expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
}, JOURNEY_TIMEOUT);

it("never recruits cavalry", () => {
  const { advance, reserves, simulation, tavern } = fixture();
  advance(5);
  expect(simulation.orderTavernRecruits(tavern.uid, "cavalry", 1))
    .toEqual({ ok: false, reason: "Ordinary cavalry is retired" });
  advance(30);
  expect(reserves()).toEqual([]);
  expect(simulation.militaryStoredTroops().find(entry => entry.type === "cavalry")?.count ?? 0).toBe(0);
}, JOURNEY_TIMEOUT);

it("rejects a saved cavalry order or batch (ordinary cavalry no longer exists)", () => {
  const { advance, simulation, tavern } = fixture();
  advance(5);
  const order = simulation.saveState();
  order.tavern = { batches: [], orders: [[tavern.uid, [{ count: 1, type: "cavalry" }]]] };
  expect(simulation.loadState(order)).toMatchObject({ ok: false });
  const batch = simulation.saveState();
  batch.tavern = { batches: [[tavern.uid, { stage: "collect", timer: 0, type: "cavalry" }]], orders: [] };
  expect(simulation.loadState(batch)).toMatchObject({ ok: false });
}, JOURNEY_TIMEOUT);

it("sends a new recruit on to the planted rally banner once it reached storage (owner 2026-10-13)", () => {
  const { advance, simulation, tavern } = fixture();
  expect(simulation.plantMilitaryRally({ x: 30, z: 30 })).toBe(true);
  expect(simulation.orderTavernRecruits(tavern.uid, "shield", 1)).toEqual({ ok: true });
  let gathered = false;
  for (let second = 0; second < 400 && !gathered; second++) {
    advance(1);
    const recruit = simulation.militarySoldiers()[0];
    const body = recruit && simulation.frames().find(actor => actor.uid === recruit.actor);
    gathered = Boolean(body && body.phase === "militaryField" && Math.hypot(body.x - 30, body.z - 30) < 2);
  }
  expect(gathered).toBe(true);
}, JOURNEY_TIMEOUT);

it("queues a count, saves a recruit in progress and military buildings take only the stored results", () => {
  const { advance, reserves, simulation, tavern } = fixture();
  const barracks = simulation.placeBuilding(1, 30, 24);
  if (!barracks.ok || !barracks.building) throw new Error(barracks.reason);
  Object.assign(barracks.building, { construction: 1, required: {} });
  simulation.connectRoads(simulation.headquarters.access, barracks.building.access);
  advance(30);
  // Settlers and equipment in storage alone never make a garrison.
  expect(simulation.militarySoldiers()).toEqual([]);
  expect(simulation.orderTavernRecruits(tavern.uid, "archer", 2)).toEqual({ ok: true });
  advance(20);
  expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
  advance(400);
  expect(simulation.militarySoldiers().map(soldier => soldier.combat?.type)).toEqual(["archer", "archer"]);
  expect(simulation.militaryBuildings()[0]?.stationed).toBe(2);
  expect(reserves()).toEqual([]);
  expect(simulation.headquarters.inventory.bow).toBe(2);
}, JOURNEY_TIMEOUT);

it("credits buffered equipment to its queued recruits when accepting another order, including reload", () => {
  const { advance, simulation, tavern } = fixture({ armor: 8, beer: 8, bow: 8 }, 40);
  advance(20);
  expect(simulation.orderTavernRecruits(tavern.uid, "archer", 4)).toEqual({ ok: true });
  for (let tick = 0; tick < 6000 && (tavern.input.bow ?? 0) < 2; tick++) simulation.update(.05);
  expect((tavern.input.bow ?? 0) + (tavern.incoming.bow ?? 0)).toBeGreaterThanOrEqual(2);
  const saved = simulation.saveState();
  expect(simulation.loadState(saved)).toEqual({ ok: true });
  expect(simulation.orderTavernRecruits(tavern.uid, "archer", 4)).toEqual({ ok: true });
  expect(simulation.orderTavernRecruits(tavern.uid, "archer", 1).ok).toBe(false);
  advance(800);
  expect(simulation.militarySoldiers().filter(soldier => soldier.combat?.type === "archer")).toHaveLength(8);
  expect(simulation.headquarters.inventory.bow).toBe(0);
  expect(simulation.headquarters.inventory.armor).toBe(0);
  expect(simulation.headquarters.inventory.beer).toBe(0);
}, JOURNEY_TIMEOUT);
