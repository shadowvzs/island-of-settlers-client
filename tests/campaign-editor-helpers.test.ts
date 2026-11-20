import { describe, expect, it } from "vitest";

import {
  type Campaign, createCampaign, createCampaignMap
} from "../../island-of-settlers-shared/src/campaign/campaign-model";
import { checkCampaignShape } from "../../island-of-settlers-shared/src/campaign/campaign-shape";
import { deleteConfirmationView } from "../src/app/map-editor/campaign/confirmation/helpers";
import {
  availabilityFromInputs, availabilityInputs, campaignEditorUrl, campaignMapEditorUrl, campaignMapSlotId,
  createRecordId, isCampaignEditorMode, parseCampaignMapSlot, readCampaignSlotParam, referencedImageIds,
  withTranslation
} from "../src/app/map-editor/campaign/helpers";
import { encodeAttempts } from "../src/app/map-editor/campaign/image-processing";
import {
  listMap, mapListRefusal, mapListRows, moveMapId, unlistedMaps, unlistMap
} from "../src/app/map-editor/campaign/map-list/helpers";
import {
  mapRewardEntries, minimumLevelOf, withMinimumLevel, withRewardEntries
} from "../src/app/map-editor/campaign/map-settings/helpers";
import {
  clampUnit, defaultNodePosition, mapViewModel, nudgeNodePosition, pointerToNodePosition, setNodePosition
} from "../src/app/map-editor/campaign/map-view/helpers";
import { withPortrait, withSpeakerAdded } from "../src/app/map-editor/campaign/speakers/helpers";
import {
  storyFieldsOf, storyPreviewContent, withStoryFields
} from "../src/app/map-editor/campaign/story/helpers";
import { translationRows } from "../src/app/map-editor/campaign/translation/helpers";

const map = (id: string, campaignId = "campaign-1") =>
  ({ ...createCampaignMap(id, campaignId, { hash: null, id: campaignMapSlotId(campaignId, id) }), name: { en: id } });
const campaign = (mapIds: string[] = []): Campaign => ({ ...createCampaign("campaign-1"), mapIds });

describe("campaign map order and ownership", () => {
  it("moves one map and clamps the indices", () => {
    expect(moveMapId(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveMapId(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveMapId(["a", "b", "c"], 1, 9)).toEqual(["a", "c", "b"]);
    const same = ["a", "b"];
    expect(moveMapId(same, 1, 1)).toBe(same);
    expect(moveMapId([], 0, 1)).toEqual([]);
  });

  it("lists a map once, only in its own campaign, and places its node", () => {
    const owned = map("map-1"), foreign = map("map-x", "campaign-2");
    const listed = listMap(campaign(), owned);
    expect(listed.mapIds).toEqual(["map-1"]);
    expect(listed.mapNodes).toEqual([{ mapId: "map-1", ...defaultNodePosition(0) }]);
    expect(mapListRefusal(listed, owned)).toBe("alreadyListed");
    expect(listMap(listed, owned)).toBe(listed);
    expect(mapListRefusal(listed, foreign)).toBe("foreignMap");
    expect(listMap(listed, foreign)).toBe(listed);
  });

  it("unlisting keeps the record as an unlisted map and drops its node", () => {
    const maps = [map("map-1"), map("map-2"), map("map-x", "campaign-2")];
    const listed = listMap(listMap(campaign(), maps[0]!), maps[1]!);
    const unlisted = unlistMap(listed, "map-1");
    expect(unlisted.mapIds).toEqual(["map-2"]);
    expect(unlisted.mapNodes?.map(node => node.mapId)).toEqual(["map-2"]);
    expect(unlistedMaps(unlisted, maps).map(entry => entry.id)).toEqual(["map-1"]);
  });

  it("rows show order, selection and Ready state; a missing record shows its id", () => {
    const rows = mapListRows(campaign(["map-1", "gone"]), [{ ...map("map-1"), state: "ready" }], "gone", "en");
    expect(rows.map(row => [row.position, row.name, row.ready, row.selected, row.first, row.last])).toEqual([
      [1, "map-1", true, false, true, false], [2, "gone", false, true, false, true]
    ]);
  });
});

describe("campaign map view nodes", () => {
  it("clamps and rounds u,v to the image", () => {
    expect(clampUnit(-0.2)).toBe(0);
    expect(clampUnit(1.7)).toBe(1);
    expect(clampUnit(0.123456)).toBe(0.1235);
    expect(clampUnit(Number.NaN)).toBe(0);
    expect(pointerToNodePosition({ height: 200, left: 10, top: 20, width: 400 }, 210, 70)).toEqual({ u: 0.5, v: 0.25 });
    expect(pointerToNodePosition({ height: 0, left: 0, top: 0, width: 0 }, 5, 5)).toEqual({ u: 0, v: 0 });
  });

  it("moves, adds and nudges nodes; stored positions stay valid documents", () => {
    const moved = setNodePosition(listMap(campaign(), map("map-1")), "map-1", 0.9, 1.4);
    expect(moved.mapNodes).toEqual([{ mapId: "map-1", u: 0.9, v: 1 }]);
    expect(setNodePosition(moved, "map-2", 0.1, 0.2).mapNodes).toHaveLength(2);
    expect(nudgeNodePosition({ u: 0.5, v: 0.5 }, "ArrowRight", false)).toEqual({ u: 0.51, v: 0.5 });
    expect(nudgeNodePosition({ u: 0.995, v: 0.5 }, "ArrowRight", true)).toEqual({ u: 1, v: 0.5 });
    expect(nudgeNodePosition({ u: 0.5, v: 0.5 }, "Enter", false)).toBeNull();
    expect(checkCampaignShape(moved)).toEqual([]);
  });

  it("default positions stay inside the image and alternate rows", () => {
    const positions = Array.from({ length: 10 }, (_, index) => defaultNodePosition(index));
    for (const { u, v } of positions) {
      expect(u).toBeGreaterThan(0);
      expect(u).toBeLessThan(1);
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(1);
    }
    expect(positions[0]!.v).not.toBe(positions[1]!.v);
  });

  it("draws nodes in play order and one dashed path per consecutive pair", () => {
    const placed = setNodePosition(setNodePosition(campaign(["a", "b", "c"]), "a", 0.1, 0.2), "c", 0.9, 0.8);
    const { nodes, paths } = mapViewModel(placed, [map("a"), map("b")], "b", "en");
    expect(nodes.map(node => [node.id, node.label, node.name, node.selected])).toEqual([
      ["a", "1", "a", false], ["b", "2", "b", true], ["c", "3", "c", false]
    ]);
    expect(nodes[0]!.left).toBe("10%");
    expect(nodes[1]!.u).toBe(defaultNodePosition(1).u);
    expect(paths.map(path => path.id)).toEqual(["a>b", "b>c"]);
    expect(paths[1]!.x2).toBeLessThan(90);
    expect(paths[1]!.y2).toBeLessThan(80);
  });
});

describe("campaign editor URLs, slots and ids", () => {
  it("campaign map slots never collide with World01 and round-trip", () => {
    const slot = campaignMapSlotId("campaign-1", "map-2");
    expect(slot).toBe("campaign/campaign-1/map-2");
    expect(parseCampaignMapSlot(slot)).toEqual({ campaignId: "campaign-1", mapId: "map-2", slotId: slot });
    expect(parseCampaignMapSlot("map-123")).toBeNull();
    expect(parseCampaignMapSlot("campaign/only")).toBeNull();
    expect(parseCampaignMapSlot("campaign/a/b/c")).toBeNull();
  });

  it("Open map and Back build each other's URLs", () => {
    const open = campaignMapEditorUrl("http://host/editor.html?mode=campaign&campaign=c", "c", "m");
    expect(readCampaignSlotParam(new URL(open).search)?.slotId).toBe("campaign/c/m");
    const back = campaignEditorUrl(open, "c", "m");
    expect(isCampaignEditorMode(new URL(back).search)).toBe(true);
    expect(new URL(back).searchParams.get("campaignMap")).toBe("m");
    expect(new URL(back).searchParams.has("campaignSlot")).toBe(false);
  });

  it("record ids are identifier-safe and ordered by time (real clock values)", () => {
    const first = createRecordId("map", 1_790_000_000_000, 0.5), later = createRecordId("map", 1_790_000_001_000, 0);
    expect(first).toMatch(/^map-[a-z0-9]+-[a-z0-9]{4}$/);
    expect(first < later).toBe(true);
  });
});

describe("campaign editor form helpers", () => {
  it("translations: English stays, a blank translation falls back to English", () => {
    const text = withTranslation(withTranslation({ en: "North" }, "hu", "Észak"), "en", "North isles");
    expect(text).toEqual({ en: "North isles", hu: "Észak" });
    expect(withTranslation(text, "hu", "")).toEqual({ en: "North isles" });
    expect(translationRows({ en: "North" }).map(row => [row.language, row.missing, row.locale])).toEqual([
      ["en", false, "en"], ["hu", true, "hu"]
    ]);
  });

  it("availability dates are UTC days with an inclusive last day", () => {
    const window = availabilityFromInputs("2026-12-01", "2026-12-24");
    expect(window).toEqual({ from: Date.UTC(2026, 11, 1), until: Date.UTC(2026, 11, 25) });
    expect(availabilityInputs(window)).toEqual({ from: "2026-12-01", until: "2026-12-24" });
    expect(availabilityFromInputs("", "")).toEqual({ from: null, until: null });
  });

  it("minimum level is the playerLevel unlock condition, other conditions stay", () => {
    const base = map("map-1");
    const leveled = withMinimumLevel(base, 12);
    expect(minimumLevelOf(leveled)).toBe(12);
    expect(leveled.unlock).toEqual([{ kind: "previousMapCompleted" }, { kind: "playerLevel", level: 12 }]);
    expect(withMinimumLevel(leveled, 0).unlock).toEqual([{ kind: "previousMapCompleted" }]);
  });

  it("map rewards round-trip through picker lines, soldiers and settlers included", () => {
    const rewards = { ...map("map-1").rewards, coins: 40, decorations: [{ amount: 1, item: "banner-oak" }],
      goods: [{ amount: 3, ware: "planks" }], xp: 10 };
    const entries = mapRewardEntries(rewards);
    expect(entries.map(entry => entry.kind)).toEqual(["xp", "coins", "ware", "decoration"]);
    expect(withRewardEntries(rewards, entries)).toEqual(rewards);
    const people = withRewardEntries(rewards, [...entries, { amount: 2, kind: "settlers" },
      { amount: 4, kind: "soldier", rank: 2, soldierType: "archer" }, { amount: 1, kind: "soldier", soldierType: "cavalry" },
      { buildingType: 3, kind: "buildingUnlock" }]);
    expect(people.settlers).toBe(2);
    expect(people.soldiers).toEqual([{ amount: 4, rank: 2, type: "archer" }]);
    expect(withRewardEntries(people, entries)).toEqual(rewards);
    const recruits = withRewardEntries(rewards,
      [...entries, { amount: 3, kind: "soldier", rank: 0, soldierType: "shield" }]);
    expect(recruits.soldiers, "rank 0 (recruit) is stored, not dropped")
      .toEqual([{ amount: 3, rank: 0, type: "shield" }]);
    expect(mapRewardEntries(recruits)).toContainEqual({ amount: 3, kind: "soldier", rank: 0, soldierType: "shield" });
  });

  it("story forms edit the map-start and victory quests and preview them in the story panel", () => {
    const edited = withStoryFields(withStoryFields(map("map-1"), "intro", { title: { en: "Landfall" } }), "epilogue",
      { imageId: "image-1", text: { en: "Won." } });
    expect(edited.quests.map(quest => [quest.id, quest.trigger.kind])).toEqual([
      ["story-intro", "mapStart"], ["story-epilogue", "victory"]
    ]);
    const again = withStoryFields(edited, "intro", { text: { en: "Ashore." } });
    expect(again.quests).toHaveLength(2);
    expect(storyFieldsOf(again, "intro")).toMatchObject({ text: { en: "Ashore." }, title: { en: "Landfall" } });
    expect(storyPreviewContent(again, "intro")).toMatchObject({ kind: "intro", replay: true });
    expect(storyPreviewContent(again, "epilogue")).toMatchObject({
      claim: { status: "granted" }, kind: "epilogue", outcome: "victory", pages: [{ imageId: "image-1" }]
    });
  });

  it("speakers keep their required neutral portrait; images in use are collected", () => {
    const withSpeaker = withSpeakerAdded(campaign(), "speaker-1", "image-n");
    const speaker = withSpeaker.speakers![0]!;
    expect(withPortrait(speaker, "neutral", null)).toBe(speaker);
    const happy = withPortrait(speaker, "happy", "image-h");
    expect(withPortrait(happy, "happy", null).portraits).toEqual({ neutral: "image-n" });
    const maps = [withStoryFields(map("map-1"), "intro", { imageId: "image-q" })];
    const used = referencedImageIds({ ...withSpeaker, imageId: "image-c", speakers: [happy] }, maps);
    expect([...used].sort()).toEqual(["image-c", "image-h", "image-n", "image-q"]);
  });

  it("image encoding fits 1024 px first, never upscales, and shrinks step by step", () => {
    const large = encodeAttempts(4096, 2048);
    expect(large[0]).toMatchObject({ height: 512, width: 1024 });
    expect(large.at(-1)).toMatchObject({ height: 256, width: 512 });
    expect(encodeAttempts(300, 200)[0]).toMatchObject({ height: 200, width: 300 });
    expect(new Set(large.map(attempt => attempt.quality)).size).toBeGreaterThan(1);
  });
});

describe("delete confirmation panel copy", () => {
  it("names the campaign and counts its maps, map files and images; a map lists its record and file", () => {
    const campaign = deleteConfirmationView({ id: "c-1", imageCount: 3, kind: "campaign", mapCount: 2,
      name: "North isles" });
    expect(campaign.title).toBe("Delete the campaign \"North isles\"?");
    expect(campaign.items).toEqual(["2 maps", "2 map files", "3 images"]);
    expect(campaign.confirmLabel).toBe("Delete campaign");
    expect(campaign.cancelLabel).toBe("Cancel");
    expect(deleteConfirmationView({ id: "c-2", imageCount: 0, kind: "campaign", mapCount: 0, name: "Empty" }).items)
      .toEqual([]);
    const map = deleteConfirmationView({ id: "m-1", imageCount: 0, kind: "map", mapCount: 1, name: "Grey Cove" });
    expect(map.title).toBe("Delete the map \"Grey Cove\"?");
    expect(map.items).toEqual(["1 map", "1 map file"]);
    expect(map.notes).toHaveLength(2);
  });
});
