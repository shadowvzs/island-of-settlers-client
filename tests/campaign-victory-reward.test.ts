import { describe, expect, it } from "vitest";

import type { CampaignMapRewards } from "../../island-of-settlers-shared/src/campaign/campaign-model";
import { createSessionLifecycle } from "../src/app/session-lifecycle";
import { createArchipelagoSession } from "../src/app/settlement/archipelago-session";
import { createPlayerCampaignVictory, UNTRACKED_VICTORY } from "../src/app/settlement/player-campaign-victory";
import { type CampaignRunState,createCampaignRunState } from "../src/shared/campaign/campaign-run";
import { endCampaignRunGroup } from "../src/shared/campaign/campaign-run-end";
import {
  type CampaignVictoryShipment, rewardTroops, victoryShipment
} from "../src/shared/campaign/campaign-victory-reward";
import { createPlayerProgress, type PlayerProgress } from "../src/shared/progression/player-progress";
import { type Archipelago, emptyArchipelago } from "../src/shared/settlement/archipelago";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { militaryHealth } from "../src/shared/settlement/military-combat-rules";
import type { SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { createMemorySaveStore } from "./memory-save-store";

/** C12: the victory reward of a won run: the claim, the credited part and the reward ship's load. */

const marker = { attempt: 2, campaignId: "isles", mapId: "bay" };
const DAY = Date.UTC(2026, 10, 11, 12);
const ARCH = "roadDecoration:roman-rusticated-arch:limestone";
const REWARDS: CampaignMapRewards = { coins: 30, decorations: [{ amount: 2, item: ARCH }, { amount: 1, item: "unknown" }], gems: 9,
  goods: [{ amount: 6, ware: "planks" }], settlers: 2, soldiers: [{ amount: 1, rank: 1, type: "archer" }], xp: 12 };
const won = (fields: Partial<CampaignRunState> = {}): CampaignRunState =>
  ({ ...createCampaignRunState(marker, { rewards: REWARDS }), status: "won", ...fields });

const guest = (now = DAY) => {
  let progress: PlayerProgress = createPlayerProgress(1);
  const experience: number[] = [];
  const victory = createPlayerCampaignVictory({ commit: next => { progress = next; }, get: () => progress,
    grantExperience: xp => experience.push(xp), localize: text => text, now: () => now });
  return { experience, progress: () => progress, victory };
};

describe("a guest's campaign victory reward (C12)", () => {
  it("pays the whole table first, a third on a replay, nothing on a second replay the same UTC day", async () => {
    const player = guest();
    const first = await player.victory.claim(won()) as CampaignVictoryShipment;
    expect(first.goods).toEqual({ coins: 30, planks: 6 });
    expect(first.settlers).toBe(2);
    expect(first.soldiers.map(troop => `${troop.type}/${troop.rank}`)).toEqual(["archer/1"]);
    expect(player.progress().gems).toBe(9);
    expect(player.progress().inventory).toEqual({ [ARCH]: 2 });
    expect(player.experience).toEqual([12]);
    const replay = await player.victory.claim(won()) as CampaignVictoryShipment;
    expect(replay).toEqual({ goods: { coins: 10, planks: 2 }, settlers: 0, soldiers: [] });
    expect(player.progress().gems).toBe(12);
    const capped = await player.victory.claim(won()) as CampaignVictoryShipment;
    expect(capped).toEqual({ goods: {}, settlers: 0, soldiers: [] });
    expect(player.progress().campaignVictories).toEqual({ completed: ["bay"], replayDays: { bay: "2026-11-11" } });
  });

  it("a signed-in run without a server attempt pays nothing", async () => {
    let calls = 0;
    const progress = createPlayerProgress(1);
    const victory = createPlayerCampaignVictory({ commit: () => undefined, get: () => progress,
      economy: { claimCampaignVictory: async () => { calls++; return "unused"; } },
      grantExperience: () => undefined, localize: text => text, now: () => DAY });
    expect(await victory.claim(won())).toBe(UNTRACKED_VICTORY);
    expect(calls).toBe(0);
  });
});

const save = (map: string): GameSaveV1 => ({ format: "island-settlers-game", map,
  progress: { fog: { length: 0, packed: "" }, surveyed: [] }, savedAt: 10,
  settlement: { storagePools: { version: 1 as const, nextId: 0, pools: [] } } as unknown as GameSaveV1["settlement"],
  version: 4 });
const homeFiled = (): Archipelago => ({ ...emptyArchipelago(), campaign: { ...marker }, home: save("home") });
const simulation = { adventure: () => undefined, campaignSettlers: () => 0, colony: () => undefined,
  colonyExpeditions: () => [], gameNow: () => DAY,
  saveState: () => ({ military: { soldiers: [] } }) } as unknown as SettlementSimulation;

const runSession = (claim: (run: CampaignRunState) => Promise<CampaignVictoryShipment | string>) => {
  const memory = createMemorySaveStore(), notices: string[] = [];
  const travel = createArchipelagoSession({ campaignRun: won(), capture: async () => save("run"),
    claimCampaignVictory: claim, initial: homeFiled(), notify: text => notices.push(text), reload: () => undefined,
    simulation, store: memory.store, transition: createSessionLifecycle() });
  const booted = () => JSON.parse(memory.values.get("startup") ?? "null") as GameSaveV1 | null;
  return { booted, notices, travel };
};

describe("the reward ship's load at the run end (C12)", () => {
  it("queues the won load for home: goods to the reward ship, soldiers aboard, settlers within the limit", async () => {
    const load = victoryShipment({ coins: 5, decorations: {}, gems: 0, goods: { planks: 4 }, settlers: 1,
      soldiers: [{ amount: 2, type: "shield" }], xp: 0 });
    const session = runSession(async () => load);
    expect(await session.travel.endCampaignRun()).toBe(true);
    const group = session.booted()!.archipelago!;
    expect(group.rewards).toEqual({ coins: 5, planks: 4 });
    expect(group.returning?.map(troop => troop.type)).toEqual(["shield", "shield"]);
    expect(group.returningSettlers).toBe(1);
  });

  it("lands recruit rewards (rank 0 or no rank) as rank 0 soldiers with a recruit's health", () => {
    const recruits = rewardTroops([{ amount: 2, rank: 0, type: "shield" }, { amount: 1, type: "archer" }]);
    expect(recruits).toEqual([
      { hp: militaryHealth("shield", 0), rank: 0, type: "shield" },
      { hp: militaryHealth("shield", 0), rank: 0, type: "shield" },
      { hp: militaryHealth("archer", 0), rank: 0, type: "archer" }
    ]);
    expect(rewardTroops([{ amount: 1, rank: 2, type: "shield" }])[0]!.hp).toBeGreaterThan(recruits[0]!.hp);
  });

  it("stays on the map when the claim cannot reach the server; claims only once", async () => {
    let calls = 0, online = false;
    const session = runSession(async () => {
      calls++;
      if (!online) throw new Error("offline");
      return victoryShipment({ coins: 1, decorations: {}, gems: 0, goods: {}, settlers: 0, soldiers: [], xp: 0 });
    });
    expect(await session.travel.endCampaignRun()).toBe(false);
    expect(session.booted()).toBeNull();
    online = true;
    expect(await session.travel.endCampaignRun()).toBe(true);
    expect(calls).toBe(2);
    expect(session.booted()!.archipelago!.rewards).toEqual({ coins: 1 });
  });

  it("a refused claim sails home without a reward and tells why", async () => {
    const session = runSession(async () => "Only a won campaign attempt pays its victory reward");
    expect(await session.travel.endCampaignRun()).toBe(true);
    expect(session.notices).toEqual(["Only a won campaign attempt pays its victory reward"]);
    expect(session.booted()!.archipelago!.rewards).toBeUndefined();
  });

  it("merges the reward goods with waiting adventure rewards", () => {
    const group = { ...homeFiled(), rewards: { coins: 2 } };
    expect(endCampaignRunGroup(group, { reward: { goods: { coins: 3, stone: 1 }, settlers: 0, soldiers: [] },
      settlers: 0, soldiers: [] }).rewards).toEqual({ coins: 5, stone: 1 });
  });
});
