import { describe, expect, it, vi } from "vitest";

import { decodeHeaderScript, encodeHeaderScript } from "../../island-of-settlers-shared/src/script/codec";
import type { MapScript } from "../../island-of-settlers-shared/src/script/types/script";
import { createEmptyMapScript } from "../src/app/map-editor/script/script-document";
import { templateLabels } from "../src/app/map-editor/script/template-labels";
import {
  applyTemplate, DEFAULT_TEMPLATE_PARAMS, type TemplateId, TEMPLATES, templatesFor
} from "../src/app/map-editor/script/templates";
import { validateEditedScript } from "../src/app/map-editor/script/validation";
import type { FactionAiSave } from "../src/shared/settlement/economy-ai/faction-ai-types";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { createMapScenario, type MapScenario } from "../src/shared/world/map-scenario";
import type { ScenarioFactionAi } from "../src/shared/world/scenario-faction-ai";
import type { WorldData } from "../src/shared/world/world-data";
import { stateHashOf } from "../tools/bench/military-a14-metrics";
import { huntingWorld } from "./helpers/hunting-world";

vi.mock("../src/shared/world/generation/generate-world", async (importOriginal) =>
  (await import("./helpers/world-cache-store")).cachedGenerateWorldModule(importOriginal));

/** EAI5c: the enemy AI templates insert Ready scripts, survive the map file and do in a running map what they say. */

const AI_TEMPLATES = ["aiWakeUp", "aiAttackOnBuild", "aiPauseDuringQuest", "aiRampUp", "aiDefendBorder",
  "aiExpandAfter"] as const satisfies readonly TemplateId[];
const ENEMY = 1;
const TICKS_PER_SECOND = 20;
const WOODCUTTER = 17;
const BORDER = { x: 17, z: 11 };
const params = { ...DEFAULT_TEMPLATE_PARAMS, labels: templateLabels(undefined, "T"), mapCenter: BORDER };
type Params = typeof params;

const entry = (mode: ScenarioFactionAi["mode"]): ScenarioFactionAi =>
  ({ faction: ENEMY, mode, start: { settlers: 10, stock: {} } });
const scenario = (mode: ScenarioFactionAi["mode"], kind: MapScenario["kind"] = "adventure"): MapScenario =>
  ({ ...createMapScenario(), factionAi: [entry(mode)], kind, settlers: 0 });
const insert = (id: TemplateId, overrides: Partial<Params> = {}, into = createEmptyMapScript("uid-test")) =>
  applyTemplate(into, id, { ...params, ...overrides });
const errors = (script: MapScript, map: MapScenario) =>
  validateEditedScript({ cellsX: 64, cellsZ: 64, scenario: map } as unknown as WorldData, script).errors
    .map(issue => `${issue.code} ${issue.path}`);

describe("enemy AI templates in the editor", () => {
  it("are offered on every map with computer factions and never at home", () => {
    for (const id of AI_TEMPLATES) {
      expect(templatesFor("home"), id).not.toContain(id);
      for (const kind of ["adventure", "colony", "campaign"] as const) expect(templatesFor(kind), id).toContain(id);
      expect(errors(insert(id).script, { ...createMapScenario(), kind: "home" }), id).not.toEqual([]);
    }
  });

  it("insert a Ready script on a map whose enemy has an AI entry, for a sleeping and a playing enemy", () => {
    for (const id of AI_TEMPLATES) for (const kind of TEMPLATES[id].mapKinds) for (const mode of ["none", "maintain"] as
      const) {
      const { firstTrigger, script } = insert(id);
      expect(script.triggers.map(trigger => trigger.id), id).toContain(firstTrigger);
      expect(script.triggers.every(trigger => trigger.actions.length > 0 && trigger.events.length > 0), id).toBe(true);
      expect(errors(script, scenario(mode, kind)), `${id} on ${kind} (${mode})`).toEqual([]);
    }
  });

  it("round-trip through the map file and stay Ready", () => {
    for (const id of AI_TEMPLATES) {
      const { script } = insert(id);
      const decoded = decodeHeaderScript(JSON.parse(JSON.stringify(encodeHeaderScript(script))))!.script;
      expect(decoded, id).toEqual(script);
      expect(errors(decoded, scenario("none")), id).toEqual([]);
    }
  });

  it("insert together without clashing ids, reuse a picked region and name the picked enemy and building", () => {
    let script = createEmptyMapScript("uid-test");
    for (const id of AI_TEMPLATES) script = insert(id, {}, script).script;
    expect(new Set(script.triggers.map(trigger => trigger.id)).size).toBe(script.triggers.length);
    expect(script.triggers).toHaveLength(AI_TEMPLATES.length + 1);
    expect(script.regions).toHaveLength(1);
    expect(errors(script, scenario("none"))).toEqual([]);
    const reused = insert("aiDefendBorder", { region: script.regions[0]!.id }, script).script;
    expect(reused.regions).toHaveLength(1);
    expect(errors(reused, scenario("none"))).toEqual([]);
    const picked = insert("aiAttackOnBuild", { building: "sawmill", faction: 3 }).script.triggers[0]!;
    expect(JSON.stringify(picked.events)).toContain("building:sawmill");
    expect(picked.actions[0]).toMatchObject({ args: { faction: { faction: 3, kind: "slot" } } });
  });
});

/** The script-facing part of the saved faction AI: no clocks, no develop memory. */
const enemyOf = (saved: readonly FactionAiSave[] | undefined) =>
  saved?.map(({ develop: _develop, due: _due, ...rest }) => rest).find(state => state.faction === ENEMY);

const run = (id: TemplateId, mode: ScenarioFactionAi["mode"], overrides: Partial<Params> = {}) => {
  const { script } = insert(id, overrides);
  const world = huntingWorld();
  world.scenario = scenario(mode, "campaign");
  world.script = script;
  const simulation = createSettlementSimulation({ canWorkerEnterPlot: () => true, homeBuilding: 0, initialSettlers: 8,
    roads: createRoadNetwork(world), world });
  const advance = (seconds: number) => {
    for (let tick = 0; tick < seconds * TICKS_PER_SECOND; tick++) simulation.update(.05);
  };
  return { advance, enemy: () => enemyOf(simulation.saveState().factionAi), script, simulation };
};

describe("enemy AI templates in a running map", () => {
  it("wake up: the sleeping enemy maintains its camp once the time has passed", () => {
    const { advance, enemy } = run("aiWakeUp", "none", { seconds: 5 });
    advance(4);
    expect(enemy()?.mode ?? "none").toBe("none");
    advance(2);
    expect(enemy()).toMatchObject({ mode: "maintain" });
  }, 120_000);

  it("expand: the goal is set once the time has passed", () => {
    const { advance, enemy } = run("aiExpandAfter", "maintain", { seconds: 5 });
    advance(4);
    expect(enemy()?.goal).toBeUndefined();
    advance(2);
    expect(enemy()?.goal).toEqual({ goal: "expand" });
  }, 120_000);

  it("attack on build: only a finished building of the picked type of Player 1 sets the attack goal", () => {
    const { advance, enemy, simulation } = run("aiAttackOnBuild", "maintain");
    const finished = (type: string, owner: number) => {
      simulation.script()!.engine.emit({ actors: { building: { family: `building.production.${type}`,
        handle: { generation: 0, id: 7, space: "building" }, owner, type: `building:${type}` } },
      kind: "constructionCompleted", player: owner });
      advance(1);
    };
    finished("sawmill", 0);
    finished("woodcutter", ENEMY);
    expect(enemy()?.goal).toBeUndefined();
    finished("woodcutter", 0);
    expect(enemy()?.goal).toMatchObject({ goal: "attack" });
  }, 120_000);

  it("defend the border: a building placed inside the region starts a timed defend goal there", () => {
    const { advance, enemy, script, simulation } = run("aiDefendBorder", "maintain", { seconds: 30 });
    const { radius } = script.regions[0]!.shape as { radius: number };
    const outside = simulation.placeBuilding(WOODCUTTER, BORDER.x, BORDER.z + radius + 6);
    expect(outside.ok, outside.reason).toBe(true);
    advance(1);
    expect(enemy()?.goal).toBeUndefined();
    const inside = simulation.placeBuilding(WOODCUTTER, BORDER.x, BORDER.z);
    expect(inside.ok, inside.reason).toBe(true);
    advance(1);
    expect(enemy()?.goal).toMatchObject({ area: { radius, x: BORDER.x, z: BORDER.z }, goal: "defend" });
    expect(enemy()?.goal?.until).toBeGreaterThan(30 * TICKS_PER_SECOND);
  }, 120_000);

  it("pause during a quest: the AI rests while the quest runs and resumes when it succeeds", () => {
    const { advance, enemy, simulation } = run("aiPauseDuringQuest", "maintain", { seconds: 5 });
    advance(2);
    expect(simulation.script()!.engine.state.quests["quest-1"]?.state).toBe("active");
    expect(enemy()).toMatchObject({ mode: "maintain", paused: true });
    advance(5);
    expect(simulation.script()!.engine.state.quests["quest-1"]?.state).toBe("succeeded");
    expect(enemy()?.paused).toBeUndefined();
  }, 120_000);

  it("ramp up: easy, then medium, then hard; a reload between the steps continues to the same state", () => {
    const live = run("aiRampUp", "maintain", { seconds: 4 }), reloaded = run("aiRampUp", "maintain", { seconds: 4 });
    live.advance(1);
    expect(live.enemy()).toMatchObject({ level: "easy" });
    live.advance(4);
    expect(live.enemy()).toMatchObject({ level: "medium" });
    live.advance(4);
    expect(live.enemy()).toMatchObject({ level: "hard" });
    reloaded.advance(5);
    const saved = JSON.parse(JSON.stringify(reloaded.simulation.saveState()));
    expect(reloaded.simulation.loadState(saved)).toEqual({ ok: true });
    reloaded.advance(4);
    expect(reloaded.enemy()).toMatchObject({ level: "hard" });
    expect(stateHashOf(reloaded.simulation)).toBe(stateHashOf(live.simulation));
  }, 120_000);
});
