import { describe, expect, it } from "vitest";

import {
  cloneGameSettings, GAME_SETTINGS_PRESETS, type GameSettings
} from "../../island-of-settlers-shared/src/game-settings/game-settings";
import {
  browserSaving, continueGameUrl, coordinatorSaving, titlePageUrl, wantsTitlePage, withoutContinueParam
} from "../src/app/game-settings/session-mode";
import { SLOT_STORAGE_FULL } from "../src/app/save-slots/constants";
import { createInGameSlots, type SlotSaving } from "../src/app/save-slots/slot-actions";
import { copyGameSlot, type SlotCopyRequest } from "../src/app/save-slots/slot-copy";
import {
  buildSlotMeta, cleanSlotLabel, listSaveSlots, newestSaveSlot, parseSlotMeta, saveSlotId, slotNumberOf
} from "../src/app/save-slots/slot-meta";
import { createSlotRepository } from "../src/app/save-slots/slot-repository";
import { createSaveCoordinator, type SaveReason } from "../src/app/save-store/save-coordinator";
import { retargetSlotRecords, type SlotRecords } from "../src/app/settlement/game-slot-copy";
import { canContinue, titleEntries } from "../src/app/title/helpers";
import { createTitleSlots } from "../src/app/title/title-slots";

const STORY = GAME_SETTINGS_PRESETS.story;
const OFFLINE_HOME = GAME_SETTINGS_PRESETS.offlineSettlement;
const NOW = 1_800_000_000_000;

const meta = (savedAt: number, label?: string) => JSON.stringify(buildSlotMeta({ label, savedAt }, { colonies: [] }));

describe("save slot ids, meta and limits (plan §5.6)", () => {
  it("numbers 1-10 per working slot and never reads another mode's slots", () => {
    expect(saveSlotId("offline.home", 3)).toBe("offline.home.3");
    expect(() => saveSlotId("offline.home", 0)).toThrow(RangeError);
    expect(() => saveSlotId("offline.home", 11)).toThrow(RangeError);
    expect(slotNumberOf("offline.home", "offline.home.10")).toBe(10);
    expect(slotNumberOf("offline.home", "offline.home.11")).toBeNull();
    expect(slotNumberOf("offline.home", "offline.home.01")).toBeNull();
    expect(slotNumberOf("guest", "guest.story.1")).toBeNull();
    const slots = listSaveSlots("offline.story", [
      ["offline.story.2/slot-meta", meta(5, "Second")], ["offline.story.7/slot-meta", meta(9)],
      ["offline.home.1/slot-meta", meta(99)], ["offline.story.3/slot-meta", "{broken"],
      ["offline.story.12/slot-meta", meta(100)]
    ]);
    expect(slots).toHaveLength(10);
    expect(slots.filter(slot => slot.meta).map(slot => slot.number)).toEqual([2, 7]);
    expect(newestSaveSlot(slots)?.number).toBe(7);
    expect(newestSaveSlot(listSaveSlots("offline.story", []))).toBeNull();
  });

  it("builds the meta from the copied rows: kind, campaign map and level", () => {
    const campaign = buildSlotMeta({ label: "  Bay run  ", place: "Bay", savedAt: NOW }, {
      colonies: [], player: { progress: { experience: 0 } },
      session: { active: "campaign", campaign: { campaignId: "isles", mapId: "first" } }
    });
    expect(campaign).toEqual({ label: "Bay run", level: 1, place: "Bay", savedAt: NOW,
      shows: { campaignId: "isles", kind: "campaign", mapId: "first" }, version: 1 });
    expect(parseSlotMeta(JSON.stringify(campaign))).toEqual(campaign);
    expect(buildSlotMeta({ savedAt: 1 }, { colonies: [{ expeditionId: 4 }], session: { active: 4 } }).shows.kind)
      .toBe("colony");
    expect(buildSlotMeta({ savedAt: 1 }, { colonies: [], session: { active: 5 } }).shows.kind).toBe("adventure");
    expect(buildSlotMeta({ savedAt: 1 }, { colonies: [], session: { active: null } }).shows.kind).toBe("home");
    expect(cleanSlotLabel("x".repeat(60))).toHaveLength(40);
    expect(cleanSlotLabel("   ")).toBeUndefined();
    expect(parseSlotMeta(JSON.stringify({ ...campaign, version: 2 }))).toBeNull();
  });

  it("retargets every record to the new slot without touching its content", () => {
    const records: SlotRecords = {
      mapBases: [{ hash: "h", key: "home:1", map: new Uint8Array([1, 2]), slotId: "offline.story" }],
      player: { id: "offline.story", progress: { experience: 7 } },
      ranges: { campaignRuns: [{ id: "campaign-first-1", run: { status: "running" }, slotId: "offline.story" }] },
      session: { active: "campaign", id: "offline.story", origin: "offline" },
      values: { "story-progress": "{\"experience\":3}" }
    };
    const copy = retargetSlotRecords(records, "offline.story.4");
    expect(copy.ranges.campaignRuns?.[0]).toEqual({ ...records.ranges.campaignRuns![0], slotId: "offline.story.4" });
    expect(copy.mapBases[0]).toEqual({ ...records.mapBases[0], slotId: "offline.story.4" });
    expect(copy.session).toEqual({ ...records.session, id: "offline.story.4" });
    expect(copy.player).toEqual({ ...records.player, id: "offline.story.4" });
    expect(copy.values).toEqual(records.values);
    expect(records.session!.id).toBe("offline.story");
  });

  it("answers the quota error and the localStorage fallback with known reasons", async () => {
    const quota = Object.assign(new Error("full"), { name: "QuotaExceededError" });
    const request: SlotCopyRequest = { from: "offline.home", meta: null, to: "offline.home.1" };
    await expect(copyGameSlot({ copyGame: async () => { throw quota; } }, request)).rejects.toThrow(SLOT_STORAGE_FULL);
    await expect(copyGameSlot({}, request)).rejects.toThrow("Save slots need IndexedDB in this browser");
  });
});

describe("session saving: slots per effectiveSaving and the fallback rule (rev I12, D1b)", () => {
  const withRewards = (settings: GameSettings, rewards: boolean) => {
    const next = cloneGameSettings(settings);
    next.connectivity = "online";
    next.progression = { ...next.progression, rewards };
    return next;
  };

  it("offers slots offline and online without a home unless rewards are on", () => {
    expect(browserSaving(null, "indexeddb")).toEqual({ autosave: true, autosaveMinutes: 2, slots: false });
    expect(browserSaving(STORY, "indexeddb")).toMatchObject({ autosave: false, slots: true });
    expect(browserSaving(withRewards(STORY, false), "indexeddb")).toMatchObject({ slots: true });
    expect(browserSaving(withRewards(STORY, true), "indexeddb")).toMatchObject({ autosave: true, slots: false });
    // OFFLINE-CLOUD: a signed-in cloud slot without a home keeps server copies (D1b) and always saves automatically.
    expect(browserSaving(withRewards(STORY, false), "indexeddb", true)).toMatchObject({ autosave: true, slots: true });
    expect(browserSaving(withRewards(STORY, false), "local-storage", true)).toMatchObject({ slots: true });
    expect(browserSaving(withRewards(STORY, true), "indexeddb", true)).toMatchObject({ slots: false });
    expect(coordinatorSaving(STORY, false, "indexeddb", true)).toEqual({ events: true, minutes: 2 });
  });

  it("forces automatic saving on the localStorage fallback, which holds no copies", () => {
    expect(browserSaving(STORY, "local-storage")).toMatchObject({ autosave: true, slots: false,
      slotsBlocked: "indexedDb" });
    expect(coordinatorSaving(STORY, false, "local-storage")).toEqual({ events: true, minutes: 2 });
    expect(coordinatorSaving(STORY, false, "indexeddb")).toEqual({ events: false, minutes: 0 });
  });

  it("continues the working slot once after a Load, without the title page", () => {
    const href = "https://game.test/play/?title=1&lang=hu";
    const next = continueGameUrl(href);
    expect(new URL(next).searchParams.get("continue")).toBe("1");
    expect(new URL(next).searchParams.has("title")).toBe(false);
    expect(wantsTitlePage(OFFLINE_HOME, new URL(next).search, false)).toBe(false);
    expect(wantsTitlePage(OFFLINE_HOME, "?lang=hu", false)).toBe(true);
    expect(new URL(withoutContinueParam(next)).searchParams.has("continue")).toBe(false);
    expect(new URL(titlePageUrl(next)).searchParams.has("continue")).toBe(false);
  });
});

/** A repository over an in-memory copy log. */
const memoryRepository = (stored: [string, string][] = []) => {
  const copies: SlotCopyRequest[] = [], removed: string[] = [], cleared: string[] = [];
  let persisted = 0, copyError: Error | null = null;
  const repository = createSlotRepository({
    copy: async request => {
      if (copyError) throw copyError;
      copies.push(request);
    },
    database: {
      clearGame: async slotId => { cleared.push(slotId); },
      listValues: async () => stored,
      removeGame: async slotId => { removed.push(slotId); }
    },
    now: () => NOW,
    persist: async () => { persisted++; },
    workingSlotId: "offline.home"
  });
  return { cleared, copies, failWith: (error: Error) => { copyError = error; }, persisted: () => persisted, removed,
    repository };
};

describe("slot repository (plan §5.6 seam)", () => {
  it("saves, loads, deletes and starts a new game on the working slot's rows", async () => {
    const memory = memoryRepository([["offline.home.2/slot-meta", meta(5)]]);
    await memory.repository.saveFromWorking(1, { label: "First" });
    await memory.repository.saveFromWorking(2, {});
    await memory.repository.loadIntoWorking(2);
    await expect(memory.repository.loadIntoWorking(3)).rejects.toThrow("Save slot 3 is empty");
    await memory.repository.remove(2);
    await memory.repository.newGame();
    await memory.repository.discardWorking();
    expect(memory.copies).toEqual([
      { from: "offline.home", meta: { label: "First", savedAt: NOW }, to: "offline.home.1" },
      { from: "offline.home", meta: { savedAt: NOW }, to: "offline.home.2" },
      { from: "offline.home.2", meta: null, to: "offline.home" }
    ]);
    expect(memory.removed).toEqual(["offline.home.2", "offline.home"]);
    expect(memory.cleared).toEqual(["offline.home"]);
    expect(memory.persisted(), "storage persistence is asked once").toBe(1);
  });
});

/** A real coordinator whose runner records every write. */
const coordinator = () => {
  const writes: SaveReason[] = [];
  const saving = createSaveCoordinator({ events: false, minutes: 0 });
  saving.attach({ betweenTicks: async () => undefined, save: async reason => { writes.push(reason); return true; } });
  return { saving, writes };
};

describe("in-game Save/Load (plan §5.6, rev I4)", () => {
  it("flushes the working slot before copying it into a slot", async () => {
    const { saving, writes } = coordinator(), memory = memoryRepository();
    const slots = createInGameSlots({ continueGame: () => undefined, exitToTitle: () => undefined,
      place: () => "Bay", repository: memory.repository, saving });
    await expect(slots.controls.save!(4, "Mine")).resolves.toBe(true);
    expect(writes).toEqual(["manual"]);
    expect(memory.copies[0]).toEqual({ from: "offline.home", meta: { label: "Mine", place: "Bay", savedAt: NOW },
      to: "offline.home.4" });
    saving.setSuspended(true);
    await expect(slots.controls.save!(5, ""), "a transition owns the writes").resolves.toBe("busy");
    memory.failWith(new Error(SLOT_STORAGE_FULL));
    saving.setSuspended(false);
    await expect(slots.controls.save!(5, "")).resolves.toBe("storageFull");
  });

  it("stops saving before the copy: a pagehide between copy and reload never overwrites it", async () => {
    const { saving, writes } = coordinator();
    const order: string[] = [];
    let pagehide: Promise<unknown> | undefined;
    const repository = { ...memoryRepository([["offline.home.2/slot-meta", meta(5)]]).repository,
      loadIntoWorking: async () => {
        order.push("copy");
        saving.markDirty();
        pagehide = saving.checkpoint("pagehide");
      } };
    const slots = createInGameSlots({ continueGame: () => order.push("reload"), exitToTitle: () => undefined,
      repository, saving: { ...saving, stop: () => { order.push("stop"); saving.stop(); } } satisfies SlotSaving });
    await expect(slots.controls.load(2)).resolves.toBe(true);
    await pagehide;
    expect(order).toEqual(["copy", "stop", "reload"]);
    expect(writes, "no write after the hold").toEqual([]);
    await expect(saving.checkpoint("pagehide")).resolves.toMatchObject({ ran: false });
    expect(writes).toEqual([]);
  });

  it("gives the writes back when the load copy fails, and leaves without saving through the title page", async () => {
    const { saving, writes } = coordinator(), memory = memoryRepository();
    let exited = 0;
    const slots = createInGameSlots({ continueGame: () => undefined, exitToTitle: () => { exited++; },
      repository: memory.repository, saving });
    await expect(slots.controls.load(3)).resolves.toBe("failed");
    expect(saving.isSuspended()).toBe(false);
    saving.markDirty();
    await saving.checkpoint("hidden");
    expect(writes).toEqual(["hidden"]);
    await expect(slots.leaveWithoutSaving()).resolves.toBe(true);
    expect(memory.cleared).toEqual(["offline.home"]);
    expect(exited).toBe(1);
    expect(saving.isSuspended()).toBe(true);
  });
});

describe("title page Continue, Load and New game (plan §7.5, owner §19.2)", () => {
  const ids = (entries: ReturnType<typeof titleEntries>) => entries.map(entry => entry.id);

  it("lists Load while slots are on without a home, and New game where it resets something", () => {
    const manual = { autosave: false, count: 2 };
    expect(ids(titleEntries({ hasSavedGame: true, settings: STORY, slots: manual })))
      .toEqual(["continue", "campaigns", "load", "newGame", "settings"]);
    const fresh = { ...manual, count: 0 };
    const freshEntries = titleEntries({ hasSavedGame: false, settings: STORY, slots: fresh });
    expect(ids(freshEntries)).toEqual(["continue", "campaigns", "load", "settings"]);
    expect(freshEntries.find(entry => entry.id === "load")).toMatchObject({ disabled: true, reason: "noSaves" });
    expect(ids(titleEntries({ hasSavedGame: true, settings: OFFLINE_HOME,
      slots: { autosave: true, count: 1 } }))).toEqual(["continue", "load", "newGame", "settings"]);
    expect(ids(titleEntries({ hasSavedGame: false, settings: OFFLINE_HOME,
      slots: { autosave: true, count: 0 } }))).toEqual(["newGame", "settings"]);
  });

  it("with automatic saving off Continue means the newest real save, never the working slot", () => {
    expect(canContinue({ hasSavedGame: true, slots: { autosave: false, count: 0 } })).toBe(false);
    expect(canContinue({ hasSavedGame: false, slots: { autosave: false, count: 1 } })).toBe(true);
    expect(canContinue({ hasSavedGame: true, slots: { autosave: true, count: 0 } })).toBe(true);
    expect(canContinue({ hasSavedGame: true })).toBe(true);
  });

  it("Continue loads the newest slot, Load copies the chosen one, New game clears the working slot", async () => {
    const memory = memoryRepository([["offline.home.2/slot-meta", meta(5)], ["offline.home.6/slot-meta", meta(9)]]);
    let finished = 0, reloaded = 0;
    const context = { finish: () => { finished++; }, home: false };
    const options = { autosave: false, reload: () => { reloaded++; }, repository: memory.repository };
    const slots = await createTitleSlots(options, context);
    expect(slots.facts).toEqual({ autosave: false, count: 2 });
    await expect(slots.continueGame()).resolves.toBe(true);
    await expect(slots.controls!.load(2)).resolves.toBe(true);
    expect(memory.copies.map(copy => copy.from)).toEqual(["offline.home.6", "offline.home.2"]);
    await expect(slots.newGame()).resolves.toBe(true);
    expect(memory.removed).toEqual(["offline.home"]);
    expect([finished, reloaded], "no home: New game reloads the title page").toEqual([2, 1]);
    const without = await createTitleSlots(undefined, context);
    await expect(without.continueGame()).resolves.toBe(true);
    expect(without.controls).toBeNull();
    expect(finished).toBe(3);
  });
});
