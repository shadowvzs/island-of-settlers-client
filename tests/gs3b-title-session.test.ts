import { describe, expect, it } from "vitest";

import {
  type Campaign, type CampaignMap, createCampaign, createCampaignMap
} from "../../island-of-settlers-shared/src/campaign/campaign-model";
import {
  cloneGameSettings, GAME_SETTINGS_PRESETS, type GameSettings
} from "../../island-of-settlers-shared/src/game-settings/game-settings";
import { browserSessionRules } from "../src/app/game-settings/browser-session-rules";
import { NO_CAMPAIGN_START } from "../src/app/title/constants";
import { titleLandingRecord } from "../src/app/title/helpers";
import { createTitleSession, type TitleSessionOptions, type TitleSlot } from "../src/app/title/title-session";
import type { LocalCampaignProgress } from "../src/shared/campaign/local-campaign-progress";
import { createPlayerProgress } from "../src/shared/progression/player-progress";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { createMapScenario } from "../src/shared/world/map-scenario";
import type { LoadedMap } from "../src/shared/world/save/map-reader";
import { bayHarbourPlot, bayWorld } from "./helpers/campaign-bay-world";

const NOW = 1_800_000_000_000;
const STORY = GAME_SETTINGS_PRESETS.story;

const campaignMap = (id: string, unlock: CampaignMap["unlock"]): CampaignMap => ({
  ...createCampaignMap(id, "isles", { hash: null, id: `slot-${id}` }), state: "ready", unlock
});
const MAPS = [campaignMap("first", [{ kind: "playerLevel", level: 2 }]),
  campaignMap("second", [{ kind: "previousMapCompleted" }])];
const campaign = (): Campaign => ({ ...createCampaign("isles"), mapIds: ["first", "second"], state: "ready" });
const loadedMap = (): LoadedMap => {
  const world = bayWorld();
  world.scenario = { ...createMapScenario(), harbourPlot: bayHarbourPlot(), kind: "campaign" };
  return { animals: [], meta: { name: "Bay", savedAt: 0, source: "generated" }, terrain: null, world };
};
const SOURCES = {
  now: () => NOW,
  openRepositories: async () => ({
    campaigns: { list: async () => [campaign()] }, maps: { list: async () => MAPS }
  }),
  readMap: async () => ({ error: "", loaded: loadedMap() })
};

interface SlotFacts {
  campaignProgress?: LocalCampaignProgress;
  experience?: number;
  saved?: boolean;
}
const memorySlot = ({ campaignProgress, experience = 0, saved = false }: SlotFacts) => {
  const writes: GameSaveV1[] = [];
  const slot: TitleSlot = {
    hasSavedGame: async () => saved,
    readStoryProgress: async () => ({ ...createPlayerProgress(7), campaignProgress, experience }),
    writeSavedGame: async save => { writes.push(save); }
  };
  return { slot, writes };
};
const session = (
  settings: GameSettings, facts: SlotFacts = {}, landingJson: string | null = null,
  signedIn: Partial<Pick<TitleSessionOptions, "server" | "sources">> = {}
) => {
  const memory = memorySlot(facts);
  const opened = createTitleSession({ landingJson, nation: "roman", now: () => NOW, settings, slot: memory.slot,
    sources: SOURCES, ...signedIn });
  return { memory, opened };
};
const earnedLevels = (): GameSettings => {
  const settings = cloneGameSettings(STORY);
  settings.progression = { ...settings.progression, levels: { kind: "earned" } };
  return settings;
};

describe("title session (GS3b, plan §7.4)", () => {
  it("lists the ready campaign with the slot's progress and checks only the level", async () => {
    const { opened } = session(earnedLevels());
    const title = await opened;
    const [choice] = await title.port!.load();
    expect(choice?.maps.map(entry => [entry.map.id, entry.status])).toEqual([
      ["first", "available"], ["second", "notAvailable"]
    ]);
    expect(title.port!.requirements(MAPS[0]!).reason).toBe("Unlocks at player level 2");
    expect(title.port!.requirements(MAPS[0]!).lines).toEqual([]);
    await expect(title.port!.start(MAPS[0]!)).resolves.toBe("Unlocks at player level 2");
  });

  it("starts a map without a home: the run is written and the page may boot", async () => {
    const { memory, opened } = session(STORY);
    const title = await opened;
    await expect(title.port!.start(MAPS[0]!)).resolves.toBe(true);
    await expect(title.done).resolves.toBeUndefined();
    expect(memory.writes).toHaveLength(1);
    expect(memory.writes[0]?.campaignRun?.mapId).toBe("first");
    expect(memory.writes[0]?.settlement.gameRules?.homeIsland).toBe(false);
  });

  it("follows the narrowed campaign list of the settings", async () => {
    const narrowed = cloneGameSettings(STORY);
    narrowed.start = { campaignIds: ["other"], place: "campaignSelect" };
    const title = await session(narrowed).opened;
    await expect(title.port!.load()).resolves.toEqual([]);
  });

  it("has no campaign port with a home island", async () => {
    const title = await session(GAME_SETTINGS_PRESETS.offlineSettlement).opened;
    expect(title.port).toBeNull();
    await expect(title.landing()).resolves.toBeNull();
  });
});

describe("landing after a run without a home (plan §7.6)", () => {
  const won = { isles: { first: { exit: "victory" } } };
  const record = (status: "lost" | "won") => JSON.stringify(titleLandingRecord({ campaignId: "isles", status }, {}));

  it("a won map that opens exactly one map offers Next map", async () => {
    const title = await session(STORY, { campaignProgress: won }, record("won")).opened;
    await expect(title.landing()).resolves.toEqual({
      campaignId: "isles", forked: false, kind: "exitChoice", nextMapId: "second"
    });
    await expect(title.startMap("isles", "second")).resolves.toBe(true);
  });

  it("a replay that opens nothing new offers no Next map", async () => {
    const replay = JSON.stringify(titleLandingRecord({ campaignId: "isles", status: "won" }, won));
    const title = await session(STORY, { campaignProgress: won }, replay).opened;
    await expect(title.landing()).resolves.toMatchObject({ kind: "exitChoice", nextMapId: null });
  });

  it("a defeat, or the selection setting, opens the campaign selection", async () => {
    const lost = await session(STORY, {}, record("lost")).opened;
    await expect(lost.landing()).resolves.toEqual({ campaignId: "isles", kind: "selection" });
    const select = cloneGameSettings(STORY);
    select.afterMap = "campaignSelect";
    const selection = await session(select, { campaignProgress: won }, record("won")).opened;
    await expect(selection.landing()).resolves.toEqual({ campaignId: "isles", kind: "selection" });
  });

  it("without a stored record there is no landing", async () => {
    await expect((await session(STORY).opened).landing()).resolves.toBeNull();
  });
});

describe("a signed-in cloud slot without a home (ONLINE-STORY)", () => {
  const ATTEMPT = "5b0e4c1e-8f43-4b52-9a51-2d0f2d1f0a11";
  const ONLINE_STORY: GameSettings = { ...cloneGameSettings(STORY), connectivity: "online" };
  const leaseRules = browserSessionRules(ONLINE_STORY, false);
  /** The server answers the first map completed: the second opens, whatever the browser progress says. */
  const serverProgress = async () => ({ completed: false, edges: [], maps: [
    { exit: "victory", mapId: "first", node: "completed" as const, status: "completed" as const },
    { mapId: "second", node: "available" as const, status: "available" as const }
  ] });
  const signedIn = (startAttempt: NonNullable<TitleSessionOptions["server"]>["startAttempt"]) => ({
    server: { rules: leaseRules, startAttempt },
    sources: { ...SOURCES, economy: { campaignProgress: serverProgress } }
  });

  it("reads the server's progress and starts the run with the server attempt under the lease's rules", async () => {
    const asked: string[] = [];
    const title = await session(ONLINE_STORY, {}, null, signedIn(async (campaignId, mapId) => {
      asked.push(`${campaignId}/${mapId}`);
      return { attemptId: ATTEMPT, mapStatus: "available" };
    })).opened;
    const [choice] = await title.port!.load();
    expect(choice?.maps.map(entry => [entry.map.id, entry.status])).toEqual([
      ["first", "completed"], ["second", "available"]
    ]);
    expect(leaseRules?.homeIsland).toBe(false);
    await expect(title.port!.start(MAPS[1]!)).resolves.toBe(true);
    expect(asked).toEqual(["isles/second"]);
  });

  it("writes the attempt into the run; a server refusal or lease rules with a home start nothing", async () => {
    const accepted = session(ONLINE_STORY, {}, null,
      signedIn(async () => ({ attemptId: ATTEMPT, mapStatus: "available" })));
    await (await accepted.opened).port!.start(MAPS[1]!);
    expect(accepted.memory.writes[0]?.campaignRun).toMatchObject({ attemptId: ATTEMPT, mapId: "second" });
    expect(accepted.memory.writes[0]?.settlement.gameRules).toEqual(leaseRules);
    const refused = session(ONLINE_STORY, {}, null, signedIn(async () => "This campaign map is not available"));
    await expect((await refused.opened).port!.start(MAPS[1]!)).resolves.toBe("This campaign map is not available");
    expect(refused.memory.writes).toEqual([]);
    // A legacy (settlement) lease grants no rules document: nothing without a home can start.
    const homeRules = session(ONLINE_STORY, {}, null, { ...signedIn(undefined), server: { rules: undefined } });
    await expect((await homeRules.opened).port!.start(MAPS[1]!)).resolves.toBe(NO_CAMPAIGN_START);
  });

  it("an unreachable server starts an untracked attempt, as at home (C9a)", async () => {
    const offline = session(ONLINE_STORY, {}, null, signedIn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect((await offline.opened).port!.start(MAPS[1]!)).resolves.toBe(true);
    expect(offline.memory.writes[0]?.campaignRun?.attemptId).toBeUndefined();
  });

  it("tells the menu when the cloud slot holds a home island game", async () => {
    const memory = memorySlot({ saved: true });
    const title = await createTitleSession({ landingJson: null, nation: "roman", now: () => NOW,
      settings: ONLINE_STORY, slot: { ...memory.slot, holdsHomeGame: () => true }, sources: SOURCES });
    expect(title.slotHoldsHome).toBe(true);
    expect((await session(ONLINE_STORY).opened).slotHoldsHome).toBe(false);
  });
});
