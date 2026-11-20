import { describe, expect, it } from "vitest";

import { advance, navalPassengerFixture as fixture, population } from "./helpers/naval-passenger-fixture";

// Split from settlement-naval-passengers.test.ts so the slow project runs both halves in parallel.
describe("passenger and settlement expedition accounting: beachhead, reserve soldier, workshop boat", () => {
  it("pays a new-island harbour, builds it using an actual builder and creates only its beachhead territory", () => {
    const { simulation, source } = fixture();
    source.inventory = { planks: 4, stone: 6, hammer: 1, shovel: 1 };
    const destinations = simulation.seaExpeditionDestinations(source.uid);
    expect(destinations.length).toBeGreaterThan(0);
    const point = destinations[0]!;
    expect(point.x).toBeGreaterThan(103);
    const free = simulation.availableSettlers();
    expect(simulation.ownsTerritory(point)).toBe(false);
    expect(simulation.queueSeaExpedition(source.uid, point)).not.toBeNull();
    expect(source.inventory).toEqual({ planks: 0, stone: 0, hammer: 0, shovel: 0 });
    expect(simulation.availableSettlers()).toBe(free - 3);
    for (let i = 0; i < 6000 && !simulation.ships()[0]?.expedition; i++) simulation.update(.05);
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
    advance(simulation, 250);
    const outpost = simulation.buildings().find(building => building.foundedByExpedition)!;
    expect(outpost).toBeDefined();
    expect(outpost.construction).toBeLessThan(1);
    const foundingShip = simulation.ships()[0]!;
    expect(foundingShip.foundingSiteUid).toBeDefined();
    expect(foundingShip.phase).toBe("founding");
    for (let tick = 0; tick < 6000 && simulation.saveState().naval.founding.operations.length; tick++)
      simulation.update(.05);
    expect(outpost.construction).toBe(1);
    expect(outpost.constructionConsumed).toEqual({ planks: 4, stone: 6 });
    expect(outpost.inventory.hammer).toBe(1);
    expect(outpost.inventory.shovel).toBe(1);
    expect(outpost.foundedByExpedition).toBe(true);
    expect(outpost.foundingAnchor).toBe(true);
    expect(simulation.demolishBuilding(outpost.uid).ok).toBe(false);
    expect(simulation.ships()[0]?.foundingSiteUid).toBeUndefined();
    expect(simulation.ships()[0]?.phase).toBe("idle");
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
    const reloadedOutpost = simulation.buildings().find(building => building.uid === outpost.uid)!;
    expect(reloadedOutpost.foundingAnchor).toBe(true);
    expect(simulation.demolishBuilding(reloadedOutpost.uid).ok).toBe(false);
    expect(simulation.frames().filter(actor => actor.navalOrder !== undefined)).toHaveLength(0);
  });
  it("keeps an equipped reserve soldier and rank through travel, cancellation and a sea voyage", () => {
    const { destination, place, simulation, source } = fixture();
    Object.assign(simulation.headquarters.inventory, { sword: 2, shield: 2, beer: 2 });
    // The barracks takes this stored swordsman (military buildings no longer recruit).
    simulation.recruitStoredMilitary(simulation.headquarters.uid, "shield");
    simulation.recruitStoredMilitary(simulation.headquarters.uid, "shield");
    const barracks = place(1, 18, 48);
    advance(simulation, 160);
    simulation.setMilitaryTarget(barracks.uid, 0);
    advance(simulation, 90);
    const historical = simulation.saveState();
    delete historical.military!.rankVersion;
    const reserveId = historical.actors.find(actor => actor.phase === "militaryReserve")!.uid;
    historical.military!.soldiers.find(soldier => soldier.actor === reserveId)!.rank = 4;
    expect(simulation.loadState(historical)).toEqual({ ok: true });
    const soldier = simulation.frames().find(actor => actor.job === "Soldier" && actor.phase === "militaryReserve")!;
    expect(soldier).toBeDefined();
    const uid = soldier.uid, rank = simulation.militarySoldiers().find(troop => troop.actor === uid)!.rank;
    expect(rank).toBe(2);
    const total = population(simulation);
    const order = simulation.queueSeaPassengers(source.uid, destination.uid, 0, 1)!;
    advance(simulation, 2);
    const position = { x: soldier.x, z: soldier.z };
    expect(simulation.cancelSeaTransport(order)).toBe(true);
    expect(Math.hypot(soldier.x - position.x, soldier.z - position.z)).toBe(0);
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
    advance(simulation, 100);
    expect(simulation.frames().find(actor => actor.uid === uid)?.phase, JSON.stringify(simulation.frames().find(actor => actor.uid === uid))).toBe("militaryReserve");
    expect(simulation.queueSeaPassengers(source.uid, destination.uid, 0, 1)).not.toBeNull();
    for (let tick = 0; tick < 5000 && simulation.frames().find(actor => actor.uid === uid)?.phase !== "navalAboard";
      tick++) simulation.update(.05);
    expect(simulation.frames().find(actor => actor.uid === uid)?.phase).toBe("navalAboard");
    const aboard = simulation.saveState();
    delete aboard.military!.rankVersion;
    aboard.military!.soldiers.find(soldier => soldier.actor === uid)!.rank = 4;
    expect(simulation.loadState(aboard)).toEqual({ ok: true });
    expect(simulation.saveState().naval).toEqual(aboard.naval);
    expect(simulation.militarySoldiers().find(troop => troop.actor === uid)?.rank).toBe(2);
    advance(simulation, 180);
    const arrived = simulation.frames().find(actor => actor.uid === uid)!;
    expect(arrived.home).toBe(destination.uid);
    expect(arrived.phase).toBe("militaryReserve"); expect(arrived.tool).toBe("sword");
    expect(simulation.militarySoldiers().find(troop => troop.actor === uid)?.rank).toBe(rank);
    expect(population(simulation)).toBe(total);
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
  }, 30000);
  it.each([0, 1, 2, 3])("builds a workshop boat and carries it to HQ with rotation %i and mid-work reload", rotation => {
    const { place, simulation } = fixture();
    const yard = place(36, 22, 48, rotation);
    const phases = new Set<string>();
    let reloaded = false, maximumStep = 0;
    for (let i = 0; i < 10000 && !(simulation.headquarters.inventory.boat ?? 0); i++) {
      const actor = simulation.frames().find(candidate => candidate.building === yard.uid && candidate.job === "Shipwright");
      const before = actor && { x: actor.x, z: actor.z, visible: actor.visible };
      simulation.update(.05);
      if (!actor) continue;
      phases.add(actor.phase);
      if (actor.visible && before?.visible)
        maximumStep = Math.max(maximumStep, Math.hypot(actor.x - before.x, actor.z - before.z));
      if (!reloaded && actor.phase === "boatWork" && (actor.boatWork ?? 0) > .5) {
        expect(simulation.shipSites().some(site => site.kind === "boat")).toBe(true);
        expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
        reloaded = true;
      }
    }
    expect(reloaded).toBe(true);
    expect(phases.has("boatWork")).toBe(true);
    expect(phases.has("home")).toBe(true);
    expect(phases.has("enterHome")).toBe(true);
    expect(simulation.headquarters.inventory.boat).toBe(1);
    expect(yard.output.boat ?? 0).toBe(0);
    expect(maximumStep).toBeLessThan(.07);
  });
});

describe("founding recovery", () => {
  it("reloads during landing and recovers the crew, tools and unconsumed receipt without losing a person", () => {
    const { simulation, source } = fixture();
    source.inventory = { planks: 4, stone: 6, hammer: 1, shovel: 1 };
    const point = simulation.seaExpeditionDestinations(source.uid)[0]!;
    const order = simulation.queueSeaExpedition(source.uid, point)!;
    expect(order).not.toBeNull();
    for (let tick = 0; tick < 12000 && !simulation.buildings().some(building => building.foundedByExpedition);
      tick++) simulation.update(.05);
    const site = simulation.buildings().find(building => building.foundedByExpedition)!;
    expect(site).toBeDefined();
    expect(site.construction).toBe(0);
    expect(site.input).not.toEqual(site.required);
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
    const populationBefore = population(simulation);
    const idleBeforeCancel = simulation.buildings().find(building => building.uid === source.uid)!.idleSettlers ?? 0;
    const launchedOrder = simulation.saveState().naval.fleet.ships[0]!.orderId!;
    expect(simulation.cancelSeaTransport(launchedOrder)).toBe(true);
    for (let tick = 0; tick < 12000 && (simulation.saveState().naval.founding.operations.length ||
      simulation.ships()[0]?.phase !== "idle"); tick++) simulation.update(.05);
    expect(simulation.buildings().some(building => building.foundedByExpedition)).toBe(false);
    expect(simulation.saveState().naval.founding.operations).toEqual([]);
    const recoveredSource = simulation.buildings().find(building => building.uid === source.uid)!;
    expect(recoveredSource.inventory).toEqual({ planks: 4, stone: 6, hammer: 1, shovel: 1 });
    expect(recoveredSource.idleSettlers).toBeGreaterThanOrEqual(idleBeforeCancel + 3);
    expect(population(simulation)).toBeGreaterThanOrEqual(populationBefore);
    expect(simulation.frames().every(actor => actor.navalOrder === undefined)).toBe(true);
    expect(simulation.ships()[0]?.phase).toBe("idle");
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
  }, 30000);
});

describe("founding source loss", () => {
  it("recovers a landing operation to another harbour when its source harbour is demolished", () => {
    const { destination, simulation, source } = fixture();
    source.inventory = { planks: 4, stone: 6, hammer: 1, shovel: 1 };
    const point = simulation.seaExpeditionDestinations(source.uid)[0]!;
    expect(simulation.queueSeaExpedition(source.uid, point)).not.toBeNull();
    for (let tick = 0; tick < 12000 && !simulation.buildings().some(building => building.foundedByExpedition);
      tick++) simulation.update(.05);
    expect(simulation.buildings().some(building => building.foundedByExpedition)).toBe(true);
    expect(simulation.demolishBuilding(source.uid).ok).toBe(true);
    for (let tick = 0; tick < 12000 && (simulation.saveState().naval.founding.operations.length ||
      simulation.ships()[0]?.phase !== "idle"); tick++) simulation.update(.05);
    expect(simulation.buildings().some(building => building.foundedByExpedition)).toBe(false);
    expect(simulation.saveState().naval.founding.operations).toEqual([]);
    const recovered = simulation.buildings().find(building => building.uid === destination.uid)!;
    expect(recovered.inventory).toEqual({ planks: 4, stone: 6, hammer: 1, shovel: 1 });
    expect(simulation.ships()[0]?.phase).toBe("idle");
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
  }, 30000);
});
