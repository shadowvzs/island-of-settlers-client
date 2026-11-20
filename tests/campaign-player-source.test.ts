import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createMemoryCampaignRecordStore, createStoreCampaignRepositories
} from "../../island-of-settlers-shared/src/campaign/campaign-store-repository";
import { sha256Hex } from "../../island-of-settlers-shared/src/sha256";
import { readyCampaign, readyMap } from "../../island-of-settlers-shared/tests/campaign-fixtures";
import { createCampaignServerClient } from "../src/app/campaign-storage/campaign-server-client";
import { createEconomyClient } from "../src/app/cloud/economy-client";
import type { StartMap } from "../src/app/map-editor/map-startup";
import {
  type CampaignPlayerSourceOptions, createCampaignPlayerSource
} from "../src/app/settlement/campaign-player-source";
import type { LoadedMap } from "../src/shared/world/save/map-reader";
import { type CampaignTestServer, createCampaignTestServer } from "./helpers/campaign-test-server";

const SLOT = "campaign/campaign-1/map-1";
const FILE = new Uint8Array([4, 2, 4, 2]);
const LOCAL_START: StartMap = { error: "", loaded: { meta: { name: "local" } } as LoadedMap };

/** CAMPAIGN-SERVER-STORAGE: the campaign window's records and map files for players, admins and offline. */
describe("campaign player source", () => {
  let server: CampaignTestServer;
  afterEach(() => server.close());

  /** A server publishing campaign-1 (map-1 with its file) and a browser with a local-only campaign. */
  const start = async (patch: Partial<CampaignPlayerSourceOptions> = {}) => {
    server = createCampaignTestServer();
    const admin = createCampaignServerClient(server.access("admin"));
    await admin.repositories.campaigns.create(readyCampaign({ name: { en: "From the server" } }));
    await admin.repositories.maps.create(readyMap());
    await admin.mapFiles.write("map-1", FILE);
    const local = createStoreCampaignRepositories(createMemoryCampaignRecordStore());
    await local.campaigns.create(readyCampaign({ name: { en: "Stale local copy" } }));
    await local.campaigns.create(readyCampaign({ id: "local-only", mapIds: ["local-map"] }));
    await local.maps.create(readyMap({ campaignId: "local-only", id: "local-map",
      mapFile: { hash: null, id: "campaign/local-only/local-map" } }));
    const cache = new Map<string, Uint8Array>();
    const loadHashedMap = vi.fn(async (hash: string, fetchBytes: () => Promise<Uint8Array>, damaged: string) => {
      const bytes = cache.get(hash) ?? await fetchBytes();
      if (sha256Hex(bytes) !== hash) throw new Error(damaged);
      cache.set(hash, bytes);
      return { meta: { name: `server:${bytes.length}` } } as LoadedMap;
    });
    const readLocalMap = vi.fn(async () => LOCAL_START);
    const economy = createEconomyClient(server.access("player"));
    const source = createCampaignPlayerSource({
      economy, loadHashedMap, localAllowed: false, openLocal: async () => local, readLocalMap, ...patch
    });
    return { economy, loadHashedMap, readLocalMap, source };
  };

  const campaignNames = async (source: Awaited<ReturnType<typeof start>>["source"]) =>
    (await (await source.openRepositories())!.campaigns.list({ state: "ready" })).map(campaign => campaign.name.en);

  it("gives a signed-in player the server's campaigns and the checked, cached map file", async () => {
    const { loadHashedMap, readLocalMap, source } = await start();
    expect(await campaignNames(source)).toEqual(["From the server"]);
    const records = (await source.openRepositories())!;
    expect((await records.maps.list({ campaignId: "campaign-1" })).map(map => map.id)).toEqual(["map-1"]);
    expect(await records.maps.list({ campaignId: "local-only" })).toEqual([]);

    const file = await source.readMap(SLOT);
    expect(file).toMatchObject({ error: "", loaded: { meta: { name: "server:4" } } });
    expect(loadHashedMap).toHaveBeenCalledWith(sha256Hex(FILE), expect.any(Function), expect.any(String));
    server.setOnline(false);
    expect((await source.readMap(SLOT)).loaded).not.toBeNull();
    expect(readLocalMap).not.toHaveBeenCalled();
  });

  it("adds an administrator's local-only campaigns; published ones stay the server's", async () => {
    const { readLocalMap, source } = await start({ localAllowed: true });
    expect(await campaignNames(source)).toEqual(["From the server", "The northern isles"]);
    const records = (await source.openRepositories())!;
    expect((await records.maps.list({ campaignId: "local-only" })).map(map => map.id)).toEqual(["local-map"]);
    expect(await source.readMap("campaign/local-only/local-map")).toBe(LOCAL_START);
    expect(readLocalMap).toHaveBeenCalledWith("campaign/local-only/local-map");
  });

  it("falls back to this browser's records for guests and while the server is unreachable", async () => {
    const guest = await start({ economy: undefined });
    expect(await campaignNames(guest.source)).toEqual(["Stale local copy", "The northern isles"]);
    expect(await guest.source.readMap(SLOT)).toBe(LOCAL_START);
    await server.close();

    const offline = await start();
    await offline.source.openRepositories();
    server.setOnline(false);
    expect(await campaignNames(offline.source)).toEqual(["Stale local copy", "The northern isles"]);
    expect(await offline.source.readMap(SLOT)).toBe(LOCAL_START);
  });

  it("answers the refusal when the published file is gone or damaged", async () => {
    const gone = await start();
    await gone.source.openRepositories();
    await server.mapFiles.delete("map-1");
    expect(await gone.source.readMap(SLOT)).toEqual({ error: "The campaign map file could not be read", loaded: null });
    await server.close();

    const damaged = await start();
    await damaged.source.openRepositories();
    await server.mapFiles.write({ bytes: new Uint8Array([6, 6, 6]), campaignId: "campaign-1", mapId: "map-1" });
    expect(await damaged.source.readMap(SLOT))
      .toEqual({ error: "The downloaded campaign map file is damaged", loaded: null });
  });
});
