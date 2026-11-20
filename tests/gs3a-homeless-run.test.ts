import { describe, expect, it } from "vitest";

import {
  campaignGraphOf, campaignMapStatuses, campaignNodeView
} from "../../island-of-settlers-shared/src/campaign/campaign-graph";
import {
  type Campaign, type CampaignMap, createCampaign, createCampaignMap
} from "../../island-of-settlers-shared/src/campaign/campaign-model";
import {
  cloneGameSettings, DEFAULT_ONLINE_SETTINGS, GAME_SETTINGS_PRESETS
} from "../../island-of-settlers-shared/src/game-settings/game-settings";
import { browserSessionRules } from "../src/app/game-settings/browser-session-rules";
import { createSessionLifecycle } from "../src/app/session-lifecycle";
import { createArchipelagoSession } from "../src/app/settlement/archipelago-session";
import { buildHomelessRunGame } from "../src/app/settlement/campaign-homeless-run";
import type { HomelessRunEnd } from "../src/app/settlement/campaign-run-end";
import { skipOfflineProgress } from "../src/app/settlement/offline-progress";
import { homelessLaunchBlock } from "../src/shared/campaign/campaign-requirements";
import { campaignRunWithOutcome } from "../src/shared/campaign/campaign-run-end";
import { advanceAroundCampaignRun, catchUpSubject, isHomelessRun } from "../src/shared/campaign/campaign-run-game";
import { homelessRunEndProgress } from "../src/shared/campaign/homeless-run";
import { localCampaignProgressOf } from "../src/shared/campaign/local-campaign-progress";
import { landingAfterRun } from "../src/shared/campaign/run-landing";
import type { PlayerProgress } from "../src/shared/progression/player-progress";
import { createPlayerProgress, validatePlayerProgress } from "../src/shared/progression/player-progress";
import { readGameSave } from "../src/shared/settlement/game-save";
import { composeGameSave, splitGameSave } from "../src/shared/settlement/game-save-rows";
import type { SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { createMapScenario } from "../src/shared/world/map-scenario";
import type { LoadedMap } from "../src/shared/world/save/map-reader";
import { bayHarbourPlot, bayWorld } from "./helpers/campaign-bay-world";
import { createMemorySaveStore } from "./memory-save-store";

const NOW = 1_800_000_000_000;
const STORY = GAME_SETTINGS_PRESETS.story;
const STORY_RULES = browserSessionRules(STORY, false)!;

const campaignMap = (id: string): CampaignMap => ({
  ...createCampaignMap(id, "isles", { hash: null, id: `slot-${id}` }), state: "ready",
  unlock: id === "first" ? [{ kind: "playerLevel", level: 2 }] : [{ kind: "previousMapCompleted" }]
});
const campaign = (): Campaign => ({ ...createCampaign("isles"), mapIds: ["first", "second"], state: "ready" });
const loadedMap = (startSetup?: "off"): LoadedMap => {
  const world = bayWorld();
  world.scenario = { ...createMapScenario(), harbourPlot: bayHarbourPlot(), kind: "campaign",
    ...(startSetup ? { startSetup } : {}) };
  return { animals: [], meta: { name: "Bay", savedAt: 0, source: "generated" }, terrain: null, world };
};
const startRun = (startSetup?: "off") => buildHomelessRunGame({ loaded: loadedMap(startSetup),
  map: campaignMap("first"), nation: "roman", now: NOW, player: createPlayerProgress(7), rules: STORY_RULES });

describe("a campaign run without a home island (GS3a, rev H1)", () => {
  it("starts from the map's own setup with the session rules pinned and no filed home", async () => {
    const game = await startRun();
    expect(game.settlement.gameRules).toEqual(STORY_RULES);
    expect(game.archipelago).toEqual({ active: null, colonies: [], version: 1,
      campaign: { attempt: 1_800_000_000, campaignId: "isles", mapId: "first", runCreatedAt: NOW } });
    expect(game.campaignRun?.rewards).toBeUndefined();
    expect(isHomelessRun(game)).toBe(true);
    const empty = await startRun("off");
    expect(empty.settlement.buildings.flatMap(building => Object.values(building.inventory ?? {}))
      .every(amount => amount === 0)).toBe(true);
  });

  it("stores as a run row only and reads back; a run without pinned no-home rules is still refused", async () => {
    const game = await startRun();
    const rows = splitGameSave(game);
    expect(rows.islands).toEqual([]);
    expect(rows.campaignRuns).toHaveLength(1);
    const composed = composeGameSave(rows)!;
    await expect(readGameSave(composed)).resolves.toMatchObject({ campaignRun: { mapId: "first" } });
    const { gameRules: _rules, ...unpinned } = composed.settlement;
    await expect(readGameSave({ ...composed, settlement: unpinned }))
      .rejects.toThrow("The campaign run has no filed home island");
  });

  it("never catches up or skips time: the run keeps its own clock", async () => {
    const game = await startRun();
    expect(catchUpSubject(game)).toBe(game);
    let advanced = false;
    await expect(advanceAroundCampaignRun(game, async save => { advanced = true; return save; }))
      .resolves.toBe(game);
    expect(advanced).toBe(false);
    expect(skipOfflineProgress(game, NOW + 3_600_000)).toEqual({ awaySeconds: 0, endedColonies: [], save: game });
  });

  it("a victory records the exit once, opens the next map per the graph; a defeat records nothing", async () => {
    const run = (await startRun()).campaignRun!;
    const player = createPlayerProgress(7);
    const won = homelessRunEndProgress(campaignRunWithOutcome(run, { kind: "victory" }), player);
    expect(won.campaignProgress).toEqual({ isles: { first: { exit: "victory" } } });
    expect(validatePlayerProgress(won)).toBe(true);
    const again = homelessRunEndProgress(campaignRunWithOutcome(run, { exit: "north", kind: "victory" }), won);
    expect(again.campaignProgress).toEqual(won.campaignProgress);
    expect(homelessRunEndProgress(campaignRunWithOutcome(run, { kind: "defeat" }), player)).toBe(player);
    const maps = new Map([["first", campaignMap("first")], ["second", campaignMap("second")]]);
    const graph = campaignGraphOf(campaign(), maps);
    const before = campaignMapStatuses(graph, maps, localCampaignProgressOf(player.campaignProgress, "isles"));
    const after = campaignMapStatuses(graph, maps, localCampaignProgressOf(won.campaignProgress, "isles"));
    expect([...after]).toEqual([["first", "completed"], ["second", "available"]]);
    expect(campaignNodeView(graph, maps, localCampaignProgressOf(won.campaignProgress, "isles")).completed)
      .toBe(false);
    expect(landingAfterRun(STORY, { campaignId: "isles", status: "won" }, before, after))
      .toEqual({ campaignId: "isles", forked: false, kind: "exitChoice", nextMapId: "second" });
  });

  it("refuses invalid local progress", () => {
    const player = { ...createPlayerProgress(1), campaignProgress: { isles: { first: { exit: "bad exit!" } } } };
    expect(validatePlayerProgress(player)).toBe(false);
  });

  it("launches gated by the effective level only", () => {
    expect(homelessLaunchBlock(2, 1)).toBe("Unlocks at player level 2");
    expect(homelessLaunchBlock(2, 2)).toBeNull();
    expect(homelessLaunchBlock(undefined, 1)).toBeNull();
  });
});

describe("landing after a run (plan §7.6)", () => {
  const statuses = (entries: [string, "available" | "completed" | "notAvailable"][]) => new Map(entries);
  const before = statuses([["a", "available"], ["b", "notAvailable"], ["c", "notAvailable"]]);
  const run = { campaignId: "isles", status: "won" as const };

  it("home sails home; campaign selection opens the selection", () => {
    expect(landingAfterRun(DEFAULT_ONLINE_SETTINGS, run, before, before)).toEqual({ kind: "home" });
    const select = cloneGameSettings(STORY);
    select.afterMap = "campaignSelect";
    expect(landingAfterRun(select, run, before, before)).toEqual({ campaignId: "isles", kind: "selection" });
  });

  it("the dialog offers Next map for one new map, Choose your path for a fork, neither at the end", () => {
    const fork = statuses([["a", "completed"], ["b", "available"], ["c", "available"]]);
    expect(landingAfterRun(STORY, run, before, fork))
      .toEqual({ campaignId: "isles", forked: true, kind: "exitChoice", nextMapId: null });
    const done = statuses([["a", "completed"], ["b", "notAvailable"], ["c", "notAvailable"]]);
    expect(landingAfterRun(STORY, run, before, done))
      .toEqual({ campaignId: "isles", forked: false, kind: "exitChoice", nextMapId: null });
  });

  it("a defeat or give-up never opens a map: the selection without a home, home with one", () => {
    for (const status of ["lost", "given-up"] as const) {
      expect(landingAfterRun(STORY, { ...run, status }, before, before))
        .toEqual({ campaignId: "isles", kind: "selection" });
      expect(landingAfterRun(DEFAULT_ONLINE_SETTINGS, { ...run, status }, before, before)).toEqual({ kind: "home" });
    }
  });
});

describe("ending a run without a home in the session (GS3a)", () => {
  const simulation = { adventure: () => undefined, campaignSettlers: () => 4, colony: () => undefined,
    colonyExpeditions: () => [], gameNow: () => NOW,
    saveState: () => ({ military: { soldiers: [] } }) } as unknown as SettlementSimulation;

  it("records the exit, boots nothing and hands the progress to the landing", async () => {
    const game = await startRun();
    const left: PlayerProgress[] = [];
    const memory = createMemorySaveStore();
    const ends: HomelessRunEnd[] = [];
    const travel = createArchipelagoSession({
      campaignRun: campaignRunWithOutcome(game.campaignRun!, { exit: "north", kind: "victory" }),
      capture: async () => game, initial: game.archipelago,
      leaveWithoutHome: async (player, ended) => { left.push(player); ends.push(ended); },
      notify: () => {}, player: () => createPlayerProgress(7), reload: () => {}, simulation, store: memory.store,
      transition: createSessionLifecycle()
    });
    await expect(travel.endCampaignRun()).resolves.toBe(true);
    expect(left.map(player => player.campaignProgress)).toEqual([{ isles: { first: { exit: "north" } } }]);
    // GS3b: the landing learns the run's end and the progress before it.
    expect(ends.map(({ before, run }) => [run.status, before.campaignProgress])).toEqual([["won", undefined]]);
    expect(memory.values.get("startup")).toBeUndefined();
  });
});
