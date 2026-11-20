import { describe, expect, it, vi } from "vitest";

import { COLONY_SUPPLIES } from "../src/shared/balance/colonies";
import { expeditionHarbourFixture, islandOf, storedCount } from "./helpers/colony-expedition-harbour";

/** Colony/adventure loads after `allowed` successful ones are refused while armed (a forced partial failure). */
const queueFailure = vi.hoisted(() => ({ allowed: Infinity, queued: 0 }));
vi.mock("../src/shared/settlement/settlement-naval-orders", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/shared/settlement/settlement-naval-orders")>();
  return {
    ...actual,
    createNavalOrders: (options: Parameters<typeof actual.createNavalOrders>[0]) => {
      const orders = actual.createNavalOrders(options);
      const queueTransport: typeof orders.queueTransport = (...args) => {
        if (args[6] && queueFailure.queued++ >= queueFailure.allowed) return null;
        return orders.queueTransport(...args);
      };
      return { ...orders, queueTransport };
    }
  };
});

describe("colony expeditions", () => {
  it("refuses undersized forces and busy fleets atomically before reserving troops or supplies", () => {
    const { harbour, simulation } = expeditionHarbourFixture();
    const island = simulation.colonyIslands().find(entry => entry.difficulty === "easy")!;
    const before = simulation.saveState();
    expect(simulation.startColonyExpedition(harbour.uid, island.id, { shield: 7 }))
      .toEqual({ ok: false, reason: "Select at least 8 soldiers for this target" });
    expect(simulation.saveState()).toEqual(before);
    const busy = simulation.saveState();
    busy.naval.fleet.ships[0]!.phase = "loading";
    expect(simulation.loadState(busy)).toEqual({ ok: true });
    const frozen = simulation.saveState();
    expect(simulation.startColonyExpedition(harbour.uid, island.id, { shield: 8 }))
      .toEqual({ ok: false, reason: "Requires an idle player-owned ship" });
    expect(simulation.saveState()).toEqual(frozen);
  });

  it("applies the target requirement to adventure commands", () => {
    const { harbour, simulation } = expeditionHarbourFixture();
    const island = simulation.adventureIslands().find(entry => entry.difficulty === "hard")!;
    const before = simulation.saveState();
    expect(simulation.startAdventureExpedition(harbour.uid, island.id, { shield: 20, heavy: 5 }))
      .toEqual({ ok: false, reason: "Select at least 26 soldiers for this target" });
    expect(simulation.saveState()).toEqual(before);

  });

  it("caps troops by the island's fixed difficulty and plans one deck for a small force", () => {
    const { harbour, simulation } = expeditionHarbourFixture();
    const easy = islandOf(simulation, "easy"), hard = islandOf(simulation, "hard");
    expect(simulation.startColonyExpedition(harbour.uid, easy, { heavy: 1, shield: 20 }))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/limit/) });
    expect(simulation.startColonyExpedition(harbour.uid, easy, { cavalry: 1, shield: 7 }))
      .toMatchObject({ ok: false, reason: "Ordinary cavalry is retired" });
    expect(simulation.startColonyExpedition(harbour.uid, hard, { heavy: 1, shield: 20 })).toMatchObject({ ok: true });
    expect(simulation.planColonyExpedition(harbour.uid, 0, { archer: 2, shield: 3 }))
      .toMatchObject({ loads: 1, ships: 1, trips: 1 });
    expect(simulation.planColonyExpedition(harbour.uid, 0, { shield: 20 })).toMatchObject({ loads: 2, trips: 2 });
  });

  it("sails troops, crew and supplies off the map, survives a reload and lands them", () => {
    const { advance, harbour, simulation } = expeditionHarbourFixture();
    const troopsBefore = storedCount(simulation);
    const started = simulation.startColonyExpedition(harbour.uid, 2, { archer: 2, shield: 6 });
    expect(started, JSON.stringify(started)).toMatchObject({ ok: true });
    expect(simulation.colonyExpeditions()[0]).toMatchObject({ status: "preparing", suppliesReady: true });
    expect(harbour.inventory.shovel ?? 0).toBe(0);
    expect(simulation.colonyExpeditions()[0]!.remainingSeconds).toBeNull();

    for (let second = 0; second < 300 && simulation.colonyExpeditions()[0]!.departed === 0; second++) {
      expect(simulation.colonyExpeditions()[0]!.remainingSeconds).toBeNull();
      advance(1);
    }
    const sailing = simulation.colonyExpeditions()[0]!;
    expect(sailing).toMatchObject({ departed: 1, loads: 1, status: "sailing" });
    expect(sailing.remainingSeconds).toBeGreaterThan(50);
    expect(sailing.remainingSeconds).toBeLessThanOrEqual(sailing.island.voyageSeconds);
    expect(simulation.colonyIslands().find(island => island.id === 2)).toBeUndefined();
    expect(simulation.colonyIslands()).toHaveLength(6);
    expect(simulation.colonyExpeditions()[0]!.island.id).toBe(2);
    expect(simulation.expeditionOngoing()).toBe(true);
    expect(simulation.startColonyExpedition(harbour.uid, 2, { shield: 1 })).toMatchObject({ ok: false });
    expect(simulation.startColonyExpedition(harbour.uid, 4, { shield: 1 }))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/under way/) });
    expect(storedCount(simulation)).toBe(troopsBefore - 8);
    expect(simulation.shipFrames()).toHaveLength(0);
    expect(simulation.ships()[0]).toMatchObject({ phase: "away" });

    const reloaded = simulation.loadState(simulation.saveState());
    expect(reloaded.ok, reloaded.ok ? "" : reloaded.reason).toBe(true);
    advance(200);
    const arrived = simulation.colonyExpeditions()[0]!;
    expect(arrived).toMatchObject({ arrived: 1, landed: COLONY_SUPPLIES, remainingSeconds: 0, status: "arrived" });
    expect(arrived.returningShips).toBe(1);
    expect(simulation.expeditionOngoing()).toBe(false);
    advance(330);
    expect(simulation.colonyExpeditions()[0]!.returningShips).toBe(0);
    expect(simulation.shipFrames()).toHaveLength(1);
    expect(simulation.ships()[0]!.phase).not.toBe("away");
  }, 30000);

  it("cancels a preparation and returns supplies and troops", () => {
    const { advance, harbour, simulation } = expeditionHarbourFixture();
    const troopsBefore = storedCount(simulation);
    harbour.inventory.planks = 0;
    const started = simulation.startColonyExpedition(harbour.uid, islandOf(simulation, "easy"), { heavy: 8 });
    expect(started.ok).toBe(true);
    advance(2);
    expect(simulation.colonyExpeditions()[0]!.status).toBe("preparing");
    expect(simulation.startColonyExpedition(harbour.uid, 3, { shield: 1 })).toMatchObject({ ok: false });
    expect(simulation.cancelColonyExpedition(started.ok ? started.id : 0)).toBe(true);
    advance(60);
    expect(simulation.colonyExpeditions()).toHaveLength(0);
    expect(simulation.expeditionOngoing()).toBe(false);
    expect(harbour.inventory.shovel).toBe(1);
    expect(storedCount(simulation)).toBe(troopsBefore);
  }, 30000);
});

describe("adventure expeditions", () => {
  const adventureOf = (simulation: ReturnType<typeof expeditionHarbourFixture>["simulation"], difficulty: string) =>
    simulation.adventureIslands().find(island => island.difficulty === difficulty)!;

  it("carries all 19 selected infantry in two loads with one ship, including across a reload", () => {
    const { advance, harbour, simulation } = expeditionHarbourFixture();
    const island = adventureOf(simulation, "easy");
    expect(simulation.planAdventureExpedition(harbour.uid, island.id, { shield: 19 }))
      .toMatchObject({ loads: 2, ships: 1, trips: 2 });
    expect(simulation.startAdventureExpedition(harbour.uid, island.id, { shield: 19 }).ok).toBe(true);
    for (let second = 0; second < 600 && !simulation.colonyExpeditions()[0]!.departed; second++) advance(1);
    expect(simulation.colonyExpeditions()[0]).toMatchObject({ departed: 1, loads: 2, status: "sailing" });
    expect(simulation.colonyLanding(simulation.colonyExpeditions()[0]!.id)).toBeNull();
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
    for (let second = 0; second < 1200 && simulation.colonyExpeditions()[0]!.status !== "arrived"; second++)
      advance(1);
    const expedition = simulation.colonyExpeditions()[0]!;
    expect(expedition).toMatchObject({ arrived: 2, departed: 2, loads: 2, status: "arrived" });
    const landing = simulation.colonyLanding(expedition.id)!;
    expect(landing.troops).toHaveLength(19);
    expect(landing.troops.every(troop => troop.type === "shield")).toBe(true);
    expect(simulation.adventure()).toBeUndefined();
  }, 30000);

  it("sails troops only, shares the one-expedition lock and keeps colony slots free", () => {
    const { advance, harbour, simulation } = expeditionHarbourFixture();
    // Harbour39 is a shared-storage access: its inventory view merges the HQ pool with the
    // supplies that are attached as local equipment until the first reconciliation.
    const stock = { ...simulation.storageSnapshot(harbour.uid)!.available };
    for (const [ware, units] of Object.entries(COLONY_SUPPLIES)) stock[ware] = (stock[ware] ?? 0) + units;
    const troopsBefore = storedCount(simulation);
    const island = adventureOf(simulation, "medium");
    expect(simulation.planAdventureExpedition(harbour.uid, island.id, { shield: 16 }))
      .toMatchObject({ loads: 1, ships: 1, trips: 1 });
    expect(simulation.startAdventureExpedition(harbour.uid, island.id, { shield: 40 }))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/limit/) });
    const started = simulation.startAdventureExpedition(harbour.uid, island.id, { archer: 7, heavy: 8 });
    expect(started, JSON.stringify(started)).toMatchObject({ ok: true });
    expect(simulation.colonyExpeditions()[0]).toMatchObject({ cargo: {}, island: { kind: "adventure" } });
    expect(simulation.startColonyExpedition(harbour.uid, 1, { shield: 1 }))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/under way/) });
    for (let second = 0; second < 300 && simulation.colonyExpeditions()[0]!.departed === 0; second++) advance(1);
    expect(simulation.colonyExpeditions()[0]).toMatchObject({ departed: 1, status: "sailing" });
    expect(simulation.storageSnapshot(harbour.uid)!.available).toEqual(stock);
    expect(storedCount(simulation)).toBe(troopsBefore - 15);
    const reloaded = simulation.loadState(simulation.saveState());
    expect(reloaded.ok, reloaded.ok ? "" : reloaded.reason).toBe(true);
    advance(200);
    const id = started.ok ? started.id : 0;
    expect(simulation.colonyExpeditions()[0]).toMatchObject({ landed: {}, status: "arrived" });
    expect(simulation.colonyLanding(id)).toMatchObject({ crew: 0, landed: {} });
    expect(simulation.colonyLanding(id)!.troops).toHaveLength(15);
    // A landed adventure blocks another adventure but never takes a colony island or slot.
    expect(simulation.startAdventureExpedition(harbour.uid, adventureOf(simulation, "easy").id, { shield: 1 }))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/current adventure/) });
    // The shared operation slot (C4): an unfinished adventure also holds back a colony launch.
    expect(simulation.startColonyExpedition(harbour.uid, 1, { shield: 8 }))
      .toEqual({ ok: false, reason: "Finish the current adventure first" });
    expect(simulation.colonyIslands().every(entry => !entry.taken)).toBe(true);
  }, 30000);

  it("offers a new set of adventures once the finished one is released", () => {
    const { advance, harbour, simulation } = expeditionHarbourFixture();
    const offered = simulation.adventureIslands().map(island => island.id);
    const started = simulation.startAdventureExpedition(harbour.uid, offered[0]!, { shield: 15 });
    for (let second = 0; second < 600 && simulation.colonyExpeditions()[0]?.status !== "arrived"; second++) advance(1);
    expect(simulation.releaseColony(started.ok ? started.id : 0)).toBe(true);
    expect(simulation.colonyExpeditions()).toHaveLength(0);
    expect(simulation.adventureIslands().map(island => island.id)).toEqual(offered.map(id => id + 100));
    const saved = simulation.saveState();
    expect(saved.naval.colonies).toMatchObject({ adventureRound: 1 });
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    expect(simulation.adventureIslands()[0]!.id).toBe(100);
    const corrupt = { ...saved, naval: { ...saved.naval, colonies: { ...saved.naval.colonies!, adventureRound: -1 } } };
    expect(simulation.loadState(corrupt)).toMatchObject({ ok: false, reason: "Invalid adventure round" });
  }, 60000);
});

describe("expedition ware conservation", () => {
  type Simulation = ReturnType<typeof expeditionHarbourFixture>["simulation"];
  /** Per ware: pooled harbour stock + its ship reservation + cargo still held by the expedition. */
  const wareTotals = (simulation: Simulation, harbourUid: number) => {
    const totals: Record<string, number> = { ...simulation.storageSnapshot(harbourUid)!.available };
    const add = (goods: Readonly<Record<string, number>> = {}) => {
      for (const [ware, count] of Object.entries(goods)) totals[ware] = (totals[ware] ?? 0) + count;
    };
    add(simulation.buildings().find(building => building.uid === harbourUid)!.shipReserve);
    for (const expedition of simulation.colonyExpeditions()) add(expedition.cargo);
    return Object.fromEntries(Object.entries(totals).filter(([, count]) => count !== 0));
  };
  const armFailure = (allowed: number) => Object.assign(queueFailure, { allowed, queued: 0 });
  const conservesWaresThroughFailedQueue = (start: (simulation: Simulation, harbourUid: number) => boolean) => {
    const { advance, harbour, simulation } = expeditionHarbourFixture();
    advance(1); // The supplies attached as local equipment join the harbour's pool first.
    const before = wareTotals(simulation, harbour.uid);
    armFailure(1);
    try {
      expect(start(simulation, harbour.uid)).toBe(true);
      for (let second = 0; second < 300 && queueFailure.queued < 4; second++) {
        advance(1);
        expect(wareTotals(simulation, harbour.uid)).toEqual(before);
      }
      expect(queueFailure.queued).toBeGreaterThanOrEqual(4);
      expect(simulation.colonyExpeditions()[0]).toMatchObject({ loads: 0, status: "preparing" });
      expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
      expect(wareTotals(simulation, harbour.uid)).toEqual(before);
    } finally {
      armFailure(Infinity);
    }
    for (let second = 0; second < 30 && simulation.colonyExpeditions()[0]!.status === "preparing"; second++)
      advance(1);
    expect(simulation.colonyExpeditions()[0]).toMatchObject({ loads: 2, status: "sailing" });
    expect(wareTotals(simulation, harbour.uid)).toEqual(before);
  };

  it("keeps colony supplies conserved when the fleet refuses a later load", () => {
    conservesWaresThroughFailedQueue((simulation, harbourUid) =>
      simulation.startColonyExpedition(harbourUid, islandOf(simulation, "hard"), { heavy: 1, shield: 20 }).ok);
  }, 30000);

  it("keeps harbour stock conserved when an adventure's later load is refused", () => {
    conservesWaresThroughFailedQueue((simulation, harbourUid) => simulation.startAdventureExpedition(harbourUid,
      simulation.adventureIslands().find(island => island.difficulty === "easy")!.id, { shield: 19 }).ok);
  }, 30000);
});
