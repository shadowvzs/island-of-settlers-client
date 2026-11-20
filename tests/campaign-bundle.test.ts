import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { campaignBundleMapPath } from "../../island-of-settlers-shared/src/campaign/campaign-published";
import type { CampaignImage } from "../../island-of-settlers-shared/src/campaign/campaign-records";
import {
  createMemoryCampaignRecordStore, createStoreCampaignRepositories
} from "../../island-of-settlers-shared/src/campaign/campaign-store-repository";
import { sha256Hex } from "../../island-of-settlers-shared/src/sha256";
import { readyCampaign, readyMap } from "../../island-of-settlers-shared/tests/campaign-fixtures";
import { createCampaignServerClient } from "../src/app/campaign-storage/campaign-server-client";
import { createEconomyClient } from "../src/app/cloud/economy-client";
import type { StartMap } from "../src/app/map-editor/map-startup";
import { createCampaignBundleReader } from "../src/app/settlement/campaign-bundle-reader";
import {
  type CampaignPlayerSourceOptions, createCampaignPlayerSource
} from "../src/app/settlement/campaign-player-source";
import type { LoadedMap } from "../src/shared/world/save/map-reader";
import {
  buildCampaignBundle, CampaignBundleRefused, readCampaignBundleInput
} from "../tools/campaign/campaign-bundle-builder";
import { writeCampaignBundleFolder } from "../tools/campaign/campaign-bundle-folder";
import { type CampaignTestServer, createCampaignTestServer } from "./helpers/campaign-test-server";

const BASE_URL = "http://game.test/";
const FIRST_FILE = new Uint8Array([1, 1, 1, 1]), SECOND_FILE = new Uint8Array([2, 2, 2]);
const FIRST_SLOT = "campaign/campaign-1/map-1", SECOND_SLOT = "campaign/campaign-1/map-2";
const WEBP = new TextEncoder().encode("RIFF\u0010\u0000\u0000\u0000WEBPVP8 pixels");
const LICENCES = { "image-1": "Own artwork, test fixture" };
const LOCAL_START: StartMap = { error: "", loaded: { meta: { name: "local" } } as LoadedMap };

const image = (overrides: Partial<CampaignImage> = {}): CampaignImage => ({
  bytes: WEBP, campaignId: "campaign-1", height: 2, id: "image-1", mimeType: "image/webp", revision: 0, updatedAt: 0,
  width: 2, ...overrides
});

/** CAMP-BUNDLE: the export of a two-map campaign and the offline/guest read path over the written folder. */
describe("campaign bundle", () => {
  let server: CampaignTestServer;
  const folders: string[] = [];
  afterEach(async () => {
    await server.close();
    for (const folder of folders.splice(0)) rmSync(folder, { force: true, recursive: true });
  });

  /** A server with a ready two-map campaign (files and one image) and a draft campaign. */
  const startServer = async () => {
    server = createCampaignTestServer();
    const admin = createCampaignServerClient(server.access("admin"));
    await admin.repositories.campaigns.create(readyCampaign({ mapIds: ["map-1", "map-2"], name: { en: "Bundled" } }));
    await admin.repositories.campaigns.create(readyCampaign({ id: "draft-campaign", mapIds: [], state: "draft" }));
    await admin.repositories.maps.create(readyMap());
    await admin.repositories.maps.create(readyMap({ id: "map-2", mapFile: { hash: null, id: SECOND_SLOT } }));
    await admin.repositories.images.create(image());
    await admin.mapFiles.write("map-1", FIRST_FILE);
    await admin.mapFiles.write("map-2", SECOND_FILE);
    return admin;
  };

  const exportBundle = async (licences: Record<string, string> = LICENCES) => {
    const admin = await startServer();
    return buildCampaignBundle(await readCampaignBundleInput(admin, licences, async () => undefined));
  };

  /** The exported folder on disk and a `fetch` serving it under the page's base URL. */
  const writeFolder = async () => {
    const bundle = await exportBundle();
    const folder = mkdtempSync(join(tmpdir(), "campaign-bundle-"));
    folders.push(folder);
    writeCampaignBundleFolder(folder, bundle.files);
    const request = (async (input: RequestInfo | URL) => {
      const path = join(folder, String(input).slice(`${BASE_URL}campaigns/`.length));
      if (!String(input).startsWith(`${BASE_URL}campaigns/`) || !existsSync(path))
        return new Response("<!doctype html>", { status: 404 });
      return new Response(new Uint8Array(readFileSync(path)));
    }) as typeof fetch;
    return { bundle, folder, request };
  };

  /** A player source over the folder: a guest by default, with one local-only campaign in the browser. */
  const startPlayer = async (patch: Partial<CampaignPlayerSourceOptions> = {}) => {
    const written = await writeFolder();
    const local = createStoreCampaignRepositories(createMemoryCampaignRecordStore());
    await local.campaigns.create(readyCampaign({ name: { en: "Stale local copy" } }));
    await local.campaigns.create(readyCampaign({ id: "local-only", mapIds: ["local-map"], name: { en: "Local" } }));
    const cache = new Map<string, Uint8Array>();
    const loadHashedMap = vi.fn(async (hash: string, fetchBytes: () => Promise<Uint8Array>, damaged: string) => {
      const bytes = cache.get(hash) ?? await fetchBytes();
      if (sha256Hex(bytes) !== hash) throw new Error(damaged);
      cache.set(hash, bytes);
      return { meta: { name: `bundle:${bytes.length}` } } as LoadedMap;
    });
    const source = createCampaignPlayerSource({
      bundle: createCampaignBundleReader({ baseUrl: BASE_URL, fetch: written.request }), loadHashedMap,
      localAllowed: false, openLocal: async () => local, readLocalMap: async () => LOCAL_START, ...patch
    });
    return { ...written, loadHashedMap, source };
  };

  const campaignNames = async (source: Awaited<ReturnType<typeof startPlayer>>["source"]) =>
    (await (await source.openRepositories())!.campaigns.list({ state: "ready" })).map(campaign => campaign.name.en);

  it("exports ready campaigns in the published shape with hash-named files", async () => {
    const { files, index, warnings } = await exportBundle();
    expect(warnings).toEqual([]);
    expect(index.campaigns.map(entry => entry.campaign.id)).toEqual(["campaign-1"]);
    expect(index.campaigns[0]!.maps.map(entry => [entry.map.id, entry.fileHash]))
      .toEqual([["map-1", sha256Hex(FIRST_FILE)], ["map-2", sha256Hex(SECOND_FILE)]]);
    expect(index.images).toEqual([{
      campaignId: "campaign-1", hash: sha256Hex(WEBP), height: 2, id: "image-1", licence: LICENCES["image-1"], width: 2
    }]);
    expect([...files.keys()].sort()).toEqual([
      `images/${sha256Hex(WEBP)}.webp`, "index.json", campaignBundleMapPath(sha256Hex(FIRST_FILE)),
      campaignBundleMapPath(sha256Hex(SECOND_FILE))
    ].sort());
    expect(files.get(campaignBundleMapPath(sha256Hex(SECOND_FILE)))).toEqual(SECOND_FILE);
  });

  it("refuses images without a licence line or outside the processed format, and unreadable map files", async () => {
    await expect(exportBundle({})).rejects.toThrow("image image-1: no reviewed licence line");
    await server.close();

    const admin = await startServer();
    const input = await readCampaignBundleInput(admin, LICENCES, async () => undefined);
    const png = image({ bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8, 9]) });
    expect(() => buildCampaignBundle({ ...input, images: [png] })).toThrow(CampaignBundleRefused);
    const unreadable = readCampaignBundleInput(admin, LICENCES, async bytes => {
      if (bytes.length === SECOND_FILE.length) throw new Error("not a map");
    });
    await expect(unreadable).rejects.toThrow("map map-2: its stored map file cannot be read (not a map)");
  });

  it("warns about ready maps without a stored file and prunes stale hashed files", async () => {
    const admin = await startServer();
    await admin.mapFiles.delete("map-2");
    const bundle = buildCampaignBundle(await readCampaignBundleInput(admin, LICENCES, async () => undefined));
    expect(bundle.index.campaigns[0]!.maps.map(entry => entry.map.id)).toEqual(["map-1"]);
    expect(bundle.warnings).toHaveLength(1);
    expect(bundle.warnings[0]).toContain("map map-2");

    const folder = mkdtempSync(join(tmpdir(), "campaign-bundle-"));
    folders.push(folder);
    writeCampaignBundleFolder(folder, new Map([[campaignBundleMapPath(sha256Hex(SECOND_FILE)), SECOND_FILE]]));
    writeFileSync(join(folder, "maps", "README.txt"), "kept");
    expect(writeCampaignBundleFolder(folder, bundle.files)).toEqual([campaignBundleMapPath(sha256Hex(SECOND_FILE))]);
    expect(existsSync(join(folder, "maps", "README.txt"))).toBe(true);
    expect(existsSync(join(folder, campaignBundleMapPath(sha256Hex(FIRST_FILE))))).toBe(true);
  });

  it("lists the bundled campaign for guests and offline players and hash-checks its maps", async () => {
    const { loadHashedMap, request, source } = await startPlayer();
    expect(await campaignNames(source)).toEqual(["Bundled", "Local"]);
    const records = (await source.openRepositories())!;
    expect((await records.maps.list({ campaignId: "campaign-1" })).map(map => map.id)).toEqual(["map-1", "map-2"]);

    expect(await source.readMap(SECOND_SLOT)).toMatchObject({ error: "", loaded: { meta: { name: "bundle:3" } } });
    expect(loadHashedMap).toHaveBeenCalledWith(sha256Hex(SECOND_FILE), expect.any(Function), expect.any(String));
    expect(await source.readMap("campaign/local-only/local-map")).toBe(LOCAL_START);

    const signedInOffline = createCampaignPlayerSource({
      bundle: createCampaignBundleReader({ baseUrl: BASE_URL, fetch: request }),
      economy: createEconomyClient(server.access("player")), loadHashedMap, localAllowed: false,
      openLocal: async () => null, readLocalMap: async () => LOCAL_START
    });
    server.setOnline(false);
    expect(await campaignNames(signedInOffline)).toEqual(["Bundled"]);
  });

  it("refuses a damaged or missing bundled map file like a download", async () => {
    const { folder, source } = await startPlayer();
    await source.openRepositories();
    writeFileSync(join(folder, campaignBundleMapPath(sha256Hex(FIRST_FILE))), new Uint8Array([6, 6, 6]));
    expect(await source.readMap(FIRST_SLOT))
      .toEqual({ error: "The downloaded campaign map file is damaged", loaded: null });
    rmSync(join(folder, campaignBundleMapPath(sha256Hex(SECOND_FILE))));
    expect(await source.readMap(SECOND_SLOT))
      .toEqual({ error: "The campaign map file could not be read", loaded: null });
  });

  it("keeps the server list for a signed-in player and ignores an invalid index", async () => {
    const signedIn = await startPlayer();
    const admin = createCampaignServerClient(server.access("admin"));
    const stored = (await admin.repositories.campaigns.get("campaign-1"))!;
    await admin.repositories.campaigns.update({ ...stored, name: { en: "From the server" } });
    const online = createCampaignPlayerSource({
      bundle: createCampaignBundleReader({ baseUrl: BASE_URL, fetch: signedIn.request }),
      economy: createEconomyClient(server.access("player")), loadHashedMap: signedIn.loadHashedMap,
      localAllowed: false, openLocal: async () => null, readLocalMap: async () => LOCAL_START
    });
    expect(await campaignNames(online)).toEqual(["From the server"]);
    await server.close();

    const broken = await startPlayer();
    writeFileSync(join(broken.folder, "index.json"), JSON.stringify({ campaigns: [{ campaign: {} }], version: 1 }));
    expect(await campaignNames(broken.source)).toEqual(["Stale local copy", "Local"]);
    expect(await broken.source.readMap(FIRST_SLOT)).toBe(LOCAL_START);
  });
});
