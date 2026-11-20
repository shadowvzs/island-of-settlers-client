import { describe, expect, it } from "vitest";

import { validateCampaignGraph } from "../../island-of-settlers-shared/src/campaign/campaign-graph-validation";
import { campaignIssue, campaignValidationResult } from "../../island-of-settlers-shared/src/campaign/campaign-issues";
import {
  type Campaign, type CampaignMap, createCampaign, createCampaignMap
} from "../../island-of-settlers-shared/src/campaign/campaign-model";
import type { CampaignQuest } from "../../island-of-settlers-shared/src/campaign/campaign-quest";
import { campaignRecordScript } from "../../island-of-settlers-shared/src/campaign/campaign-record-script";
import {
  createMemoryCampaignRecordStore, createStoreCampaignRepositories
} from "../../island-of-settlers-shared/src/campaign/campaign-store-repository";
import { DEFAULT_ONLINE_SETTINGS } from "../../island-of-settlers-shared/src/game-settings/game-settings";
import { validateMapScript } from "../../island-of-settlers-shared/src/script/validate";
import { createCampaignEditor } from "../src/app/map-editor/campaign/campaign-editor";
import type { CampaignReadyReport } from "../src/app/map-editor/campaign/campaign-editor-state";
import { checkWholeCampaign, reportTotals, rewardLineIssues } from "../src/app/map-editor/campaign/campaign-readiness";
import {
  collectCampaignTexts, missingTextLanguages, recordTextEdit, withTextValue
} from "../src/app/map-editor/campaign/campaign-texts";
import { checkCategoryOf, checkSections, checkSummary } from "../src/app/map-editor/campaign/check/helpers";
import {
  fieldPathLabel, recordPathLabel, scriptPathLabel, scriptPathNames
} from "../src/app/map-editor/campaign/check/path-labels";
import { CAMPAIGN_CHECK_LANGUAGES } from "../src/app/map-editor/campaign/constants";
import {
  missingTextIds, textCellId, textTableGroups, visibleTextIds
} from "../src/app/map-editor/campaign/text-table/helpers";
import { resolveEditorText } from "../src/app/map-editor/messages";

const quest = (id: string, fields: Partial<CampaignQuest> = {}): CampaignQuest => ({
  claimEffects: [], highlightRegion: false, homeReward: null, id, imageId: null, mapReward: null, prerequisites: [],
  repeat: "once", text: { en: "Text" }, timeLimitSeconds: null, title: { en: "Title" },
  trigger: { kind: "mapStart" }, ...fields
});

/** A campaign with two maps: translated and untranslated texts, a speaker, a speak line and a bad reward. */
const fixture = () => {
  const campaign: Campaign = {
    ...createCampaign("c1"), description: { en: "" }, mapIds: ["m1", "m2"],
    name: { de: "Nordinseln", en: "North isles", hu: "Északi szigetek" },
    speakers: [{ id: "advisor", name: { en: "Advisor", hu: "Tanácsadó" }, portraits: { neutral: "image-1" } }]
  };
  const first: CampaignMap = {
    ...createCampaignMap("m1", "c1", { hash: null, id: "campaign/c1/m1" }),
    name: { en: "Landfall" },
    quests: [
      quest("story-intro", { title: { de: "Ankunft", en: "Arrival", hu: "Érkezés" } }),
      quest("hidden", { hidden: true, trigger: { kind: "elapsedTime", seconds: 5 } }),
      quest("build", { trigger: { buildingType: 3, count: 1, kind: "buildingCompleted" } })
    ],
    rewards: { coins: 5, decorations: [{ amount: 1, item: "no-such-decoration" }], gems: 0, goods: [], xp: 0 },
    sequences: [{ id: "seq-1", name: "Arrival", pauseWorld: true, skippable: true, steps: [
      { delayMs: 0, durationMs: 300, id: "s1", kind: "fade", start: "afterPrevious", to: "black" },
      { delayMs: 0, id: "s2", kind: "speak", speakerId: "advisor", start: "afterPrevious", text: { en: "Welcome" },
        timing: "auto" }
    ] }]
  };
  const second: CampaignMap = {
    ...createCampaignMap("m2", "c1", { hash: null, id: "campaign/c1/m2" }),
    name: { de: "Festung", en: "Fortress", hu: "Erőd" }
  };
  return { campaign, maps: [first, second] };
};

describe("campaign texts (CUX-I18N-TABLE)", () => {
  it("collects every visible record text with a stable id and the validators' path", () => {
    const { campaign, maps } = fixture();
    const texts = collectCampaignTexts(campaign, maps);
    expect(texts.map(text => text.id)).toEqual([
      "campaign/name", "campaign/description", "campaign/speaker/advisor", "map/m1/name",
      "map/m1/quest/story-intro/title", "map/m1/quest/story-intro/text", "map/m1/quest/build/title",
      "map/m1/quest/build/text", "map/m1/sequence/seq-1/s2", "map/m2/name"
    ]);
    const byId = new Map(texts.map(text => [text.id, text]));
    expect(byId.get("campaign/speaker/advisor")!.issuePath).toBe("speakers[0].name");
    expect(byId.get("map/m1/quest/build/text")!.issuePath).toBe("quests[2].text");
    expect(byId.get("map/m1/sequence/seq-1/s2")).toMatchObject({
      issuePath: "sequences[0].steps[1].text", mapId: "m1", position: 1, subject: "Arrival"
    });
  });

  it("detects missing translations in en/hu/de; an empty optional description lacks none", () => {
    const { campaign, maps } = fixture();
    const missing = Object.fromEntries(collectCampaignTexts(campaign, maps)
      .map(text => [text.id, missingTextLanguages(text, CAMPAIGN_CHECK_LANGUAGES)]));
    expect(CAMPAIGN_CHECK_LANGUAGES).toEqual(["en", "hu", "de"]);
    expect(missing["campaign/name"]).toEqual([]);
    expect(missing["campaign/description"]).toEqual([]);
    expect(missing["campaign/speaker/advisor"]).toEqual(["de"]);
    expect(missing["map/m1/name"]).toEqual(["hu", "de"]);
    expect(missing["map/m2/name"]).toEqual([]);
    expect([...missingTextIds(campaign, maps)]).not.toContain("map/m1/quest/story-intro/title");
    const described = { ...campaign, description: { en: "A cold sea." } };
    expect(missingTextLanguages(collectCampaignTexts(described, [])[1]!, CAMPAIGN_CHECK_LANGUAGES))
      .toEqual(["hu", "de"]);
  });

  it("builds table groups with missing cells flagged, counted and filtered", () => {
    const { campaign, maps } = fixture();
    const groups = textTableGroups(campaign, maps);
    expect(groups.map(group => [group.id, group.title, group.missing])).toEqual([
      ["campaign", "Campaign", 1], ["m1", "Landfall", 10], ["m2", "Fortress", 0]
    ]);
    const speaker = groups[0]!.rows[2]!;
    expect(speaker.label).toBe("Speaker 1: name");
    expect(speaker.cells.map(cell => [cell.language, cell.missing, cell.value])).toEqual([
      ["en", false, "Advisor"], ["hu", false, "Tanácsadó"], ["de", true, ""]
    ]);
    expect(speaker.cells[2]!.id).toBe(textCellId("campaign/speaker/advisor", "de"));
    expect(groups[1]!.rows.map(row => row.label)).toEqual([
      "Name", "Quest story-intro: title", "Quest story-intro: text", "Quest build: title", "Quest build: text",
      "Arrival: line 1"
    ]);
    const filtered = textTableGroups(campaign, maps, undefined, missingTextIds(campaign, maps));
    expect(filtered.map(group => group.id)).toEqual(["campaign", "m1"]);
    expect(filtered[0]!.rows.map(row => row.id)).toEqual(["campaign/speaker/advisor"]);
    expect(filtered[1]!.rows.map(row => row.id)).not.toContain("map/m1/quest/story-intro/title");
    expect([...visibleTextIds(new Set(["a"]), "b")!]).toEqual(["a", "b"]);
    expect(visibleTextIds(null, "b")).toBeNull();
  });

  it("writes one language at a path and records one undo step per edited cell", () => {
    const { maps } = fixture();
    const changed = withTextValue(maps[0]!, ["quests", 2, "title"], "hu", "Építs");
    expect(changed.quests[2]!.title).toEqual({ en: "Title", hu: "Építs" });
    expect(changed.quests[0]).toBe(maps[0]!.quests[0]);
    expect(withTextValue(changed, ["quests", 2, "title"], "hu", "").quests[2]!.title).toEqual({ en: "Title" });
    const first = recordTextEdit([], { language: "hu", previous: "", textId: "a" });
    const typed = recordTextEdit(first, { language: "hu", previous: "É", textId: "a" });
    expect(typed).toBe(first);
    expect(recordTextEdit(typed, { language: "de", previous: "", textId: "a" })).toHaveLength(2);
  });
});

/** A whole-campaign report of the fixture built from the real validators' issue shapes. */
const fixtureReport = (maps: readonly CampaignMap[]): CampaignReadyReport => {
  const script = validateMapScript(campaignRecordScript(maps[0]!), {
    languages: CAMPAIGN_CHECK_LANGUAGES, mapKind: "campaign"
  });
  return {
    campaign: campaignValidationResult([
      campaignIssue("warning", "missingTranslation", "speakers[0].name", { language: "de" }),
      campaignIssue("error", "campaignImageDeleted", "imageId", { imageId: "image-9" }),
      campaignIssue("error", "campaignMapNotReady", "mapIds[1]", { mapId: "m2" }),
      campaignIssue("warning", "campaignMapNodeMissing", "mapNodes[0]", { mapId: "m1" }),
      campaignIssue("error", "missingPortraitImage", "speakers[0].portraits.neutral", { imageId: "image-1" })
    ]),
    campaignRewards: [],
    maps: [{
      mapId: "m1",
      result: campaignValidationResult([
        campaignIssue("warning", "missingTranslation", "name", { language: "hu" }),
        campaignIssue("warning", "missingTranslation", "quests[2].text", { language: "de" }),
        campaignIssue("warning", "speakLineTooLong", "sequences[0].steps[1].text.hu", { length: 900, max: 400 }),
        campaignIssue("error", "missingRegionReference", "quests[2].trigger.regionId", { regionId: "region-4" }),
        campaignIssue("error", "missingImage", "quests[0].imageId", { imageId: "image-7", questId: "story-intro" }),
        campaignIssue("error", "unknownWare", "rewards.goods[0].ware", { ware: "unobtainium" }),
        campaignIssue("error", "mapFileNotCampaign", "mapFile")
      ]),
      rewards: rewardLineIssues(maps[0]!.rewards, "rewards"),
      script
    }, { mapId: "m2", result: campaignValidationResult([]), rewards: [], script: null }]
  };
};

describe("campaign Check panel (CUX-CHECK)", () => {
  it("sorts reported issues into kinds by code, path and source", () => {
    expect(checkCategoryOf({ code: "missingTranslation", origin: "record", path: "name" })).toBe("translation");
    expect(checkCategoryOf({ code: "missingEnglishText", origin: "script", path: "quests.quests[0].title" }))
      .toBe("translation");
    expect(checkCategoryOf({ code: "unknownWare", origin: "record", path: "rewards.goods[0].ware" })).toBe("reward");
    expect(checkCategoryOf({ code: "unknownWare", origin: "record", path: "requiredCargo.goods[0].ware" }))
      .toBe("reference");
    expect(checkCategoryOf({ code: "invalidReward", origin: "reward", path: "rewards[1].item" })).toBe("reward");
    expect(checkCategoryOf({ code: "unusedTrigger", origin: "script", path: "triggers[0]" })).toBe("script");
    expect(checkCategoryOf({ code: "unknownReference", origin: "script", path: "triggers[1].conditions.of[0].a" }))
      .toBe("script");
    expect(checkCategoryOf({ code: "noSoldierSource", origin: "record", path: "victory" })).toBe("other");
  });

  it("the shared reward validator reports unknown reward lines", () => {
    const { maps } = fixture();
    const issues = rewardLineIssues(maps[0]!.rewards, "rewards");
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "invalidReward", path: "rewards[1].item", severity: "error" });
    expect(rewardLineIssues(null, "rewards")).toEqual([]);
  });

  it("groups the whole campaign by document and kind, with counts", () => {
    const { campaign, maps } = fixture();
    const report = fixtureReport(maps);
    const sections = checkSections(report, campaign, maps);
    expect(sections.map(section => section.id)).toEqual(["campaign", "m1"]);
    const [campaignSection, mapSection] = sections;
    expect(campaignSection).toMatchObject({ errors: 3, errorsLabel: "3 errors", title: "Campaign", warnings: 2 });
    expect(campaignSection!.groups.map(group => [group.category, group.entries.length])).toEqual([
      ["translation", 1], ["reference", 2], ["other", 2]
    ]);
    expect(campaignSection!.groups[2]!.entries[0]!.message).toContain("Fortress");
    expect(mapSection!.title).toBe("Landfall");
    const kinds = Object.fromEntries(mapSection!.groups.map(group => [group.category, group.entries.length]));
    expect(kinds.reward).toBe(2);
    expect(kinds.reference).toBe(2);
    expect(kinds.other).toBe(2);
    expect(kinds.translation).toBeGreaterThan(2);
    const scriptTranslations = mapSection!.groups.find(group => group.category === "translation")!.entries
      .filter(entry => entry.target.kind === "mapEditor");
    expect(scriptTranslations.length).toBeGreaterThan(0);
    const totals = reportTotals(report);
    expect(mapSection!.errors + campaignSection!.errors).toBe(totals.errors);
    expect(mapSection!.warnings + campaignSection!.warnings).toBe(totals.warnings);
    expect(checkSummary(report, maps)).toEqual({
      coverage: "Checked: the campaign and 2 of 2 maps.", totals: `${totals.errors} errors, ${totals.warnings} warnings.`
    });
  });

  it("gives every entry the place that fixes it", () => {
    const { campaign, maps } = fixture();
    const sections = checkSections(fixtureReport(maps), campaign, maps);
    const targets = (sectionIndex: number) => Object.fromEntries(sections[sectionIndex]!.groups
      .flatMap(group => group.entries).map(entry => [entry.message, entry]));
    const campaignTargets = Object.values(targets(0)).map(entry => entry.target);
    expect(campaignTargets).toEqual([
      { kind: "tab", language: "de", mapId: null, tab: "translations", textId: "campaign/speaker/advisor" },
      { kind: "tab", mapId: null, tab: "details" },
      { kind: "tab", mapId: null, tab: "speakers" },
      { kind: "tab", mapId: "m2", tab: "maps" },
      { kind: "tab", mapId: null, tab: "map-view" }
    ]);
    expect(Object.values(targets(0))[0]!.targetLabel).toBe("Go to: Translations\nField path: speakers[0].name");
    const recordTargets = sections[1]!.groups.flatMap(group => group.entries)
      .filter(entry => entry.id.startsWith("m1:") && Number(entry.id.split(":")[1]) < 8).map(entry => entry.target);
    expect(recordTargets).toEqual(expect.arrayContaining([
      { kind: "tab", language: "hu", mapId: "m1", tab: "translations", textId: "map/m1/name" },
      { kind: "tab", language: "de", mapId: "m1", tab: "translations", textId: "map/m1/quest/build/text" },
      { kind: "tab", language: "hu", mapId: "m1", tab: "translations", textId: "map/m1/sequence/seq-1/s2" },
      { kind: "mapEditor", mapId: "m1" },
      { kind: "tab", mapId: "m1", tab: "story" },
      { kind: "tab", mapId: "m1", tab: "maps" }
    ]));
    const mapEditorEntry = sections[1]!.groups.flatMap(group => group.entries)
      .find(entry => entry.target.kind === "mapEditor")!;
    expect(mapEditorEntry.targetLabel).toContain("Open the script editor at this item\nField path: ");
  });
});

const createHarness = () => {
  const navigations: string[] = [];
  let clock = 1_000;
  const repositories = createStoreCampaignRepositories(createMemoryCampaignRecordStore(), () => clock++);
  const editor = createCampaignEditor({
    confirm: () => true,
    imageUrls: { create: () => "blob:1", revoke: () => undefined },
    mapFiles: { delete: async () => undefined, read: async () => null },
    navigate: url => navigations.push(url),
    now: () => clock,
    pageUrl: () => "http://localhost/editor.html?mode=campaign",
    processImage: async () => ({ bytes: new Uint8Array([1]), height: 1, width: 1 }),
    prompt: () => "North isles",
    random: () => (clock % 997) / 997,
    repositories,
    serverSync: null,
    storage: "local",
    translate: text => resolveEditorText(undefined, text)
  });
  return { editor, navigations, repositories };
};

describe("campaign editor service: translation table edits, undo, jumps and the whole check", () => {
  it("an inline edit goes through the working copies (unsaved until Save) and undo restores the cell", async () => {
    const { editor, repositories } = createHarness();
    await editor.createCampaign();
    await editor.addMap();
    await editor.save();
    const mapId = editor.getState().draft!.mapIds[0]!;
    const mapNameId = `map/${mapId}/name`;

    editor.setText(mapNameId, "hu", "P");
    editor.setText(mapNameId, "hu", "Part");
    editor.setText("campaign/name", "de", "Nordinseln");
    let state = editor.getState();
    expect(state.dirty).toBe(true);
    expect(state.maps[0]!.name).toEqual({ en: "Map 1", hu: "Part" });
    expect(state.draft!.name.de).toBe("Nordinseln");
    expect(state.textEdits).toHaveLength(2);
    expect((await repositories.maps.get(mapId))!.name).toEqual({ en: "Map 1" });

    editor.undoTextEdit();
    expect(editor.getState().draft!.name.de).toBeUndefined();
    editor.undoTextEdit();
    state = editor.getState();
    expect(state.maps[0]!.name).toEqual({ en: "Map 1" });
    expect(state.textEdits).toEqual([]);
    editor.undoTextEdit();
    editor.setText("map/unknown/name", "hu", "x");
    expect(editor.getState().textEdits).toEqual([]);

    editor.setText(mapNameId, "hu", "Partraszállás");
    await editor.save();
    expect((await repositories.maps.get(mapId))!.name).toEqual({ en: "Map 1", hu: "Partraszállás" });
  });

  it("a jump selects the map and requests the tab; a new jump has a new revision", async () => {
    const { editor } = createHarness();
    await editor.createCampaign();
    await editor.addMap();
    await editor.addMap();
    const [first] = editor.getState().draft!.mapIds;
    editor.jumpTo({ language: "hu", mapId: first, tab: "translations", textId: `map/${first}/name` });
    expect(editor.getState()).toMatchObject({
      jump: { language: "hu", revision: 1, tab: "translations", textId: `map/${first}/name` }, selectedMapId: first
    });
    editor.jumpTo({ mapId: null, tab: "details" });
    expect(editor.getState()).toMatchObject({ jump: { revision: 2, tab: "details" }, selectedMapId: first });
  });

  it("Check covers the campaign and every map: map files, translations and reward lines", async () => {
    const { editor } = createHarness();
    await editor.createCampaign();
    await editor.addMap();
    await editor.addMap();
    const [first] = editor.getState().draft!.mapIds;
    editor.updateMap(first!, map => ({
      ...map, rewards: { ...map.rewards, decorations: [{ amount: 1, item: "no-such-decoration" }] }
    }));
    await editor.checkReady();
    const { draft, maps, notice, report } = editor.getState();
    expect(report!.maps.map(entry => entry.mapId)).toEqual(maps.map(map => map.id));
    expect(report!.maps.every(entry => entry.result.errors[0]!.code === "campaignMapFileMissing")).toBe(true);
    expect(report!.maps[0]!.rewards).toHaveLength(1);
    expect(report!.campaign.warnings.filter(issue => issue.code === "missingTranslation").map(issue =>
      issue.params.language)).toEqual(["hu", "de"]);
    const totals = reportTotals(report!);
    expect(resolveEditorText(undefined, notice!.text)).toBe(`${totals.errors} errors, ${totals.warnings} warnings.`);
    const direct = await checkWholeCampaign(draft!, maps,
      { imageIds: new Set(), readBytes: async () => null, settings: DEFAULT_ONLINE_SETTINGS });
    expect(reportTotals(direct)).toEqual(totals);
    const sections = checkSections(report!, draft!, maps);
    expect(sections.map(section => section.title)).toEqual(["Campaign", "Map 1", "Map 2"]);
  });
});

describe("readable issue paths (CUX-PATHS)", () => {
  const names = {
    actor: ["Scout"], homeReward: [], quest: ["story-intro"], trigger: ["Intro", "Wolves attack"], variable: ["kills"]
  };
  const plain = { i18n: undefined, language: "en" };

  it("names a script path by its trigger, quest or variable and the slot word", () => {
    expect(scriptPathLabel("triggers[1].conditions.of[0].a.variable", names, plain))
      .toBe("Trigger \"Wolves attack\" › first value");
    expect(scriptPathLabel("triggers[0]", names, plain)).toBe("Trigger \"Intro\"");
    expect(scriptPathLabel("quests.quests[0].title", names, plain)).toBe("Quest \"story-intro\" › title");
    expect(scriptPathLabel("variables[0].initial", names, plain)).toBe("Variable \"kills\" › initial");
    expect(scriptPathLabel("triggers[4].events[0].slots.killer", undefined, plain)).toBe("Trigger \"5\" › killer");
    expect(scriptPathLabel("triggers[1].conditions.of[0].a", names, { i18n: undefined, language: "hu" }))
      .toBe("Trigger \"Wolves attack\" › első érték");
  });

  it("names record paths by speaker, map and quest, and counts list items from one", () => {
    const { campaign, maps } = fixture();
    const context = { ...plain, campaign, mapNames: new Map([["m2", "Second shore"]]) };
    expect(recordPathLabel("speakers[0].name", null, context)).toBe("Speaker \"Advisor\" › name");
    expect(recordPathLabel("speakers[0].portraits.neutral", null, context))
      .toBe("Speaker \"Advisor\" › portraits › neutral");
    expect(recordPathLabel("mapIds[1]", null, context)).toBe("Map \"Second shore\"");
    expect(recordPathLabel("imageId", null, context)).toBe("image id");
    const questId = maps[0]!.quests[0]!.id;
    expect(recordPathLabel("quests[0].imageId", maps[0]!, context)).toBe(`Quest "${questId}" › image id`);
    expect(fieldPathLabel(["rewards", "goods", 0, "ware"], "en")).toBe("rewards › goods 1 › ware");
  });

  it("collects the item names of a script and shows no raw path in the Check messages", () => {
    const { campaign, maps } = fixture();
    const script = campaignRecordScript(maps[0]!);
    const collected = scriptPathNames(script);
    expect(collected.trigger).toEqual(script.triggers.map(trigger => trigger.name));
    const report = fixtureReport(maps);
    const withNames = { ...report, maps: report.maps.map(check => ({ ...check, scriptNames: collected })) };
    const entries = checkSections(withNames, campaign, maps).flatMap(section => section.groups)
      .flatMap(group => group.entries);
    expect(entries.filter(entry => /\w\[\d+\]/.test(entry.message))).toEqual([]);
    const speaker = entries.find(entry => entry.message.includes("Speaker \"Advisor\" › name"))!;
    expect(speaker.targetLabel).toContain("speakers[0].name");
  });
});

describe("campaign graph issues in the Check (BR3)", () => {
  /** m1 —victory→ m2 · m1 —exit-1 (no path) · m2 → m1 (a loop) · m2 still carries the previous-map lock. */
  const graphFixture = () => {
    const { campaign, maps } = fixture();
    const first = { ...maps[0]!, exits: [{ id: "exit-1", name: { en: "Spared" } }], unlock: [] };
    const branching: Campaign = {
      ...campaign, edges: [
        { exit: "victory", from: "m1", id: "edge-1", to: "m2" }, { exit: "victory", from: "m2", id: "edge-2", to: "m1" }
      ], startMapIds: ["m1"]
    };
    return { campaign: branching, maps: [first, maps[1]!] };
  };

  it("groups graph issues as campaign paths, names maps and exits, and jumps to the concerned map", () => {
    const { campaign, maps } = graphFixture();
    const report: CampaignReadyReport = {
      campaign: campaignValidationResult(validateCampaignGraph(campaign, new Map(maps.map(map => [map.id, map])))),
      maps: []
    };
    const group = checkSections(report, campaign, maps)[0]!.groups.find(entry => entry.category === "path")!;
    const entries = Object.fromEntries(group.entries.map(entry => [entry.message, entry.target]));
    expect(entries).toEqual({
      "Exit Spared of map Landfall leads nowhere: connect it to a map or let it end the campaign.":
        { kind: "tab", mapId: "m1", tab: "maps" },
      "No path of the campaign reaches a campaign end.": { kind: "tab", mapId: null, tab: "maps" },
      "Start map Landfall is also the target of a path.": { kind: "tab", mapId: null, tab: "details" },
      "The path from map Fortress to map Landfall closes a loop; a campaign path can never lead back.":
        { kind: "tab", mapId: "m2", tab: "maps" },
      "Map Fortress still requires the previous map; a branching campaign ignores that lock: remove it.":
        { kind: "tab", mapId: "m2", tab: "maps" }
    });
    expect(group.entries.find(entry => entry.message.includes("loop"))!.targetLabel)
      .toBe("Go to: Maps\nField path: edges[1]");
  });

  it("labels edges, start maps and exits by name; exit names join the translation table", () => {
    const { campaign, maps } = graphFixture();
    const context = { campaign, i18n: undefined, language: "en", mapNames: new Map([["m1", "Landfall"],
      ["m2", "Fortress"]]), maps };
    expect(recordPathLabel("edges[1].to", null, context))
      .toBe("Path \"Fortress: victory → Landfall\" › destination");
    expect(recordPathLabel("startMapIds[0]", null, context)).toBe("Map \"Landfall\"");
    expect(recordPathLabel("exits[0].victorySequenceId", maps[0]!, context))
      .toBe("Exit \"Spared\" › victory sequence id");
    expect(collectCampaignTexts(campaign, maps).find(text => text.kind === "exitName")).toMatchObject({
      id: "map/m1/exit/exit-1/name", issuePath: "exits[0].name", mapId: "m1"
    });
  });
});
