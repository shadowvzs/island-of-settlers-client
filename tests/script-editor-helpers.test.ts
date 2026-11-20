import { setupI18n } from "@lingui/core";
import { catalogEntries, getContentEntry } from "@shared/catalog";
import { describe, expect, it } from "vitest";

import { decodeHeaderScript, encodeHeaderScript } from "../../island-of-settlers-shared/src/script/codec";
import type { MapScript } from "../../island-of-settlers-shared/src/script/types/script";
import type { ScriptTrigger } from "../../island-of-settlers-shared/src/script/types/triggers";
import { validateMapScript } from "../../island-of-settlers-shared/src/script/validate";
import {
  chiefFlees, escortArcher, huntCounter, plantTrees, seaStar, shipReinforcements, tutorialUi
} from "../../island-of-settlers-shared/tests/script-fixtures";
import type { BlockPart, SlotPart } from "../src/app/map-editor/script/block-parts";
import { triggerBlocks } from "../src/app/map-editor/script/blocks";
import { entryBadge, entryIcon, familyLabel } from "../src/app/map-editor/script/catalog-options";
import { explainTrigger } from "../src/app/map-editor/script/explain";
import { createCondition } from "../src/app/map-editor/script/factory";
import { FAMILY_NAMES } from "../src/app/map-editor/script/family-names";
import { getAtPath, parseIssuePath, setAtPath } from "../src/app/map-editor/script/paths";
import { createEmptyMapScript } from "../src/app/map-editor/script/script-document";
import { createScriptWorkspace } from "../src/app/map-editor/script/script-workspace";
import { templateLabels } from "../src/app/map-editor/script/template-labels";
import {
  applyTemplate, DEFAULT_TEMPLATE_PARAMS, TEMPLATE_IDS, TEMPLATES, templatesFor
} from "../src/app/map-editor/script/templates";
import { indexIssues, triggerIssues, validateEditedScript } from "../src/app/map-editor/script/validation";
import { messages as english } from "../src/locales/en/messages";
import { messages as hungarian } from "../src/locales/hu/messages";
import type { WorldData } from "../src/shared/world/world-data";

const i18n = setupI18n({ locale: "en", messages: { en: english, hu: hungarian } });
const context = (script: MapScript, locale = "en") => ({ i18n, locale, script });

const slotParts = (parts: readonly BlockPart[]): SlotPart[] => parts.flatMap(part => {
  if (part.kind !== "slot") return [];
  return [part, ...slotParts(part.children ?? [])];
});

const allSlots = (trigger: ScriptTrigger, script: MapScript) => {
  const blocks = triggerBlocks(trigger, context(script));
  return [
    ...blocks.events.flatMap(row => slotParts(row.parts)),
    ...[...blocks.conditions, ...blocks.actions].flatMap(row => ("block" in row ? slotParts(row.block.parts) : []))
  ];
};

const FIXTURES = { chiefFlees, escortArcher, huntCounter, plantTrees, seaStar, shipReinforcements, tutorialUi };

describe("sentence blocks ↔ data", () => {
  it("every slot reads its value at its path, and writing the values back leaves the trigger unchanged", () => {
    for (const [name, fixture] of Object.entries(FIXTURES)) {
      const script = fixture();
      for (const trigger of script.triggers) {
        const slots = allSlots(trigger, script);
        expect(slots.length, name).toBeGreaterThan(0);
        let rebuilt = structuredClone(trigger);
        for (const slot of slots) {
          if (slot.spec.kind === "choice" && slot.path.at(-1) === "op") continue;
          expect(getAtPath(trigger, slot.path), `${name} ${slot.key}`).toEqual(slot.value);
          rebuilt = setAtPath(rebuilt, slot.path, slot.value);
        }
        expect(rebuilt).toEqual(trigger);
      }
    }
  });

  it("the hunt counter reads as a sentence and its explain line names the parts", () => {
    const script = huntCounter();
    const [trigger] = script.triggers;
    const blocks = triggerBlocks(trigger!, context(script));
    const text = blocks.events[0]!.parts.map(part => (part.kind === "text" ? part.text : `[${part.summary}]`))
      .join("");
    expect(text).toContain("[Player 1]'s [Hunter] kills [");
    expect(blocks.events[0]!.canInvert).toBe(true);
    expect(explainTrigger(trigger!, context(script))).toMatch(/^When Player 1's Hunter kills .*, increase deerCount/);
  });

  it("the inverse wording keeps the same kind and slots", () => {
    const script = huntCounter();
    const trigger = script.triggers[0]!;
    const inverse = setAtPath(trigger, ["events", 0, "phrasing"], "inverse");
    expect(inverse.events[0]!.slots).toEqual(trigger.events[0]!.slots);
    const row = triggerBlocks(inverse, context(script)).events[0]!;
    expect(row.parts[0]).toMatchObject({ kind: "slot", path: ["events", 0, "slots", "victim"] });
    expect(validateMapScript({ ...script, triggers: [inverse] }, { mapKind: "home" }).ready).toBe(true);
  });

  it("parses issue paths and removes unset optional fields", () => {
    expect(parseIssuePath("triggers[3].events[0].slots.killer")).toEqual(["triggers", 3, "events", 0, "slots",
      "killer"]);
    expect(setAtPath({ a: { b: 1, c: 2 } }, ["a", "b"], undefined)).toEqual({ a: { c: 2 } });
  });
});

describe("templates", () => {
  const center = { x: 32, z: 32 };
  it("every template inserts a Ready script on each map kind it lists", () => {
    for (const id of TEMPLATE_IDS) {
      const { firstTrigger, script } = applyTemplate(createEmptyMapScript("uid-test"), id,
        { ...DEFAULT_TEMPLATE_PARAMS, labels: templateLabels(undefined, "T"), mapCenter: center });
      expect(firstTrigger, id).toBeTruthy();
      for (const mapKind of TEMPLATES[id].mapKinds) {
        const result = validateMapScript(script, { mapKind });
        expect(result.errors, `${id} on ${mapKind}`).toEqual([]);
      }
    }
  });

  it("goal templates stay Ready with every option (EXT-TEMPLATES)", () => {
    const base = { ...DEFAULT_TEMPLATE_PARAMS, labels: templateLabels(undefined, "T"), mapCenter: center };
    const withRegion = applyTemplate(createEmptyMapScript("uid-test"), "reachArea", base).script;
    const variants = [
      { id: "buildCount", params: { ...base, board: false, building: "sawmill" }, script: withRegion },
      { id: "captureIsland", params: { ...base, goal: "defeat" }, script: withRegion },
      { id: "holdRegion", params: { ...base, region: withRegion.regions[0]!.id, seconds: 120 }, script: withRegion },
      { id: "collectDeadline", params: { ...base, count: 25, seconds: 600, ware: "stone" }, script: withRegion }
    ] as const;
    for (const { id, params, script } of variants) {
      const inserted = applyTemplate(script, id, params).script;
      expect(inserted.regions, id).toHaveLength(1);
      for (const mapKind of TEMPLATES[id].mapKinds)
        expect(validateMapScript(inserted, { mapKind }).errors, `${id} on ${mapKind}`).toEqual([]);
    }
    const boardless = applyTemplate(createEmptyMapScript("uid-test"), "buildCount", variants[0].params).script;
    expect(boardless.variables.map(item => item.type)).toEqual(["number"]);
    expect(boardless.nextIds.variable).toBe(1);
  });

  it("offers the trade quest only at home and map victories only where a map can be won", () => {
    expect(templatesFor("home")).toContain("tradeQuest");
    expect(templatesFor("home")).not.toContain("captureIsland");
    for (const mapKind of ["adventure", "campaign"] as const) {
      expect(templatesFor(mapKind)).toContain("captureIsland");
      expect(templatesFor(mapKind)).not.toContain("tradeQuest");
    }
    expect(templatesFor("colony")).not.toContain("captureIsland");
    const trade = applyTemplate(createEmptyMapScript("uid-test"), "tradeQuest",
      { ...DEFAULT_TEMPLATE_PARAMS, labels: templateLabels(undefined, "T"), mapCenter: center }).script;
    expect(validateMapScript(trade, { mapKind: "adventure" }).errors).not.toEqual([]);
  });

  it("inserting twice allocates fresh ids and names", () => {
    const params = { ...DEFAULT_TEMPLATE_PARAMS, labels: templateLabels(undefined, "T"), mapCenter: center };
    const once = applyTemplate(createEmptyMapScript("uid-test"), "killCounter", params).script;
    const twice = applyTemplate(once, "killCounter", params).script;
    expect(new Set(twice.triggers.map(item => item.id)).size).toBe(twice.triggers.length);
    expect(twice.variables.map(item => item.name)).toEqual(["killCount", "killCount2"]);
    expect(validateMapScript(twice, { mapKind: "home" }).errors).toEqual([]);
  });
});

describe("validation display", () => {
  it("maps issues to their trigger and slot with a readable subject in both languages", () => {
    const script = huntCounter();
    const broken = setAtPath(script, ["triggers", 0, "actions", 0, "args", "amount"], null);
    const world = { cellsX: 64, scenario: undefined };
    const result = validateEditedScript(world, broken);
    const english = triggerIssues(indexIssues(result, "en"), 0);
    expect(english).toContainEqual(expect.objectContaining({ path: ["actions", 0, "args", "amount"],
      severity: "error" }));
    expect(english[0]!.text).toMatch(/^amount: /);
    expect(triggerIssues(indexIssues(result, "hu"), 0)[0]!.text).toMatch(/^mennyiség: /);
  });
});

describe("workspace commits into the map header", () => {
  const createStore = () => {
    let tool: { kind: string } | null = null;
    return { clearTool: () => { tool = null; }, getState: () => ({ tool }), selectTool: (kind: string) => {
      tool = { kind };
    }, setHint: () => undefined, subscribe: () => () => undefined };
  };

  it("writes a frozen script to world.script that the header codec round-trips; undo restores it", () => {
    const world = { cellsX: 64, cellsZ: 64, scenario: undefined, script: undefined } as unknown as WorldData;
    const workspace = createScriptWorkspace({ onEdit: () => true, store: createStore() as never, world });
    const { script } = applyTemplate(workspace.getSnapshot().script, "killCounter",
      { ...DEFAULT_TEMPLATE_PARAMS, labels: templateLabels(undefined, "T"), mapCenter: { x: 32, z: 32 } });
    expect(workspace.commit(script)).toBe(true);
    expect(Object.isFrozen(world.script)).toBe(true);
    const decoded = decodeHeaderScript(JSON.parse(JSON.stringify(encodeHeaderScript(world.script))));
    expect(decoded?.script).toEqual(world.script);
    expect(workspace.getSnapshot().validation.ready).toBe(true);
    workspace.undo();
    expect(world.script?.triggers).toEqual([]);
  });

  it("pick on map makes a circular region at the click and hands its id over", () => {
    const world = { cellsX: 64, cellsZ: 64, scenario: undefined, script: undefined } as unknown as WorldData;
    const workspace = createScriptWorkspace({ onEdit: () => true, store: createStore() as never, world });
    let picked = "";
    workspace.beginPick("region", result => { if ("regionId" in result) picked = result.regionId; });
    workspace.pickAt({ x: 10, z: 12 });
    expect(picked).toBe("region-1");
    expect(world.script?.regions[0]?.shape).toMatchObject({ centerX: 10, centerZ: 12, kind: "circle" });
    expect(workspace.getSnapshot().pick).toBeNull();
  });
});

describe("review fixes (TRG11 review 2026-11-11)", () => {
  it("shows real icons; only the kinds without any game art keep the initial placeholder", () => {
    const placeholders = new Set(catalogEntries().filter(entry => !entry.retired && entry.actor &&
      !entryIcon(entry, "roman")).map(entry => entry.kind));
    expect([...placeholders].sort()).toEqual(["bandit", "bird", "butterfly", "critter", "fish", "plant", "shell",
      "whale"]);
    const hunter = getContentEntry("settler:hunter")!;
    expect(entryIcon(hunter, "roman")).toMatchObject({ kind: "image" });
    expect(entryBadge(hunter, "roman")).toMatchObject({ kind: "ware" });
  });

  it("names every catalog family in the editor language (no English segment in Hungarian)", () => {
    const hungarianI18n = setupI18n({ locale: "hu", messages: { hu: hungarian } });
    const paths = new Set(catalogEntries().filter(entry => !entry.retired && entry.actor).flatMap(entry =>
      entry.family.split(".").map((_, index, parts) => parts.slice(0, index + 1).join("."))));
    const named = (path: string) => Boolean(FAMILY_NAMES[path]) ||
      Boolean(getContentEntry(`${path.split(".")[0]}:${path.split(".").at(-1)}`));
    expect([...paths].filter(path => !named(path))).toEqual([]);
    expect(familyLabel("animal.deer", hungarianI18n)).toBe("Szarvas");
    expect(familyLabel("soldier", hungarianI18n)).toBe("Katona");
  });

  it("puts the owner after a type or family and names template triggers in the editor language", () => {
    const script = huntCounter();
    const hu = triggerBlocks(script.triggers[0]!, { i18n: setupI18n({ locale: "hu", messages: { hu: hungarian } }),
      locale: "hu", script }).events[0]!;
    const victim = hu.parts.find(part => part.kind === "slot" && part.path.at(-1) === "victim");
    expect(victim && "summary" in victim && victim.summary).toBe(
      "Szarvas család (Szarvas, Vapiti) – gazdátlan (vadvilág, díszlet)");
    const en = triggerBlocks(script.triggers[0]!, context(script)).events[0]!.parts
      .find(part => part.kind === "slot" && part.path.at(-1) === "victim");
    expect(en && "summary" in en && en.summary).toBe("Deer family (Deer, Elk) – ownerless (wildlife, scenery)");
    const labels = templateLabels(setupI18n({ locale: "hu", messages: { hu: hungarian } }), "Zsákmányszámláló");
    expect(labels.killCounter).toBe("Zsákmányszámláló");
    expect(labels.start).toBe("Zsákmányszámláló · indítás");
  });

  it("a new comparison starts with flagged empty operands, and a German sentence exists", () => {
    const script = huntCounter();
    const withCompare = setAtPath(script, ["triggers", 0, "conditions"], { k: "all", of: [createCondition("compare")] });
    const row = triggerBlocks(withCompare.triggers[0]!, context(withCompare)).conditions[0]!;
    expect("block" in row && row.block.parts.filter(part => part.kind === "slot").map(part => "summary" in part &&
      part.summary)).toEqual(["", "=", ""]);
    expect(validateMapScript(withCompare, { mapKind: "home" }).ready).toBe(false);
    expect(triggerBlocks(script.triggers[0]!, context(script, "de")).events[0]!.parts
      .map(part => (part.kind === "text" ? part.text : "[]")).join("")).toBe("[] von [] erlegt []");
  });

  it("asks before saving a map whose script has errors and never blocks a Ready one", () => {
    const world = { cellsX: 64, cellsZ: 64, scenario: undefined, script: undefined } as unknown as WorldData;
    const questions: string[] = [];
    const workspace = createScriptWorkspace({ confirmSave: question => { questions.push(question); return false; },
      onEdit: () => true, store: { clearTool: () => undefined, getState: () => ({ tool: null }),
        selectTool: () => undefined, setHint: () => undefined, subscribe: () => () => undefined } as never, world });
    expect(workspace.confirmDraftSave()).toBe(true);
    workspace.commit(setAtPath(huntCounter(), ["triggers", 0, "actions", 0, "args", "amount"], null));
    expect(workspace.confirmDraftSave()).toBe(false);
    expect(questions[0]).toMatch(/1 error\. Save the map as a draft anyway/);
  });
});
