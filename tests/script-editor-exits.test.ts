import { describe, expect, it } from "vitest";

import {
  type CampaignMapExit, createCampaignMap
} from "../../island-of-settlers-shared/src/campaign/campaign-model";
import {
  createMemoryCampaignRecordStore, createStoreCampaignRepositories
} from "../../island-of-settlers-shared/src/campaign/campaign-store-repository";
import type { MapScript } from "../../island-of-settlers-shared/src/script/types/script";
import {
  doStep, emptyScript, ref, str, trigger
} from "../../island-of-settlers-shared/tests/script-fixtures";
import { createCampaignSlotRecord } from "../src/app/map-editor/campaign/campaign-slot-record";
import type { BlockPart, SlotPart } from "../src/app/map-editor/script/block-parts";
import { triggerBlocks } from "../src/app/map-editor/script/blocks";
import { type DescribeContext, scriptExitOptions } from "../src/app/map-editor/script/describe";
import { tabChoices } from "../src/app/map-editor/script/picker-choices";
import { createScriptWorkspace } from "../src/app/map-editor/script/script-workspace";
import { pickerTabs } from "../src/app/map-editor/script/slot-picker-model";
import { validateEditedScript } from "../src/app/map-editor/script/validation";
import { createMapScenario } from "../src/shared/world/map-scenario";
import type { WorldData } from "../src/shared/world/world-data";

/** BR2: the `endMap` exit slot of the script editor offers the campaign map's exits. */

const EXITS: CampaignMapExit[] = [
  { id: "exit-1", name: { en: "The village was spared", hu: "A falu megmenekült" } },
  { id: "exit-2", name: { en: " " } }
];
const endMap = (exit?: string): MapScript => emptyScript({ triggers: [trigger("t1", { actions: [doStep("s1", "endMap",
  { outcome: str("victory"), ...(exit ? { exit: ref("exit", exit) } : {}) })] })] });

const exitSlot = (script: MapScript, context: Omit<DescribeContext, "script">) => {
  const row = triggerBlocks(script.triggers[0]!, { ...context, script }).actions[0]!;
  const parts: readonly BlockPart[] = "block" in row ? row.block.parts : [];
  return parts.find((part): part is SlotPart => part.kind === "slot" && part.path.at(-1) === "exit");
};

const world = (kind: "adventure" | "campaign", script: MapScript) =>
  ({ cellsX: 64, cellsZ: 64, scenario: { ...createMapScenario(), kind }, script }) as unknown as WorldData;
const STORE = { clearTool: () => undefined, getState: () => ({ tool: null }), selectTool: () => undefined,
  setHint: () => undefined, subscribe: () => () => undefined } as never;
const settled = () => new Promise(resolve => setTimeout(resolve, 0));

describe("endMap exit slot (BR2)", () => {
  it("lists the implicit exit first, then the declared exits by name in the active language", () => {
    expect(scriptExitOptions(EXITS, "hu-HU")).toEqual([
      { id: "victory", name: "győzelem" }, { id: "exit-1", name: "A falu megmenekült" },
      { id: "exit-2", name: "exit-2" }
    ]);
    expect(scriptExitOptions([], "en").map(option => option.name)).toEqual(["victory"]);
  });

  it("offers the slot on a campaign map only, as one list of the map's exits", () => {
    const exits = scriptExitOptions(EXITS, "en");
    const slot = exitSlot(endMap("exit-1"), { exits, locale: "en" })!;
    expect([slot.optional, slot.summary, slot.spec]).toEqual(
      [true, "The village was spared", { kind: "ref", ref: "exit", scope: expect.anything() }]);
    expect(pickerTabs(slot.spec)).toEqual(["list"]);
    const choices = tabChoices("list", slot.spec, { exits, locale: "en", script: endMap() });
    expect(choices.map(choice => [choice.label, choice.value])).toEqual([
      ["victory", ref("exit", "victory")], ["The village was spared", ref("exit", "exit-1")],
      ["exit-2", ref("exit", "exit-2")]
    ]);
    expect(exitSlot(endMap(), { exits, locale: "en" })?.summary).toBe("");
  });

  it("hides the empty slot off a campaign map, but shows a stray exit so it can be cleared", () => {
    expect(exitSlot(endMap(), { locale: "en" })).toBeUndefined();
    expect(exitSlot(endMap("exit-1"), { locale: "en" })?.summary).toBe("exit-1");
  });
});

describe("live exit check of the edited script (BR2)", () => {
  it("checks exits only when the campaign record's exits are known", () => {
    const codes = (exits: readonly CampaignMapExit[] | null, exit: string) =>
      validateEditedScript(world("campaign", endMap()), endMap(exit), exits).errors.map(issue => issue.code);
    expect(codes(null, "exit-9")).toEqual([]);
    expect(codes(EXITS, "exit-9")).toEqual(["endMapUnknownExit"]);
    expect(codes(EXITS, "exit-2")).toEqual([]);
    expect(codes([], "victory")).toEqual([]);
    expect(validateEditedScript(world("adventure", endMap()), endMap("exit-1")).errors.map(issue => issue.code))
      .toEqual(["endMapExitOffCampaign"]);
  });

  it("loads the record's exits into the workspace, re-checks, and reads them again on refresh", async () => {
    let declared: CampaignMapExit[] | null = EXITS;
    const workspace = createScriptWorkspace({ mapExits: async () => declared, onEdit: () => true, store: STORE,
      world: world("campaign", endMap("exit-3")) });
    expect(workspace.getSnapshot()).toMatchObject({ campaignMap: true, mapExits: null });
    expect(workspace.getSnapshot().validation.ready).toBe(true);
    await settled();
    expect(workspace.getSnapshot().mapExits).toEqual(EXITS);
    expect(workspace.getSnapshot().validation.errors.map(issue => issue.code)).toEqual(["endMapUnknownExit"]);
    declared = [...EXITS, { id: "exit-3", name: { en: "Retreat" } }];
    workspace.refresh();
    await settled();
    expect(workspace.getSnapshot().validation.ready).toBe(true);
    declared = null;
    workspace.refresh();
    await settled();
    expect(workspace.getSnapshot().mapExits).toBeNull();
  });

  it("knows no exits without a campaign record, and no campaign map off a campaign scenario", async () => {
    const workspace = createScriptWorkspace({ onEdit: () => true, store: STORE, world: world("adventure", endMap()) });
    await settled();
    expect(workspace.getSnapshot()).toMatchObject({ campaignMap: false, mapExits: null });
  });
});

describe("campaign slot record exits (BR2)", () => {
  it("reads the map's declared exits fresh; null for a missing record", async () => {
    const repositories = createStoreCampaignRepositories(createMemoryCampaignRecordStore());
    const slot = { campaignId: "c1", mapId: "m1", slotId: "campaign/c1/m1" };
    const record = createCampaignSlotRecord(slot, async () => repositories);
    expect(await record.exits()).toBeNull();
    const map = await repositories.maps.create(createCampaignMap("m1", "c1", { hash: null, id: slot.slotId }));
    expect(await record.exits()).toEqual([]);
    await repositories.maps.update({ ...map, exits: EXITS, nextExitNumber: 3 });
    expect(await record.exits()).toEqual(EXITS);
    expect(await createCampaignSlotRecord(slot, async () => null).exits()).toBeNull();
  });
});
