import { LEVEL_THRESHOLDS, questRewardMaterialKind, TALENT_RESET_GEMS } from "@shared/catalog/balance";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEconomyClient, type LevelClaim } from "../src/app/cloud/economy-client";
import { dailyQuestClaimBody } from "../src/app/cloud/quest-claim-body";
import { createServerEconomy, type ServerEconomy } from "../src/app/cloud/server-economy";
import { SaveApiError } from "../src/app/save-store/save-api-client";
import { createPlayerSession } from "../src/app/settlement/player-session";
import { createPlayerProgress } from "../src/shared/progression/player-progress";
import { addToHome } from "../src/shared/settlement/colony-economy";
import { applyQuestClaim } from "../src/shared/settlement/settlement-quest-claim";
import type { SettlementSimulation } from "../src/shared/settlement/settlement-simulation";

const API = "http://127.0.0.1:3002";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("economy client", () => {
  it("posts claims, purchases and resets; rule refusals (409) come back as reasons", async () => {
    const calls: [string, unknown][] = [];
    const answers = [json({ level: 12, paid: [], wallet: { gems: 5 } }),
      json({ coins: 30, goods: { coins: 30, planks: 3 }, wallet: { gems: 5 } }),
      json({ goods: { coins: 67 }, wallet: { gems: 5 } }),
      json({ code: "SAVE_CONFLICT", message: "Needs 3 more gems" }, 409),
      json({ goods: { logs: 100 }, wallet: { gems: 2 } }), json({ gems: 2 })];
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      calls.push([`${init.method} ${url.slice(API.length)}`, init.body && JSON.parse(init.body as string)]);
      return answers.shift()!;
    }) as unknown as typeof globalThis.fetch;
    const client = createEconomyClient({ apiUrl: API, fetch, getAccessToken: async () => "t" });
    expect(await client.claimLevels(12)).toMatchObject({ level: 12, ok: true });
    const quest = dailyQuestClaimBody({ bonus: 0, material: "planks", questId: "2026-10-22-0" }, 0);
    expect(await client.claimQuest(quest)).toMatchObject({ goods: { coins: 30, planks: 3 }, ok: true });
    const adventure = { adventureId: 7, bonus: 0.1, difficulty: "medium", seed: 3 };
    expect(await client.claimAdventure(adventure)).toMatchObject({ goods: { coins: 67 }, ok: true });
    expect(await client.buyGemOffer("logs-100", "key-00000001")).toEqual({ ok: false, reason: "Needs 3 more gems" });
    expect(await client.buyGemOffer("logs-100", "key-00000002")).toMatchObject({ goods: { logs: 100 }, ok: true });
    expect(await client.wallet()).toEqual({ gems: 2 });
    expect(calls).toEqual([
      ["POST /v1/economy/rewards/levels", { level: 12 }], ["POST /v1/economy/rewards/quests", quest],
      ["POST /v1/economy/rewards/adventures", adventure],
      ["POST /v1/economy/gem-shop/purchases", { idempotencyKey: "key-00000001", offerId: "logs-100" }],
      ["POST /v1/economy/gem-shop/purchases", { idempotencyKey: "key-00000002", offerId: "logs-100" }],
      ["GET /v1/economy/wallet", undefined]
    ]);
  });
});

describe("server economy", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("queues reward claims, retries them offline with backoff and publishes the server's gems", async () => {
    let offline = 2;
    const claimLevels = vi.fn(async (level: number) => {
      if (offline-- > 0) throw new SaveApiError(0, "NETWORK", "offline");
      return { claimedLevel: level, level, ok: true as const, paid: [], verifiedLevel: level - 1,
        wallet: { gems: level * 10 } };
    });
    const economy = createServerEconomy({ client: { claimLevels } as never, startGems: 3 });
    const gems: number[] = [], claims: LevelClaim[] = [];
    economy.onGems(value => gems.push(value));
    economy.onLevelClaim(claim => claims.push(claim));
    economy.claimLevel(12);
    await vi.advanceTimersByTimeAsync(0);
    expect(gems).toEqual([]);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(4000);
    expect(gems).toEqual([120]);
    expect(claims).toEqual([expect.objectContaining({ claimedLevel: 12, level: 12, paid: [], verifiedLevel: 11,
      wallet: { gems: 120 } })]);
    expect(claimLevels).toHaveBeenCalledTimes(3);
  });
});

describe("player session with the server economy", () => {
  it("stops cloud wallet delivery to a disposed island session", () => {
    const listeners = new Set<(gems: number) => void>();
    const economy = { startGems: 2, onGems: (listener: (gems: number) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    } } as unknown as ServerEconomy;
    const session = createPlayerSession({ economy, seed: 1, now: () => Date.UTC(2026, 9, 29) });
    expect(listeners.size).toBe(1);
    for (const listener of listeners) listener(7);
    expect(session.progress().gems).toBe(7);
    session.dispose();
    session.dispose();
    expect(listeners.size).toBe(0);
    for (const listener of listeners) listener(20);
    expect(session.progress().gems).toBe(7);
  });
  const hq = { construction: 1, inventory: {} as Record<string, number>, typeId: 0 };
  const simulation = (room = true) => ({
    buildings: () => [hq], canDeliverHome: () => room,
    deliverHome: (goods: Record<string, number>) => {
      for (const [ware, count] of Object.entries(goods)) hq.inventory[ware] = (hq.inventory[ware] ?? 0) + count;
      return room;
    },
    claimQuest: (claim: Parameters<SettlementSimulation["claimQuest"]>[0]) =>
      applyQuestClaim([hq] as never, claim, ware => hq.inventory[ware] ?? 0),
    home: () => hq, islandRole: () => "home", militarySoldiers: () => [], pendingRoadDecorationReturns: () => [],
    playerNation: () => "roman",
    receiveHomeGoods: (goods: Record<string, number>) => addToHome([hq], goods), setTalentRanks: () => true
  }) as unknown as SettlementSimulation;
  const fakeEconomy = (startGems: number) => {
    const listeners: ((gems: number) => void)[] = [], claimListeners: ((claim: LevelClaim) => void)[] = [];
    const economy = {
      buyGemOffer: vi.fn(async () => ({ gems: startGems - 10, goods: { logs: 100 }, ok: true as const })),
      claimAdventure: vi.fn(async (): Promise<Record<string, number> | string> => ({ coins: 67 })),
      claimLevel: vi.fn(),
      claimQuest: vi.fn(async (): Promise<Record<string, number> | string> => ({ coins: 25, granite: 3 })),
      onGems: (listener: (gems: number) => void) => { listeners.push(listener); return () => undefined; },
      onLevelClaim: (listener: (claim: LevelClaim) => void) => {
        claimListeners.push(listener);
        return () => undefined;
      },
      resetTalents: vi.fn(async () => ({ gems: startGems - TALENT_RESET_GEMS, ok: true as const })),
      startGems
    } satisfies ServerEconomy;
    return {
      economy,
      publish: (gems: number) => listeners.forEach(listener => listener(gems)),
      publishClaim: (claim: LevelClaim) => claimListeners.forEach(listener => listener(claim))
    };
  };

  it("starts from the wallet's gems and claims level rewards from the server instead of adding them", () => {
    const { economy, publish } = fakeEconomy(40);
    const initial = { ...createPlayerProgress(3), gems: 999, experience: LEVEL_THRESHOLDS[11]! - 1 };
    const session = createPlayerSession({ economy, initial, seed: 3, now: () => Date.UTC(2026, 9, 22) });
    session.bind(simulation());
    expect(session.progress().gems).toBe(40);
    session.claimServerLevel();
    expect(economy.claimLevel).toHaveBeenLastCalledWith(11);
    session.buildingCompleted({ typeId: 37 } as never);
    expect(session.level()).toBe(12);
    expect(session.progress().gems).toBe(40);
    expect(economy.claimLevel).toHaveBeenLastCalledWith(12);
    publish(45);
    expect(session.progress().gems).toBe(45);
    expect(session.grantGems(100)).toBe(false);
  });

  it("buys from the gem shop through the server, and only when the goods fit", async () => {
    const { economy } = fakeEconomy(40);
    const session = createPlayerSession({ economy, seed: 3, now: () => Date.UTC(2026, 9, 22) });
    session.bind(simulation(false));
    expect(session.buyGemOffer("logs-100")).toMatch(/storage/);
    expect(economy.buyGemOffer).not.toHaveBeenCalled();
    session.bind(simulation(true));
    hq.inventory = {};
    expect(await session.buyGemOffer("logs-100")).toBe(true);
    expect(hq.inventory.logs).toBe(100);
    expect(session.progress().gems).toBe(30);
  });

  it("claims a daily quest only once the server confirmed it, and keeps it open when refused", async () => {
    const { economy } = fakeEconomy(0);
    const session = createPlayerSession({ economy, seed: 3, now: () => Date.UTC(2026, 9, 22, 9) });
    session.bind(simulation());
    hq.inventory = {};
    const quest = session.progress().quests.find(entry => entry.kind === "produce")!;
    for (let index = 0; index < quest.amount; index++) session.produced(quest.ware);
    economy.claimQuest.mockResolvedValueOnce("This quest is not claimable now");
    const refused = session.completeQuest(quest.id);
    expect(refused).toBeInstanceOf(Promise);
    expect(await refused).toBe("The server did not confirm this claim: This quest is not claimable now");
    expect(session.progress().quests.find(entry => entry.id === quest.id)!.done).toBe(false);
    expect(hq.inventory.coins).toBeUndefined();
    expect(await session.completeQuest(quest.id)).toBe(true);
    expect(economy.claimQuest).toHaveBeenLastCalledWith({ bonus: 0, material: questRewardMaterialKind(quest.reward),
      questId: quest.id });
    expect(session.progress().quests.find(entry => entry.id === quest.id)!.done).toBe(true);
    expect(hq.inventory).toEqual({ coins: 25, granite: 3 });
  });

  it("resets talents only after the server took the gems", async () => {
    const { economy } = fakeEconomy(TALENT_RESET_GEMS + 5);
    const initial = { ...createPlayerProgress(3), talents: { harvest: 1 } as never };
    const session = createPlayerSession({ economy, initial, seed: 3, now: () => Date.UTC(2026, 9, 22) });
    session.bind(simulation());
    const result = session.resetTalents();
    expect(result).toBeInstanceOf(Promise);
    expect(await result).toBe(true);
    expect(session.progress()).toMatchObject({ gems: 5, talents: {} });
  });
});

describe("campaign victory claim while the server verifies the run", () => {
  const pending = () => new SaveApiError(503, "CAMPAIGN_VICTORY_PENDING", "Still checking");
  const answer = { attemptId: "a", kind: "first", ok: true, payout: { coins: 0, decorations: {}, gems: 4, goods: {},
    settlers: 0, soldiers: [], xp: 0 }, repeated: false, unpaidDecorations: {}, wallet: { gems: 9 } };
  const immediate = { clear: () => undefined,
    set: (run: () => void) => { run(); return 0 as unknown as ReturnType<typeof setTimeout>; } };
  const economyWith = (claim: () => Promise<unknown>) => createServerEconomy({ startGems: 0, timers: immediate,
    client: { claimCampaignVictory: claim } as unknown as Parameters<typeof createServerEconomy>[0]["client"] });

  it("asks again while the answer is pending and returns the payout", async () => {
    const claim = vi.fn().mockRejectedValueOnce(pending()).mockRejectedValueOnce(pending()).mockResolvedValue(answer);
    const result = await economyWith(claim).claimCampaignVictory!("a");
    expect(claim).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ kind: "first", payout: { gems: 4 } });
  });

  it("gives up after a few pending answers (the player stays on the map) and never retries another error", async () => {
    const stuck = vi.fn().mockRejectedValue(pending());
    await expect(economyWith(stuck).claimCampaignVictory!("a")).rejects.toThrow("Still checking");
    expect(stuck).toHaveBeenCalledTimes(6);
    const failing = vi.fn().mockRejectedValue(new SaveApiError(500, "INTERNAL_ERROR", "Broken"));
    await expect(economyWith(failing).claimCampaignVictory!("a")).rejects.toThrow("Broken");
    expect(failing).toHaveBeenCalledTimes(1);
  });
});
