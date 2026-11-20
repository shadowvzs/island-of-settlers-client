import { describe, expect, it, vi } from "vitest";

import {
  cloneGameSettings, DEFAULT_ONLINE_SETTINGS, GAME_SETTINGS_PRESETS, type GameSettings
} from "../../island-of-settlers-shared/src/game-settings/game-settings";
import { changeLines } from "../src/app/admin/settings/confirmation-helpers";
import { sameSettings, storedSwitch, switchState, withPreset, withSwitch } from "../src/app/admin/settings/helpers";
import { settingsViewModel } from "../src/app/admin/settings/view-model";
import { hasTitlePage, wantsTitlePage } from "../src/app/game-settings/session-mode";
import { reloadPage, takeInSessionReload } from "../src/app/page-reload";
import { createGameSectionOptions } from "../src/app/settings/game-section/game-section-options";
import { titleEntries } from "../src/app/title/helpers";

/** The owner's "Show the game menu before play" switch (2026-11-13): gate, admin row and Exit game. */
type Stored = "absent" | "off" | "on";
const STORED: readonly Stored[] = ["absent", "on", "off"];

const settingsOf = (online: boolean, home: boolean, stored: Stored): GameSettings => {
  const settings = cloneGameSettings(DEFAULT_ONLINE_SETTINGS);
  if (!online) settings.connectivity = "offline";
  if (!home) Object.assign(settings, { afterMap: "exitChoice", start: { place: "campaignSelect" } });
  if (stored !== "absent") settings.menuBeforePlay = stored === "on";
  return settings;
};
const ONLINE_HOME = settingsOf(true, true, "absent");
const ONLINE_HOME_OFF = settingsOf(true, true, "off");
const view = (settings: GameSettings) => settingsViewModel(undefined as never, settings, "server").titlePage;
const exitGameOffered = (settings: GameSettings | null) => createGameSectionOptions({
  account: null, backend: "indexeddb", cloud: null, container: {} as HTMLElement, i18n: undefined as never,
  offlineCloud: null, saving: null, settings
})?.options.exitGame !== undefined;

describe("the title page gate", () => {
  it("online with a home follows the switch; absent reads as on", () => {
    expect(STORED.map(stored => hasTitlePage(settingsOf(true, true, stored)))).toEqual([true, true, false]);
  });

  it("without a home or offline the title page always exists, whatever the switch says", () => {
    for (const stored of STORED) {
      expect(hasTitlePage(settingsOf(true, false, stored))).toBe(true);
      expect(hasTitlePage(settingsOf(false, true, stored))).toBe(true);
      expect(hasTitlePage(settingsOf(false, false, stored))).toBe(true);
    }
  });

  it("no settings (tool runs, a build that knows none) keep booting straight into the island", () => {
    expect(hasTitlePage(null)).toBe(false);
    expect(wantsTitlePage(null, "", false)).toBe(false);
    expect(wantsTitlePage(null, "?title=1", false)).toBe(true);
  });

  it("the boot shows it on a plain launch only: never in tool runs, on ?map=/?seed= or after ?continue=1", () => {
    expect(wantsTitlePage(ONLINE_HOME, "", false)).toBe(true);
    expect(wantsTitlePage(ONLINE_HOME, "?lang=hu", false)).toBe(true);
    expect(wantsTitlePage(ONLINE_HOME, "", true)).toBe(false);
    expect(wantsTitlePage(ONLINE_HOME, "?seed=7", false)).toBe(false);
    expect(wantsTitlePage(ONLINE_HOME, "?map=bay", false)).toBe(false);
    expect(wantsTitlePage(ONLINE_HOME, "?world=1", false)).toBe(false);
    expect(wantsTitlePage(ONLINE_HOME, "?continue=1", false)).toBe(false);
    expect(wantsTitlePage(ONLINE_HOME_OFF, "", false)).toBe(false);
    expect(wantsTitlePage(ONLINE_HOME_OFF, "?title=1", false)).toBe(true);
  });

  it("a reload of the running game (voyage, new island, detail level) never shows it", () => {
    for (const settings of [ONLINE_HOME, settingsOf(false, true, "absent"), settingsOf(true, false, "absent")])
      expect(wantsTitlePage(settings, "", false, true)).toBe(false);
    const session = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => session.get(key) ?? null,
      removeItem: (key: string) => session.delete(key),
      setItem: (key: string, value: string) => session.set(key, value)
    });
    vi.stubGlobal("location", { reload: () => undefined });
    try {
      expect(takeInSessionReload()).toBe(false);
      reloadPage();
      expect(takeInSessionReload()).toBe(true);
      expect(takeInSessionReload()).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(takeInSessionReload()).toBe(false);
  });
});

describe("the title menu of an online home game", () => {
  it("offers Continue and Settings with a game, New game and Settings without one (no slots: D2)", () => {
    const ids = (hasSavedGame: boolean) =>
      titleEntries({ hasSavedGame, settings: ONLINE_HOME }).map(entry => [entry.id, entry.disabled]);
    expect(ids(true)).toEqual([["continue", false], ["settings", false]]);
    expect(ids(false)).toEqual([["newGame", false], ["settings", false]]);
  });
});

describe("the admin switch", () => {
  it("is an enabled, checked toggle with a tooltip on today's settings and stores the admin's choice", () => {
    expect(view(ONLINE_HOME).menuBeforePlay)
      .toMatchObject({ checked: true, disabled: false, key: "menuBeforePlay", reason: "" });
    const off = withSwitch(ONLINE_HOME, "menuBeforePlay", false);
    expect(off.menuBeforePlay).toBe(false);
    expect(ONLINE_HOME.menuBeforePlay).toBeUndefined();
    expect(view(off).menuBeforePlay).toMatchObject({ checked: false, disabled: false });
    expect(sameSettings(ONLINE_HOME, off)).toBe(false);
    expect(withSwitch(off, "menuBeforePlay", true).menuBeforePlay).toBe(true);
  });

  it("is disabled and checked without a home island, with the reason; the stored value is kept", () => {
    const noHome = withSwitch(ONLINE_HOME_OFF, "homeIsland", false);
    expect(view(noHome).menuBeforePlay).toMatchObject({
      checked: true, disabled: true, reason: "Without a home island the game menu is always shown."
    });
    expect(storedSwitch(noHome, "menuBeforePlay")).toBe(false);
    expect(view(withSwitch(noHome, "homeIsland", true)).menuBeforePlay)
      .toMatchObject({ checked: false, disabled: false, reason: "" });
  });

  it("is disabled and checked offline, where the menu holds Continue, Load and New game", () => {
    const state = switchState(settingsOf(false, true, "off"), "menuBeforePlay");
    expect(state).toMatchObject({ checked: true, disabled: true });
    expect(state.reason).toMatch(/^Offline games always start from the game menu/);
  });

  it("survives a preset like the title files and asks before a save the players notice", () => {
    expect(withPreset(ONLINE_HOME_OFF, "onlineSettlement", true).menuBeforePlay).toBe(false);
    expect(withPreset(ONLINE_HOME, "onlineSettlement", true)).toEqual(GAME_SETTINGS_PRESETS.onlineSettlement);
    expect(changeLines(ONLINE_HOME, ONLINE_HOME_OFF).map(line => line.id)).toEqual(["menuBeforePlayOff"]);
    expect(changeLines(ONLINE_HOME_OFF, ONLINE_HOME).map(line => line.id)).toEqual(["menuBeforePlayOn"]);
  });
});

describe("Exit game (Settings > Misc > Game)", () => {
  it("is offered wherever the title page exists", () => {
    expect(exitGameOffered(ONLINE_HOME)).toBe(true);
    expect(exitGameOffered(settingsOf(true, true, "on"))).toBe(true);
    expect(exitGameOffered(ONLINE_HOME_OFF)).toBe(false);
    expect(exitGameOffered(null)).toBe(false);
    for (const stored of STORED) {
      expect(exitGameOffered(settingsOf(true, false, stored))).toBe(true);
      expect(exitGameOffered(settingsOf(false, true, stored))).toBe(true);
      expect(exitGameOffered(settingsOf(false, false, stored))).toBe(true);
    }
  });
});
