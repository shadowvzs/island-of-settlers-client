import { describe, expect, it } from "vitest";

import { openLocalStorageGame } from "../src/app/settlement/game-local-storage";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { composeGameSave, splitGameSave } from "../src/shared/settlement/game-save-rows";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { REPLAY_COMMANDS } from "../src/shared/settlement/settlement-commands";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";
import { createSettlementTrade } from "../src/shared/trade/settlement-trade";
import { validateTradeSave } from "../src/shared/trade/trade-save";
import type { SettlementTradeSave } from "../src/shared/trade/trade-types";
import { TRADE_REASONS } from "../src/shared/trade/trade-validation";
import { BUILD, type WorldData } from "../src/shared/world/world-data";
import { createMemoryStorage } from "./memory-storage";

const storage = (uid: number, typeId: number, inventory: Record<string, number>) => ({
  access: { x: 0, z: 0 }, construction: 1, incoming: {}, input: {}, inventory, output: {}, required: {}, typeId, uid
}) as unknown as SettlementBuilding;

/** A trade state with a market, own offers, a purchase, a sale and history (made by the real commands). */
const tradedState = (seed = 42): SettlementTradeSave => {
  const context = { actors: [], buildings: [storage(1, 0, { planks: 400, stone: 1400 }), storage(2, 39, {})],
    options: { now: () => 5_000, playerLevel: () => 1, world: { seed } } } as unknown as SettlementContext;
  const trade = createSettlementTrade(context);
  trade.setNpcTraders(true);
  trade.update(1);
  expect(trade.placeOffer({ amount: 100, ware: "planks" }, { amount: 900, ware: "fish" })).toBe(true);
  const open = trade.snapshot().market!.offers.find(offer => trade.checkBuy(offer.id) === true);
  if (open) expect(trade.buy(open.id)).toBe(true);
  expect(trade.placeOffer({ amount: 20, ware: "planks" }, { amount: 10, ware: "stone" })).toBe(true);
  trade.update(600);
  expect(trade.snapshot().deliveries.some(entry => entry.kind === "sale")).toBe(true);
  return trade.save()!;
};

describe("trade save validation", () => {
  it("accepts a traded state and rejects tampered ones", () => {
    const state = tradedState();
    expect(state.offers.length).toBeGreaterThan(0);
    expect(validateTradeSave(state)).toBeNull();
    expect(validateTradeSave(undefined)).toBeNull();
    const tampered = (change: (copy: SettlementTradeSave) => void) => {
      const copy = structuredClone(state);
      change(copy);
      return validateTradeSave(copy);
    };
    expect(tampered(copy => { copy.escrow.push({ ...copy.escrow[0]!, goods: { logs: 1 }, held: [], staged: {} }); }))
      .toBe("Duplicate trade record ids");
    expect(tampered(copy => { copy.escrow.push({ goods: { logs: 1 }, held: [], id: "e0", purpose: "offer", ref: "o1",
      staged: {} }); })).toBe("Trade escrow without exactly one owner");
    expect(tampered(copy => { copy.escrow[0]!.staged = { ...copy.escrow[0]!.goods, logs: 1 }; }))
      .toBe("Invalid trade escrow or deliveries");
    expect(tampered(copy => { copy.npcTraders = "on" as unknown as boolean; })).toBe("Invalid trade state");
    expect(tampered(copy => { copy.offers[0]!.escrowId = "e999"; })).toBe("Trade escrow without exactly one owner");
    expect(tampered(copy => { (copy as unknown as { mail: unknown[] }).mail = [{ goods: { horse: 2 }, id: "t1" }]; }))
      .toBe("Invalid trade mail or floors");
    expect(tampered(copy => { copy.nextId = 2; })).toBe("Trade record id after the next id");
    expect(tampered(copy => { copy.offers.push(...Array(10).fill(copy.offers[0])); })).toBe("Invalid trade offers");
    expect(tampered(copy => { copy.floors = { fish: -1 }; })).toBe("Invalid trade mail or floors");
  });
});

const islandSave = (map: string, trade?: SettlementTradeSave): GameSaveV1 => ({
  format: "island-settlers-game", map, progress: { fog: { length: 0, packed: "" }, surveyed: [] }, savedAt: 10,
  settlement: { storagePools: { version: 1 as const, nextId: 0, pools: [] }, trade } as unknown as GameSaveV1["settlement"], version: 4
});
/** Home on screen with a colony filed in its archipelago, both trading. */
const tradingGame = (): GameSaveV1 => ({
  ...islandSave("home", tradedState(1)),
  archipelago: { active: null, colonies: [{ expeditionId: 4, save: islandSave("colony", tradedState(2)) }],
    version: 1 } as unknown as GameSaveV1["archipelago"]
});

describe("trade tables (database version 6)", () => {
  it("moves offers and history of every island into rows and composes the same game", () => {
    const game = tradingGame();
    const rows = splitGameSave(game);
    const home = game.settlement.trade!;
    expect(rows.tradeHistory!.filter(row => row.islandId === "home").map(row => row.entry)).toEqual(home.history);
    expect(rows.tradeOffers!.some(row => row.islandId === "colony-4" && row.kind === "player")).toBe(true);
    const stored = rows.islands.find(row => row.id === "home")!.save.settlement.trade!;
    expect([stored.history, stored.offers, stored.market!.offers]).toEqual([[], [], []]);
    expect(stored.escrow).toEqual(home.escrow);
    expect(composeGameSave(JSON.parse(JSON.stringify(rows)))).toEqual(game);
  });
  it("serves one island's rows through the repository", async () => {
    const database = openLocalStorageGame(createMemoryStorage());
    const game = tradingGame();
    await database.writeGame("ada", game);
    const colony = await database.readTradeRows("ada", "colony-4");
    const colonyTrade = game.archipelago!.colonies[0]!.save!.settlement.trade!;
    expect(colony.tradeHistory.map(row => row.entry)).toEqual(colonyTrade.history);
    expect((await database.readTradeRows("bo", "home")).tradeOffers).toEqual([]);
    expect(await database.readGame("ada")).toEqual(game);
  });
});

describe("trade in the settlement simulation", () => {
  const simulation = () => {
    const size = 40;
    const world = {
      seed: 9, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 5.5, z: 5.5 },
      heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
      walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
      oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2), mineZones: [],
      props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(),
        scale: new Float32Array() }
    } as unknown as WorldData;
    let created: ReturnType<typeof createSettlementSimulation>;
    const roads = createRoadNetwork(world, { isBlocked: (x, z) => created?.isOccupied(x, z) ?? false });
    created = createSettlementSimulation({ world, roads, now: () => 1_000, playerLevel: () => 3 });
    return created;
  };
  it("journals the trade commands, refuses without a harbour and round-trips its state through saves", () => {
    const commands = ["tradeBuy", "tradePlaceOffer", "tradeCancelOffer", "tradeSetProtectedFloor", "tradeSetNpcTraders"];
    for (const command of commands) expect(REPLAY_COMMANDS).toContain(command);
    const source = simulation();
    source.update(0.1);
    const market = source.trade().market!;
    expect(market).toMatchObject({ day: 0, level: 3 });
    expect(source.tradeBuy(market.offers[0]!.id)).toBe(TRADE_REASONS.harbourMissing);
    expect(source.tradePlaceOffer({ amount: 5, ware: "planks" }, { amount: 5, ware: "stone" }))
      .toBe(TRADE_REASONS.harbourMissing);
    expect(source.tradeSetProtectedFloor("fish", 3)).toBe(true);
    const saved = { ...source.saveState(), trade: { ...tradedState(), floors: { fish: 3 } } };
    const target = simulation();
    expect(target.loadState(saved)).toEqual({ ok: true });
    expect(target.saveState().trade).toEqual(saved.trade);
    const tampered = structuredClone(saved);
    tampered.trade.escrow.pop();
    expect(target.loadState(tampered)).toMatchObject({ ok: false });
  });
});

describe("phase 1 trade saves (version 1, trade mail dropped 2026-10-19)", () => {
  /** A phase 1 trade state: escrow out of storage at once, an NPC fill time on the trade clock, mail. */
  const legacyState = () => ({
    deliveries: [], elapsed: 900, escrow: [{ goods: { planks: 20 }, id: "e1", purpose: "offer", ref: "o2" }],
    floors: {}, history: [], mail: [{ at: 1, goods: { stone: 7 }, id: "t3", ref: "d9" }], market: null, nextId: 4,
    offers: [{ escrowId: "e1", fillAt: 1000, give: { amount: 20, ware: "planks" }, id: "o2", placedAt: 800,
      placedTime: 1, want: { amount: 9, ware: "fish" } }], version: 1
  });
  it("loads: escrow counts as staged at the harbour, the buyer clock starts at the trade clock, mail is credited", () => {
    expect(validateTradeSave(legacyState())).toBeNull();
    const buildings = [storage(1, 0, {}), storage(2, 39, { stone: 3 })];
    const context = { actors: [], buildings, options: { now: () => 5, world: { seed: 1 } } } as unknown as SettlementContext;
    const trade = createSettlementTrade(context);
    trade.restore(legacyState() as unknown as SettlementTradeSave);
    expect(buildings[1]!.inventory.stone).toBe(10);
    const state = trade.snapshot();
    expect(state).toMatchObject({ buyerClock: 900, npcTraders: false, version: 2 });
    expect(state.escrow[0]).toMatchObject({ held: [], staged: { planks: 20 } });
    expect("mail" in state).toBe(false);
    expect(validateTradeSave(trade.save())).toBeNull();
  });
  it("folds stored mail rows back into their island", () => {
    const save = islandSave("home", legacyState() as unknown as SettlementTradeSave);
    const rows = { ...splitGameSave(save), tradeMail: [{ id: "t8", islandId: "home", mail: { goods: { fish: 2 }, id: "t8" },
      order: 0 }] };
    const composed = composeGameSave(rows)!.settlement.trade as unknown as { mail: { goods: object }[] };
    expect(composed.mail.map(mail => mail.goods)).toEqual([{ stone: 7 }, { fish: 2 }]);
  });
});
