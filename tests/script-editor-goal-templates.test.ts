import { describe, expect, it } from "vitest";

import type { ScriptEmission } from "../../island-of-settlers-shared/src/script/types/emission";
import {
  createEngine, createFakeWorld, runTicks, value
} from "../../island-of-settlers-shared/tests/script-engine-fixtures";
import { createEmptyMapScript } from "../src/app/map-editor/script/script-document";
import { templateLabels } from "../src/app/map-editor/script/template-labels";
import { applyTemplate, DEFAULT_TEMPLATE_PARAMS, type TemplateId } from "../src/app/map-editor/script/templates";

/** EXT-TEMPLATES: the goal templates behave in the script engine as their descriptions say. */

const TICKS_PER_SECOND = 20;
const QUEST = "quest-1";
const params = { ...DEFAULT_TEMPLATE_PARAMS, labels: templateLabels(undefined, "T"), mapCenter: { x: 32, z: 32 } };

const start = (id: TemplateId, overrides: Partial<typeof params> = {}) => {
  const { script } = applyTemplate(createEmptyMapScript("uid-test"), id, { ...params, ...overrides });
  const world = createFakeWorld();
  const engine = createEngine(script, world);
  runTicks(engine, world, 1);
  const emit = (emission: ScriptEmission) => {
    engine.emit(emission);
    runTicks(engine, world, 1);
  };
  /** Quests are evaluated on the one-second cadence. */
  const questState = () => {
    runTicks(engine, world, TICKS_PER_SECOND);
    return engine.state.quests[QUEST]?.state;
  };
  return { emit, engine, questId: script.quests.quests[0]!.id, questState, script, world };
};

const building = (type: string) => ({ family: `building.${type}`, handle: { generation: 0, id: 7,
  space: "building" as const }, owner: 0, type: `building:${type}` });
const wares = (kind: "wareProduced" | "wareSold", ware: string, amount: number): ScriptEmission => ({
  ...(kind === "wareProduced" && { actors: { building: building("sawmill") } }), kind, player: 0,
  responses: { amount: { type: "number", value: amount }, ware: { type: "string", value: ware } }, values: { ware }
});

describe("goal templates in the engine", () => {
  it("names its quest like the helper expects", () => {
    expect(start("tradeQuest").questId).toBe(QUEST);
  });

  it("collect by a deadline: production of the ware counts and reaching Y in time succeeds", () => {
    const { emit, engine, questState, script } = start("collectDeadline", { count: 6, seconds: 60 });
    const [counter, timer] = script.variables.map(item => item.id) as [string, string];
    expect(engine.state.quests[QUEST]?.state).toBe("active");
    expect(engine.state.timers[timer]?.endScriptTick).toBeGreaterThan(0);
    expect(engine.multiboardSnapshots(0)[0]!.rows[0]!.cells.map(cell => cell.format))
      .toEqual(["text", "fraction", "countdown"]);
    emit(wares("wareProduced", "planks", 4));
    emit(wares("wareProduced", "stone", 9));
    expect(value(engine, counter)).toBe(4);
    emit(wares("wareProduced", "planks", 2));
    expect(questState()).toBe("succeeded");
    expect(engine.multiboardSnapshots(0)).toEqual([]);
    expect(engine.state.timers[timer]).toEqual({ endScriptTick: null, paused: null });
  });

  it("collect by a deadline: the quest fails when the timer runs out", () => {
    const { emit, engine, script, world } = start("collectDeadline", { count: 6, seconds: 60 });
    emit(wares("wareProduced", "planks", 5));
    runTicks(engine, world, 60 * TICKS_PER_SECOND + 2);
    expect(engine.state.quests[QUEST]?.state).toBe("failed");
    expect(engine.multiboardSnapshots(0)).toEqual([]);
    emit(wares("wareProduced", "planks", 5));
    expect(value(engine, script.variables[0]!.id)).toBe(5);
  });

  it("build X: only finished buildings of the picked type count", () => {
    const { emit, engine, questState, script } = start("buildCount", { building: "sawmill", count: 2 });
    const finished = (type: string): ScriptEmission =>
      ({ actors: { building: building(type) }, kind: "constructionCompleted", player: 0 });
    emit(finished("sawmill"));
    emit(finished("woodcutter"));
    expect(value(engine, script.variables[0]!.id)).toBe(1);
    expect(engine.multiboardSnapshots(0)[0]!.rows[0]!.cells[1]).toEqual({ current: 1, format: "fraction", target: 2 });
    emit(finished("sawmill"));
    expect(questState()).toBe("succeeded");
  });

  it("trade quest: sold amounts of the ware add up to N", () => {
    const { emit, questState } = start("tradeQuest", { count: 10, ware: "planks" });
    emit(wares("wareSold", "planks", 6));
    emit(wares("wareSold", "logs", 50));
    expect(questState()).toBe("active");
    emit(wares("wareSold", "planks", 4));
    expect(questState()).toBe("succeeded");
  });
});
