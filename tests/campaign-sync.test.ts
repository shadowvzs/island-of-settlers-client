import { afterEach, describe, expect, it } from "vitest";

import {
  createMemoryCampaignRecordStore, createStoreCampaignRepositories
} from "../../island-of-settlers-shared/src/campaign/campaign-store-repository";
import { sha256Hex } from "../../island-of-settlers-shared/src/sha256";
import { readyCampaign, readyMap } from "../../island-of-settlers-shared/tests/campaign-fixtures";
import { createCampaignServerClient } from "../src/app/campaign-storage/campaign-server-client";
import { type CampaignSyncBaseStore, syncCampaignRecords } from "../src/app/campaign-storage/campaign-sync";
import {
  decideComparedSync, decideFileSync, decideRecordSync, emptyCampaignSyncBase, sameCampaignRecord
} from "../src/app/campaign-storage/campaign-sync-plan";
import {
  createCampaignSyncBaseStore, createLocalCampaignSyncSide, createServerCampaignSyncSide
} from "../src/app/campaign-storage/campaign-sync-sides";
import type { MapSlot } from "../src/app/map-editor/map-storage";
import { type CampaignTestServer, createCampaignTestServer } from "./helpers/campaign-test-server";

const SLOT = "campaign/campaign-1/map-1";
const head = (revision: number, updatedAt = 0) => ({ id: "x", revision, updatedAt });

const createMapFiles = () => {
  const files = new Map<string, Uint8Array>();
  return {
    delete: async (id: string) => { files.delete(id); },
    files,
    read: async (id: string) => files.get(id) ?? null,
    write: async (slot: MapSlot, bytes: Uint8Array) => { files.set(slot.id, bytes); }
  };
};

const createMemoryBaseStore = (): CampaignSyncBaseStore => {
  let base = emptyCampaignSyncBase();
  return { read: () => base, write: next => { base = next; } };
};

/** One browser: memory records, map file slots and its own sync base, against the shared test server. */
const createBrowser = (server: CampaignTestServer, clock: { now: number }) => {
  const repositories = createStoreCampaignRepositories(createMemoryCampaignRecordStore(), () => clock.now);
  const mapFiles = createMapFiles();
  const remote = createCampaignServerClient(server.access("admin"));
  const options = {
    baseStore: createMemoryBaseStore(),
    local: createLocalCampaignSyncSide(repositories, mapFiles, async bytes => sha256Hex(bytes), () => clock.now),
    remote: createServerCampaignSyncSide(remote)
  };
  return { mapFiles, remote, repositories, sync: () => syncCampaignRecords(options) };
};

const image = (id: string) => ({ bytes: new Uint8Array([1, 2, 3]), campaignId: "campaign-1", height: 4, id,
  mimeType: "image/webp" as const, revision: 0, updatedAt: 0, width: 4 });

describe("campaign sync rules", () => {
  it("copies the changed side, follows deletions and compares when both sides changed", () => {
    const base = { local: 2, remote: 5 };
    expect(decideRecordSync(undefined, undefined, base)).toEqual({ conflict: false, step: "forget" });
    expect(decideRecordSync(head(2), head(5), base).step).toBe("keep");
    expect(decideRecordSync(head(3), head(5), base).step).toBe("send");
    expect(decideRecordSync(head(2), head(6), base).step).toBe("receive");
    expect(decideRecordSync(head(3), head(6), base).step).toBe("compare");
    expect(decideRecordSync(head(1), head(1), undefined).step).toBe("compare");
    expect(decideRecordSync(head(1), undefined, undefined)).toEqual({ conflict: false, step: "send" });
    expect(decideRecordSync(undefined, head(1), undefined)).toEqual({ conflict: false, step: "receive" });
    expect(decideRecordSync(head(2), undefined, base)).toEqual({ conflict: false, step: "deleteLocal" });
    expect(decideRecordSync(undefined, head(5), base)).toEqual({ conflict: false, step: "deleteRemote" });
    expect(decideRecordSync(head(3), undefined, base)).toEqual({ conflict: true, step: "send" });
    expect(decideRecordSync(undefined, head(6), base)).toEqual({ conflict: true, step: "receive" });
  });

  it("keeps the newest revision of two different documents; the server wins a tie", () => {
    const local = readyCampaign({ revision: 3, updatedAt: 20 });
    const reordered = {
      ...readyCampaign({ revision: 9, updatedAt: 99 }), name: { hu: local.name.hu!, en: local.name.en }
    };
    expect(sameCampaignRecord(local, reordered)).toBe(true);
    expect(decideComparedSync(local, reordered)).toEqual({ conflict: false, step: "keep" });
    const renamed = { ...local, name: { en: "Other" } };
    expect(decideComparedSync(local, { ...renamed, updatedAt: 19 })).toEqual({ conflict: true, step: "send" });
    expect(decideComparedSync(local, { ...renamed, updatedAt: 20 })).toEqual({ conflict: true, step: "receive" });
    const repainted = { ...image("a"), bytes: new Uint8Array([1, 2, 4]) };
    expect(sameCampaignRecord(image("a"), repainted)).toBe(false);
  });

  it("copies the map file the record pins, else follows the record's direction", () => {
    expect(decideFileSync(null, null, null, false)).toBe("none");
    expect(decideFileSync("a", "a", "a", true)).toBe("none");
    expect(decideFileSync("a", null, "a", false)).toBe("download");
    expect(decideFileSync("a", "a", null, true)).toBe("upload");
    expect(decideFileSync("a", "a", "b", true)).toBe("upload");
    expect(decideFileSync("b", "a", "b", false)).toBe("download");
    expect(decideFileSync(null, "a", "b", true)).toBe("download");
    expect(decideFileSync(null, "a", "b", false)).toBe("upload");
  });

  it("keeps the sync base per server and survives blocked or damaged storage", () => {
    const items = new Map<string, string>();
    const storage = { getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => { items.set(key, value); } };
    const store = createCampaignSyncBaseStore(storage, "http://api.test");
    expect(store.read()).toEqual(emptyCampaignSyncBase());
    store.write({ ...emptyCampaignSyncBase(), maps: { "map-1": { local: 1, remote: 2 } } });
    expect(createCampaignSyncBaseStore(storage, "http://api.test").read().maps["map-1"])
      .toEqual({ local: 1, remote: 2 });
    expect(createCampaignSyncBaseStore(storage, "http://other.test").read()).toEqual(emptyCampaignSyncBase());
    items.set("island-campaign-sync:http://api.test", "{broken");
    expect(createCampaignSyncBaseStore(storage, "http://api.test").read()).toEqual(emptyCampaignSyncBase());
    const blocked = createCampaignSyncBaseStore(null, "http://api.test");
    blocked.write({ ...emptyCampaignSyncBase(), images: { a: { local: 1, remote: 1 } } });
    expect(blocked.read().images.a).toEqual({ local: 1, remote: 1 });
  });
});

describe("campaign sync between browsers and the server", () => {
  let server: CampaignTestServer;
  const clock = { now: 1_000 };
  const start = () => {
    clock.now = 1_000;
    server = createCampaignTestServer(() => clock.now);
    return createBrowser(server, clock);
  };
  afterEach(() => server.close());

  const author = async (browser: ReturnType<typeof createBrowser>) => {
    const bytes = new Uint8Array([5, 4, 3, 2, 1]);
    await browser.repositories.campaigns.create(readyCampaign({ imageId: "image-1" }));
    await browser.repositories.maps.create(readyMap({ mapFile: { hash: sha256Hex(bytes), id: SLOT } }));
    await browser.repositories.images.create(image("image-1"));
    browser.mapFiles.files.set(SLOT, bytes);
    return bytes;
  };

  it("sends a new campaign with its map file and image; a second browser receives it; then nothing moves", async () => {
    const first = start(), bytes = await author(first);
    expect(await first.sync()).toEqual({ conflicts: [], received: 0, removed: 0, sent: 4 });
    expect((await server.repositories.campaigns.get("campaign-1"))?.name.en).toBe("The northern isles");
    expect((await server.mapFiles.read("map-1"))?.bytes).toEqual(bytes);
    expect(await first.sync()).toEqual({ conflicts: [], received: 0, removed: 0, sent: 0 });

    const second = createBrowser(server, clock);
    expect(await second.sync()).toEqual({ conflicts: [], received: 4, removed: 0, sent: 0 });
    expect(second.mapFiles.files.get(SLOT)).toEqual(bytes);
    expect((await second.repositories.images.get("image-1"))?.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(await second.sync()).toEqual({ conflicts: [], received: 0, removed: 0, sent: 0 });
  });

  it("copies one-sided edits and a re-saved map file without a conflict", async () => {
    const first = start();
    await author(first);
    await first.sync();
    const second = createBrowser(server, clock);
    await second.sync();

    const campaign = (await first.repositories.campaigns.get("campaign-1"))!;
    await first.repositories.campaigns.update({ ...campaign, name: { en: "Renamed" } });
    const resaved = new Uint8Array([9, 9]);
    const map = (await first.repositories.maps.get("map-1"))!;
    await first.repositories.maps.update({ ...map, mapFile: { hash: sha256Hex(resaved), id: SLOT } });
    first.mapFiles.files.set(SLOT, resaved);
    expect(await first.sync()).toEqual({ conflicts: [], received: 0, removed: 0, sent: 3 });

    expect(await second.sync()).toEqual({ conflicts: [], received: 3, removed: 0, sent: 0 });
    expect((await second.repositories.campaigns.get("campaign-1"))?.name.en).toBe("Renamed");
    expect(second.mapFiles.files.get(SLOT)).toEqual(resaved);
  });

  it("keeps the newest revision when both sides changed and names the conflict", async () => {
    const first = start();
    await author(first);
    await first.sync();
    const second = createBrowser(server, clock);
    await second.sync();

    const rename = async (browser: typeof first, name: string, at: number) => {
      clock.now = at;
      const campaign = (await browser.repositories.campaigns.get("campaign-1"))!;
      await browser.repositories.campaigns.update({ ...campaign, name: { en: name } });
    };
    await rename(first, "Older edit", 2_000);
    await rename(second, "Newer edit", 3_000);
    clock.now = 2_500;
    await first.sync();

    clock.now = 4_000;
    const report = await second.sync();
    expect(report.conflicts).toEqual([{ id: "campaign-1", kept: "local", kind: "campaigns", name: "Newer edit" }]);
    expect((await server.repositories.campaigns.get("campaign-1"))?.name.en).toBe("Newer edit");

    await rename(first, "Stale edit", 3_500);
    const lost = await first.sync();
    expect(lost.conflicts).toEqual([{ id: "campaign-1", kept: "server", kind: "campaigns", name: "Newer edit" }]);
    expect((await first.repositories.campaigns.get("campaign-1"))?.name.en).toBe("Newer edit");
  });

  it("follows deletions; a record edited on the other side is kept and stored again", async () => {
    const first = start();
    await author(first);
    await first.sync();
    const second = createBrowser(server, clock);
    await second.sync();

    const stored = (await first.repositories.images.get("image-1"))!;
    await first.repositories.images.delete("image-1", stored.revision);
    const map = (await first.repositories.maps.get("map-1"))!;
    await first.repositories.maps.delete("map-1", map.revision);
    first.mapFiles.files.delete(SLOT);
    expect(await first.sync()).toMatchObject({ conflicts: [], removed: 2 });
    expect(await server.repositories.maps.get("map-1")).toBeNull();
    expect(await server.mapFiles.read("map-1")).toBeNull();

    const edited = (await second.repositories.maps.get("map-1"))!;
    await second.repositories.maps.update({ ...edited, soldierCap: 77 });
    const report = await second.sync();
    expect(report.removed).toBe(1);
    expect(report.conflicts).toEqual([{ id: "map-1", kept: "local", kind: "maps", name: "First landing" }]);
    expect(await second.repositories.images.get("image-1")).toBeNull();
    expect((await server.repositories.maps.get("map-1"))?.soldierCap).toBe(77);
    expect(await server.mapFiles.read("map-1")).not.toBeNull();

    const back = await first.sync();
    expect(back).toEqual({ conflicts: [], received: 2, removed: 0, sent: 0 });
    expect(first.mapFiles.files.has(SLOT)).toBe(true);
  });

  it("deletes the local map file with a map the server no longer has", async () => {
    const first = start();
    await author(first);
    await first.sync();
    const map = (await server.repositories.maps.get("map-1"))!;
    await first.remote.repositories.maps.delete("map-1", map.revision);
    expect(await first.sync()).toMatchObject({ removed: 1 });
    expect(await first.repositories.maps.get("map-1")).toBeNull();
    expect(first.mapFiles.files.has(SLOT)).toBe(false);
  });

  it("needs nothing for equal records after a lost base and keeps finished work when the server drops", async () => {
    const first = start();
    await author(first);
    await first.sync();
    const fresh = createBrowser(server, clock);
    await author(fresh);
    expect(await fresh.sync()).toEqual({ conflicts: [], received: 0, removed: 0, sent: 0 });

    await fresh.repositories.campaigns.create(readyCampaign({ id: "campaign-2", imageId: undefined, mapIds: [] }));
    server.setOnline(false);
    await expect(fresh.sync()).rejects.toMatchObject({ status: 0 });
    server.setOnline(true);
    expect(await fresh.sync()).toEqual({ conflicts: [], received: 0, removed: 0, sent: 1 });
  });
});
