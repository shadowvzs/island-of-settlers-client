import { setupI18n } from "@lingui/core";
import { describe, expect, it } from "vitest";

import { questRewardEntries, questRewardsFromEntries } from "../../island-of-settlers-shared/src/script/quest-rewards";
import type { MultiboardDefinition } from "../../island-of-settlers-shared/src/script/types/multiboards";
import type { MapScript } from "../../island-of-settlers-shared/src/script/types/script";
import { validateMapScript } from "../../island-of-settlers-shared/src/script/validate";
import type { SlotPart } from "../src/app/map-editor/script/block-parts";
import { createActionStep } from "../src/app/map-editor/script/factory";
import type { ShownPart } from "../src/app/map-editor/script/form-rows";
import {
  addBoard, addColumn, boardOf, setCellFormat, updateBoard
} from "../src/app/map-editor/script/multiboards/board-edits";
import { previewBoard } from "../src/app/map-editor/script/multiboards/board-preview";
import { NEW_BOARD_TEXTS } from "../src/app/map-editor/script/multiboards/constants";
import { getAtPath, setAtPath } from "../src/app/map-editor/script/paths";
import { cellChoices, functionChoices } from "../src/app/map-editor/script/picker-options";
import { questBlocks } from "../src/app/map-editor/script/quests/helpers";
import { addHomeReward, removeHomeReward } from "../src/app/map-editor/script/quests/home-reward-edits";
import {
  addQuest, objectiveOf, removeQuest, replaceQuest, withCalendarField
} from "../src/app/map-editor/script/quests/quest-edits";
import { nextClaimDates } from "../src/app/map-editor/script/quests/repeat-preview";
import { createEmptyMapScript } from "../src/app/map-editor/script/script-document";
import { pickerTabs } from "../src/app/map-editor/script/slot-picker-model";
import { templateLabels } from "../src/app/map-editor/script/template-labels";
import { applyTemplate, DEFAULT_TEMPLATE_PARAMS } from "../src/app/map-editor/script/templates";
import { withTextLanguage } from "../src/app/map-editor/script/text-fields";
import { addSteps } from "../src/app/map-editor/script/trigger-edits";
import { indexIssues, itemIssues } from "../src/app/map-editor/script/validation";
import { VARIABLE_TYPES } from "../src/app/map-editor/script/variables/constants";
import {
  addVariable, editArray, removeVariable, retypeVariable
} from "../src/app/map-editor/script/variables/variable-edits";
import { messages as english } from "../src/locales/en/messages";

/** TRG12: variables, multiboards and the quest form (design §13.4–§13.6) as pure edits that stay Ready. */

const i18n = setupI18n({ locale: "en", messages: { en: english } });
const context = (script: MapScript) => ({ i18n, locale: "en", script });
const ready = (script: MapScript) => validateMapScript(script, { mapKind: "campaign" });
const template = (id: Parameters<typeof applyTemplate>[1]) => applyTemplate(createEmptyMapScript("uid"), id,
  { ...DEFAULT_TEMPLATE_PARAMS, labels: templateLabels(undefined, "T"), mapCenter: { x: 32, z: 32 } }).script;
const slots = (parts: readonly ShownPart[]): SlotPart[] =>
  parts.flatMap(part => (part.kind === "slot" ? [part.part, ...slots(part.children ?? [])] : []));

describe("variables", () => {
  it("every offered type starts valid (a player text asks for its English); arrays edit item by item", () => {
    let script = createEmptyMapScript("uid");
    for (const type of VARIABLE_TYPES) script = addVariable(script, type).script;
    const textIndex = script.variables.findIndex(item => item.type === "text");
    expect(ready(script).errors.map(issue => `${issue.code} ${issue.path}`))
      .toEqual([`missingEnglishText variables[${textIndex}].initial.value`]);
    expect(new Set(script.variables.map(item => item.name)).size).toBe(VARIABLE_TYPES.length);
    expect(editArray([1, 2], "number[]", 2, "x")).toEqual([1, 2, 0]);
    expect(editArray(["a", "b"], "string[]", 0, null)).toEqual(["b"]);
  });

  it("refuses delete and type change while a trigger or quest uses the variable, and names the users", () => {
    const script = template("killCounter");
    const counter = script.variables[0]!;
    const removed = removeVariable(script, counter.id);
    expect(removed).toMatchObject({ changed: false });
    expect(!removed.changed && removed.users).toEqual(expect.arrayContaining([expect.stringMatching(/^trigger:/),
      expect.stringMatching(/^quest:/)]));
    expect(retypeVariable(script, counter, "string")).toMatchObject({ changed: false });
    const unused = addVariable(script, "number");
    expect(removeVariable(unused.script, unused.variable.id)).toMatchObject({ changed: true });
  });
});

describe("multiboards", () => {
  it("a new board is Ready; a new column flags its unset cell; random is refused in cells", () => {
    const added = addBoard(createEmptyMapScript("uid"), NEW_BOARD_TEXTS);
    expect(ready(added.script).errors).toEqual([]);
    const withColumn = updateBoard(added.script, added.id, board => addColumn(board, NEW_BOARD_TEXTS.column));
    expect(ready(withColumn).errors.length).toBeGreaterThan(0);
    const random = updateBoard(added.script, added.id, board => setAtPath(board, ["cells", "c2", "expr"],
      { args: {}, fn: "random", k: "fn" }));
    expect(ready(random).errors.map(issue => issue.code)).toContain("multiboardCellRandom");
  });

  it("cell slots offer the row and never random; a fraction keeps the expression as its current value", () => {
    const script = createEmptyMapScript("uid");
    const spec = { kind: "value" as const, scope: { cell: true, locals: [], responses: [] }, type: "number" as const };
    expect(pickerTabs(spec)).toContain("cell");
    expect(functionChoices(null, context(script), true).map(choice => choice.key)).not.toContain("random");
    expect(cellChoices("number", context(script)).map(choice => choice.key)).toEqual(["rowIndex", "rowItem"]);
    const board: MultiboardDefinition = boardOf(addBoard(script, NEW_BOARD_TEXTS).script.variables[0])!;
    const fraction = setCellFormat(board, "c2", "fraction").cells.c2;
    expect(fraction).toEqual({ current: board.cells.c2 && "expr" in board.cells.c2 && board.cells.c2.expr,
      format: "fraction", target: { k: "lit", type: "number", value: 1 } });
  });

  it("the live preview runs the engine with initial values (planted 0 of 10)", () => {
    const script = template("plantBoard");
    const board = script.variables.find(item => item.type === "multiboard")!;
    const snapshot = previewBoard(script, board.id);
    expect(snapshot?.rows[0]?.cells[1]).toEqual({ current: 0, format: "fraction", target: 10 });
    expect(ready(script).errors).toEqual([]);
  });
});

describe("quest form", () => {
  it("adds a Ready quest; every Completed-when choice stays Ready", () => {
    const { quest, script } = addQuest(createEmptyMapScript("uid"), { de: "Neu", en: "New", hu: "Új" });
    for (const choice of ["condition", "counterReached", "scripted"] as const)
      expect(ready(replaceQuest(script, { ...quest, objective: objectiveOf(choice) })).errors, choice).toEqual([]);
  });

  it("refuses deleting a quest a trigger activates", () => {
    const script = template("collect");
    expect(removeQuest(script, script.quests.quests[0]!.id)).toMatchObject({ changed: false });
  });

  it("quest rows read their values at their paths; issues are indexed by quest", () => {
    const script = template("plantBoard");
    const quest = script.quests.quests[0]!;
    const blocks = questBlocks(quest, context(script), []);
    const parts = [...blocks.objective, ...blocks.onActivate.rows]
      .flatMap(row => ("block" in row ? slots(row.block.parts) : []));
    expect(parts.length).toBeGreaterThan(0);
    for (const part of parts) {
      if (part.spec.kind === "choice" && part.path.at(-1) === "op") continue;
      expect(getAtPath(quest, part.path), part.key).toEqual(part.value);
    }
    const broken = setAtPath(script, ["quests", "quests", 0, "objective", "progress", "target"],
      { k: "lit", type: "string", value: "x" });
    const issues = itemIssues(indexIssues(ready(broken), "en"), "quest", 0);
    expect(issues.some(issue => issue.path.join(".") === "objective.progress.target")).toBe(true);
  });

  it("step ids stay unique across a quest's action lists", () => {
    const quest = template("plantBoard").quests.quests[0]!;
    const next = addSteps(quest, ["onFailure"], [createActionStep("notify", "s1")]);
    const ids = [...next.onActivate, ...next.onSuccess, ...next.onFailure].map(step => step.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("rewards round-trip through RewardPicker lines", () => {
    const rewards = { buildingUnlocks: [3], coins: 5, decorations: [], gems: 0, goods: [{ amount: 2, ware: "planks" }],
      soldiers: [{ amount: 1, rank: 1, type: "archer" as const }], xp: 40 };
    expect(questRewardsFromEntries(questRewardEntries(rewards))).toEqual(rewards);
    expect(questRewardsFromEntries([])).toBeNull();
  });

  it("previews the next claim dates on the fixed UTC grid", () => {
    const start = Date.UTC(2026, 10, 11, 10, 30);
    expect(nextClaimDates({ days: 1, hours: 0, kind: "interval", minutes: 0, retryAfterFail: false }, start, 2))
      .toEqual([start + 86_400_000, start + 2 * 86_400_000]);
    const weekly = withCalendarField({ kind: "calendar", minuteUtc: 6 * 60, retryAfterFail: false }, "weekday", "1");
    expect(nextClaimDates(weekly, start, 1)).toEqual([Date.UTC(2026, 10, 16, 6, 0)]);
    expect(nextClaimDates({ kind: "once", retryAfterFail: false }, start, 3)).toEqual([]);
  });

  it("declared home rewards: added Ready, delete refused while a trigger grants them", () => {
    const added = addHomeReward(createEmptyMapScript("uid"), "Bonus");
    expect(ready(added.script).errors).toEqual([]);
    const granted = { ...added.script, triggers: [{ actions: [{ args: { reward: { id: added.reward.id, k: "ref",
      kind: "reward" } }, id: "s1", k: "do", op: "grantHomeReward" }], concurrency: "queue",
    conditions: { k: "all", of: [] }, enabled: true, events: [{ kind: "mapStarted", player: { kind: "any" },
      slots: {} }], folderId: null, id: "trigger-1", name: "Grant", runLimit: null }] } as MapScript;
    expect(removeHomeReward(granted, added.reward.id)).toMatchObject({ changed: false });
    expect(removeHomeReward(added.script, added.reward.id)).toMatchObject({ changed: true });
  });

  it("texts drop an emptied translation but keep English", () => {
    expect(withTextLanguage({ de: "x", en: "a" }, "de", " ")).toEqual({ en: "a" });
    expect(withTextLanguage({ en: "a" }, "en", "")).toEqual({ en: "" });
  });
});
