import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cloneGameSettings, DEFAULT_ONLINE_SETTINGS, GAME_SETTINGS_PRESETS, type GameSettings
} from "../../island-of-settlers-shared/src/game-settings/game-settings";
import { localRulesRevision } from "../../island-of-settlers-shared/src/game-settings/sim-rules";
import { browserSessionRules } from "../src/app/game-settings/browser-session-rules";
import { browserWorkingSlot, coordinatorSaving } from "../src/app/game-settings/session-mode";
import {
  resolveBootGameSettings, type SettingsSourcePorts
} from "../src/app/game-settings/settings-source";
import { createSaveCoordinator, SAVE_DEBOUNCE_MS, type SaveReason } from "../src/app/save-store/save-coordinator";
import { fromSlotRows, toSlotRows } from "../src/app/settlement/game-slot-rows";
import { isOfflineGameFile } from "../src/app/settlement/settlement-save";
import { composeGameSave, type GameRows } from "../src/shared/settlement/game-save-rows";

const MINUTE = 60_000;
const STORY = GAME_SETTINGS_PRESETS.story;
const OFFLINE_HOME = GAME_SETTINGS_PRESETS.offlineSettlement;
const onlineWithoutHome = (): GameSettings => {
  const settings = cloneGameSettings(DEFAULT_ONLINE_SETTINGS);
  settings.start = { place: "campaignSelect" };
  settings.afterMap = "exitChoice";
  return settings;
};

/** In-memory ports; `server` undefined = no backend answers. */
const ports = (sources: { bundled?: unknown; cached?: string | null; server?: unknown }) => {
  const writes: string[] = [];
  const source: SettingsSourcePorts = {
    readBundled: async () => sources.bundled ?? null,
    readCached: async () => sources.cached ?? null,
    readServer: async () => {
      if (sources.server === undefined) throw new Error("offline");
      return sources.server;
    },
    writeCached: async json => { writes.push(json); }
  };
  return { source, writes };
};

describe("settings source before sign-in (plan §7.2 step 1)", () => {
  it("prefers the server and caches its answer", async () => {
    const { source, writes } = ports({ bundled: STORY, server: { revision: "r7", settings: OFFLINE_HOME } });
    const boot = await resolveBootGameSettings(source);
    expect(boot).toEqual({ origin: "server", revision: "r7", settings: OFFLINE_HOME });
    expect(JSON.parse(writes[0]!)).toEqual({ revision: "r7", settings: OFFLINE_HOME });
  });

  it("falls back to the cached copy, then the bundled file, then none", async () => {
    const cached = JSON.stringify({ revision: "r3", settings: STORY });
    expect(await resolveBootGameSettings(ports({ bundled: OFFLINE_HOME, cached }).source))
      .toEqual({ origin: "cached", revision: "r3", settings: STORY });
    expect(await resolveBootGameSettings(ports({ bundled: OFFLINE_HOME, cached: "{broken" }).source))
      .toEqual({ origin: "bundled", settings: OFFLINE_HOME });
    expect(await resolveBootGameSettings(ports({}).source)).toEqual({ origin: "none", settings: null });
  });

  it("ignores malformed or invalid documents from every source", async () => {
    const invalid = { ...cloneGameSettings(STORY), afterMap: "home" };
    const boot = await resolveBootGameSettings(ports({
      bundled: { version: 1 }, cached: JSON.stringify({ revision: 4, settings: STORY }),
      server: { revision: "r1", settings: invalid }
    }).source);
    expect(boot).toEqual({ origin: "none", settings: null });
  });
});

describe("browser session rules (rev I6): default or unknown settings keep legacy rules", () => {
  it("pins nothing for today's settings, unknown settings and every tool run", () => {
    expect(browserSessionRules(null, false)).toBeUndefined();
    expect(browserSessionRules(DEFAULT_ONLINE_SETTINGS, false)).toBeUndefined();
    const chatOff = cloneGameSettings(DEFAULT_ONLINE_SETTINGS);
    chatOff.online.chat = false;
    chatOff.saving = { autosave: true, autosaveMinutes: 9, slots: false };
    expect(browserSessionRules(chatOff, false)).toBeUndefined();
    expect(browserSessionRules(STORY, true)).toBeUndefined();
  });

  it("pins the simulated subset under a local revision when it differs", () => {
    const rules = browserSessionRules(onlineWithoutHome(), false)!;
    expect(rules.revision).toBe(localRulesRevision(onlineWithoutHome()));
    expect([rules.homeIsland, rules.catchUp]).toEqual([false, "run"]);
    expect(browserSessionRules(OFFLINE_HOME, false)?.catchUp).toBe("skip");
  });
});

describe("working slots per mode (plan §5.6)", () => {
  it("keeps home and no-home rows, online and offline rows apart", () => {
    expect(browserWorkingSlot(null)).toBe("guest");
    expect(browserWorkingSlot(DEFAULT_ONLINE_SETTINGS)).toBe("guest");
    expect(browserWorkingSlot(onlineWithoutHome())).toBe("guest.story");
    expect(browserWorkingSlot(OFFLINE_HOME)).toBe("offline.home");
    expect(browserWorkingSlot(STORY)).toBe("offline.story");
  });

  it("stamps offline slots with the offline origin and carries it into the composed save", () => {
    const rows = { colonies: [], islands: [], session: { active: null, id: "local", savedAt: 1 } } as GameRows;
    expect(toSlotRows("guest", rows).session.origin).toBeUndefined();
    const offline = toSlotRows("offline.story", rows);
    expect(offline.session.origin).toBe("offline");
    expect(fromSlotRows(offline).session.origin).toBe("offline");
    const stored = { ...fromSlotRows(offline),
      islands: [{ id: "home" as const, save: { savedAt: 1, settlement: {} } as never }] };
    expect(composeGameSave(stored)?.origin).toBe("offline");
  });

  it("refuses offline game files (origin or local pin) for an account import", () => {
    expect(isOfflineGameFile({ origin: "offline" })).toBe(true);
    expect(isOfflineGameFile({ settlement: { gameRules: { revision: "local:abc" } } })).toBe(true);
    expect(isOfflineGameFile({ settlement: { gameRules: { revision: "r1" } } })).toBe(false);
    expect(isOfflineGameFile({ settlement: {} })).toBe(false);
  });
});

describe("automatic saving per settings (plan §7.3)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("derives the coordinator triggers: today, tool runs, timed, manual", () => {
    expect(coordinatorSaving(null, false)).toEqual({ events: true, minutes: 2 });
    expect(coordinatorSaving(STORY, true)).toEqual({ events: true, minutes: 0 });
    expect(coordinatorSaving(DEFAULT_ONLINE_SETTINGS, false)).toEqual({ events: true, minutes: 2 });
    expect(coordinatorSaving(STORY, false)).toEqual({ events: false, minutes: 0 });
    const timed = cloneGameSettings(OFFLINE_HOME);
    timed.saving = { autosave: true, autosaveMinutes: 5, slots: true };
    expect(coordinatorSaving(timed, false)).toEqual({ events: true, minutes: 5 });
  });

  it("automatic saving off writes only on hide/pagehide and explicit flushes", async () => {
    const reasons: SaveReason[] = [];
    const saving = createSaveCoordinator(coordinatorSaving(STORY, false));
    saving.attach({ betweenTicks: async () => undefined, save: async reason => { reasons.push(reason); return true; } });
    saving.markDirty();
    saving.request();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 30 * MINUTE);
    expect(reasons).toEqual([]);
    await saving.checkpoint("hidden");
    await saving.flush("manual");
    expect(reasons).toEqual(["hidden", "manual"]);
    saving.dispose();
  });
});
