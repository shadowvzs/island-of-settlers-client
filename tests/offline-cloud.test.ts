import { describe, expect, it, vi } from "vitest";

import { GAME_SETTINGS_PRESETS } from "../../island-of-settlers-shared/src/game-settings/game-settings";
import type { OfflineSlotSummary, SlotMeta } from "../../island-of-settlers-shared/src/offline-slots";
import type { PlayerAccount } from "../src/app/account/account-boot";
import { createCloudSlotRepository } from "../src/app/save-slots/cloud-slot-repository";
import { CLOUD_SYNC_KEY, OFFLINE_WRITE_SPACING_MS } from "../src/app/save-slots/constants";
import { offlineSlotModeOf, wantsOfflineCloud, withWorkingSlotSync } from "../src/app/save-slots/offline-cloud";
import { createOfflineSlotsClient, type OfflineSlotsClient } from "../src/app/save-slots/offline-slots-client";
import { createServerSlotRepository, serverSaveSlots } from "../src/app/save-slots/server-slot-repository";
import {
  buildSlotDumpUpload, decodeSlotDump, encodeSlotDump, importSlotDump, parseDumpJson
} from "../src/app/save-slots/slot-dump";
import {
  createWorkingSlotSync, type SlotTransfer, type WorkingSlotSync
} from "../src/app/save-slots/working-slot-sync";
import type { SaveStore } from "../src/app/save-store/save-store";
import type { SlotRecords } from "../src/app/settlement/game-slot-copy";
import { titleEntries } from "../src/app/title/helpers";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";

const WORKING = "offline.home";
const MARKER = `${WORKING}/${CLOUD_SYNC_KEY}`;

const slotMeta = (savedAt: number): SlotMeta => ({ savedAt, shows: { kind: "home" }, version: 1 });
const summary = (slotNo: number, savedAt: string, metaTime = 1): OfflineSlotSummary =>
  ({ bytes: 10, meta: slotMeta(metaTime), savedAt, slotNo });

const records = (): SlotRecords => ({
  mapBases: [{ hash: "h", key: "home:x", map: new Uint8Array([1, 2, 255]), slotId: WORKING }],
  ranges: { islands: [{ id: "home", save: { settlement: {} }, slotId: WORKING }] },
  session: { active: null, id: WORKING, origin: "offline" },
  values: { "story-progress": "{}" }
});

/** An in-memory api offline store. */
const fakeApi = (slots: OfflineSlotSummary[] = []) => {
  const bodies = new Map<number, ArrayBuffer>();
  const api: OfflineSlotsClient = {
    download: vi.fn(async (_mode, slotNo) => bodies.get(slotNo) ?? null),
    list: vi.fn(async () => slots),
    remove: vi.fn(async (_mode, slotNo) => { bodies.delete(slotNo); }),
    upload: vi.fn(async (_mode, slotNo, body) => {
      bodies.set(slotNo, body);
      return summary(slotNo, "2026-11-12T10:00:00.000Z");
    })
  };
  return { api, bodies };
};

const fakeTransfer = (): SlotTransfer => ({
  exportSlot: vi.fn(async (_slotId, input) => ({ body: new ArrayBuffer(4), meta: slotMeta(input.savedAt) })),
  importSlot: vi.fn(async () => slotMeta(7))
});

/** Boot values and the working slot's presence. */
const fakeDatabase = (values: Record<string, string> = {}, hasGame = false) => {
  const stored = new Map(Object.entries(values));
  let game = hasGame;
  return {
    clearGame: vi.fn(async () => undefined),
    hasGame: vi.fn(async () => game),
    readValue: vi.fn(async (key: string) => stored.get(key) ?? null),
    removeGame: vi.fn(async () => { game = false; }),
    removeValue: vi.fn(async (key: string) => { stored.delete(key); }),
    stored,
    writeValue: vi.fn(async (key: string, value: string) => { stored.set(key, value); })
  };
};

const ME = "account-me";
const marker = (dirty: boolean, syncedAt: string | null, account = ME) =>
  JSON.stringify({ account, dirty, syncedAt });

describe("the server slot dump (OFFLINE-CLOUD)", () => {
  it("round-trips the stored records with their byte arrays", () => {
    const dump = { meta: slotMeta(5), records: records() };
    const decoded = decodeSlotDump(encodeSlotDump(dump));
    expect(decoded).toEqual(dump);
    expect(decoded.records.mapBases[0]!.map).toBeInstanceOf(Uint8Array);
  });

  it("refuses binary values it cannot restore and malformed downloads", () => {
    const withFloats = records();
    withFloats.mapBases[0]!.map = new Float32Array([1]);
    expect(() => encodeSlotDump({ meta: slotMeta(1), records: withFloats })).toThrow(/byte arrays/);
    expect(() => decodeSlotDump(JSON.stringify({ meta: slotMeta(1), records: { ranges: {} } }))).toThrow(/malformed/);
  });

  it("builds a gzip upload with the meta read from the rows and imports a download", async () => {
    const database = { exportGame: vi.fn(async () => records()), importGame: vi.fn(async () => undefined) };
    const upload = await buildSlotDumpUpload(database, WORKING, { label: " Mine ", savedAt: 9 });
    expect(upload.meta).toEqual({ label: "Mine", savedAt: 9, shows: { kind: "home" }, version: 1 });
    const json = await new Response(new Blob([upload.body]).stream().pipeThrough(new DecompressionStream("gzip")))
      .arrayBuffer();
    expect(await importSlotDump(database, WORKING, json)).toEqual(upload.meta);
    expect(database.importGame).toHaveBeenCalledWith(WORKING, records());
  });
});

describe("the server Save/Load slots behind the SAVE-SLOTS seam", () => {
  const repositoryOf = (sync: Partial<WorkingSlotSync> = {}) => {
    const { api, bodies } = fakeApi([summary(0, "x"), summary(2, "y", 2)]);
    const database = fakeDatabase(), transfer = fakeTransfer();
    const workingSync: WorkingSlotSync = { changed: vi.fn(), forget: vi.fn(async () => undefined),
      pull: vi.fn(async () => false), uploadNow: vi.fn(async () => undefined), ...sync };
    const repository = createServerSlotRepository({ api, database, mode: "home", now: () => 42, sync: workingSync,
      transfer, workingSlotId: WORKING });
    return { api, bodies, database, repository, sync: workingSync, transfer };
  };

  it("lists the ten Save/Load slots from the summaries and never the working slot 0", () => {
    const slots = serverSaveSlots(WORKING, [summary(0, "x"), summary(3, "y", 3)]);
    expect(slots).toHaveLength(10);
    expect(slots.filter(slot => slot.meta).map(slot => [slot.number, slot.slotId])).toEqual([[3, "offline.home.3"]]);
  });

  it("saves a dump of the working slot into the numbered slot", async () => {
    const { api, repository, transfer } = repositoryOf();
    await repository.saveFromWorking(4, { label: "Name" });
    expect(transfer.exportSlot).toHaveBeenCalledWith(WORKING, { label: "Name", savedAt: 42 });
    expect(api.upload).toHaveBeenCalledWith("home", 4, expect.any(ArrayBuffer));
    await expect(repository.saveFromWorking(0, {})).rejects.toThrow(RangeError);
  });

  it("loads a slot over the working slot and copies the new working slot up; a failed copy retries later", async () => {
    const uploadNow = vi.fn(async () => { throw new Error("offline"); });
    const { bodies, repository, sync, transfer } = repositoryOf({ uploadNow });
    await expect(repository.loadIntoWorking(5)).rejects.toThrow(/empty/);
    bodies.set(5, new ArrayBuffer(2));
    await repository.loadIntoWorking(5);
    expect(transfer.importSlot).toHaveBeenCalledWith(WORKING, bodies.get(5));
    expect(uploadNow).toHaveBeenCalledOnce();
    expect(sync.changed).toHaveBeenCalledOnce();
  });

  it("New game clears the browser slot and server copy; Leave without saving uploads the emptied slot", async () => {
    const { api, database, repository, sync } = repositoryOf();
    await repository.newGame();
    expect(database.removeGame).toHaveBeenCalledWith(WORKING);
    expect(sync.forget).toHaveBeenCalledOnce();
    await repository.discardWorking();
    expect(database.clearGame).toHaveBeenCalledWith(WORKING);
    expect(sync.uploadNow).toHaveBeenCalledOnce();
    await repository.remove(2);
    expect(api.remove).toHaveBeenCalledWith("home", 2);
  });
});

describe("the working slot's server copy", () => {
  const syncOf = (values: Record<string, string>, server: OfflineSlotSummary[], hasGame = false) => {
    const { api, bodies } = fakeApi(server);
    bodies.set(0, new ArrayBuffer(3));
    const database = fakeDatabase(values, hasGame), transfer = fakeTransfer();
    const timers: (() => void)[] = [];
    let clock = 1_000;
    const sync = createWorkingSlotSync({ accountId: ME, api, database, intervalMs: 100, mode: "home", now: () => clock,
      schedule: run => timers.push(run), transfer, workingSlotId: WORKING });
    const runTimers = async () => {
      timers.splice(0).forEach(run => run());
      await vi.waitFor(() => expect(api.upload).toHaveBeenCalled());
    };
    return { advance: (ms: number) => { clock += ms; }, api, database, runTimers, sync, timers, transfer };
  };

  it("brings a newer server copy down when nothing local waits for its upload", async () => {
    const state = syncOf({ [MARKER]: marker(false, "2026-11-12T09:00:00.000Z") },
      [summary(0, "2026-11-12T10:00:00.000Z")]);
    expect(await state.sync.pull()).toBe(true);
    expect(state.transfer.importSlot).toHaveBeenCalledOnce();
    expect(JSON.parse(state.database.stored.get(MARKER)!)).toEqual({ account: ME, dirty: false,
      syncedAt: "2026-11-12T10:00:00.000Z" });
  });

  it("keeps the browser's slot when the server copy is not newer or there is none", async () => {
    const same = syncOf({ [MARKER]: marker(false, "2026-11-12T10:00:00.000Z") },
      [summary(0, "2026-11-12T10:00:00.000Z")]);
    expect(await same.sync.pull()).toBe(false);
    expect(await syncOf({}, []).sync.pull()).toBe(false);
  });

  it("never overwrites unsent local play: a dirty slot uploads instead", async () => {
    const state = syncOf({ [MARKER]: marker(true, "2026-11-12T09:00:00.000Z") },
      [summary(0, "2026-11-12T11:00:00.000Z")]);
    expect(await state.sync.pull()).toBe(false);
    expect(state.transfer.importSlot).not.toHaveBeenCalled();
    await state.runTimers();
    expect(state.api.upload).toHaveBeenCalledWith("home", 0, expect.any(ArrayBuffer));
  });

  it("a browser that never synced keeps its own game, and an empty one takes the server copy", async () => {
    const server = [summary(0, "2026-11-12T10:00:00.000Z")];
    expect(await syncOf({}, server, true).sync.pull()).toBe(false);
    expect(await syncOf({ "offline.home/story-progress": "{}" }, server).sync.pull()).toBe(false);
    expect(await syncOf({}, server).sync.pull()).toBe(true);
  });

  it("throttles uploads after local writes and keeps a write during the upload dirty", async () => {
    const state = syncOf({}, []);
    state.sync.changed();
    state.sync.changed();
    expect(state.timers).toHaveLength(1);
    await vi.waitFor(() => expect(JSON.parse(state.database.stored.get(MARKER)!).dirty).toBe(true));
    let finishUpload: () => void = () => {};
    vi.mocked(state.api.upload).mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { finishUpload = resolve; });
      return summary(0, "2026-11-12T12:00:00.000Z");
    });
    state.timers.splice(0)[0]!();
    await vi.waitFor(() => expect(state.api.upload).toHaveBeenCalledOnce());
    state.sync.changed();
    finishUpload();
    await vi.waitFor(() => expect(JSON.parse(state.database.stored.get(MARKER)!).syncedAt)
      .toBe("2026-11-12T12:00:00.000Z"));
    expect(JSON.parse(state.database.stored.get(MARKER)!).dirty).toBe(true);
  });

  it("replaces another account's synced game, but keeps (and never uploads) its unsent play", async () => {
    const server = [summary(0, "2026-11-12T08:00:00.000Z")];
    const synced = syncOf({ [MARKER]: marker(false, "2026-11-12T09:00:00.000Z", "other") }, server, true);
    expect(await synced.sync.pull()).toBe(true);
    expect(synced.database.removeGame).toHaveBeenCalledWith(WORKING);
    expect(synced.transfer.importSlot).toHaveBeenCalledOnce();

    const unsent = syncOf({ [MARKER]: marker(true, null, "other") }, server, true);
    expect(await unsent.sync.pull()).toBe(false);
    expect(unsent.database.removeGame).not.toHaveBeenCalled();
    unsent.sync.changed();
    await unsent.sync.uploadNow();
    expect(unsent.timers).toHaveLength(0);
    expect(unsent.api.upload).not.toHaveBeenCalled();
    expect(JSON.parse(unsent.database.stored.get(MARKER)!).account).toBe("other");
  });

  it("forgets the server copy and the sync state on New game", async () => {
    const state = syncOf({ [MARKER]: marker(false, "x") }, []);
    await state.sync.forget();
    expect(state.api.remove).toHaveBeenCalledWith("home", 0);
    expect(state.database.stored.has(MARKER)).toBe(false);
  });
});

describe("the api client and the session wiring", () => {
  it("spaces writes so the api's per-account write limit is not hit, and reads 404 as empty", async () => {
    const calls: { at: number; method: string; encoding?: string }[] = [];
    let clock = 0;
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      calls.push({ at: clock, encoding: headers["Content-Encoding"], method: init.method! });
      if (url.endsWith("/home/9")) return new Response("{}", { status: 404 });
      return new Response(JSON.stringify(summary(1, "t")), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    vi.useFakeTimers();
    try {
      const client = createOfflineSlotsClient({ apiUrl: "https://api.test", fetch,
        getAccessToken: async () => "token" }, () => clock);
      const first = client.upload("home", 1, new ArrayBuffer(1));
      const second = client.remove("home", 2);
      await first;
      clock += 500;
      await vi.advanceTimersByTimeAsync(OFFLINE_WRITE_SPACING_MS);
      clock += OFFLINE_WRITE_SPACING_MS;
      await second;
      expect(calls.map(call => call.method)).toEqual(["PUT", "DELETE"]);
      expect(calls[0]!.encoding).toBe("gzip");
      expect(await client.download("home", 9)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps offline saves on the server only for signed-in offline sessions outside tool runs", () => {
    const account = {} as PlayerAccount, settings = GAME_SETTINGS_PRESETS.offlineSettlement;
    expect(wantsOfflineCloud({ account, cloud: null, settings, toolRun: false })).toBe(true);
    expect(wantsOfflineCloud({ account: null, cloud: null, settings, toolRun: false })).toBe(false);
    expect(wantsOfflineCloud({ account, cloud: null, settings, toolRun: true })).toBe(false);
    const online = GAME_SETTINGS_PRESETS.onlineSettlement;
    expect(wantsOfflineCloud({ account, cloud: null, settings: online, toolRun: false })).toBe(false);
    expect(offlineSlotModeOf("offline.story")).toBe("story");
    expect(offlineSlotModeOf("offline.home")).toBe("home");
  });

  it("schedules the server copy after every working slot write", async () => {
    const changed = vi.fn();
    const store = { writeCapturedGame: vi.fn(async () => undefined), writeSavedGame: vi.fn(async () => undefined),
      endRunWithoutHome: vi.fn(async () => undefined) } as unknown as SaveStore;
    const synced = withWorkingSlotSync(store, { changed } as unknown as WorkingSlotSync);
    await synced.writeCapturedGame({} as never);
    await synced.writeSavedGame({} as never);
    await synced.endRunWithoutHome!({} as never);
    expect(changed).toHaveBeenCalledTimes(3);
  });
});

describe("Save/Load copies of a signed-in cloud slot without a home (D1b)", () => {
  const run = { campaignId: "camp", mapId: "map-2" };
  const cloudGame = { campaignRun: run, player: { experience: 0 }, savedAt: 5 } as unknown as GameSaveV1;
  const unzip = (body: ArrayBuffer) =>
    new Response(new Blob([body]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  const repositoryOf = (pending = false, server: GameSaveV1 | null = cloudGame) => {
    const { api, bodies } = fakeApi([summary(4, "t", 3)]);
    const cloud = { initialGame: null as GameSaveV1 | null, store: {
      hasPendingUpload: vi.fn(() => pending), whenIdle: vi.fn(async () => undefined),
      writeSavedGame: vi.fn(async () => undefined)
    } } as unknown as Parameters<typeof createCloudSlotRepository>[0]["cloud"];
    const readServerGame = vi.fn(async () => server);
    const repository = createCloudSlotRepository({ api, cloud, now: () => 77, readServerGame,
      workingSlotId: "guest.story" });
    return { api, bodies, cloud, readServerGame, repository };
  };

  it("saves the cloud slot's confirmed game into the online mode's slot with its campaign meta", async () => {
    const { api, bodies, repository } = repositoryOf();
    await repository.saveFromWorking(2, { label: "Before the boss" });
    expect(api.upload).toHaveBeenCalledWith("online", 2, expect.any(ArrayBuffer));
    const copy = parseDumpJson(new TextDecoder().decode(await unzip(bodies.get(2)!))) as Record<string, unknown>;
    expect(copy).toEqual({ meta: { label: "Before the boss", level: 1, savedAt: 77,
      shows: { campaignId: "camp", kind: "campaign", mapId: "map-2" }, version: 1 }, save: cloudGame });
    expect((await repository.list()).filter(slot => slot.meta).map(slot => slot.number)).toEqual([4]);
  });

  it("refuses a copy while the cloud slot has an unconfirmed save or no game", async () => {
    await expect(repositoryOf(true).repository.saveFromWorking(1, {})).rejects.toThrow(/not saved/);
    await expect(repositoryOf(false, null).repository.saveFromWorking(1, {})).rejects.toThrow(/no game/);
  });

  it("loads a copy back through the verified cloud store and continues with it", async () => {
    const { bodies, cloud, repository } = repositoryOf();
    await repository.saveFromWorking(3, {});
    // The api answers the stored body decompressed (Content-Encoding: gzip).
    bodies.set(3, await unzip(bodies.get(3)!));
    await repository.loadIntoWorking(3);
    expect(cloud.store.writeSavedGame).toHaveBeenCalledWith(cloudGame);
    expect(cloud.initialGame).toEqual(cloudGame);
    bodies.delete(3);
    await expect(repository.loadIntoWorking(3)).rejects.toThrow(/empty/);
  });

  it("fails a Load the server did not confirm and offers no New game for the cloud slot", async () => {
    const state = repositoryOf(true);
    state.bodies.set(1, new TextEncoder().encode(JSON.stringify({ meta: slotMeta(1), save: cloudGame })).buffer);
    await expect(state.repository.loadIntoWorking(1)).rejects.toThrow(/could not be saved/);
    expect(state.cloud.initialGame).toBeNull();
    await expect(state.repository.newGame()).rejects.toThrow(/cloud save slot/);
    const ids = (resettable?: boolean) => titleEntries({ hasSavedGame: true, hasStoryProgress: true,
      settings: GAME_SETTINGS_PRESETS.story, slots: { autosave: true, count: 1, resettable } })
      .map(entry => entry.id);
    expect(ids(false)).not.toContain("newGame");
    expect(ids()).toContain("newGame");
  });
});
