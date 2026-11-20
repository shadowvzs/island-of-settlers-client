import { describe, expect, it, vi } from "vitest";

import { ACTION_CATALOG } from "../../island-of-settlers-shared/src/script/catalog/actions";
import { decodeHeaderScript, encodeHeaderScript } from "../../island-of-settlers-shared/src/script/codec";
import type { ScriptActionRequest } from "../../island-of-settlers-shared/src/script/engine/ports";
import type { MapScript } from "../../island-of-settlers-shared/src/script/types/script";
import {
  bool, doStep, emptyScript, str, trigger
} from "../../island-of-settlers-shared/tests/script-fixtures";
import type { BlockPart, SlotPart } from "../src/app/map-editor/script/block-parts";
import { triggerBlocks } from "../src/app/map-editor/script/blocks";
import { ACTION_GROUPS } from "../src/app/map-editor/script/constants";
import { createActionStep } from "../src/app/map-editor/script/factory";
import { setAtPath } from "../src/app/map-editor/script/paths";
import { tabChoices } from "../src/app/map-editor/script/picker-choices";
import { actionSentence, choiceLabel } from "../src/app/map-editor/script/sentences";
import { pickerTabs } from "../src/app/map-editor/script/slot-picker-model";
import { validateEditedScript } from "../src/app/map-editor/script/validation";
import { COMMANDER_PROFILES } from "../src/shared/balance/commander-profiles";
import type { ScriptActionHost } from "../src/shared/script-world/actions/action-host";
import { FACTION_AI_ACTIONS } from "../src/shared/script-world/actions/faction-ai";
import { createCommanderLevels } from "../src/shared/settlement/commander/commander-levels";
import { createCommanderProfileSource } from "../src/shared/settlement/commander/commander-profile-source";
import { createFactionAi } from "../src/shared/settlement/economy-ai/faction-ai";
import type { FactionAiSave } from "../src/shared/settlement/economy-ai/faction-ai-types";
import {
  applyFactionAiChange, type FactionAiChange, factionAiSetting
} from "../src/shared/settlement/faction-ai-script";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import { FACTION_AI_LEVELS, FACTION_AI_MODES, FACTION_AI_STYLES } from "../src/shared/world/constants";
import { createMapScenario, type MapScenario } from "../src/shared/world/map-scenario";
import type { ScenarioFactionAi } from "../src/shared/world/scenario-faction-ai";
import type { WorldData } from "../src/shared/world/world-data";
import { createBalanceSimulation } from "../tools/bench/garrison-balance-harness";
import { stateHashOf } from "../tools/bench/military-a14-metrics";

vi.mock("../src/shared/world/generation/generate-world", async (importOriginal) =>
  (await import("./helpers/world-cache-store")).cachedGenerateWorldModule(importOriginal));

/** EAI2c: the script actions `setFactionAi` and `factionAiPause`: Ready rules, the tick, the save and the editor. */

type Kind = MapScenario["kind"];

const faction = (id: number) => ({ faction: id, kind: "slot" as const });
const scenario = (factionAi: ScenarioFactionAi[] | undefined, kind: Kind = "campaign", settlers = 100): MapScenario =>
  ({ ...createMapScenario(), kind, settlers, ...(factionAi ? { factionAi } : {}) });
const scriptOf = (...steps: [op: string, args: Record<string, unknown>][]): MapScript => emptyScript({ triggers: [
  trigger("t-ai", { actions: steps.map(([op, args], index) => doStep(`s${index + 1}`, op, args)) })
] });
const setAi = (id: unknown, change: Record<string, string>): [string, Record<string, unknown>] =>
  ["setFactionAi", { faction: id, ...Object.fromEntries(Object.entries(change).map(([key, value]) =>
    [key, str(value)])) }];
const pause = (id: unknown, paused = true): [string, Record<string, unknown>] =>
  ["factionAiPause", { faction: id, paused: bool(paused) }];

/** An AI entry with a depot start, so it may play every mode. */
const entry = (id: number, mode: ScenarioFactionAi["mode"], fields: Partial<ScenarioFactionAi> = {}):
  ScenarioFactionAi => ({ faction: id, mode, start: { settlers: 10, stock: {} }, ...fields });
const unit = (id: number): MapScenario["units"][number] =>
  ({ faction: id, group: 0, heading: 0, id: 100 + id, rank: 0, type: "shield", x: 20, z: 20 });
const MAP: ScenarioFactionAi[] = [entry(1, "maintain"), entry(2, "none"), entry(3, "develop")];
/** The saved economy AI state without its clocks: what scripts and the map set. */
/** The script-facing part of the saved faction AI: no clocks, no develop memory (discovered cells, EAI3c). */
const withoutClocks = (saved: readonly FactionAiSave[] | undefined) =>
  saved?.map(({ develop: _develop, due: _due, ...rest }) => rest);

describe("Ready rules of the faction AI actions", () => {
  const errors = (script: MapScript, map: MapScenario | undefined) =>
    validateEditedScript({ cellsX: 128, cellsZ: 128, scenario: map } as unknown as WorldData, script).errors
      .map(issue => `${issue.code} ${issue.path}`);
  const ARGS = "triggers[0].actions[0].args";

  it("accepts a switch and a pause of a faction with an AI entry, a `none` entry included", () => {
    const script = scriptOf(setAi(faction(1), { level: "hard" }), setAi(faction(2), { mode: "maintain" }),
      setAi(faction(3), { mode: "develop", style: "turtle" }), pause(faction(1)), pause(faction(2), false));
    expect(errors(script, scenario(MAP))).toEqual([]);
  });

  it("refuses both actions on a home map", () => {
    expect(errors(scriptOf(setAi(faction(1), { mode: "maintain" }), pause(faction(1))), scenario(undefined, "home")))
      .toEqual([
        "notOnMapKind triggers[0].actions[0].op", `factionWithoutAi ${ARGS}.faction`,
        "notOnMapKind triggers[0].actions[1].op", "factionWithoutAi triggers[0].actions[1].args.faction"
      ]);
    expect(errors(scriptOf(setAi(faction(1), { mode: "maintain" })), undefined)[0])
      .toBe("notOnMapKind triggers[0].actions[0].op");
  });

  it("refuses a faction without an AI entry, the player and player groups", () => {
    for (const target of [faction(4), faction(0), { kind: "computers" }, { kind: "any" }]) {
      expect(errors(scriptOf(setAi(target, { mode: "maintain" })), scenario(MAP)), JSON.stringify(target))
        .toEqual([`factionWithoutAi ${ARGS}.faction`]);
      expect(errors(scriptOf(pause(target)), scenario(MAP))).toEqual([`factionWithoutAi ${ARGS}.faction`]);
    }
    expect(errors(scriptOf(setAi(faction(1), { mode: "maintain" })), scenario(undefined)))
      .toEqual([`factionWithoutAi ${ARGS}.faction`]);
  });

  it("accepts a faction that only owns units or buildings: maintain and pause, but develop needs settlers", () => {
    const map = { ...scenario(MAP), units: [unit(5)] };
    expect(errors(scriptOf(setAi(faction(5), { level: "easy", mode: "maintain" }), pause(faction(5))), map))
      .toEqual([]);
    expect(errors(scriptOf(setAi(faction(6), { mode: "maintain" })), map))
      .toEqual([`factionWithoutAi ${ARGS}.faction`]);
    expect(errors(scriptOf(setAi(faction(5), { mode: "develop" })), { ...map, factionAi: [entry(1, "maintain")] }))
      .toEqual([`factionAiDevelopWithoutSettlers ${ARGS}.mode`]);
    expect(errors(scriptOf(setAi(faction(5), { mode: "maintain" })), { ...scenario(undefined, "home"),
      units: [unit(5)] })).toContain(`factionWithoutAi ${ARGS}.faction`);
  });

  it("refuses a second develop faction: beside the map's and beside another script switch", () => {
    expect(errors(scriptOf(setAi(faction(1), { mode: "develop" })), scenario(MAP)))
      .toEqual([`factionAiSecondDevelop ${ARGS}.mode`]);
    expect(errors(scriptOf(setAi(faction(3), { mode: "develop" })), scenario(MAP))).toEqual([]);
    const noDevelop = [entry(1, "maintain"), entry(2, "maintain")];
    expect(errors(scriptOf(setAi(faction(1), { mode: "develop" }), setAi(faction(1), { mode: "develop" })),
      scenario(noDevelop))).toEqual([]);
    expect(errors(scriptOf(setAi(faction(1), { mode: "develop" }), setAi(faction(2), { mode: "develop" })),
      scenario(noDevelop))).toEqual(["factionAiSecondDevelop triggers[0].actions[1].args.mode"]);
  });

  it("holds a switched mode to the island's people target with the faction's caps", () => {
    const switched = scriptOf(setAi(faction(1), { mode: "develop" }));
    const result = (map: MapScenario) => validateEditedScript({ cellsX: 128, cellsZ: 128, scenario: map } as
      unknown as WorldData, switched).errors;
    // 400 start settlers + the develop caps 150 civilians and 80 soldiers.
    expect(result(scenario([entry(1, "maintain")], "campaign", 400))).toMatchObject([
      { code: "factionAiPeopleAboveTarget", params: { people: 630, target: 600 }, path: `${ARGS}.mode` }
    ]);
    expect(result(scenario([entry(1, "maintain")], "campaign", 370))).toEqual([]);
    const limited = entry(1, "maintain", { limits: { population: 100, soldiers: 50 } });
    expect(result(scenario([limited], "campaign", 400))).toEqual([]);
  });

  it("refuses a style without the develop mode, an empty change and unknown values", () => {
    expect(errors(scriptOf(setAi(faction(1), { mode: "maintain", style: "turtle" })), scenario(MAP)))
      .toEqual([`factionAiStyleWithoutDevelop ${ARGS}.style`]);
    expect(errors(scriptOf(setAi(faction(1), {})), scenario(MAP))).toEqual([`missingSlot ${ARGS}`]);
    const unknown: Record<string, string>[] = [{ mode: "conquer" }, { style: "sneaky" }, { level: "brutal" }];
    for (const change of unknown)
      expect(errors(scriptOf(setAi(faction(3), change)), scenario(MAP)), JSON.stringify(change)).toHaveLength(1);
  });
});

describe("faction AI actions on an island", () => {
  const island = (map: MapScenario | undefined) => {
    const commanderLevels = createCommanderLevels();
    const context = { commanderLevels, options: { world: { cellsX: 128, cellsZ: 128, scenario: map } } } as
      unknown as SettlementContext;
    context.factionAi = createFactionAi(context);
    const overrides = { save: () => withoutClocks(context.factionAi!.save()) };
    const perform = ([op, args]: [string, Record<string, unknown>]) =>
      FACTION_AI_ACTIONS[op]!({ context } as unknown as ScriptActionHost, {
        args, op, scope: { evaluate: (expr: { value: unknown }) => expr.value }
      } as unknown as ScriptActionRequest).kind === "done";
    const refusal = (id: number, change: FactionAiChange) => applyFactionAiChange(context, id, change);
    return { commanderLevels, context, overrides, perform, refusal };
  };

  it("switches mode, style and level, keeps unset fields and reads as the faction's setting", () => {
    const { context, overrides, perform } = island(scenario([
      entry(1, "develop", { level: "easy", style: "turtle" }), entry(2, "maintain")
    ]));
    expect(factionAiSetting(context, 1)).toEqual({ level: "easy", mode: "develop", paused: false, style: "turtle" });
    expect(factionAiSetting(context, 5)).toBeUndefined();
    expect(perform(setAi(faction(1), { level: "hard" }))).toBe(true);
    expect(perform(setAi(faction(1), { style: "aggressive" }))).toBe(true);
    expect(factionAiSetting(context, 1))
      .toEqual({ level: "hard", mode: "develop", paused: false, style: "aggressive" });
    expect(overrides.save()).toEqual([
      { faction: 1, level: "hard", mode: "develop", style: "aggressive" }, { faction: 2, mode: "maintain" }
    ]);
    // Downgrading to none stops decisions; the style leaves with the develop mode.
    expect(perform(setAi(faction(1), { mode: "none" }))).toBe(true);
    expect(factionAiSetting(context, 1)).toEqual({ level: "hard", mode: "none", paused: false, style: undefined });
    expect(overrides.save()?.[0]).toEqual({ faction: 1, level: "hard", mode: "none" });
  });

  it("pauses and resumes the faction's decisions", () => {
    const { context, overrides, perform } = island(scenario(MAP));
    expect(perform(pause(faction(3)))).toBe(true);
    expect(perform(pause(faction(1)))).toBe(true);
    expect(factionAiSetting(context, 3)?.paused).toBe(true);
    expect(overrides.save()).toEqual([
      { faction: 1, mode: "maintain", paused: true }, { faction: 3, mode: "develop", paused: true }
    ]);
    expect(perform(pause(faction(3), false))).toBe(true);
    expect(perform(pause(faction(1), false))).toBe(true);
    expect(overrides.save()).toEqual([{ faction: 1, mode: "maintain" }, { faction: 3, mode: "develop" }]);
  });

  it("refuses what the Ready check refuses, and changes nothing", () => {
    const { overrides, perform } = island(scenario(MAP));
    const refused = [
      setAi(faction(4), { mode: "maintain" }), setAi(faction(0), { mode: "maintain" }),
      setAi({ kind: "computers" }, { mode: "maintain" }), setAi(faction(1), { mode: "develop" }),
      setAi(faction(1), { style: "turtle" }), setAi(faction(1), { mode: "conquer" }),
      setAi(faction(1), { level: "brutal" }), setAi(faction(1), {}), pause(faction(4)),
      ["factionAiPause", { faction: faction(1), paused: str("yes") }] as [string, Record<string, unknown>]
    ];
    const before = overrides.save();
    for (const step of refused) expect(perform(step), JSON.stringify(step)).toBe(false);
    expect(overrides.save()).toEqual(before);
    // The develop faction steps down first: then another faction may develop.
    expect(perform(setAi(faction(3), { mode: "maintain" }))).toBe(true);
    expect(perform(setAi(faction(1), { mode: "develop", style: "balanced" }))).toBe(true);
    expect(perform(setAi(faction(3), { mode: "develop" }))).toBe(false);
  });

  it("refuses on a home map, without a scenario and above the island's people target", () => {
    expect(island(scenario(undefined, "home")).perform(setAi(faction(1), { mode: "maintain" }))).toBe(false);
    expect(island(undefined).perform(pause(faction(1)))).toBe(false);
    const crowded = island(scenario([entry(1, "maintain")], "campaign", 400));
    expect(crowded.perform(setAi(faction(1), { mode: "develop" }))).toBe(false);
    expect(island(scenario([entry(1, "maintain")], "campaign", 370))
      .perform(setAi(faction(1), { mode: "develop" }))).toBe(true);
  });

  it("wakes a faction that only owns units, and refuses a switch with EAI0a's issue codes", () => {
    const map = { ...scenario([entry(1, "maintain"), { faction: 2, mode: "none" }, entry(3, "develop")]),
      units: [unit(5)] };
    const { context, overrides, refusal } = island(map);
    expect(factionAiSetting(context, 5)).toEqual({ level: undefined, mode: "none", paused: false, style: undefined });
    expect(refusal(5, { mode: "develop" })).toBe("developWithoutSettlers");
    expect(refusal(5, { mode: "maintain" })).toBeNull();
    expect(refusal(5, { paused: true })).toBeNull();
    expect(overrides.save()?.find(saved => saved.faction === 5))
      // EAI2b: the woken faction runs an economy from its switch on (saved, it keeps it).
      .toEqual({ economy: true, faction: 5, mode: "maintain", paused: true });
    // An entry without a start and without units or buildings could never act.
    expect(refusal(2, { mode: "maintain" })).toBe("factionNeverActs");
    expect(refusal(2, { level: "hard" })).toBeNull();
    expect(refusal(1, { mode: "develop" })).toBe("multipleDevelopFactions");
    expect(refusal(1, { style: "turtle" })).toBe("styleWithoutDevelop");
    expect(refusal(1, { mode: "conquer" })).toBe("invalidField");
    expect(refusal(6, { mode: "maintain" })).toBe("factionNotOnMap");
    expect(island(scenario([entry(1, "maintain")], "campaign", 400)).refusal(1, { mode: "develop" }))
      .toBe("peopleAboveIslandTarget");
    expect(island({ ...scenario(undefined, "home"), units: [unit(5)] }).refusal(5, { mode: "maintain" }))
      .toBe("factionNotOnMap");
  });

  it("feeds a script level to the faction's commander; `setCommanderLevel` outranks it", () => {
    const { commanderLevels, context, perform } = island(scenario([entry(1, "maintain", { level: "easy" })]));
    const profile = createCommanderProfileSource(context);
    expect(profile(1)).toBe(COMMANDER_PROFILES.easy);
    const before = commanderLevels.revision();
    expect(perform(setAi(faction(1), { level: "hard" }))).toBe(true);
    expect(profile(1)).toBe(COMMANDER_PROFILES.hard);
    expect(commanderLevels.revision()).toBeGreaterThan(before);
    expect(perform(setAi(faction(1), { mode: "none" }))).toBe(true);
    expect(profile(1)).toBe(COMMANDER_PROFILES.hard);
    commanderLevels.set(1, "medium");
    expect(profile(1)).toBe(COMMANDER_PROFILES.medium);
  });
});

describe("faction AI actions in a running map", () => {
  const AI_SCRIPT = scriptOf(setAi(faction(1), { level: "hard", mode: "none" }), pause(faction(2)),
    setAi(faction(2), { mode: "develop" }), setAi(faction(4), { mode: "maintain" }));
  const run = (script: MapScript | undefined) => createBalanceSimulation(48, 7, { x: 10.5, z: 10.5 },
    (world: WorldData) => {
      world.scenario = scenario([entry(1, "develop"), entry(2, "maintain")], "adventure", 0);
      if (script) world.script = script;
    });
  const advance = (simulation: ReturnType<typeof run>, ticks: number) => {
    for (let tick = 0; tick < ticks; tick++) simulation.update(.05);
  };
  const EXPECTED = [{ faction: 1, level: "hard", mode: "none" }, { faction: 2, mode: "develop", paused: true }];
  const MAP_START = [{ faction: 1, mode: "develop" }, { faction: 2, mode: "maintain" }];

  it("applies in the tick, is saved, and a reload continues to the same state", () => {
    const live = run(AI_SCRIPT), reloaded = run(AI_SCRIPT);
    expect(withoutClocks(live.saveState().factionAi)).toEqual(MAP_START);
    advance(live, 40);
    advance(reloaded, 10);
    const saved = reloaded.saveState();
    expect(withoutClocks(saved.factionAi)).toEqual(EXPECTED);
    expect(reloaded.loadState(JSON.parse(JSON.stringify(saved)))).toEqual({ ok: true });
    expect(withoutClocks(reloaded.saveState().factionAi)).toEqual(EXPECTED);
    advance(reloaded, 30);
    expect(stateHashOf(reloaded)).toBe(stateHashOf(live));
  }, 120_000);

  it("leaves a map whose script has no faction AI action as the map set it, and refuses a broken save", () => {
    const plain = run(scriptOf());
    advance(plain, 10);
    expect(plain.saveState().scriptRun).toBeDefined();
    expect(withoutClocks(plain.saveState().factionAi)).toEqual(MAP_START);
    const simulation = run(AI_SCRIPT);
    advance(simulation, 10);
    const saved = JSON.parse(JSON.stringify(simulation.saveState()));
    saved.factionAi[0].mode = "conquer";
    expect(simulation.loadState(saved)).toMatchObject({ ok: false });
  }, 120_000);
});

describe("faction AI actions in the script editor", () => {
  const slotsOf = (script: MapScript) => {
    const rows = triggerBlocks(script.triggers[0]!, { locale: "en", script }).actions;
    return rows.map(row => {
      const parts: readonly BlockPart[] = "block" in row ? row.block.parts : [];
      return parts.filter((part): part is SlotPart => part.kind === "slot");
    });
  };

  it("lists both actions once, with English sentences and labelled closed lists", () => {
    expect(ACTION_CATALOG.setFactionAi.args.map(slot => [slot.name, slot.type.kind, slot.optional])).toEqual([
      ["faction", "player", false], ["mode", "choice", true], ["style", "choice", true], ["level", "choice", true]
    ]);
    expect(ACTION_CATALOG.factionAiPause.args.map(slot => [slot.name, slot.type.kind, slot.optional]))
      .toEqual([["faction", "player", false], ["paused", "value", false]]);
    for (const op of ["setFactionAi", "factionAiPause"])
      expect(Object.values(ACTION_GROUPS).flat().filter(listed => listed === op), op).toHaveLength(1);
    expect(actionSentence("setFactionAi", "en")).toBe("set the AI of {faction}");
    expect(actionSentence("factionAiPause", "en")).toBe("pause the AI of {faction}: {paused}");
    for (const value of [...FACTION_AI_MODES, ...FACTION_AI_STYLES, ...FACTION_AI_LEVELS])
      expect(choiceLabel(value, "en")).toBe(value);
  });

  it("edits a new step with the existing pickers and round-trips through the map file", () => {
    let script = emptyScript({ triggers: [trigger("t-ai", { actions: [
      createActionStep("setFactionAi", "s1"), createActionStep("factionAiPause", "s2")
    ] })] });
    const [setSlots, pauseSlots] = slotsOf(script);
    expect(setSlots!.map(slot => [slot.path.at(-1), slot.optional, slot.spec.kind])).toEqual([
      ["faction", false, "player"], ["mode", true, "choice"], ["style", true, "choice"], ["level", true, "choice"]
    ]);
    expect(pauseSlots!.map(slot => slot.path.at(-1))).toEqual(["faction", "paused"]);
    const pick = (slot: SlotPart, label: string) => {
      expect(pickerTabs(slot.spec)).toContain("list");
      const choice = tabChoices("list", slot.spec, { locale: "en", script }).find(entry => entry.label === label);
      expect(choice, `${slot.label}: ${label}`).toBeDefined();
      script = setAtPath(script, ["triggers", 0, ...slot.path], choice!.value);
    };
    const [faction1, mode, style, level] = setSlots!;
    expect(tabChoices("list", mode!.spec, { locale: "en", script }).map(choice => choice.key))
      .toEqual([...FACTION_AI_MODES]);
    pick(faction1!, "Player 2");
    pick(mode!, "develop");
    pick(style!, "aggressive");
    pick(level!, "hard");
    pick(pauseSlots![0]!, "Player 2");
    expect(script.triggers[0]!.actions).toEqual([
      doStep("s1", "setFactionAi", { faction: faction(1), level: str("hard"), mode: str("develop"),
        style: str("aggressive") }),
      doStep("s2", "factionAiPause", { faction: faction(1), paused: bool(false) })
    ]);
    expect(slotsOf(script)[0]!.map(slot => slot.summary)).toEqual(["Player 2", "develop", "aggressive", "hard"]);
    const decoded = decodeHeaderScript(encodeHeaderScript(script) as Record<string, unknown>)!.script;
    expect(decoded).toEqual(script);
    const world = { cellsX: 128, cellsZ: 128, scenario: scenario([entry(1, "maintain")]) } as
      unknown as WorldData;
    expect(validateEditedScript(world, decoded).errors).toEqual([]);
  });
});
