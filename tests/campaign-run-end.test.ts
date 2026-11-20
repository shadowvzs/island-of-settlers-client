import { describe, expect, it } from "vitest";

import { type CampaignEndReport, createEconomyClient } from "../src/app/cloud/economy-client";
import { createSessionLifecycle } from "../src/app/session-lifecycle";
import { createArchipelagoSession } from "../src/app/settlement/archipelago-session";
import {
  campaignRunMapStatus, type CampaignRunState, campaignRunStateError, createCampaignRunState
} from "../src/shared/campaign/campaign-run";
import {
  campaignRunEndExit, campaignRunSettlers, campaignRunSurvivors, campaignRunWithOutcome, endCampaignRunGroup
} from "../src/shared/campaign/campaign-run-end";
import { type Archipelago, emptyArchipelago } from "../src/shared/settlement/archipelago";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import type { EmigratedTroop } from "../src/shared/settlement/settlement-military";
import type { SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { edgeBaySettlement } from "./helpers/edge-bay-settlement";
import { createMemorySaveStore } from "./memory-save-store";

/**
 * C9a: ending a campaign attempt. Nothing returns home after a defeat; a give-up (or restart) and a victory send the
 * shipped soldiers still alive home; the marker leaves the group; the server learns the end (a victory must reach it).
 */

const marker = { attempt: 2, campaignId: "isles", mapId: "bay" };
const SHIPPED = [{ amount: 2, type: "shield" as const }, { amount: 1, type: "archer" as const }];
const troop = (type: EmigratedTroop["type"], rank = 0): EmigratedTroop => ({ hp: 50, rank, type });

const save = (map: string): GameSaveV1 => ({ format: "island-settlers-game", map,
  progress: { fog: { length: 0, packed: "" }, surveyed: [] }, savedAt: 10,
  settlement: { storagePools: { version: 1 as const, nextId: 0, pools: [] } } as unknown as GameSaveV1["settlement"],
  version: 4 });
const homeFiled = (): Archipelago => ({ ...emptyArchipelago(), campaign: { ...marker }, home: save("home") });

/** The run's soldiers as its save lists them: player shields/archer and one enemy. */
const runSoldiers = [
  { combat: { faction: 0, hp: 40, type: "shield" }, rank: 2 },
  { combat: { faction: 0, hp: 50, type: "shield" }, rank: 0 },
  { combat: { faction: 0, hp: 60, type: "shield" }, rank: 3 },
  { combat: { faction: 0, hp: 30, type: "archer" }, rank: 0 },
  { combat: { faction: 1, hp: 90, type: "heavy" }, rank: 0 }
];
const simulation = { adventure: () => undefined, campaignSettlers: () => 4, colony: () => undefined,
  colonyExpeditions: () => [],
  gameNow: () => Date.UTC(2026, 10, 11),
  saveState: () => ({ military: { soldiers: runSoldiers } }) } as unknown as SettlementSimulation;

type Report = (id: string, end: string, exit?: string) => Promise<CampaignEndReport | string>;
const STORED: CampaignEndReport = { campaignCompleted: false };

const runSession = (run: CampaignRunState, report?: Report) => {
  const memory = createMemorySaveStore(), notices: string[] = [], reports: string[] = [];
  const stored: CampaignEndReport[] = [];
  let flushes = 0, reloads = 0;
  const travel = createArchipelagoSession({ campaignRun: run, capture: async () => save("run"),
    flushHomeClaims: async () => { flushes++; },
    initial: homeFiled(), notify: text => notices.push(text), onCampaignEndReported: (_run, report) => {
      stored.push(report);
    }, reload: () => { reloads++; },
    reportCampaignEnd: async (id, end, exit) => {
      reports.push([id, end, ...(exit === undefined ? [] : [exit])].join(":"));
      return report ? report(id, end, exit) : STORED;
    },
    simulation, store: memory.store, transition: createSessionLifecycle() });
  const booted = () => JSON.parse(memory.values.get("startup") ?? "null") as GameSaveV1 | null;
  return { booted, flushes: () => flushes, memory, notices, reloads: () => reloads, reports, stored, travel };
};

const started = (fields: Partial<CampaignRunState> = {}) =>
  ({ ...createCampaignRunState(marker, { attemptId: "attempt-7", shippedSettlers: 3, shippedSoldiers: SHIPPED }),
    ...fields });

describe("campaign run survivors (C9a)", () => {
  it("returns nothing after a defeat, else at most the shipped count per type, lowest rank first", () => {
    const alive = [troop("shield", 2), troop("shield"), troop("shield", 3), troop("archer"), troop("heavy")];
    expect(campaignRunSurvivors({ shippedSoldiers: SHIPPED }, "defeat", alive)).toEqual([]);
    expect(campaignRunSurvivors({ shippedSoldiers: SHIPPED }, "giveUp", alive))
      .toEqual([troop("shield", 2), troop("shield"), troop("archer")]);
    expect(campaignRunSurvivors({}, "victory", alive)).toEqual([]);
  });

  it("removes the marker and queues the survivors for home", () => {
    const group = { ...homeFiled(), returning: [troop("heavy")] };
    const ended = endCampaignRunGroup(group, { settlers: 0, soldiers: [troop("shield")] });
    expect(ended.campaign).toBeUndefined();
    expect(ended.returning).toEqual([troop("heavy"), troop("shield")]);
    expect(endCampaignRunGroup(homeFiled(), { settlers: 0, soldiers: [] }).returning).toBeUndefined();
  });

  it("sends home the living settlers, at most the shipped count, none after a defeat (C9b)", () => {
    expect(campaignRunSettlers({ shippedSettlers: 5 }, "victory", 3)).toBe(3);
    expect(campaignRunSettlers({ shippedSettlers: 5 }, "giveUp", 9)).toBe(5);
    expect(campaignRunSettlers({ shippedSettlers: 5 }, "defeat", 9)).toBe(0);
    expect(campaignRunSettlers({}, "victory", 9)).toBe(0);
    const group = { ...homeFiled(), returningSettlers: 2 };
    expect(endCampaignRunGroup(group, { settlers: 3, soldiers: [] }).returningSettlers).toBe(5);
    expect(campaignRunStateError(started({ shippedSettlers: 0 }))).toBe("Invalid campaign run");
  });

  it("keeps the attempt fields valid in the run save, the map status defaulting to available", () => {
    const run = started({ mapStatus: "completed" });
    expect(campaignRunStateError(run)).toBeNull();
    expect(campaignRunMapStatus(run)).toBe("completed");
    expect(campaignRunMapStatus(createCampaignRunState(marker))).toBe("available");
    expect(campaignRunStateError({ ...run, mapStatus: "notAvailable" })).toBe("Invalid campaign run");
    expect(campaignRunStateError({ ...run, shippedSoldiers: [{ amount: 0, type: "shield" }] }))
      .toBe("Invalid campaign run");
    expect(campaignRunStateError({ ...run, attemptId: "" })).toBe("Invalid campaign run");
  });
});

describe("campaign run exit (BR2)", () => {
  it("takes the exit of a victory only and names it in a victory report only", () => {
    const won = campaignRunWithOutcome(started(), { exit: "exit-1", kind: "victory" });
    expect(won).toMatchObject({ exit: "exit-1", status: "won" });
    expect(campaignRunEndExit(won, "victory")).toBe("exit-1");
    expect(campaignRunEndExit(won, "giveUp")).toBeUndefined();
    expect(campaignRunEndExit(campaignRunWithOutcome(started(), { kind: "victory" }), "victory")).toBeUndefined();
    const lost = campaignRunWithOutcome(started(), { exit: "exit-1", kind: "defeat" });
    expect(lost.status).toBe("lost");
    expect("exit" in lost).toBe(false);
  });

  it("validates the stored exit: a named exit of a won run only", () => {
    const won = started({ exit: "exit-1", status: "won" });
    expect(campaignRunStateError(won)).toBeNull();
    expect(campaignRunStateError({ ...won, status: "running" })).toBe("Invalid campaign run");
    expect(campaignRunStateError({ ...won, status: "lost" })).toBe("Invalid campaign run");
    expect(campaignRunStateError({ ...won, exit: "victory" })).toBe("Invalid campaign run");
    expect(campaignRunStateError({ ...won, exit: "exit 1" })).toBe("Invalid campaign run");
    expect(campaignRunStateError({ ...won, exit: 3 })).toBe("Invalid campaign run");
  });
});

describe("ending a campaign run (C9a)", () => {
  it("gives up a running map: the shipped survivors sail home and the home island boots", async () => {
    const session = runSession(started());
    expect(await session.travel.endCampaignRun()).toBe(true);
    expect(session.reports).toEqual(["attempt-7:giveUp"]);
    const home = session.booted()!;
    expect(home.map).toBe("home");
    expect(home.archipelago?.campaign).toBeUndefined();
    expect(home.archipelago?.active).toBeNull();
    expect(home.archipelago?.returning?.map(entry => `${entry.type}/${entry.rank}`))
      .toEqual(["shield/2", "shield/0", "archer/0"]);
    expect(home.archipelago?.returningSettlers).toBe(3);
    expect(session.memory.games.at(-1)?.archipelago?.campaign).toBeUndefined();
    expect(session.reloads()).toBe(1);
  });

  it("brings nothing home after a lost map (landing harbour fallen)", async () => {
    const session = runSession(started());
    session.travel.recordCampaignOutcome({ kind: "defeat", reason: "harbourLost", tick: 40 });
    session.travel.recordCampaignOutcome({ kind: "victory", reason: "script", tick: 41 });
    expect(session.travel.campaignRun()?.status).toBe("lost");
    expect(await session.travel.endCampaignRun()).toBe(true);
    expect(session.reports).toEqual(["attempt-7:defeat"]);
    expect(session.booted()!.archipelago?.returning).toBeUndefined();
    expect(session.booted()!.archipelago?.returningSettlers).toBeUndefined();
  });

  it("keeps a won map on screen while the server cannot be reached, and leaves after a refusal", async () => {
    const offline = runSession(started(), async () => { throw new Error("offline"); });
    offline.travel.recordCampaignOutcome({ kind: "victory", reason: "script", tick: 9 });
    expect(await offline.travel.endCampaignRun()).toBe(false);
    expect(offline.booted()).toBeNull();
    expect(offline.notices).toHaveLength(1);
    const refused = runSession(started(), async () => "This campaign attempt has already ended");
    refused.travel.recordCampaignOutcome({ kind: "victory", reason: "script", tick: 9 });
    expect(await refused.travel.endCampaignRun()).toBe(true);
    expect(refused.notices).toEqual(["This campaign attempt has already ended"]);
    expect(refused.booted()!.archipelago?.returning).toHaveLength(3);
  });

  it("offers held home claims again once the server stored the victory, never after a give-up (C9b)", async () => {
    const won = runSession(started());
    won.travel.recordCampaignOutcome({ kind: "victory", reason: "rule", tick: 20 });
    expect(await won.travel.endCampaignRun()).toBe(true);
    expect(won.flushes()).toBe(1);
    const offline = runSession(started(), async () => { throw new Error("offline"); });
    offline.travel.recordCampaignOutcome({ kind: "victory", reason: "rule", tick: 20 });
    expect(await offline.travel.endCampaignRun()).toBe(false);
    expect(offline.flushes()).toBe(0);
    const given = runSession(started());
    expect(await given.travel.endCampaignRun()).toBe(true);
    expect(given.flushes()).toBe(0);
  });

  it("keeps the exit of a script victory on the run and reports it; the implicit exit sends none (BR2)", async () => {
    const named = runSession(started());
    named.travel.recordCampaignOutcome({ exit: "exit-2", kind: "victory", reason: "script", tick: 30 });
    named.travel.recordCampaignOutcome({ exit: "exit-1", kind: "victory", reason: "script", tick: 31 });
    expect(named.travel.campaignRun()).toMatchObject({ exit: "exit-2", status: "won" });
    expect(campaignRunStateError(named.travel.campaignRun())).toBeNull();
    expect(await named.travel.endCampaignRun()).toBe(true);
    expect(named.reports).toEqual(["attempt-7:victory:exit-2"]);
    const implicit = runSession(started());
    implicit.travel.recordCampaignOutcome({ kind: "victory", reason: "rule", tick: 30 });
    expect("exit" in implicit.travel.campaignRun()!).toBe(false);
    expect(await implicit.travel.endCampaignRun()).toBe(true);
    expect(implicit.reports).toEqual(["attempt-7:victory"]);
  });

  it("retries a won run's report with the same exit after the server was unreachable (BR2)", async () => {
    let online = false;
    const session = runSession(started(), async () => {
      if (!online) throw new Error("offline");
      return STORED;
    });
    session.travel.recordCampaignOutcome({ exit: "exit-1", kind: "victory", reason: "script", tick: 9 });
    expect(await session.travel.endCampaignRun()).toBe(false);
    online = true;
    expect(await session.travel.endCampaignRun()).toBe(true);
    expect(session.reports).toEqual(["attempt-7:victory:exit-1", "attempt-7:victory:exit-1"]);
  });

  it("hands the stored path facts on, and a refusal to the notice (BR4)", async () => {
    const pathKept = { campaignCompleted: false, exit: "exit-1", pathExit: "victory" };
    const session = runSession(started(), async () => pathKept);
    session.travel.recordCampaignOutcome({ exit: "exit-1", kind: "victory", reason: "script", tick: 9 });
    expect(await session.travel.endCampaignRun()).toBe(true);
    expect(session.stored).toEqual([pathKept]);
    const refused = runSession(started(), async () => "This campaign attempt has already ended");
    expect(await refused.travel.endCampaignRun()).toBe(true);
    expect(refused.stored).toEqual([]);
    expect(refused.notices).toContain("This campaign attempt has already ended");
  });

  it("does not report a guest's attempt (no server attempt id)", async () => {
    const session = runSession(createCampaignRunState(marker, { shippedSoldiers: SHIPPED }));
    expect(await session.travel.endCampaignRun()).toBe(true);
    expect(session.reports).toEqual([]);
  });
});

describe("attempt end request (BR2)", () => {
  it("sends the exit field only for a victory through a named exit, so other ends keep the old body", async () => {
    const bodies: unknown[] = [];
    const fetch = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      return new Response(JSON.stringify({ attemptId: "a", campaignCompleted: false, exit: "exit-1",
        mapStatus: "completed", outcome: "victory", pathExit: "exit-1" }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const client = createEconomyClient({ apiUrl: "http://127.0.0.1:3002", fetch, getAccessToken: async () => "t" });
    expect(await client.endCampaignAttempt("a", "victory", "exit-1")).toMatchObject({ exit: "exit-1", ok: true });
    await client.endCampaignAttempt("a", "victory");
    await client.endCampaignAttempt("a", "giveUp");
    await client.endCampaignAttempt("a", "defeat", "exit-1");
    expect(bodies).toEqual([{ exit: "exit-1", outcome: "victory" }, { outcome: "victory" }, { outcome: "giveUp" },
      { outcome: "defeat" }]);
  });
});

describe("campaign settlers at home (C9b, R15)", () => {
  it("stores returning settlers in the home building up to the people limit; the rest are lost", () => {
    const home = edgeBaySettlement();
    const { limit, people } = home.population();
    const room = limit! - people;
    expect(room).toBeGreaterThan(0);
    const idle = home.home()!.idleSettlers ?? 0;
    expect(home.receiveSettlers(room + 3)).toEqual({ lost: 3, stored: room });
    expect(home.home()!.idleSettlers).toBe(idle + room);
    expect(home.population().people).toBe(limit);
    expect(home.receiveSettlers(2)).toEqual({ lost: 2, stored: 0 });
    // Soldiers return in full: above the people limit they wait in the HQ reserve (owner Q3 follow-up).
    home.receiveTroops([troop("shield"), troop("archer")]);
    expect(home.militarySoldiers()).toHaveLength(2);
    expect(home.population().people).toBe(limit! + 2);
  });
});
