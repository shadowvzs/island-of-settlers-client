import { describe, expect, it } from "vitest";

import { FACTION_AI_ICONS } from "../src/app/map-editor/map-rules/faction-ai/constants";
import {
  applyFactionAi, depotStartFromEntries, toFactionAiState, usedFactions, withFactionBonus, withFactionLevel,
  withFactionLimit, withFactionMode, withFactionStart, withFactionStyle
} from "../src/app/map-editor/map-rules/faction-ai/helpers";
import { factionAiView, validationLines } from "../src/app/map-editor/map-rules/faction-ai/view-model";
import { createMapRulesControls } from "../src/app/map-editor/map-rules/map-rules-controls";
import { getActionIcon } from "../src/app/map-editor/panel/action-icons";
import type { RewardEntry } from "../src/app/settlement-ui/reward-icons/entries";
import { createMapScenario, type MapScenario } from "../src/shared/world/map-scenario";
import type { ScenarioFactionAi } from "../src/shared/world/scenario-faction-ai";

const unit = (id: number, faction: number) =>
  ({ faction, group: 0, heading: 0, id, rank: 0, type: "shield" as const, x: 10 + id, z: 10 });
const colony = (change: Partial<MapScenario> = {}): MapScenario =>
  ({ ...createMapScenario(), kind: "colony", units: [unit(1, 1), unit(2, 3)], ...change });
const develop = (faction: number): ScenarioFactionAi =>
  ({ faction, mode: "develop", start: { settlers: 5, stock: {} } });

/** The controller over an in-memory scenario, with the scenario editor's "false = no undo step" contract. */
const controlsOver = (initial: MapScenario) => {
  let scenario = initial, steps = 0;
  const controls = createMapRulesControls({
    cells: () => ({ cellsX: 256, cellsZ: 256 }),
    edit: change => {
      const next = structuredClone(scenario);
      if (change(next) === false) return;
      scenario = next; steps++;
      controls.refresh();
    },
    scenario: () => scenario
  });
  return { controls, scenario: () => scenario, steps: () => steps };
};

describe("faction AI mode transitions", () => {
  it("creates an entry for a mode, removes it for none and leaves absent factions alone", () => {
    const maintain = withFactionMode([], 3, "maintain");
    expect(maintain).toEqual([{ faction: 3, mode: "maintain" }]);
    expect(withFactionMode(maintain, 3, "none")).toEqual([]);
    expect(withFactionMode([], 2, "none")).toEqual([]);
    expect(withFactionMode(maintain, 1, "develop").map(entry => entry.faction)).toEqual([1, 3]);
  });

  it("keeps the details across maintain and develop but drops the develop-only style", () => {
    const entry: ScenarioFactionAi = { ...develop(1), level: "hard", style: "turtle" };
    expect(withFactionMode([entry], 1, "maintain")).toEqual([{ faction: 1, level: "hard", mode: "maintain",
      start: { settlers: 5, stock: {} } }]);
  });

  it("styles only a develop faction and stores balanced as no style", () => {
    const maintain: ScenarioFactionAi = { faction: 1, mode: "maintain" };
    expect(withFactionStyle([maintain], 1, "aggressive")).toEqual([maintain]);
    const aggressive = withFactionStyle([develop(1)], 1, "aggressive");
    expect(aggressive[0]!.style).toBe("aggressive");
    expect(withFactionStyle(aggressive, 1, "balanced")[0]).not.toHaveProperty("style");
  });

  it("sets a level and restores the island difficulty for an empty value", () => {
    const hard = withFactionLevel([develop(1)], 1, "hard");
    expect(hard[0]!.level).toBe("hard");
    expect(withFactionLevel(hard, 1, "")[0]).not.toHaveProperty("level");
    expect(withFactionLevel(hard, 1, "impossible")[0]).not.toHaveProperty("level");
  });
});

describe("faction AI limits, bonus and depot", () => {
  it("clamps limits to the owner's caps and drops empty limits", () => {
    let entries = withFactionLimit([develop(1)], 1, "population", "999");
    entries = withFactionLimit(entries, 1, "soldiers", "500");
    entries = withFactionLimit(entries, 1, "buildings", "0");
    expect(entries[0]!.limits).toEqual({ buildings: 1, population: 150, soldiers: 80 });
    entries = withFactionLimit(entries, 1, "buildings", "12.7");
    expect(entries[0]!.limits!.buildings).toBe(12);
    for (const key of ["buildings", "population", "soldiers"] as const) entries = withFactionLimit(entries, 1, key, "");
    expect(entries[0]).not.toHaveProperty("limits");
  });

  it("clamps a bonus to 100–300 % and removes no-handicap values", () => {
    let entries = withFactionBonus([develop(1)], 1, "production", "500");
    expect(entries[0]!.bonus).toEqual({ production: 300 });
    entries = withFactionBonus(entries, 1, "production", "40");
    expect(entries[0]).not.toHaveProperty("bonus");
    entries = withFactionBonus(entries, 1, "training", "abc");
    expect(entries[0]).not.toHaveProperty("bonus");
  });

  it("turns picker lines into a depot start and removes an empty one", () => {
    const lines: RewardEntry[] = [{ amount: 30, kind: "ware", ware: "planks" },
      { amount: 0, kind: "ware", ware: "stone" }, { amount: 4, kind: "settlers" }, { amount: 2, kind: "soldier", rank: 1, soldierType: "archer" }];
    expect(depotStartFromEntries(lines)).toEqual({ settlers: 4, soldiers: [{ count: 2, rank: 1, type: "archer" }],
      stock: { planks: 30 } });
    const entries = withFactionStart([develop(1)], 1, []);
    expect(entries[0]).not.toHaveProperty("start");
  });
});

describe("faction AI controls", () => {
  it("writes no factionAi key when every faction plays none", () => {
    const scenario = colony();
    applyFactionAi(scenario, [{ faction: 1, mode: "none" }]);
    expect(scenario).not.toHaveProperty("factionAi");
    const session = controlsOver(colony());
    session.controls.factionAi.setMode(1, "maintain");
    expect(session.scenario().factionAi).toEqual([{ faction: 1, mode: "maintain" }]);
    session.controls.factionAi.setMode(1, "none");
    expect(session.scenario()).not.toHaveProperty("factionAi");
    expect(session.steps()).toBe(2);
  });

  it("refuses AI on a home map and counts no undo step for an unchanged edit", () => {
    const home = controlsOver({ ...colony(), kind: "home" });
    home.controls.factionAi.setMode(1, "develop");
    expect(home.scenario()).not.toHaveProperty("factionAi");
    const session = controlsOver(colony());
    session.controls.factionAi.setMode(1, "none");
    session.controls.factionAi.setLevel(1, "hard");
    expect(session.steps()).toBe(0);
  });

  it("lists the used factions, adds a draft row and reports two develop factions as an error", () => {
    const session = controlsOver(colony());
    expect(usedFactions(session.scenario())).toEqual([1, 3]);
    session.controls.factionAi.addFaction();
    expect(session.controls.factionAi.state.getSnapshot().factions).toEqual([1, 2, 3]);
    session.controls.factionAi.setMode(1, "develop");
    session.controls.factionAi.setMode(3, "develop");
    const issues = session.controls.factionAi.state.getSnapshot().issues;
    expect(issues.find(issue => issue.code === "multipleDevelopFactions")?.severity).toBe("error");
  });
});

describe("faction AI view model", () => {
  const state = (entries: ScenarioFactionAi[], change: Partial<MapScenario> = {}) =>
    toFactionAiState(colony({ factionAi: entries, ...change }), { cellsX: 256, cellsZ: 256 });

  it("presses the mode and enables styles only for develop", () => {
    const view = factionAiView(undefined, state([develop(1), { faction: 3, mode: "maintain" }]));
    const [first, third] = view.rows;
    expect(first!.modes.find(mode => mode.pressed)?.id).toBe("develop");
    expect(first!.styles.map(style => [style.id, style.disabled, style.pressed]))
      .toEqual([["balanced", false, true], ["turtle", false, false], ["aggressive", false, false]]);
    expect(third!.styles.every(style => style.disabled && !style.pressed)).toBe(true);
    expect(third!.details!.limits.map(field => field.placeholder)).toEqual(["auto", "20", "auto"]);
    expect(first!.details!.limits.map(field => field.placeholder)).toEqual(["60", "150", "80"]);
    expect(view.pendingNote).toBe("Needs P1/P2");
    expect(view.rows.map(row => row.modes[0]!.icon)).toEqual(["ai:none", "ai:none"]);
  });

  it("hides on a home map, shows no details or note for none and badges a handicap", () => {
    expect(factionAiView(undefined, state([], { kind: "home" })).shown).toBe(false);
    const none = factionAiView(undefined, state([]));
    expect(none.pendingNote).toBe("");
    expect(none.rows.every(row => row.details === null && row.level.disabled)).toBe(true);
    const bonus = factionAiView(undefined, state([{ ...develop(1), bonus: { construction: 150 } }]));
    expect(bonus.rows[0]!.handicap).toBe("Handicap +50 %");
  });

  it("puts the map rules' warnings and the AI issues on one validation list", () => {
    const issues = state([develop(1), develop(3)]).issues;
    const lines = validationLines(["Home island mode: this map pays no reward coins home."], issues);
    expect(lines[0]!.severity).toBe("warning");
    expect(lines.some(line => line.severity === "error" && line.text.startsWith("2 computer factions develop")))
      .toBe(true);
  });

  it("resolves every mode and style icon to its own render in assets/ui-icons/ai", () => {
    const sources = Object.entries(FACTION_AI_ICONS).map(([name, key]) => [name, getActionIcon(key)?.src ?? ""]);
    for (const [name, source] of sources) expect(source, name).toContain(`ui-icons/ai/${name}.webp`);
    expect(getActionIcon("ai:unknown")).toBeNull();
  });
});
