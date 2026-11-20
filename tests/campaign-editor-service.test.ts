import { describe, expect, it } from "vitest";

import {
  createMemoryCampaignRecordStore, createStoreCampaignRepositories
} from "../../island-of-settlers-shared/src/campaign/campaign-store-repository";
import type { CampaignSyncReport } from "../src/app/campaign-storage/campaign-sync";
import { createCampaignEditor } from "../src/app/map-editor/campaign/campaign-editor";
import {
  createCampaignSlotRecord, withSavedMapFile
} from "../src/app/map-editor/campaign/campaign-slot-record";
import { CampaignImageRefused } from "../src/app/map-editor/campaign/image-processing";
import { serverSyncView } from "../src/app/map-editor/campaign/workspace-helpers";
import { resolveEditorText } from "../src/app/map-editor/messages";

/** One editor over a shared memory store; dialogs answer from queues, navigation is recorded. */
const createHarness = (
  store = createMemoryCampaignRecordStore(), serverSync: (() => Promise<CampaignSyncReport>) | null = null
) => {
  const answers = { confirm: [] as boolean[], prompt: [] as (string | null)[] };
  const navigations: string[] = [], deletedSlots: string[] = [];
  const mapFiles = new Map<string, Uint8Array>();
  let clock = 1_000, urls = 0;
  const repositories = createStoreCampaignRepositories(store, () => clock++);
  const editor = createCampaignEditor({
    confirm: () => answers.confirm.shift() ?? true,
    imageUrls: { create: () => `blob:${++urls}`, revoke: () => undefined },
    mapFiles: {
      delete: async slot => { deletedSlots.push(slot); mapFiles.delete(slot); },
      read: async slot => mapFiles.get(slot) ?? null
    },
    navigate: url => navigations.push(url),
    now: () => clock,
    pageUrl: () => "http://localhost/editor.html?mode=campaign",
    processImage: async () => ({ bytes: new Uint8Array([1, 2, 3]), height: 64, width: 128 }),
    prompt: () => answers.prompt.shift() ?? null,
    random: () => (clock % 997) / 997,
    repositories,
    serverSync,
    storage: "local",
    translate: text => resolveEditorText(undefined, text)
  });
  return { answers, deletedSlots, editor, navigations, repositories, store };
};

const createCampaignWithMaps = async (harness: ReturnType<typeof createHarness>, count: number) => {
  harness.answers.prompt.push("North isles");
  await harness.editor.createCampaign();
  for (let index = 0; index < count; index++) await harness.editor.addMap();
  return harness.editor.getState();
};

describe("campaign editor service over the C1 repository", () => {
  it("persists order and node positions across a reload (repository round trip)", async () => {
    const harness = createHarness();
    const created = await createCampaignWithMaps(harness, 3);
    const [first, second, third] = created.draft!.mapIds;
    expect(created.dirty).toBe(true);
    harness.editor.moveMap(2, 0);
    harness.editor.setNode(second!, 0.7, 0.3);
    await harness.editor.save();
    expect(harness.editor.getState().dirty).toBe(false);

    const reloaded = createHarness(harness.store);
    await reloaded.editor.start(created.draft!.id, second!);
    const state = reloaded.editor.getState();
    expect(state.draft!.mapIds).toEqual([third, first, second]);
    expect(state.draft!.mapNodes!.find(node => node.mapId === second)).toEqual({ mapId: second, u: 0.7, v: 0.3 });
    expect(state.selectedMapId).toBe(second);
    expect(state.maps.every(map => map.campaignId === created.draft!.id)).toBe(true);
    expect(state.maps.map(map => map.mapFile.id).sort()).toEqual(
      [first, second, third].map(id => `campaign/${created.draft!.id}/${id}`).sort());
  });

  it("edits stay local until Save; Open map saves first and opens the campaign slot", async () => {
    const harness = createHarness();
    const created = await createCampaignWithMaps(harness, 1);
    const mapId = created.draft!.mapIds[0]!;
    harness.editor.updateMap(mapId, map => ({ ...map, name: { en: "Landfall", hu: "Partraszállás" } }));
    expect((await harness.repositories.maps.get(mapId))!.name.en).toBe("Map 1");
    await harness.editor.openMap(mapId);
    expect((await harness.repositories.maps.get(mapId))!.name).toEqual({ en: "Landfall", hu: "Partraszállás" });
    expect(new URL(harness.navigations[0]!).searchParams.get("campaignSlot"))
      .toBe(`campaign/${created.draft!.id}/${mapId}`);
  });

  it("unlisted maps keep their record; deleting a map removes record, slot and order entry", async () => {
    const harness = createHarness();
    const created = await createCampaignWithMaps(harness, 2);
    const [first, second] = created.draft!.mapIds;
    harness.editor.unlistMap(first!);
    await harness.editor.save();
    expect((await harness.repositories.maps.get(first!))).not.toBeNull();
    harness.editor.deleteMap(second!);
    expect(harness.editor.getState().confirmation).toMatchObject({ id: second, kind: "map", name: "Map 2" });
    harness.editor.cancelDeletion();
    expect(harness.editor.getState().confirmation).toBeNull();
    expect(await harness.repositories.maps.get(second!)).not.toBeNull();
    expect(harness.deletedSlots).toEqual([]);
    harness.editor.deleteMap(second!);
    await harness.editor.confirmDeletion();
    expect(harness.editor.getState().confirmation).toBeNull();
    expect(await harness.repositories.maps.get(second!)).toBeNull();
    expect(harness.deletedSlots).toEqual([`campaign/${created.draft!.id}/${second}`]);
    expect((await harness.repositories.campaigns.get(created.draft!.id))!.mapIds).toEqual([]);
  });

  it("Save as Ready lists the errors and stays a draft; deleting the campaign removes everything it owns", async () => {
    const harness = createHarness();
    const created = await createCampaignWithMaps(harness, 1);
    await harness.editor.setCampaignReady(true);
    const state = harness.editor.getState();
    expect(state.draft!.state).toBe("draft");
    expect(state.report!.campaign.errors.map(issue => issue.code)).toEqual(["campaignMapNotReady"]);
    expect(state.report!.campaign.warnings.map(issue => issue.code)).toContain("campaignImageMissing");

    const mapId = created.draft!.mapIds[0]!;
    await harness.editor.setMapReady(mapId, true);
    expect(harness.editor.getState().report!.maps[0]!.result.errors.map(issue => issue.code))
      .toEqual(["campaignMapFileMissing"]);

    await harness.editor.deleteCampaign(created.draft!.id);
    expect(harness.editor.getState().confirmation).toEqual({
      id: created.draft!.id, imageCount: 0, kind: "campaign", mapCount: 1, name: "North isles"
    });
    expect(await harness.repositories.maps.list()).toHaveLength(1);
    expect(harness.editor.getState().draft).not.toBeNull();
    await harness.editor.confirmDeletion();
    expect(harness.editor.getState().draft).toBeNull();
    expect(await harness.repositories.campaigns.list()).toEqual([]);
    expect(await harness.repositories.maps.list()).toEqual([]);
  });

  it("uploads need the owner-art confirmation; unused images are removed on save", async () => {
    const harness = createHarness();
    await createCampaignWithMaps(harness, 0);
    expect(await harness.editor.uploadImage(new Blob())).toBeNull();
    harness.editor.setArtworkConfirmed(true);
    const kept = await harness.editor.uploadImage(new Blob());
    const dropped = await harness.editor.uploadImage(new Blob());
    harness.editor.updateDraft(campaign => ({ ...campaign, imageId: kept! }));
    await harness.editor.save();
    const stored = await harness.repositories.images.list();
    expect(stored.map(image => image.id)).toEqual([kept]);
    expect(Object.keys(harness.editor.getState().images)).toEqual([kept]);
    expect(dropped).not.toBe(kept);
  });

  it("a refused image becomes a notice, not an error", async () => {
    const harness = createHarness();
    await createCampaignWithMaps(harness, 0);
    harness.editor.setArtworkConfirmed(true);
    const refusing = createCampaignEditor({
      confirm: () => true, imageUrls: { create: () => "", revoke: () => undefined }, mapFiles: null,
      navigate: () => undefined, now: () => 1, pageUrl: () => "http://localhost/editor.html",
      processImage: async () => { throw new CampaignImageRefused("tooDetailed"); }, prompt: () => "Refusing",
      random: () => 0.1, repositories: harness.repositories, serverSync: null, storage: "memory",
      translate: text => resolveEditorText(undefined, text)
    });
    await refusing.createCampaign();
    refusing.setArtworkConfirmed(true);
    expect(await refusing.uploadImage(new Blob())).toBeNull();
    expect(resolveEditorText(undefined, refusing.getState().notice!.text)).toContain("300 KB");
  });
});

describe("campaign slot record (map editor side)", () => {
  it("names the map file after the campaign map and writes the hash and a renamed name back on save", async () => {
    const harness = createHarness();
    const created = await createCampaignWithMaps(harness, 1);
    await harness.editor.save();
    const mapId = created.draft!.mapIds[0]!;
    const slot = { campaignId: created.draft!.id, mapId, slotId: `campaign/${created.draft!.id}/${mapId}` };
    const record = createCampaignSlotRecord(slot, async () => harness.repositories);
    expect(await record.mapName()).toBe("Map 1");
    await record.recordSave("abc123", "Map 1");
    const saved = (await harness.repositories.maps.get(mapId))!;
    expect(saved.mapFile).toEqual({ hash: "abc123", id: slot.slotId });
    expect(saved.name.en).toBe("Map 1");
    await record.recordSave("def456", " Grey Cove ");
    const renamed = (await harness.repositories.maps.get(mapId))!;
    expect([renamed.mapFile.hash, renamed.name.en]).toEqual(["def456", "Grey Cove"]);
    expect(withSavedMapFile(renamed, "def456", "Grey Cove")).toBe(renamed);
    const foreign = createCampaignSlotRecord({ ...slot, campaignId: "other" }, async () => harness.repositories);
    expect(await foreign.mapName()).toBeNull();
    expect(await createCampaignSlotRecord(slot, async () => null).mapName()).toBeNull();
  });
});

describe("a re-saved Ready campaign map (owner decision 2026-11-13)", () => {
  const readyMapSlot = async () => {
    const harness = createHarness();
    const created = await createCampaignWithMaps(harness, 1);
    await harness.editor.save();
    const mapId = created.draft!.mapIds[0]!;
    const stored = (await harness.repositories.maps.get(mapId))!;
    await harness.repositories.maps.update({ ...stored, state: "ready" });
    const slot = { campaignId: created.draft!.id, mapId, slotId: stored.mapFile.id };
    return { harness, mapId, record: createCampaignSlotRecord(slot, async () => harness.repositories), slot };
  };

  it("stays Ready when the map editor writes a new file hash and a renamed name back", async () => {
    const { harness, mapId, record } = await readyMapSlot();
    await record.recordSave("abc123", "Map 1");
    await record.recordSave("def456", "Grey Cove");
    const saved = (await harness.repositories.maps.get(mapId))!;
    expect([saved.state, saved.mapFile.hash, saved.name.en]).toEqual(["ready", "def456", "Grey Cove"]);
    expect(withSavedMapFile({ ...saved, state: "draft" }, "0a0a", "Grey Cove").state).toBe("draft");
  });

  it("stays Ready when the campaign editor then saves other changes of the campaign", async () => {
    const { harness, mapId, record, slot } = await readyMapSlot();
    await record.recordSave("abc123", "Map 1");
    const reopened = createHarness(harness.store);
    await reopened.editor.start(slot.campaignId, mapId);
    expect(reopened.editor.getState().maps[0]!.state).toBe("ready");
    reopened.editor.setNode(mapId, 0.4, 0.6);
    await reopened.editor.save();
    const saved = (await reopened.repositories.maps.get(mapId))!;
    expect([saved.state, saved.mapFile.hash]).toEqual(["ready", "abc123"]);
  });
});

describe("campaign editor server sync", () => {
  const report = (patch: Partial<CampaignSyncReport> = {}): CampaignSyncReport =>
    ({ conflicts: [], received: 0, removed: 0, sent: 0, ...patch });
  const noticeOf = (editor: ReturnType<typeof createHarness>["editor"]) => {
    const { notice } = editor.getState();
    return notice && { error: notice.error, text: resolveEditorText(undefined, notice.text) };
  };

  it("stays local without a server: the badge says so and the start-up sync is silent", async () => {
    const { editor } = createHarness();
    expect(serverSyncView(editor.getState())).toMatchObject({ badge: "Local only", disabled: true });
    await editor.syncWithServer(true);
    expect(editor.getState().notice).toBeNull();
    await editor.syncWithServer();
    expect(noticeOf(editor)).toMatchObject({ error: true, text: expect.stringContaining("administrator sign-in") });
  });

  it("asks for a save first, then reports what moved and reloads received records", async () => {
    const reports = [report({ sent: 3 }), report(), report({ received: 1 })];
    const harness = createHarness(undefined, async () => {
      const next = reports.shift()!;
      if (!next.received) return next;
      const stored = (await harness.repositories.campaigns.list())[0]!;
      await harness.repositories.campaigns.update({ ...stored, name: { en: "From the server" } });
      return next;
    });
    const { editor } = harness;
    await createCampaignWithMaps(harness, 1);
    expect(serverSyncView(editor.getState())).toMatchObject({ badge: "Server", disabled: false });
    editor.updateDraft(draft => ({ ...draft, description: { en: "Edited" } }));
    await editor.syncWithServer();
    expect(noticeOf(editor)?.text).toContain("Save or discard");
    expect(reports).toHaveLength(3);

    await editor.save();
    await editor.syncWithServer();
    expect(noticeOf(editor)).toEqual({ error: false,
      text: "Synced with the server: 3 sent, 0 received, 0 deleted." });
    await editor.syncWithServer(true);
    expect(noticeOf(editor)?.text).toContain("3 sent");
    await editor.syncWithServer();
    expect(editor.getState().draft?.name.en).toBe("From the server");
    expect(editor.getState().campaigns[0]?.name.en).toBe("From the server");
  });

  it("names every conflict with the kept copy and shows a failed sync", async () => {
    const answers: (CampaignSyncReport | Error)[] = [
      report({ conflicts: [
        { id: "c", kept: "server", kind: "campaigns", name: "Isles" },
        { id: "m", kept: "local", kind: "maps", name: "Bay" }
      ], received: 1, sent: 1 }),
      new Error("offline")
    ];
    const { editor } = createHarness(undefined, async () => {
      const next = answers.shift()!;
      if (next instanceof Error) throw next;
      return next;
    });
    await editor.syncWithServer(true);
    expect(noticeOf(editor)).toEqual({ error: true, text: "Synced with the server: 1 sent, 1 received, 0 deleted. " +
      "Changed on both sides, the newest revision was kept: \"Isles\" (the server's copy), " +
      "\"Bay\" (this browser's copy)." });
    await editor.syncWithServer();
    expect(noticeOf(editor)).toEqual({ error: true, text: "The server sync failed: offline" });
    expect(serverSyncView(editor.getState())).toMatchObject({ badge: "Sync failed", disabled: false });
  });
});
