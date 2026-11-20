import { describe, expect, it } from "vitest";

import { createSessionLifecycle } from "../src/app/session-lifecycle";
import { createArchipelagoSession } from "../src/app/settlement/archipelago-session";
import { GRANT_RETRY_SECONDS } from "../src/app/settlement/campaign-home-grants";
import {
  campaignMarkerError, campaignRunStateError, type CampaignRunState, createCampaignRunState
} from "../src/shared/campaign/campaign-run";
import { applyCampaignGrants, type Archipelago, emptyArchipelago } from "../src/shared/settlement/archipelago";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { composeGameSave, splitGameSave } from "../src/shared/settlement/game-save-rows";
import type { SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { createMemorySaveStore } from "./memory-save-store";

const marker = { attempt: 1, campaignId: "isles", mapId: "bay" };
const save = (map: string): GameSaveV1 => ({ format: "island-settlers-game", map,
  progress: { fog: { length: 0, packed: "" }, surveyed: [] }, savedAt: 10,
  settlement: { storagePools: { version: 1 as const, nextId: 0, pools: [] } } as unknown as GameSaveV1["settlement"],
  version: 4 });
const homeFiled = (extra: Partial<Archipelago> = {}): Archipelago =>
  ({ ...emptyArchipelago(), campaign: { ...marker }, home: save("home"), ...extra });
const simulation = { colonyExpeditions: () => [], colony: () => undefined, adventure: () => undefined,
  gameNow: () => Date.UTC(2026, 10, 11) } as unknown as SettlementSimulation;

const deferred = () => {
  let release = () => {};
  const promise = new Promise<void>(done => { release = done; });
  return { promise, release };
};

/** The archipelago session of a campaign run on screen, with home filed. */
const runSession = (run: CampaignRunState = createCampaignRunState(marker), initial = homeFiled()) => {
  const memory = createMemorySaveStore(), transition = createSessionLifecycle();
  const travel = createArchipelagoSession({ campaignRun: run, capture: async () => save("run"), initial,
    notify: () => undefined, reload: () => undefined, simulation, store: memory.store, transition });
  return { memory, transition, travel };
};

/** Holds another transition open, so the next archipelago write is refused as busy. */
const blockTransition = (transition: ReturnType<typeof createSessionLifecycle>) => {
  const gate = deferred();
  const done = transition.run({ key: "travel:elsewhere", run: () => gate.promise });
  return async () => { gate.release(); await done; };
};

/** Lets the retry's serialized archipelago write finish. */
const settleWrites = async () => {
  for (let turn = 0; turn < 5; turn++) await new Promise(done => setTimeout(done, 0));
};

const coins = (travel: ReturnType<typeof runSession>["travel"]) => travel.groupForSave()?.rewards?.coins ?? 0;

describe("campaign home grants (owner decision 2026-11-11, point 1)", () => {
  it("keeps a refused grant pending in the run, retries it after the transition and credits it once", async () => {
    const { memory, transition, travel } = runSession();
    const release = blockTransition(transition);
    expect(await travel.queueHomeGrant("level-2", { coins: 9 })).toBe(false);
    expect(travel.campaignRun()?.pendingGrants).toEqual([{ goods: { coins: 9 }, id: "level-2" }]);
    travel.update(GRANT_RETRY_SECONDS);
    expect(travel.campaignRun()?.pendingGrants, "no retry while the transition runs").toHaveLength(1);
    await release();
    travel.update(GRANT_RETRY_SECONDS);
    await settleWrites();
    expect(travel.campaignRun()?.pendingGrants).toBeUndefined();
    const written = memory.games.at(-1)!;
    expect(written.archipelago?.rewards).toEqual({ coins: 9 });
    expect(written.archipelago?.campaign?.appliedGrants).toEqual(["level-2"]);
    expect(await travel.queueHomeGrant("level-2", { coins: 9 }), "a repeated id credits nothing").toBe(true);
    expect(coins(travel)).toBe(9);
  });

  it("writes a grant at once when nothing blocks it", async () => {
    const { memory, travel } = runSession();
    expect(await travel.queueHomeGrant("level-3", { coins: 11 })).toBe(true);
    expect(travel.campaignRun()?.pendingGrants).toBeUndefined();
    expect(memory.games.at(-1)!.archipelago?.rewards).toEqual({ coins: 11 });
  });

  it("folds pending grants into the next save with the run that drops them", async () => {
    const { transition, travel } = runSession();
    const release = blockTransition(transition);
    await travel.queueHomeGrant("level-2", { coins: 9 });
    await release();
    const saved = travel.attach(save("run"));
    expect(saved.archipelago?.rewards).toEqual({ coins: 9 });
    expect(saved.archipelago?.campaign?.appliedGrants).toEqual(["level-2"]);
    expect(saved.campaignRun?.pendingGrants).toBeUndefined();
    expect(travel.attach(save("run")).archipelago?.rewards, "a second save adds nothing").toEqual({ coins: 9 });
  });

  it("retries pending grants of a reloaded run on its first frame", async () => {
    const stored = { ...save("run"), archipelago: homeFiled(),
      campaignRun: { ...createCampaignRunState(marker), pendingGrants: [{ goods: { coins: 9 }, id: "level-2" }] } };
    const reloaded = composeGameSave(splitGameSave(stored))!;
    expect(reloaded.campaignRun?.pendingGrants).toEqual([{ goods: { coins: 9 }, id: "level-2" }]);
    const { memory, travel } = runSession(reloaded.campaignRun, reloaded.archipelago);
    travel.update(0);
    await settleWrites();
    expect(travel.campaignRun()?.pendingGrants).toBeUndefined();
    expect(memory.games.at(-1)!.archipelago?.rewards).toEqual({ coins: 9 });
  });

  it("drops a reloaded pending grant the archipelago already applied, without a second credit", async () => {
    const applied = homeFiled({ campaign: { ...marker, appliedGrants: ["level-2"] }, rewards: { coins: 9 } });
    const stored = { ...save("run"), archipelago: applied,
      campaignRun: { ...createCampaignRunState(marker), pendingGrants: [{ goods: { coins: 9 }, id: "level-2" }] } };
    const reloaded = composeGameSave(splitGameSave(stored))!;
    expect(reloaded.archipelago?.campaign?.appliedGrants).toEqual(["level-2"]);
    const { travel } = runSession(reloaded.campaignRun, reloaded.archipelago);
    travel.update(0);
    await settleWrites();
    expect(travel.campaignRun()?.pendingGrants).toBeUndefined();
    expect(coins(travel)).toBe(9);
  });
});

describe("campaign grant records", () => {
  it("applies each grant id once and keeps the goods without a marker", () => {
    const grant = { goods: { coins: 5 }, id: "level-4" };
    const once = applyCampaignGrants(homeFiled(), [grant, grant]);
    expect(once.rewards).toEqual({ coins: 5 });
    expect(applyCampaignGrants(once, [grant])).toBe(once);
    expect(applyCampaignGrants(emptyArchipelago(), [grant]).rewards).toEqual({ coins: 5 });
  });

  it("validates pending grants and applied ids", () => {
    const run = createCampaignRunState(marker);
    expect(campaignRunStateError({ ...run, pendingGrants: [{ goods: { coins: 3 }, id: "level-2" }] })).toBeNull();
    expect(campaignRunStateError({ ...run, pendingGrants: [{ goods: { coins: -1 }, id: "x" }] })).not.toBeNull();
    expect(campaignRunStateError({ ...run, pendingGrants: [{ goods: {}, id: "" }] })).not.toBeNull();
    expect(campaignMarkerError({ ...marker, appliedGrants: ["level-2"] })).toBeNull();
    expect(campaignMarkerError({ ...marker, appliedGrants: [3] })).not.toBeNull();
  });
});
