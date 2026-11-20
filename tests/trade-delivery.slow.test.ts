import { describe, expect, it } from "vitest";

import { createPlayerSession } from "../src/app/settlement/player-session";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { GEM_SHOP_OFFER_LIST, gemShopOffers } from "../src/shared/progression/gem-shop";
import { createPlayerProgress } from "../src/shared/progression/player-progress";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { islandStorageCapacity } from "../src/shared/settlement/storage-capacity";
import type { MerchantOffer } from "../src/shared/trade/trade-types";
import { BUILD, type WorldData } from "../src/shared/world/world-data";
import { edgeBayWorld } from "./helpers/edge-bay-settlement";

const SIZE = 64, COAST = 36;
/** Land in the west, open sea from x = 36 to the east map edge. */
const coastWorld = () => {
  const heights = new Float32Array((SIZE + 1) ** 2);
  for (let z = 0; z <= SIZE; z++) for (let x = COAST; x <= SIZE; x++) heights[z * (SIZE + 1) + x] = -2;
  const data = { seed: 4, cellsX: SIZE, cellsZ: SIZE, seaLevel: -1, start: { x: 12.5, z: 12.5 }, heights,
    blocking: new Uint8Array(SIZE ** 2), walkCost: new Uint8Array(SIZE ** 2).fill(10),
    buildClass: new Uint8Array(SIZE ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(SIZE ** 2), mineZone: new Uint16Array(SIZE ** 2), mineZones: [],
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(), scale: new Float32Array() }
  } as unknown as WorldData;
  for (let z = 0; z < SIZE; z++) for (let x = COAST; x < SIZE; x++) {
    data.walkCost[z * SIZE + x] = 0; data.blocking[z * SIZE + x] = 1;
  }
  return data;
};
type Simulation = ReturnType<typeof createSettlementSimulation>;
const STOCK = { fish: 40, planks: 200, stone: 100 };

const createIsland = (world: WorldData, initialSettlers = 30) => {
  let simulation: Simulation;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ canWorkerEnterPlot: () => true, initialSettlers,
    initialStock: { ...STOCK }, now: () => 50_000, playerLevel: () => 1, roads, unlockAllBuildings: true, world });
  return simulation;
};

/** The headquarters and a finished, empty harbour on the coast; the road between them is optional. */
const homeIsland = (connect = true, initialSettlers = 30) => {
  const world = coastWorld(), simulation = createIsland(world, initialSettlers);
  const [width, depth] = getBuildingDefinition(39).gridFootprint;
  const placed = simulation.placeBuilding(39, Math.floor(32 - width / 2) + width / 2,
    Math.floor(20 - depth / 2) + depth / 2);
  expect(placed.ok, placed.reason).toBe(true);
  Object.assign(placed.building!, { construction: 1, input: {}, required: {}, worker: undefined });
  if (connect) expect(simulation.connectRoads(simulation.headquarters.access, placed.building!.access)).toBe(true);
  const harbourUid = placed.building!.uid;
  return { harbourUid, simulation, world };
};

const reload = (simulation: Simulation, world: WorldData) => {
  const saved = JSON.parse(JSON.stringify(simulation.saveState()));
  const target = createIsland(world);
  const loaded = target.loadState(saved);
  expect(loaded.ok, loaded.ok ? "" : loaded.reason).toBe(true);
  return target;
};

/** Each ware on the island: storage stock, on carriers, escrow held/staged (out of stock, still here). */
const islandWares = (simulation: Simulation, ware: string) => {
  // Storage doors of one shared pool show the same stock: count each pool once.
  const stock = islandStorageCapacity(simulation.buildings()).stored[ware] ?? 0;
  // A storage dispatch leaves the stock when the carrier sets off, before it picks the ware up.
  const carried = simulation.frames().filter(actor => actor.ware === ware ||
    (!actor.ware && actor.delivery?.ware === ware && !actor.delivery.reserved))
    .reduce((sum, actor) => sum + (actor.wareUnits ?? 1), 0);
  const escrow = simulation.trade().escrow.reduce((sum, entry) => sum + (entry.staged[ware] ?? 0) +
    entry.held.reduce((held, row) => held + (row.goods[ware] ?? 0), 0), 0);
  return stock + carried + escrow;
};

const merchant = (id: string, give: MerchantOffer["give"], want: MerchantOffer["want"]): MerchantOffer =>
  ({ give, id, merchant: "Livia Portus", status: "open", want });
/** Today's merchant offers replaced by known ones (terms are saved, so a load keeps them). */
const withMarket = (simulation: Simulation, world: WorldData, offers: MerchantOffer[], initialSettlers = 30) => {
  simulation.update(0.05);
  const saved = JSON.parse(JSON.stringify(simulation.saveState()));
  saved.trade.market = { day: 0, level: 1, offers };
  const target = createIsland(world, initialSettlers);
  expect(target.loadState(saved)).toEqual({ ok: true });
  return target;
};

const run = (simulation: Simulation, seconds: number, done: () => boolean, each?: () => void) => {
  for (let tick = 0; tick < seconds / 0.25 && !done(); tick++) { simulation.update(0.25); each?.(); }
  return done();
};
/** Nothing owed either way and every trade ship gone off the map. */
const tradeSettled = (simulation: Simulation) => !simulation.trade().deliveries.length &&
  !simulation.trade().escrow.length && !simulation.ships().some(ship => ship.visitorRole === "trade");

/** Pool custody (shared storage pools): every escrow lies in the harbour's trade stock, none held or walked. */
const expectStagedInPool = (simulation: Simulation, harbourUid: number) => {
  const poolId = simulation.headquarters.storagePoolId;
  expect(poolId).toBeDefined();
  for (const escrow of simulation.trade().escrow) {
    expect(escrow).toMatchObject({ custody: { poolId }, harbourUid, held: [], staged: escrow.goods });
    expect(simulation.tradeEscrowCollected(escrow.id)).toBe(true);
  }
  expect(simulation.frames().some(actor => actor.delivery?.destination === harbourUid)).toBe(false);
};

it("conserves trade and shop receipts over a reload mid-trade, refuses shop overflow free of charge", () => {
  const setup = homeIsland();
  let simulation = withMarket(setup.simulation, setup.world, [
    merchant("m0-0", { amount: 10, ware: "logs" }, { amount: 2, ware: "fish" })
  ]);
  const home = simulation.headquarters;
  // Finite authored near-capacity stock; committed trade arrivals must still be delivered safely.
  home.inventory.logs = 1490;
  expect(islandStorageCapacity(simulation.buildings()).capacity).toBe(1500);
  // HQ and harbour share one pool: a transfer between them is refused, nothing walks.
  expect(simulation.transferWare(home.uid, setup.harbourUid, "planks", 3)).toBe(false);
  expect(simulation.tradeBuy("m0-0")).toBe(true);
  simulation.update(.25);
  expectStagedInPool(simulation, setup.harbourUid);
  const player = createPlayerSession({ now: Date.now, initial: { ...createPlayerProgress(4), gems: 80 }, seed: 4 });
  player.bind(simulation);
  expect(player.buyGemOffer("logs-100")).toMatch(/capacity/);
  expect(player.progress().gems).toBe(80);
  expect(player.buyGemOffer("bread-100")).toBe(true);
  const breadPrice = GEM_SHOP_OFFER_LIST.find(offer => offer.id === "bread-100")!.price;
  expect(player.progress().gems).toBe(80 - breadPrice);
  expect(gemShopOffers("resources", 1).some(offer => offer.ware === "granite")).toBe(true);
  let reloaded = false, settled = false;
  for (let tick = 0; tick < 3600 && !settled; tick++) {
    simulation.update(.25);
    expect(islandWares(simulation, "planks")).toBe(STOCK.planks);
    // The paid fish stay on the island (staged) until the trade ship loads them.
    expect([STOCK.fish, STOCK.fish - 2]).toContain(islandWares(simulation, "fish"));
    if (!reloaded && simulation.ships().some(ship => ship.visitorRole === "trade")) {
      simulation = reload(simulation, setup.world);
      player.bind(simulation);
      expect(simulation.trade().escrow).toHaveLength(1);
      expectStagedInPool(simulation, setup.harbourUid);
      reloaded = true;
    }
    settled = tradeSettled(simulation);
  }
  expect(settled && reloaded).toBe(true);
  expect(islandWares(simulation, "logs")).toBe(1500);
  expect(islandWares(simulation, "planks")).toBe(STOCK.planks);
  expect(islandWares(simulation, "fish")).toBe(STOCK.fish - 2);
  expect(islandWares(simulation, "bread")).toBe(100);
  expect(player.buyGemOffer("logs-100")).toMatch(/capacity/);
  expect(player.progress().gems).toBe(80 - breadPrice);
  expect(simulation.trade().history.filter(entry => entry.kind === "bought")).toHaveLength(1);
  expect(simulation.population().people - simulation.settlerBirths()).toBe(30);
}, 30000);

describe("trade delivery on a real harbour (TRADE-01 phase 2)", () => {
  it("stages three payments in pool custody without a road, queues three trade ships, conserves wares", () => {
    const setup = homeIsland(false);
    const simulation = withMarket(setup.simulation, setup.world, [
      merchant("m0-0", { amount: 30, ware: "stone" }, { amount: 20, ware: "planks" }),
      merchant("m0-1", { amount: 12, ware: "fish" }, { amount: 25, ware: "planks" }),
      merchant("m0-2", { amount: 10, ware: "stone" }, { amount: 10, ware: "planks" })
    ]);
    for (const id of ["m0-0", "m0-1", "m0-2"]) expect(simulation.tradeBuy(id)).toBe(true);
    // No road to the harbour: the harbour pays from its own pool, so nothing is blocked.
    simulation.update(1);
    expectStagedInPool(simulation, setup.harbourUid);
    expect(simulation.tradeDeliveryStatus().map(status => status.stage)).not.toContain("blocked");
    expect(islandWares(simulation, "planks")).toBe(200);
    // Production fills the stone store meanwhile: the arrivals must still be stored (overflow, no mail).
    const capacity = islandStorageCapacity(simulation.buildings()).capacity;
    simulation.headquarters.inventory.stone = capacity;
    let maxAtPier = 0;
    const tradeShips = new Set<number>();
    const settled = run(simulation, 1500, () => tradeSettled(simulation), () => {
      const trading = simulation.ships().filter(ship => ship.visitorRole === "trade");
      for (const ship of trading) tradeShips.add(ship.id);
      maxAtPier = Math.max(maxAtPier, trading.filter(ship => ship.phase === "loading" ||
        ship.phase === "unloading").length);
    });
    expect(settled).toBe(true);
    expect(tradeShips.size).toBe(3);
    expect(maxAtPier).toBe(1);
    expect(simulation.ships().filter(ship => ship.visitorRole === "trade")).toEqual([]);
    expect(islandWares(simulation, "planks")).toBe(200 - 55);
    expect(islandWares(simulation, "fish")).toBe(40 + 12);
    expect(islandWares(simulation, "stone")).toBe(capacity + 40);
    expect(islandStorageCapacity(simulation.buildings()).stored.stone).toBeGreaterThan(capacity);
  }, 120000);

  it("fills a sale only with NPC traders on, keeps staged offers over a reload and returns a cancelled offer", () => {
    const setup = homeIsland();
    let simulation = setup.simulation;
    simulation.update(0.05);
    expect(simulation.tradePlaceOffer({ amount: 30, ware: "planks" }, { amount: 14, ware: "fish" })).toBe(true);
    expect(simulation.tradePlaceOffer({ amount: 20, ware: "planks" }, { amount: 9, ware: "fish" })).toBe(true);
    simulation.update(0.5);
    expectStagedInPool(simulation, setup.harbourUid);
    simulation = reload(simulation, setup.world);
    expectStagedInPool(simulation, setup.harbourUid);
    expect(islandWares(simulation, "planks")).toBe(200);
    // Cancel the second offer: its staged wares come back into the pool at once.
    const [first, second] = simulation.trade().offers;
    expect(simulation.tradeCancelOffer(second!.id)).toBe(true);
    expect(islandStorageCapacity(simulation.buildings()).stored.planks).toBe(200 - 30);
    // Off: the offer stays open however long it waits (its fill time counts only while on).
    expect(run(simulation, 600, () => !simulation.trade().offers.length)).toBe(false);
    expect(simulation.trade().buyerClock).toBe(0);
    expect(simulation.tradeEscrowCollected(first!.escrowId)).toBe(true);
    expect(simulation.tradeSetNpcTraders(true)).toBe(true);
    expect(simulation.tradeNpcTraders()).toBe(true);
    expect(run(simulation, 900, () => !simulation.trade().offers.length && tradeSettled(simulation))).toBe(true);
    expect(islandWares(simulation, "planks")).toBe(200 - 30);
    expect(islandWares(simulation, "fish")).toBe(40 + 14);
    expect(simulation.trade().history.map(entry => entry.kind)).toEqual(["cancelled", "sold"]);
  }, 120000);

  it("refuses trading on a colony and refunds trade state of an older build into the colony harbour", () => {
    const world = edgeBayWorld();
    let simulation: Simulation;
    const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
    simulation = createSettlementSimulation({ canWorkerEnterPlot: () => true, homeBuilding: 39, initialSettlers: 10,
      initialStock: { planks: 60 }, now: () => 1, roads, world });
    expect(simulation.headquarters).toMatchObject({ colonyHome: true, typeId: 39 });
    simulation.update(0.05);
    expect(simulation.trade().market).toBeNull();
    expect(simulation.tradePlaceOffer({ amount: 40, ware: "planks" }, { amount: 19, ware: "fish" }))
      .toBe("Trading is only available on your home island");
    expect(simulation.saveState().trade).toBeUndefined();
    // A colony save of today's dev builds with an open offer: its 40 planks (staged at the harbour) come back.
    const saved = JSON.parse(JSON.stringify(simulation.saveState()));
    // Since the shared storage pools (6443243c5) the island's free stock lives in its pool, not in a door.
    saved.storagePools.pools[0].available.planks = 20;
    // An unbound escrow is refunded only through its named door (the colony harbour here).
    saved.trade = { buyerClock: 0, deliveries: [], elapsed: 5, escrow: [{ goods: { planks: 40 },
      harbourUid: simulation.headquarters.uid, held: [], id: "e1", purpose: "offer", ref: "o2", staged: { planks: 40 } }], floors: {}, history: [], market: null, nextId: 3,
      npcTraders: true, offers: [{ escrowId: "e1", fillAt: 50, give: { amount: 40, ware: "planks" }, id: "o2",
        placedAt: 0, placedTime: 1, want: { amount: 19, ware: "fish" } }], version: 2 };
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    simulation.update(0.05);
    expect(islandWares(simulation, "planks")).toBe(60);
    expect(simulation.trade().offers).toEqual([]);
    expect(simulation.saveState().trade).toBeUndefined();
  }, 120000);

  it("keeps a delivery and its escrow owed when the harbour is demolished, then serves the next harbour", () => {
    const setup = homeIsland();
    let simulation = withMarket(setup.simulation, setup.world,
      [merchant("m0-0", { amount: 30, ware: "stone" }, { amount: 20, ware: "planks" })]);
    expect(simulation.tradeBuy("m0-0")).toBe(true);
    const sailingIn = () => simulation.ships().some(ship => ship.visitorRole === "trade" && ship.phase === "sailing");
    expect(run(simulation, 600, sailingIn)).toBe(true);
    expect(simulation.demolishBuilding(setup.harbourUid)).toMatchObject({ ok: true });
    expect(run(simulation, 600, () => !simulation.ships().some(ship => ship.visitorRole === "trade"))).toBe(true);
    simulation.update(1);
    expect(simulation.trade().deliveries).toMatchObject([{ goods: { stone: 30 }, kind: "purchase" }]);
    expect(simulation.trade().deliveries[0]!.shipId).toBeUndefined();
    // The ship sails ahead of the payment, so the harbour may go while carriers still collect it.
    expect(simulation.tradeDeliveryStatus()[0]).toMatchObject({ stage: "blocked",
      blocker: expect.stringMatching(/^The island needs a finished harbour/) });
    // The paid planks stay in trade custody (never destroyed with the harbour).
    expect(islandWares(simulation, "planks")).toBe(200);
    const [width, depth] = getBuildingDefinition(39).gridFootprint;
    const placed = simulation.placeBuilding(39, Math.floor(32 - width / 2) + width / 2,
      Math.floor(44 - depth / 2) + depth / 2);
    expect(placed.ok, placed.reason).toBe(true);
    Object.assign(placed.building!, { construction: 1, input: {}, required: {}, worker: undefined });
    expect(simulation.connectRoads(simulation.headquarters.access, placed.building!.access)).toBe(true);
    simulation = reload(simulation, setup.world);
    expect(run(simulation, 900, () => tradeSettled(simulation))).toBe(true);
    expect(islandWares(simulation, "planks")).toBe(180);
    expect(islandWares(simulation, "stone")).toBe(130);
  }, 120000);

  it("stages a paid trade without any free carrier (pool custody replaces LOG-02 carrier priority)", () => {
    // Owner save 2026-10-20 (1): with no idle settler the paid coins once crept to the harbour and no ship came.
    const setup = homeIsland(true, 1);
    const simulation = withMarket(setup.simulation, setup.world,
      [merchant("m0-0", { amount: 30, ware: "stone" }, { amount: 20, ware: "planks" })], 1);
    expect(simulation.tradeBuy("m0-0")).toBe(true);
    simulation.update(.5);
    expectStagedInPool(simulation, setup.harbourUid);
    expect(simulation.tradeDeliveryStatus()).toMatchObject([{ stage: "shipping" }]);
  }, 120000);

  /** A payment of `coins` coins leaves the pool's free stock and is staged whole by the Buy itself. */
  const expectCoinPaymentStaged = (coins: number) => {
    const setup = homeIsland();
    setup.simulation.headquarters.inventory.coins = 600;
    const simulation = withMarket(setup.simulation, setup.world,
      [merchant("m0-0", { amount: 30, ware: "stone" }, { amount: coins, ware: "coins" })]);
    expect(simulation.tradeBuy("m0-0")).toBe(true);
    expect(simulation.trade().escrow[0]!.staged).toEqual({ coins });
    simulation.update(.5);
    expectStagedInPool(simulation, setup.harbourUid);
    expect(islandStorageCapacity(simulation.buildings()).stored.coins).toBe(600 - coins);
    expect(islandWares(simulation, "coins")).toBe(600);
  };
  it("stages a coin payment whole at once: no 250-coin boxes under pool custody (61 and 300 coins)", () => {
    expectCoinPaymentStaged(61);
    expectCoinPaymentStaged(300);
  }, 120000);

  it("sends the trade ship for a payment already staged, so it berths without waiting offshore", () => {
    const setup = homeIsland(true, 2);
    const simulation = withMarket(setup.simulation, setup.world,
      [merchant("m0-0", { amount: 30, ware: "stone" }, { amount: 60, ware: "planks" })], 2);
    expect(simulation.tradeBuy("m0-0")).toBe(true);
    const tradeShip = () => simulation.ships().find(ship => ship.visitorRole === "trade");
    const collected = () => simulation.tradeEscrowCollected(simulation.trade().escrow[0]?.id ?? "");
    let shipSeen = false, aheadOfPayment = false, berthed = false;
    const settled = run(simulation, 1500, () => tradeSettled(simulation), () => {
      const ship = tradeShip();
      if (!ship) return;
      shipSeen = true;
      aheadOfPayment ||= simulation.trade().escrow.length > 0 && !collected();
      berthed ||= ship.phase === "loading" || ship.phase === "unloading";
    });
    expect(settled).toBe(true);
    expect(shipSeen && berthed).toBe(true);
    expect(aheadOfPayment).toBe(false);
    expect(islandWares(simulation, "planks")).toBe(200 - 60);
    expect(islandWares(simulation, "stone")).toBe(100 + 30);
  }, 120000);
});
