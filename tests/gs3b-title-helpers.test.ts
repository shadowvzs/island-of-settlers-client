import { describe, expect, it } from "vitest";

import { MAX_PLAYER_LEVEL } from "../../island-of-settlers-shared/src/catalog/balance/levels";
import {
  cloneGameSettings, DEFAULT_ONLINE_SETTINGS, GAME_SETTINGS_PRESETS, type GameSettings
} from "../../island-of-settlers-shared/src/game-settings/game-settings";
import {
  offeredByTitle, parseTitleLanding, progressBeforeRun, titleBackgroundCandidates, titleEntries, titleFileUrl,
  titleLandingRecord, titleMediaKind, titleModeLabel, titleMusicCandidates, titlePlayerLevel
} from "../src/app/title/helpers";
import { createPlayerProgress } from "../src/shared/progression/player-progress";

const STORY = GAME_SETTINGS_PRESETS.story;
const OFFLINE_HOME = GAME_SETTINGS_PRESETS.offlineSettlement;
const onlineWithoutHome = (): GameSettings => {
  const settings = cloneGameSettings(DEFAULT_ONLINE_SETTINGS);
  settings.start = { place: "campaignSelect" };
  settings.afterMap = "exitChoice";
  return settings;
};
const ids = (entries: ReturnType<typeof titleEntries>) => entries.map(entry => entry.id);

describe("title menu entries per combination (plan §7.5)", () => {
  it("no home: Continue, Campaigns, the disabled Multiplayer maps placeholder (online only), Settings", () => {
    const entries = titleEntries({ hasSavedGame: true, settings: onlineWithoutHome() });
    expect(ids(entries)).toEqual(["continue", "campaigns", "multiplayer", "settings"]);
    expect(entries.find(entry => entry.id === "multiplayer")).toMatchObject({
      disabled: true, reason: "multiplayerPlanned"
    });
    expect(entries.filter(entry => entry.disabled)).toHaveLength(1);
    expect(ids(titleEntries({ hasSavedGame: true, settings: STORY }))).toEqual(["continue", "campaigns", "settings"]);
  });

  it("no home without a run: Continue is disabled with its reason", () => {
    const [first] = titleEntries({ hasSavedGame: false, settings: STORY });
    expect(first).toEqual({ disabled: true, id: "continue", reason: "continueNone" });
  });

  it("signed in without a home (ONLINE-STORY): Campaigns open; a slot holding a home game stays unused", () => {
    const entries = titleEntries({ hasSavedGame: false, settings: onlineWithoutHome() });
    expect(entries.find(entry => entry.id === "campaigns")).toMatchObject({ disabled: false, reason: null });
    const held = titleEntries({ hasSavedGame: true, settings: onlineWithoutHome(), slotHoldsHome: true });
    expect(ids(held)).toEqual(["continue", "campaigns", "multiplayer", "settings"]);
    expect(held.slice(0, 2).map(entry => entry.reason)).toEqual(["slotHoldsHome", "slotHoldsHome"]);
  });

  it("offline with a home: Continue (or New game without a save) and Settings, no campaigns", () => {
    expect(ids(titleEntries({ hasSavedGame: true, settings: OFFLINE_HOME })))
      .toEqual(["continue", "settings"]);
    expect(ids(titleEntries({ hasSavedGame: false, settings: OFFLINE_HOME })))
      .toEqual(["newGame", "settings"]);
    expect(ids(titleEntries({ hasSavedGame: true, settings: null }))).toEqual(["continue", "settings"]);
  });

  it("mode line: offline or online mode", () => {
    expect(titleModeLabel(STORY)).toBe("offline");
    expect(titleModeLabel(onlineWithoutHome())).toBe("online");
  });
});

describe("title files by convention", () => {
  it("probes video before images and the admin's valid name first", () => {
    expect(titleBackgroundCandidates(null)).toEqual([
      "title-background.webm", "title-background.mp4", "title-background.webp", "title-background.jpg",
      "title-background.png"
    ]);
    const settings = { ...STORY, titleScreen: { background: "dawn.jpg", music: "theme.mp3" } };
    expect(titleBackgroundCandidates(settings)[0]).toBe("dawn.jpg");
    expect(titleMusicCandidates(settings)).toEqual(["theme.mp3", "title-music.ogg", "title-music.mp3"]);
  });

  it("ignores names with a path or the wrong kind and never repeats a name", () => {
    const settings = { ...STORY, titleScreen: { background: "../x.png", music: "title-music.ogg" } };
    expect(titleBackgroundCandidates(settings)).toHaveLength(5);
    expect(titleMusicCandidates(settings)).toEqual(["title-music.ogg", "title-music.mp3"]);
  });

  it("shows videos as video, everything else as an image, under the base path", () => {
    expect(titleMediaKind("title-background.webm")).toBe("video");
    expect(titleMediaKind("x.MP4")).toBe("video");
    expect(titleMediaKind("x.webp")).toBe("image");
    expect(titleFileUrl("/game/", "title-music.ogg")).toBe("/game/title/title-music.ogg");
  });
});

describe("title campaigns and level", () => {
  it("offers every campaign unless the settings narrow the list", () => {
    expect(offeredByTitle(STORY, { id: "c1" })).toBe(true);
    const narrowed = { ...STORY, start: { campaignIds: ["c2"], place: "campaignSelect" as const } };
    expect(offeredByTitle(narrowed, { id: "c1" })).toBe(false);
    expect(offeredByTitle(narrowed, { id: "c2" })).toBe(true);
  });

  it("a fixed level wins; earned levels follow the slot's experience", () => {
    expect(titlePlayerLevel(STORY, null)).toBe(MAX_PLAYER_LEVEL);
    expect(titlePlayerLevel(onlineWithoutHome(), null)).toBe(1);
    const progress = { ...createPlayerProgress(1), experience: 1_000_000 };
    expect(titlePlayerLevel(onlineWithoutHome(), progress)).toBeGreaterThan(1);
  });
});

describe("landing record", () => {
  it("keeps the campaign's progress before the run and round-trips through JSON", () => {
    const record = titleLandingRecord({ campaignId: "c1", status: "won" }, { c1: { m1: { exit: "victory" } } });
    expect(parseTitleLanding(JSON.stringify(record))).toEqual(record);
    expect(progressBeforeRun(record, { c1: { m1: { exit: "victory" }, m2: { exit: "victory" } }, c2: {} }))
      .toEqual({ c1: { m1: { exit: "victory" } }, c2: {} });
  });

  it("refuses damaged records", () => {
    for (const json of [null, "", "{", "[]", '{"campaignId":"c","status":"running","before":{}}',
      '{"campaignId":"c","status":"won","before":{"m":{"exit":7}}}'])
      expect(parseTitleLanding(json)).toBeNull();
  });
});
