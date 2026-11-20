import { describe, expect, it } from "vitest";

import { type CampaignMap, createCampaignMap } from "../../island-of-settlers-shared/src/campaign/campaign-model";
import { GAME_SETTINGS_PRESETS } from "../../island-of-settlers-shared/src/game-settings/game-settings";
import { browserSessionRules } from "../src/app/game-settings/browser-session-rules";
import { createSessionLifecycle } from "../src/app/session-lifecycle";
import { createArchipelagoSession } from "../src/app/settlement/archipelago-session";
import { buildHomelessRunGame } from "../src/app/settlement/campaign-homeless-run";
import { campaignRunWithOutcome } from "../src/shared/campaign/campaign-run-end";
import { createPlayerProgress, type PlayerProgress } from "../src/shared/progression/player-progress";
import type { SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SimRules } from "../src/shared/settlement/sim-rules";
import { createMapScenario } from "../src/shared/world/map-scenario";
import type { LoadedMap } from "../src/shared/world/save/map-reader";
import { bayHarbourPlot, bayWorld } from "./helpers/campaign-bay-world";
import { createMemorySaveStore } from "./memory-save-store";

/** ONLINE-STORY: a signed-in slot without a home island plays campaign maps with server attempts. */

const NOW = 1_800_000_000_000;
const ATTEMPT = "5b0e4c1e-8f43-4b52-9a51-2d0f2d1f0a11";
const STORY_RULES = browserSessionRules(GAME_SETTINGS_PRESETS.story, false)!;
const PAID_RULES: SimRules = { ...STORY_RULES, rewards: true };

const campaignMap = (): CampaignMap => ({
  ...createCampaignMap("first", "isles", { hash: null, id: "slot-first" }), state: "ready",
  rewards: { ...createCampaignMap("first", "isles", { hash: null, id: "slot-first" }).rewards, gems: 3 }
});
const loadedMap = (): LoadedMap => {
  const world = bayWorld();
  world.scenario = { ...createMapScenario(), harbourPlot: bayHarbourPlot(), kind: "campaign" };
  return { animals: [], meta: { name: "Bay", savedAt: 0, source: "generated" }, terrain: null, world };
};
const startRun = (rules: SimRules) => buildHomelessRunGame({ attempt: { attemptId: ATTEMPT, mapStatus: "available" },
  loaded: loadedMap(), map: campaignMap(), nation: "roman", now: NOW, player: createPlayerProgress(7), rules });

const simulation = { adventure: () => undefined, campaignSettlers: () => 0, colony: () => undefined,
  colonyExpeditions: () => [], gameNow: () => NOW,
  saveState: () => ({ military: { soldiers: [] } }) } as unknown as SettlementSimulation;

/** A won signed-in run ending in the session; records what reached the server and the landing. */
const endWonRun = async (rules: SimRules, claim: () => Promise<unknown>) => {
  const game = await startRun(rules);
  const calls: string[] = [], left: PlayerProgress[] = [];
  const travel = createArchipelagoSession({
    campaignRun: campaignRunWithOutcome(game.campaignRun!, { exit: "north", kind: "victory" }),
    capture: async () => game, initial: game.archipelago,
    claimCampaignVictory: async () => { calls.push("claim"); return await claim() as undefined; },
    leaveWithoutHome: async player => { calls.push("leave"); left.push(player); },
    notify: () => {}, player: () => createPlayerProgress(7), reload: () => {},
    reportCampaignEnd: async attemptId => { calls.push(`report ${attemptId}`); return { campaignCompleted: false }; },
    simulation, store: createMemorySaveStore().store, transition: createSessionLifecycle()
  });
  return { calls, ended: await travel.endCampaignRun(), game, left };
};

describe("a signed-in run without a home (ONLINE-STORY)", () => {
  it("starts with the server attempt and its rules pinned; rewards ride along only when the rules pay", async () => {
    const free = await startRun(STORY_RULES);
    expect(free.campaignRun).toMatchObject({ attemptId: ATTEMPT, mapStatus: "available" });
    expect(free.campaignRun?.rewards).toBeUndefined();
    expect(free.settlement.gameRules?.homeIsland).toBe(false);
    expect((await startRun(PAID_RULES)).campaignRun?.rewards?.gems).toBe(3);
  });

  it("rewards off: reports the attempt's end and leaves without any claim (no ledger row)", async () => {
    const { calls, ended, left } = await endWonRun(STORY_RULES, async () => undefined);
    expect(ended).toBe(true);
    expect(calls).toEqual([`report ${ATTEMPT}`, "leave"]);
    expect(left[0]?.campaignProgress).toEqual({ isles: { first: { exit: "north" } } });
  });

  it("rewards on: claims the victory (wallet kinds) before leaving; an unreachable claim keeps the map", async () => {
    const paid = await endWonRun(PAID_RULES, async () => ({ goods: {}, settlers: 0, soldiers: [] }));
    expect(paid.calls).toEqual([`report ${ATTEMPT}`, "claim", "leave"]);
    const offline = await endWonRun(PAID_RULES, async () => { throw new TypeError("Failed to fetch"); });
    expect(offline.ended).toBe(false);
    expect(offline.calls).toEqual([`report ${ATTEMPT}`, "claim"]);
  });
});
