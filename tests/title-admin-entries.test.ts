import { describe, expect, it, vi } from "vitest";

import {
  cloneGameSettings, DEFAULT_ONLINE_SETTINGS, type GameSettings
} from "../../island-of-settlers-shared/src/game-settings/game-settings";
import { adminAuthoredMapUrl, adminSettingsUrl, mapEditorUrl } from "../src/app/admin-links";
import { isAdministrator, resolveDevelopmentAccess } from "../src/app/development-access";
import { isTitleAdminEntry, titleAdminActions, titleEntries } from "../src/app/title/helpers";

/** The administrator's title entries (owner 2026-11-13): Map editor and Server settings after Settings. */
const settingsOf = (online: boolean, home: boolean): GameSettings => {
  const settings = cloneGameSettings(DEFAULT_ONLINE_SETTINGS);
  if (!online) settings.connectivity = "offline";
  if (!home) Object.assign(settings, { afterMap: "exitChoice", start: { place: "campaignSelect" } });
  return settings;
};
const MODES = [true, false].flatMap(online => [true, false].map(home => ({ home, online })));
const ids = (entries: ReturnType<typeof titleEntries>) => entries.map(entry => entry.id);
const ADMIN_IDS = ["mapEditor", "serverSettings"];

describe("title admin entries", () => {
  it.each(MODES)("online=$online home=$home: an administrator gets both links after Settings", mode => {
    const facts = { hasSavedGame: true, settings: settingsOf(mode.online, mode.home) };
    const plain = titleEntries(facts);
    const admin = titleEntries({ ...facts, admin: true });
    expect(ids(plain).filter(id => ADMIN_IDS.includes(id))).toEqual([]);
    expect(titleEntries({ ...facts, admin: false })).toEqual(plain);
    expect(ids(admin)).toEqual([...ids(plain), ...ADMIN_IDS]);
    expect(ids(plain).at(-1)).toBe("settings");
    expect(admin.slice(-2).every(entry => !entry.disabled && entry.reason === null)).toBe(true);
  });

  it("also without settings, without a game and over a slot that holds a home game", () => {
    expect(ids(titleEntries({ admin: true, hasSavedGame: false, settings: null })))
      .toEqual(["newGame", "settings", ...ADMIN_IDS]);
    const held = titleEntries({ admin: true, hasSavedGame: true, settings: settingsOf(true, false),
      slotHoldsHome: true });
    expect(ids(held).slice(-3)).toEqual(["settings", ...ADMIN_IDS]);
  });

  it("only the two links count as the admin group", () => {
    const entries = titleEntries({ admin: true, hasSavedGame: true, settings: settingsOf(true, false) });
    expect(ids(entries).filter(isTitleAdminEntry)).toEqual(ADMIN_IDS);
  });

  it("only the signed-in administrator role counts, not a development build's guest", () => {
    expect(isAdministrator(resolveDevelopmentAccess({ devBuild: false, online: true, role: "admin" }))).toBe(true);
    expect(isAdministrator(resolveDevelopmentAccess({ devBuild: true, online: false }))).toBe(false);
    expect(isAdministrator(resolveDevelopmentAccess({ devBuild: true, online: true, role: "player" }))).toBe(false);
    expect(isAdministrator({ allowed: false, reason: "player-entry" })).toBe(false);
  });
});

describe("title admin links", () => {
  const HREF = "https://play.example/game/index.html?title=1&lang=hu#top";

  it("build the pages beside the current one, without its query", () => {
    expect(mapEditorUrl(HREF)).toBe("https://play.example/game/editor.html");
    expect(adminAuthoredMapUrl(HREF)).toBe("https://play.example/game/admin.html?world=1");
    expect(adminSettingsUrl(HREF)).toBe("https://play.example/game/admin.html?panel=settings");
    expect(mapEditorUrl("http://localhost:5173/")).toBe("http://localhost:5173/editor.html");
  });

  it("each entry opens its page in the same tab", () => {
    const page = { assign: vi.fn(), href: HREF };
    const actions = titleAdminActions(page);
    expect(Object.keys(actions)).toEqual(ADMIN_IDS);
    actions.mapEditor();
    expect(page.assign).toHaveBeenLastCalledWith("https://play.example/game/editor.html");
    actions.serverSettings();
    expect(page.assign).toHaveBeenLastCalledWith("https://play.example/game/admin.html?panel=settings");
    expect(page.assign).toHaveBeenCalledTimes(2);
  });
});
