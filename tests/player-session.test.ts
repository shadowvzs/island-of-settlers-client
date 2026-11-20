import { LEVEL_THRESHOLDS } from "@shared/catalog/balance";
import { describe, expect, it } from "vitest";

import { createPlayerSession } from "../src/app/settlement/player-session";
import { GEM_SHOP_CAMPAIGN_CLOSED } from "../src/shared/progression/gem-shop";
import { createPlayerProgress, type LevelUp } from "../src/shared/progression/player-progress";
import { addToHome, takeFromStorages } from "../src/shared/settlement/colony-economy";
import { applyQuestClaim } from "../src/shared/settlement/settlement-quest-claim";
import type { SettlementSimulation } from "../src/shared/settlement/settlement-simulation";

const hq = { construction: 1, inventory: { fish: 50, logs: 50, meat: 50, stone: 50, water: 50 } as Record<string, number>,
  typeId: 0 };
const simulation = {
  buildings: () => [hq],
  claimQuest: (claim: Parameters<SettlementSimulation["claimQuest"]>[0]) =>
    applyQuestClaim([hq] as never, claim, ware => hq.inventory[ware] ?? 0),
  home: () => hq,
  islandRole: () => "home",
  militarySoldiers: () => [],
  playerNation: () => "roman",
  receiveHomeGoods: (goods: Record<string, number>) => addToHome([hq], goods),
  resourceTotal: (ware: string) => hq.inventory[ware] ?? 0,
  setTalentRanks: () => true,
  takeStoredGoods: (goods: Record<string, number>) => takeFromStorages([hq], goods)
} as unknown as SettlementSimulation;

describe("player session", () => {
  it("buffers exact level-up coins for a coordinated archived island without crediting its private stock", () => {
    const coins: number[] = [], before = hq.inventory.coins ?? 0;
    const session = createPlayerSession({ receiveLevelUpCoins: amount => coins.push(amount), seed: 3,
      now: () => Date.UTC(2026, 9, 12, 9) });
    session.bind(simulation);
    for (let building = 0; building < 10; building++) session.buildingCompleted({ typeId: 37 } as never);
    expect(session.level()).toBe(3);
    expect(coins.reduce((sum, amount) => sum + amount, 0)).toBe(20);
    expect(hq.inventory.coins ?? 0).toBe(before);
  });
  it("shares one canonical progress store across live island sessions", () => {
    let stored: ReturnType<typeof createPlayerProgress> | undefined;
    const store = { get: () => stored, set: (progress: ReturnType<typeof createPlayerProgress>) => { stored = progress; } };
    const first = createPlayerSession({ seed: 3, now: () => Date.UTC(2026, 9, 12, 9), store });
    const second = createPlayerSession({ seed: 3, now: () => Date.UTC(2026, 9, 12, 9), store });
    const produce = first.progress().quests.find(quest => quest.kind === "produce")!;
    for (let index = 0; index < produce.amount; index++) first.produced(produce.ware);
    const shared = second.progress().quests.find(quest => quest.id === produce.id)!;
    expect(shared.progress).toBe(produce.amount);
  });

  it("queues a campaign map's level-up coins for home and closes the gem shop there (C3)", () => {
    const grants: Record<string, number>[] = [], before = hq.inventory.coins ?? 0;
    const campaign = { ...simulation, islandRole: () => "campaign" } as unknown as SettlementSimulation;
    const session = createPlayerSession({ queueHomeGrant: (_id, goods) => grants.push({ ...goods }), seed: 3,
      now: () => Date.UTC(2026, 9, 12, 9) });
    session.bind(campaign);
    for (let building = 0; building < 10; building++) session.buildingCompleted({ typeId: 37 } as never);
    expect(session.level()).toBe(3);
    expect(grants.reduce((sum, goods) => sum + (goods.coins ?? 0), 0)).toBe(20);
    expect(hq.inventory.coins ?? 0).toBe(before);
    expect(session.buyGemOffer("logs-100")).toBe(GEM_SHOP_CAMPAIGN_CLOSED);
    expect(session.completeQuest(session.progress().quests[0]!.id)).toBe("Claim the daily quest on your home island");
  });

  it("claims produced quests and sends level-up coins home", () => {
    const levelUps: LevelUp[][] = [];
    const session = createPlayerSession({ onLevelUp: entries => levelUps.push([...entries]), seed: 3,
      now: () => Date.UTC(2026, 9, 12, 9) });
    session.bind(simulation);
    const quests = session.progress().quests;
    expect(quests.some(quest => quest.kind === "deliver")).toBe(false);
    const produce = quests.find(quest => quest.kind === "produce")!;
    expect(session.completeQuest(produce.id)).toMatch(/Produce/);
    for (let index = 0; index < produce.amount; index++) session.produced(produce.ware);
    expect(session.completeQuest(produce.id)).toBe(true);
    for (let building = 0; building < 10; building++) session.buildingCompleted({ typeId: 37 } as never);
    expect(session.level()).toBe(3);
    expect(levelUps.flat().map(entry => entry.level)).toEqual([2, 3]);
    // Level-up coins (9 + 11) and the level-1 daily quest's 12 coins and 2 planks or stone.
    expect(hq.inventory.coins).toBe(9 + 11 + 12);
    const material = Object.keys(produce.reward).find(ware => ware !== "coins")!;
    expect(["planks", "stone"]).toContain(material);
    expect(hq.inventory[material]).toBe(2);
    expect(session.completeQuest(produce.id), "a quest pays once").toBe("This quest is already done");
  });

  it("pays delivery quests from storage and credits the goods (with the quest talent) at home", () => {
    const deliver = { amount: 5, done: false, experience: 100, id: "2026-10-12-0", kind: "deliver" as const,
      progress: 0, reward: { coins: 30, marble: 3 }, ware: "fish" };
    const initial = { ...createPlayerProgress(3), experience: LEVEL_THRESHOLDS[29]!,
      questDay: "2026-10-12", quests: [deliver], talents: { productionSpeed: 5, questRewards: 4 } };
    const session = createPlayerSession({ initial, seed: 3, now: () => Date.UTC(2026, 9, 12, 9) });
    session.bind(simulation);
    const before = { coins: hq.inventory.coins ?? 0, fish: hq.inventory.fish!, marble: hq.inventory.marble ?? 0 };
    expect(session.completeQuest(deliver.id)).toBe(true);
    expect(hq.inventory.fish).toBe(before.fish - 5);
    // +20% (4 ranks of the daily quest talent) on the goods and on the experience.
    expect(hq.inventory.coins).toBe(before.coins + 36);
    expect(hq.inventory.marble).toBe(before.marble + 4);
    expect(session.progress().experience).toBe(LEVEL_THRESHOLDS[29]! + 120);
  });

  it("claims the daily quest on the home island only and rolls it over at UTC midnight", () => {
    let time = Date.UTC(2026, 9, 12, 23, 59);
    const colony = { ...simulation, home: () => ({ typeId: 39 }), islandRole: () => "colony" } as unknown as SettlementSimulation;
    const session = createPlayerSession({ now: () => time, seed: 3 });
    session.bind(colony);
    const [quest] = session.progress().quests;
    expect(session.progress().quests).toHaveLength(1);
    for (let index = 0; index < quest!.amount; index++) session.produced(quest!.ware);
    expect(session.completeQuest(quest!.id)).toBe("Claim the daily quest on your home island");
    time = Date.UTC(2026, 9, 13, 0, 1);
    const [next] = session.progress().quests;
    expect(next!.id).toBe("2026-10-13-0");
    expect(session.progress().quests).toHaveLength(1);
  });
});

describe("player talents", () => {
  it("applies and resets the talent tree and hands the applied ranks to the island", () => {
    const sent: unknown[] = [];
    const island = { ...simulation, setTalentRanks: (ranks: unknown) => { sent.push(ranks); return true; } };
    const initial = { ...createPlayerProgress(3), experience: LEVEL_THRESHOLDS[9]!, gems: 150 };
    const session = createPlayerSession({ initial, seed: 3, now: () => Date.UTC(2026, 9, 12, 9) });
    session.bind(island as SettlementSimulation);
    expect(sent).toEqual([{}]);
    expect(session.applyTalents({ productionSpeed: 2, storageCapacity: 1 })).toBe(true);
    expect(sent.at(-1)).toEqual({ productionSpeed: 2, storageCapacity: 1 });
    expect(session.talentModifiers().productionSpeed).toBeCloseTo(.04);
    expect(session.applyTalents({ fieldGrowth: 1 })).toMatch(/requires level 12/);
    expect(session.resetTalents()).toBe(true);
    expect(session.progress()).toMatchObject({ gems: 50, talents: {} });
    expect(sent.at(-1)).toEqual({});
    expect(session.resetTalents()).toBe("No applied talents to reset");
  });
});

it("releases a lethally hit commander's player-wide ownership without releasing another identity", () => {
  const session = createPlayerSession({ now: () => 0, seed: 3 });
  expect(session.claimCommander("first", 3)).toBe(true);
  session.releaseCommander("other");
  expect(session.commanderOwner()?.id).toBe("first");
  session.releaseCommander("first");
  expect(session.commanderOwner()).toBeUndefined();
  expect(session.claimCommander("replacement", 3)).toBe(true);
});
