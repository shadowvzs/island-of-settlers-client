import { describe, expect, it } from "vitest";

import { EXPEDITION_SUPPLIES } from "../src/shared/settlement/settlement-naval-preparation";
import { BOARDING_FILE } from "../src/shared/settlement/settlement-naval-passengers";
import { isSharedStorageWare } from "../src/shared/settlement/shared-storage";
import { FOG } from "../src/shared/world/world-data";
import { advance, navalPassengerFixture as fixture, population } from "./helpers/naval-passenger-fixture";

/** Author a pool balance through its live access, without replacing/severing the runtime view. */
const replacePoolStock = (source: ReturnType<typeof fixture>["source"], goods: Record<string, number>) => {
  for (const ware of Object.keys(source.inventory)) if (isSharedStorageWare(ware)) delete source.inventory[ware];
  Object.assign(source.inventory, goods);
};
const sharedStock = (inventory: Record<string, number>) => Object.fromEntries(Object.entries(inventory)
  .filter(([ware]) => isSharedStorageWare(ware)));

// The beachhead, reserve-soldier and workshop-boat cases live in settlement-naval-beachhead-boats.slow.test.ts.
describe("passenger and settlement expedition accounting", () => {
  it("boards every infantry soldier before cavalry and keeps their real deck actors", () => {
    const { simulation, source } = fixture();
    simulation.receiveTroops(["heavy", "shield", "heavy", "shield", "heavy", "shield", "heavy", "shield"].map(type =>
      ({ hp: 90, rank: 0, type: type as "heavy" | "shield" })));
    const island = simulation.adventureIslands().find(island => island.difficulty === "easy")!;
    expect(simulation.startAdventureExpedition(source.uid, island.id, { heavy: 4, shield: 4 }))
      .toMatchObject({ ok: true });
    const aboard = new Set<number>(), types: string[] = [];
    for (let tick = 0; tick < 12000 && aboard.size < 8; tick++) {
      simulation.update(.05);
      const soldiers = new Map(simulation.militarySoldiers().map(soldier => [soldier.actor, soldier]));
      for (const actor of simulation.frames()) {
        if (actor.phase !== "navalAboard" || aboard.has(actor.uid)) continue;
        expect(actor.visible).toBe(true);
        expect(actor.mounted).not.toBe(true);
        aboard.add(actor.uid);
        types.push(soldiers.get(actor.uid)!.combat!.type);
      }
    }
    expect(aboard.size).toBe(8);
    expect(types).not.toContain("cavalry");
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
  });
  it("walks real passengers along a saved pier and keeps them visible on the sailing deck", () => {
    const { destination, simulation, source } = fixture();
    expect(simulation.queueSeaPassengers(source.uid, destination.uid, 3)).not.toBeNull();
    const phases = new Set<string>();
    let reloaded = false, sailing = false, visibleDeck = false;
    for (let tick = 0; tick < 6000 && !sailing; tick++) {
      simulation.update(.05);
      const passengers = simulation.frames().filter(actor => actor.navalOrder !== undefined);
      for (const actor of passengers) phases.add(actor.phase);
      const onPier = passengers.find(actor => actor.phase === "navalBoarding");
      if (onPier && !reloaded) {
        const pose = { x: onPier.x, y: onPier.y, z: onPier.z };
        expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
        expect(simulation.frames().find(actor => actor.uid === onPier.uid)).toMatchObject(pose);
        reloaded = true;
      }
      sailing = simulation.ships()[0]?.phase === "sailing";
      visibleDeck ||= passengers.length === 3 && passengers.every(actor =>
        actor.phase === "navalAboard" && actor.visible);
    }
    expect(reloaded).toBe(true);
    expect([...phases]).toEqual(expect.arrayContaining(["navalToShip", "navalBoarding", "navalDeckWalk", "navalAboard"]));
    expect(sailing).toBe(true);
    expect(visibleDeck).toBe(true);
    const ship = simulation.shipFrames()[0]!;
    const passengers = simulation.frames().filter(actor => actor.navalOrder !== undefined);
    expect(passengers).toHaveLength(3);
    expect(passengers.every(actor => actor.y > ship.y &&
      Math.hypot(actor.x - ship.x, actor.z - ship.z) < 5)).toBe(true);
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
  });
  it("moves finite helpers, cancels exactly once and survives a sailing reload", () => {
    const { destination, simulation, source } = fixture();
    const before = simulation.availableSettlers(), total = population(simulation);
    const cancelled = simulation.queueSeaPassengers(source.uid, destination.uid, 3)!;
    expect(simulation.availableSettlers()).toBe(before - 3);
    expect(population(simulation)).toBe(total);
    expect(simulation.cancelSeaTransport(cancelled)).toBe(true);
    expect(simulation.cancelSeaTransport(cancelled)).toBe(false);
    expect(simulation.availableSettlers()).toBe(before);
    const order = simulation.queueSeaPassengers(source.uid, destination.uid, 4)!;
    expect(order).not.toBeNull();
    for (let i = 0; i < 2000 && simulation.ships()[0]?.phase !== "sailing"; i++) simulation.update(.05);
    expect(simulation.ships()[0]?.passengers).toBe(4);
    expect(simulation.ships()[0]?.passengerJobs).toEqual({ Settler: 4 });
    const saved = simulation.saveState();
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    expect(simulation.ships()[0]?.passengerJobs).toEqual({ Settler: 4 });
    advance(simulation, 120);
    expect(simulation.frames().filter(actor => actor.navalOrder !== undefined)).toHaveLength(0);
    expect(simulation.availableSettlers()).toBeGreaterThanOrEqual(before);
    expect(population(simulation)).toBe(total);
    expect(simulation.ships()[0]?.passengers).toBe(0);
    expect(simulation.ships()[0]?.passengerJobs).toEqual({});
    const corrupt = structuredClone(saved);
    corrupt.naval.fleet.ships[0]!.passengers!.push(corrupt.naval.fleet.ships[0]!.passengers![0]!);
    expect(simulation.loadState(corrupt).ok).toBe(false);
    const corruptRoute = structuredClone(saved);
    corruptRoute.naval.fleet.ships[0]!.route[0]!.yaw = Number.NaN;
    expect(simulation.loadState(corruptRoute).ok).toBe(false);
  });
  it("lands passengers two at a time over the pier into the harbour, also after a save while going ashore", () => {
    const { destination, simulation, source } = fixture();
    const before = simulation.availableSettlers(), total = population(simulation);
    simulation.queueSeaPassengers(source.uid, destination.uid, 4);
    const phases = () => simulation.frames().filter(actor => actor.navalOrder !== undefined).map(actor => actor.phase);
    let ashore = false;
    for (let tick = 0; tick < 8000 && !ashore; tick++) {
      simulation.update(.05);
      const now = phases();
      expect(now.filter(phase => phase === "navalDisembark").length).toBeLessThanOrEqual(BOARDING_FILE);
      ashore = now.includes("navalLanding");
    }
    expect(ashore).toBe(true);
    expect(simulation.ships()[0]?.phase).toBe("unloading");
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
    expect(population(simulation)).toBe(total);
    for (let tick = 0; tick < 4000 && phases().length; tick++) simulation.update(.05);
    expect(phases()).toEqual([]);
    expect(simulation.availableSettlers()).toBeGreaterThanOrEqual(before);
    expect(population(simulation)).toBe(total);
    // Unloaded, the ship leaves the berth for a waiting spot clear of the approaches and lies there idle.
    advance(simulation, 1);
    expect(simulation.ships()[0]?.phase).toBe("sailing");
    advance(simulation, 120);
    expect(simulation.ships()[0]?.phase).toBe("idle");
  });
  it("loads and boards an expedition before it sails, even with its crew already in the harbour", () => {
    // Owner 2026-11-09: never an instant departure. A crew waiting inside the harbour still walks over
    // the pier onto the deck, and porters carry the cargo aboard, before the ship casts off.
    const { simulation, source } = fixture();
    replacePoolStock(source, { ...EXPEDITION_SUPPLIES });
    expect(source.idleSettlers ?? 0).toBeGreaterThanOrEqual(3);
    expect(simulation.queueSeaExpedition(source.uid, { x: 110, z: 30, rotation: 0 })).not.toBeNull();
    const crew = () => simulation.frames().filter(actor => actor.navalOrder !== undefined);
    expect(crew().map(actor => actor.phase)).toEqual(["navalWaiting", "navalWaiting", "navalWaiting"]);
    const seen = new Set<string>();
    let reloaded = false, sailedAt = -1;
    for (let tick = 0; tick < 6000 && sailedAt < 0; tick++) {
      simulation.update(.05);
      const ship = simulation.ships()[0]!;
      seen.add(ship.phase);
      for (const actor of crew()) seen.add(actor.phase);
      if (!reloaded && crew().some(actor => actor.phase === "navalBoarding")) {
        const saved = simulation.saveState();
        // Porters carry the cargo aboard box by box while the crew boards.
        expect(saved.naval.fleet.ships[0]!.handling?.boxes ?? 0).toBeGreaterThan(0);
        expect(simulation.loadState(saved)).toEqual({ ok: true });
        reloaded = true;
      }
      if (ship.phase === "sailing") sailedAt = tick;
    }
    expect(reloaded).toBe(true);
    for (const phase of ["loading", "navalToShip", "navalBoarding", "navalDeckWalk", "navalAboard"])
      expect(seen, phase).toContain(phase);
    expect(crew().every(actor => actor.phase === "navalAboard")).toBe(true);
    expect(simulation.ships()[0]!.cargo).toMatchObject({ ...EXPEDITION_SUPPLIES });
    // Measured 2026-11-09 on this fixture: about 73 s from the order to casting off.
    expect(sailedAt * .05).toBeGreaterThan(30);
  });
  it("reloads paid pool preparations and rejects corrupted stock, crew and harbour receipts", () => {
    const { simulation, source } = fixture();
    replacePoolStock(source, { ...EXPEDITION_SUPPLIES });
    // The crew walks in from the headquarters, so the preparation waits for it ("crew") and can be
    // saved and reloaded; a crew stored in the harbour goes straight to loading and boarding (above).
    const headquarters = simulation.buildings().find(building => building.uid === simulation.headquarters.uid)!;
    headquarters.idleSettlers = (headquarters.idleSettlers ?? 0) + (source.idleSettlers ?? 0);
    source.idleSettlers = 0;
    const id = simulation.queueSeaExpedition(source.uid, { x: 110, z: 30, rotation: 0 })!;
    expect(id).toBeLessThan(0);
    const saved = simulation.saveState();
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    expect(simulation.seaExpeditionPreparations()[0]).toMatchObject({
      cargo: { ...EXPEDITION_SUPPLIES }, crew: 3, builder: true, status: "crew"
    });
    for (const corruption of ["stock", "prototype", "crew", "source"]) {
      const invalid = structuredClone(saved), preparation = invalid.naval.preparation.preparations[0]!;
      if (corruption === "stock") preparation.cargo.planks = (EXPEDITION_SUPPLIES.planks ?? 0) + 1;
      if (corruption === "prototype") preparation.cargo["constructor"] = 1;
      if (corruption === "crew") preparation.passengers[1] = preparation.passengers[0]!;
      if (corruption === "source") preparation.sourceUid = simulation.headquarters.uid;
      expect(simulation.loadState(invalid).ok, corruption).toBe(false);
    }
    expect(simulation.cancelSeaTransport(id)).toBe(true);
    const restored = simulation.buildings().find(building => building.uid === source.uid)!;
    expect(sharedStock(restored.inventory)).toEqual({ ...EXPEDITION_SUPPLIES });
    const legacy = simulation.saveState();
    delete (legacy.naval as Partial<typeof legacy.naval>).preparation;
    expect(simulation.loadState(legacy)).toEqual({ ok: true });
    expect(simulation.seaExpeditionPreparations()).toEqual([]);
  });
  it("rejects invalid destinations and unfunded pool preparation without reserving people or materials", () => {
    const { simulation, source } = fixture();
    replacePoolStock(source, {});
    const free = simulation.availableSettlers(), state = simulation.saveState();
    expect(simulation.queueSeaPassengers(source.uid, 9876, 3)).toBeNull();
    const preparation = simulation.queueSeaExpedition(source.uid, { x: 110, z: 30, rotation: 0 });
    expect(preparation).toBeNull();
    expect(simulation.seaExpeditionPreparations()).toEqual([]);
    expect(simulation.saveState().storagePools).toEqual(state.storagePools);
    expect(simulation.availableSettlers()).toBe(free);
    expect(simulation.saveState().naval.fleet.orders).toEqual(state.naval.fleet.orders);
    expect(simulation.queueSeaPassengers(source.uid, source.uid, 1)).toBeNull();
  });
});

describe("cancelled voyages retain paid cargo", () => {
  it("returns an expedition while sailing without founding a free harbour or losing settlers", () => {
    const { simulation, source } = fixture();
    replacePoolStock(source, { ...EXPEDITION_SUPPLIES });
    const total = population(simulation), free = simulation.availableSettlers();
    const target = simulation.seaExpeditionDestinations(source.uid)[0]!;
    expect(simulation.queueSeaExpedition(source.uid, target)).not.toBeNull();
    for (let i = 0; i < 6000 && simulation.ships()[0]?.phase !== "sailing"; i++) simulation.update(.05);
    expect(simulation.ships()[0]?.expedition).toBe(true);
    // The crew walks from the HQ first (POP-01), so the voyage launched from a preparation.
    const id = simulation.ships()[0]!.orderId!;
    expect(simulation.cancelSeaTransport(id)).toBe(true);
    expect(simulation.cancelSeaTransport(id)).toBe(false);
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
    advance(simulation, 150);
    expect(simulation.buildings().some(building => building.foundedByExpedition)).toBe(false);
    const actualSource = simulation.buildings().find(building => building.uid === source.uid)!;
    expect(sharedStock(actualSource.inventory)).toEqual({ ...EXPEDITION_SUPPLIES });
    expect(simulation.frames().filter(actor => actor.navalOrder !== undefined)).toHaveLength(0);
    expect(simulation.availableSettlers()).toBeGreaterThanOrEqual(free);
    expect(population(simulation)).toBe(total);
  });
});


describe("exploration expedition accounting", () => {
  it("owns one equipped scout, charts observed sites and returns the same crew after a sailing load", () => {
    const { destination, simulation, source, world } = fixture();
    world.fog = new Uint8Array(world.cellsX * world.cellsZ);
    source.inventory.spyglass = 1;
    source.inventory.bow = 7;
    const total = population(simulation), available = simulation.availableSettlers();
    expect(simulation.seaExplorationAvailability(source.uid)).toMatchObject({ hidden: false, ready: true });
    const id = simulation.queueSeaExploration(source.uid);
    expect(id).not.toBeNull(); expect(source.inventory.spyglass).toBe(0);
    expect(simulation.availableSettlers()).toBe(available - 1);
    expect(simulation.frames().filter(actor => actor.navalOrder === id)).toHaveLength(1);
    // The single idle ship is not offered a second time while this order waits for it.
    destination.inventory.spyglass = 1; // A second authored tool in this shared pool; the first is aboard.
    expect(simulation.seaExplorationAvailability(destination.uid)).toMatchObject({ ready: false, reason: "ship" });
    expect(simulation.queueSeaExploration(source.uid)).toBeNull();
    const ids = simulation.frames().filter(actor => actor.navalOrder === id).map(actor => actor.uid);
    expect(ids).toHaveLength(1);
    expect(simulation.frames().find(actor => actor.uid === ids[0])?.tool).toBe("spyglass");
    for (let tick = 0; tick < 4000 && simulation.ships()[0]?.phase !== "sailing"; tick++) simulation.update(.05);
    expect(simulation.ships()[0]?.exploration).toBe(true);
    const sailingSave = simulation.saveState();
    expect(sailingSave.naval.charting.sites).toEqual([]);
    expect(simulation.loadState(sailingSave)).toEqual({ ok: true });
    const bowCrew = structuredClone(sailingSave);
    bowCrew.actors.find(actor => ids.includes(actor.uid))!.tool = "bow";
    expect(simulation.loadState(bowCrew)).toEqual({ ok: false, reason: "Invalid passenger identity or reservation" });
    const unequippedCrew = structuredClone(sailingSave);
    unequippedCrew.actors.find(actor => ids.includes(actor.uid))!.tool = undefined;
    expect(simulation.loadState(unequippedCrew)).toEqual({ ok: false, reason: "Invalid exploration receipt or scout crew" });
    const invalid = structuredClone(sailingSave); invalid.naval.fleet.ships[0]!.exploration!.cursor = 999;
    expect(simulation.loadState(invalid).ok).toBe(false);
    advance(simulation, 1500);
    expect(simulation.frames().filter(actor => actor.navalOrder !== undefined)).toHaveLength(0);
    expect(simulation.ships()[0]?.exploration).toBe(false);
    expect(simulation.buildings().find(building => building.uid === source.uid)?.inventory.spyglass).toBe(2);
    expect(simulation.buildings().find(building => building.uid === source.uid)?.inventory.bow).toBe(7);
    expect(ids.every(uid => !simulation.frames().some(actor => actor.uid === uid))).toBe(true);
    expect(population(simulation)).toBe(total);
    expect(world.fog.some(value => value === FOG.discovered)).toBe(true);
    expect(simulation.seaChartedSites().length).toBeGreaterThan(0);
    const saved = simulation.saveState();
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    expect(simulation.seaChartedSites()).toEqual(saved.naval.charting.sites);
    const wrongMap = structuredClone(saved);
    wrongMap.naval.charting.sites[0]!.map.seed++;
    expect(simulation.loadState(wrongMap).ok).toBe(false);
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
  });
  it("cancels queued and sailing scouts once, refunds one spyglass only after crew return, and never creates a harbour", () => {
    const { simulation, source } = fixture(); source.inventory.spyglass = 1;
    const total = population(simulation), count = simulation.buildings().length;
    const queued = simulation.queueSeaExploration(source.uid)!;
    expect(queued).not.toBeNull(); expect(simulation.cancelSeaTransport(queued)).toBe(true);
    expect(simulation.cancelSeaTransport(queued)).toBe(false); expect(source.inventory.spyglass).toBe(1);
    const sailing = simulation.queueSeaExploration(source.uid)!;
    for (let tick = 0; tick < 4000 && simulation.ships()[0]?.phase !== "sailing"; tick++) simulation.update(.05);
    expect(simulation.cancelSeaTransport(sailing)).toBe(true); expect(simulation.cancelSeaTransport(sailing)).toBe(false);
    expect(source.inventory.spyglass).toBe(0);
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true }); advance(simulation, 200);
    expect(simulation.buildings().find(building => building.uid === source.uid)?.inventory.spyglass).toBe(1);
    expect(population(simulation)).toBe(total); expect(simulation.buildings()).toHaveLength(count);
  });
});


it("refuses sea exploration with hunting bows instead of spyglasses without reserving people or tools", () => {
  const { simulation, source } = fixture();
  source.inventory.spyglass = 0;
  source.inventory.bow = 3;
  const before = simulation.saveState(), settlers = simulation.availableSettlers();
  expect(simulation.queueSeaExploration(source.uid)).toBeNull();
  expect(simulation.availableSettlers()).toBe(settlers);
  expect(sharedStock(source.inventory)).toEqual(before.storagePools.pools.find(pool => pool.id === source.storagePoolId)!.available);
  expect(simulation.saveState().naval).toEqual(before.naval);
});
