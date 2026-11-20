import { describe, expect, it } from "vitest";

import { stageGameSession } from "../src/app/settlement/game-session";
import { prepareOfflineEconomyArrivals } from "../src/app/settlement/offline-economy-arrivals";
import { runOfflineEconomyEvents } from "../src/app/settlement/offline-economy-events";
import { createGameSave, type GameSaveV1 } from "../src/shared/settlement/game-save";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import type { NavalShip } from "../src/shared/settlement/settlement-naval-fleet";
import { countSaveIntegrity } from "../src/shared/settlement/settlement-save-integrity";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { createTradeState } from "../src/shared/trade/trade-ledger";
import { dispatchTradeShips } from "../src/shared/trade/trade-shipping";
import { huntingWorld } from "./helpers/hunting-world";

const fixture = () => {
  const world = huntingWorld(), simulation = createSettlementSimulation({ world, roads: createRoadNetwork(world) });
  const state = simulation.saveState();
  const home = state.buildings[0]!;
  const pool = state.storagePools.pools.find(entry => entry.id === home.storagePoolId)!;
  pool.available = { coins: 100 };
  home.inventory = {};
  const harbour = { ...home, uid: 1, typeId: 39, x: 30, z: 20, width: 6, depth: 6,
    access: { x: 30, z: 16 }, doorThreshold: { x: 30, z: 19 },
    inventory: {}, input: {}, output: {}, incoming: {}, idleSettlers: 0 };
  state.buildings.push(harbour); state.nextBuilding = 2;
  const ship: NavalShip = { id: 1, x: 32, z: 10, y: 0, yaw: 0, phase: "away", timer: 30,
    cargo: { leather: 22 }, cargoCount: 22, route: [], cursor: 0, destinationUid: 1,
    visitor: { exit: { x: 32, z: 0 }, pickup: [], role: "trade", trade: { delivery: "d2", queue: 1 } } };
  state.naval.fleet.ships = [ship]; state.naval.fleet.nextShip = 2;
  state.trade = createTradeState(); state.trade.nextId = 3;
  state.trade.escrow.push({ id: "e1", purpose: "purchase", ref: "offer", goods: { coins: 61 },
    held: [], staged: { coins: 61 }, harbourUid: 1 });
  state.trade.deliveries.push({ id: "d2", ref: "offer", escrowId: "e1", kind: "purchase", createdAt: 0,
    goods: { leather: 22 }, aboard: { leather: 22 }, shipId: 1, queue: 1 });
  state.integrity = countSaveIntegrity(state);
  const save = { settlement: state, savedAt: 1_000_000 } as GameSaveV1;
  const prepared = (seconds = 3600) => prepareOfflineEconomyArrivals(save, "home", seconds);
  return { world, save, state, home, harbour, ship, prepared };
};

describe("offline already-owned ship arrivals", () => {
  it("preserves held cargo until its causal delayed arrival", () => {
    const f = fixture(), before = JSON.stringify(f.save), prepared = f.prepared();
    expect(prepared.islands).toEqual([{ islandId: "~arrival:home:1", stock: { leather: 22 } }]);
    const arrival = prepared.jobs[0]!;
    const result = runOfflineEconomyEvents({ horizonTicks: arrival.cycleTicks - 1, jobs: prepared.jobs,
      islands: [{ islandId: "home", stock: {} }, ...prepared.islands] });
    expect(result.islands[0]!.stock.leather ?? 0).toBe(0);
    expect(result.inProgress).toHaveLength(1);
    expect(JSON.stringify(f.save)).toBe(before);
    prepared.apply(result.completedCycles, result.islands[0]!);
    expect(f.ship.cargo).toEqual({ leather: 22 });
  });

  it("feeds already-paid leather to production, clears the ship receipt once and preserves payment", async () => {
    const f = fixture(), prepared = f.prepared(), oldEscrow = structuredClone(f.state.trade!.escrow);
    const result = runOfflineEconomyEvents({ horizonTicks: 3_600_000, jobs: [...prepared.jobs,
      { uid: "armor", islandId: "home", cycleTicks: 10_000, inputs: { leather: 1, cloth: 1 }, outputs: { armor: 1 } }],
      islands: [{ islandId: "home", stock: { coins: 100, cloth: 22 } }, ...prepared.islands] });
    const ledger = result.islands[0]!;
    expect(ledger.produced).toEqual({ armor: 22 });
    expect(ledger.consumed).toEqual({ leather: 22, cloth: 22 });
    expect(ledger.received).toEqual({ leather: 22 });
    prepared.apply(result.completedCycles, ledger);
    expect(ledger.received).toEqual({ leather: 0 });
    expect(f.state.naval.fleet.ships).toEqual([]);
    expect(f.state.trade!.deliveries[0]).toMatchObject({ goods: {} });
    expect(f.state.trade!.deliveries[0]!.aboard).toBeUndefined();
    expect(f.state.trade!.deliveries[0]!.shipId).toBeUndefined();
    expect(f.state.trade!.escrow).toEqual(oldEscrow);
    const pool = f.state.storagePools.pools.find(entry => entry.id === f.home.storagePoolId)!;
    expect(pool.available.coins).toBe(100);
    // The kernel's final stock is applied by the main adapter, not credited again by trade hooks.
    pool.available.armor = ledger.stock.armor!;
    const saved = await createGameSave(f.world, f.state, {
      name: "Arrived owned cargo", savedAt: f.save.savedAt + 3_600_000, source: "generated", animals: []
    });
    await expect(stageGameSession(saved)).resolves.toBeDefined();
    expect(f.prepared().jobs).toEqual([]);
    expect(() => prepared.apply(result.completedCycles, ledger)).toThrow("already applied");
    const sent: unknown[] = [];
    dispatchTradeShips(f.state.trade!, 1, { ready: () => {}, shipIds: () => new Set(),
      send: (_harbour, cargo) => { sent.push(cargo); return 2; } });
    expect(sent).toEqual([{}]);
  });

  it("does not schedule cargo that cannot finish by the recovery cutoff", () => {
    const f = fixture(), before = JSON.stringify(f.save), prepared = f.prepared(.001);
    const result = runOfflineEconomyEvents({ horizonTicks: 1, jobs: prepared.jobs,
      islands: [{ islandId: "home", stock: {} }, ...prepared.islands] });
    expect(result.inProgress).toEqual([]);
    prepared.apply(result.completedCycles, result.islands[0]!);
    expect(JSON.stringify(f.save)).toBe(before);
  });

  it("withholds outgoing ships, ore pickups, passenger manifests and mismatched trade receipts", () => {
    for (const change of [
      (ship: NavalShip) => { ship.visitor!.leaving = true; },
      (ship: NavalShip) => { ship.phase = "loading"; },
      (ship: NavalShip) => { ship.visitor!.role = "ore"; },
      (ship: NavalShip) => { ship.terrainBlocked = true; },
      (ship: NavalShip) => { ship.lighters = {} as NonNullable<NavalShip["lighters"]>; },
      (ship: NavalShip) => { ship.passengers = [9]; },
      (ship: NavalShip) => { ship.visitor!.pickup = ["ironOre"]; }
    ]) {
      const f = fixture(); change(f.ship); expect(f.prepared().jobs).toEqual([]);
    }
    const f = fixture(); f.state.trade!.deliveries[0]!.aboard = { leather: 23 };
    expect(f.prepared().jobs).toEqual([]);
  });

  it("can deliver supply and reward cargo while preserving physical ownership", () => {
    for (const role of ["supply", "reward"] as const) {
      const f = fixture(); f.ship.visitor!.role = role; delete f.ship.visitor!.trade;
      const prepared = f.prepared(), result = runOfflineEconomyEvents({ horizonTicks: 3_600_000,
        jobs: prepared.jobs, islands: [{ islandId: "home", stock: {} }, ...prepared.islands] });
      expect(result.islands[0]!.stock).toEqual({ leather: 22 });
      prepared.apply(result.completedCycles, result.islands[0]!);
      expect(f.ship.cargo).toEqual({});
      expect(result.islands[0]!.received).toEqual({ leather: 0 });
    }
  });

  it("rejects a missing arrival credit and duplicated completion before touching a ship", () => {
    const f = fixture(), prepared = f.prepared(), uid = prepared.jobs[0]!.uid;
    const ledger = { islandId: "home", stock: {}, produced: {}, consumed: {}, sent: {}, received: {} };
    expect(() => prepared.apply({ [uid]: 1 }, ledger)).toThrow("missing destination credit");
    expect(f.ship.cargo).toEqual({ leather: 22 });
    expect(() => prepared.apply({ [uid]: 2 }, ledger)).toThrow("more than once");
    expect(f.ship.cargo).toEqual({ leather: 22 });
  });

  it("does not advance a collecting ship whose payment has no physical owner", () => {
    const f = fixture(); f.state.trade!.escrow[0]!.staged = {};
    expect(f.prepared().jobs).toEqual([]);
    expect(f.prepared().notes.some(note => note.includes("payment ownership"))).toBe(true);
  });

  it("treats payment held in the harbour's pool as owned without a carrier walk", () => {
    const f = fixture(), stagedDelay = f.prepared().jobs[0]!.cycleTicks;
    f.state.trade!.escrow[0]!.staged = {};
    f.state.trade!.escrow[0]!.held = [{ uid: f.home.uid, goods: { coins: 61 } }];
    const prepared = f.prepared();
    expect(prepared.jobs).toHaveLength(1);
    expect(prepared.jobs[0]!.cycleTicks).toBe(stagedDelay);
    const result = runOfflineEconomyEvents({ horizonTicks: 3_600_000, jobs: prepared.jobs,
      islands: [{ islandId: "home", stock: {} }, ...prepared.islands] });
    prepared.apply(result.completedCycles, result.islands[0]!);
    expect(f.state.trade!.escrow[0]!.goods).toEqual({ coins: 61 });
    expect(f.state.trade!.escrow[0]!.held).toEqual([{ uid: f.home.uid, goods: { coins: 61 } }]);
  });
});
