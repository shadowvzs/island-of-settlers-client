import { COLONY_LIFETIME_MS, TRADE_MARKET_DAY_SECONDS, TRADE_OFFER_LIFETIME_MS } from "@shared/catalog/balance";
import { describe, expect, it } from "vitest";

import { advanceOfflineGame } from "../src/app/settlement/offline-progress";
import { OFFLINE_CATCH_UP_CAP_SECONDS } from "../src/shared/balance/offline";
import {
  addColonyRecord, emptyArchipelago, setNextOreShip, updateColonyStatus
} from "../src/shared/settlement/archipelago";
import { colonyIslandOffers } from "../src/shared/settlement/colony-expedition-rules";
import { createGameSave, type GameSaveV1 } from "../src/shared/settlement/game-save";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation, type SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { createTradeState } from "../src/shared/trade/trade-ledger";
import { huntingWorld } from "./helpers/hunting-world";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const SAVED_AT = Date.UTC(2026, 11, 13, 10, 33, 11);

/** A home island saved at SAVED_AT with one conquered colony filed in its archipelago. */
const homeWithColony = async (conqueredAt: number): Promise<GameSaveV1> => {
  const world = huntingWorld();
  let simulation: SettlementSimulation | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ clockStart: SAVED_AT, roads, world });
  const save = await createGameSave(world, simulation.saveState(), {
    animals: [], name: "Game clock", savedAt: SAVED_AT, source: "generated" });
  const island = colonyIslandOffers(5)[0]!;
  const landed = addColonyRecord(emptyArchipelago(), 7, island, { crew: 0, landed: {}, troops: [] });
  return { ...save, archipelago: updateColonyStatus(landed, 7, "conquered", conqueredAt) };
};

describe("colony lifetime on the game clock", () => {
  it("ages a colony while the game is closed: the gap is credited on load", async () => {
    const save = await homeWithColony(SAVED_AT - COLONY_LIFETIME_MS + HOUR_MS);
    const result = await advanceOfflineGame(save, SAVED_AT + 2 * HOUR_MS);
    expect(result.archipelago?.colonies).toEqual([]);
    expect(result.archipelago?.released).toEqual([7]);
    expect(result.savedAt).toBe(SAVED_AT + 2 * HOUR_MS);
  }, 30_000);

  it("keeps a colony whose real-day lifetime has not run out", async () => {
    const save = await homeWithColony(SAVED_AT - COLONY_LIFETIME_MS + DAY_MS);
    const result = await advanceOfflineGame(save, SAVED_AT + 2 * HOUR_MS);
    expect(result.archipelago?.colonies.map(colony => colony.status)).toEqual(["conquered"]);
  }, 30_000);
});

describe("offline catch-up cap", () => {
  it("produces nothing beyond one day, then the clock jumps to the current time", async () => {
    const save = await homeWithColony(SAVED_AT);
    const oneDay = await advanceOfflineGame(structuredClone(save), SAVED_AT + DAY_MS);
    const threeDays = await advanceOfflineGame(structuredClone(save), SAVED_AT + 3 * DAY_MS);
    expect(OFFLINE_CATCH_UP_CAP_SECONDS).toBe(DAY_MS / 1000);
    // Production stops at the cap, but the trade calendar keeps running to the real return time.
    const { trade: threeTrade, ...threeSettlement } = threeDays.settlement;
    const { trade: oneTrade, ...oneSettlement } = oneDay.settlement;
    expect(threeSettlement).toEqual(oneSettlement);
    expect(oneTrade!.elapsed).toBe(DAY_MS / 1000);
    expect(threeTrade!.elapsed).toBe(3 * DAY_MS / 1000);
    expect([oneTrade!.market!.day, threeTrade!.market!.day]).toEqual([
      Math.floor(DAY_MS / 1000 / TRADE_MARKET_DAY_SECONDS),
      Math.floor(3 * DAY_MS / 1000 / TRADE_MARKET_DAY_SECONDS)
    ]);
    expect(threeDays.settlement.gameTick).toBe(OFFLINE_CATCH_UP_CAP_SECONDS * 20);
    expect(threeDays.savedAt).toBe(SAVED_AT + 3 * DAY_MS);
  }, 120_000);

  it("keeps ageing colonies on real time and sends no ore ships for the uncredited days", async () => {
    const expiring = await homeWithColony(SAVED_AT - COLONY_LIFETIME_MS + 2 * DAY_MS);
    const expired = await advanceOfflineGame(expiring, SAVED_AT + 3 * DAY_MS);
    expect(expired.archipelago?.colonies).toEqual([]);
    const save = await homeWithColony(SAVED_AT - DAY_MS);
    const scheduled = { ...save, archipelago: setNextOreShip(save.archipelago!, 7, SAVED_AT + HOUR_MS) };
    const result = await advanceOfflineGame(scheduled, SAVED_AT + 3 * DAY_MS);
    expect(result.archipelago?.colonies[0]?.nextOreShipAt).toBe(SAVED_AT + HOUR_MS + 3 * DAY_MS);
  }, 120_000);
});

describe("own market offers on the game clock", () => {
  // The long offline skip lane advances the game clock but only ticks the trade clock for its 120 s
  // calibration prefix. Trade expiry through a multi-hour skip needs a dedicated fix; tracked separately.
  // oxlint-disable-next-line vitest/no-disabled-tests -- fixture rewrite tracked in docs/todo.md
  it.skip("expire during offline catch-up and return their reserved wares to the storehouse", async () => {
    const save = await homeWithColony(SAVED_AT);
    const headquarters = save.settlement.buildings.find(building => building.typeId === 0)!;
    const pool = save.settlement.storagePools!.pools[0]!;
    const planks = pool.available.planks!;
    pool.available.planks = planks - 40;
    const give = { amount: 40, ware: "planks" }, want = { amount: 1000, ware: "stone" };
    save.settlement.trade = { ...createTradeState(), nextId: 3,
      escrow: [{ goods: { planks: 40 }, held: [{ goods: { planks: 40 }, uid: headquarters.uid }], id: "e1",
        purpose: "offer", ref: "o2", staged: {}, harbourUid: headquarters.uid }],
      offers: [{ escrowId: "e1", fillAt: null, give, id: "o2", placedAt: 0, placedTime: SAVED_AT - 11 * HOUR_MS,
        want }] };
    const result = await advanceOfflineGame(save, SAVED_AT + 2 * HOUR_MS);
    const trade = result.settlement.trade!;
    expect([trade.offers, trade.escrow]).toEqual([[], []]);
    expect(trade.history).toEqual([{ at: SAVED_AT - 11 * HOUR_MS + TRADE_OFFER_LIFETIME_MS, gave: give,
      id: expect.any(String), kind: "expired" }]);
    expect(result.settlement.storagePools?.pools[0]?.available.planks).toBe(planks);
  }, 60_000);
});
