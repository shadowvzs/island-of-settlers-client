import { afterEach, describe, expect, it } from "vitest";

import { readyCampaign, readyMap } from "../../island-of-settlers-shared/tests/campaign-fixtures";
import { runCampaignRepositoryContract } from "../../island-of-settlers-shared/tests/campaign-repository-contract";
import { createCampaignServerClient } from "../src/app/campaign-storage/campaign-server-client";
import { createEconomyClient } from "../src/app/cloud/economy-client";
import { SaveApiError } from "../src/app/save-store/save-api-client";
import { type CampaignTestServer, createCampaignTestServer } from "./helpers/campaign-test-server";

/** CAMPAIGN-SERVER-STORAGE: the web client against the API's real campaign routes (memory stores). */
describe("campaign server client", () => {
  let server: CampaignTestServer;
  const start = () => { server = createCampaignTestServer(); return server; };
  afterEach(() => server.close());

  it("keeps the shared repository contract over the admin routes", async () => {
    const { repositories } = createCampaignServerClient(start().access("admin"));
    await expect(runCampaignRepositoryContract(repositories, "web")).resolves.toBeUndefined();
  });

  it("refuses players on the admin routes", async () => {
    const { mapFiles, repositories } = createCampaignServerClient(start().access("player"));
    await expect(repositories.campaigns.list()).rejects.toBeInstanceOf(SaveApiError);
    await expect(mapFiles.list()).rejects.toMatchObject({ status: 401 });
  });

  it("stores, lists, reads and deletes map files by map record", async () => {
    const { mapFiles, repositories } = createCampaignServerClient(start().access("admin"));
    const bytes = new Uint8Array([3, 1, 4, 1, 5]);
    await expect(mapFiles.write("map-1", bytes)).rejects.toMatchObject({ status: 404 });
    await repositories.maps.create(readyMap());

    const meta = await mapFiles.write("map-1", bytes);
    expect(meta).toMatchObject({ campaignId: "campaign-1", mapId: "map-1", size: 5 });
    expect(await mapFiles.list("campaign-1")).toEqual([meta]);
    expect(await mapFiles.list("other")).toEqual([]);
    expect(await mapFiles.read("map-1")).toEqual(bytes);

    await mapFiles.delete("map-1");
    await mapFiles.delete("map-1");
    expect(await mapFiles.read("map-1")).toBeNull();
  });

  it("gives players the published campaigns and their map files only", async () => {
    const admin = createCampaignServerClient(start().access("admin"));
    const published = createEconomyClient(server.access("player"));
    await admin.repositories.campaigns.create(readyCampaign());
    await admin.repositories.maps.create(readyMap());
    await admin.repositories.maps.create(readyMap({ id: "map-2", state: "draft" }));
    expect(await published.publishedCampaigns()).toEqual([]);

    const bytes = new Uint8Array([7, 7, 7]);
    const meta = await admin.mapFiles.write("map-1", bytes);
    await admin.mapFiles.write("map-2", bytes);
    const [campaign] = await published.publishedCampaigns();
    expect(campaign!.maps.map(entry => [entry.map.id, entry.fileHash])).toEqual([["map-1", meta.hash]]);
    expect(await published.campaignMapFile("map-1")).toEqual(bytes);
    expect(await published.campaignMapFile("map-2")).toBeNull();

    const guest = createEconomyClient(server.access("guest"));
    await expect(guest.publishedCampaigns()).rejects.toMatchObject({ status: 401 });
    server.setOnline(false);
    await expect(published.publishedCampaigns()).rejects.toMatchObject({ status: 0 });
  });
});
