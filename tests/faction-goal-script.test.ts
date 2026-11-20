import { describe, expect, it, vi } from "vitest";

import { ACTION_CATALOG } from "../../island-of-settlers-shared/src/script/catalog/actions";
import { EVENT_CATALOG } from "../../island-of-settlers-shared/src/script/catalog/events";
import { FUNCTION_CATALOG } from "../../island-of-settlers-shared/src/script/catalog/functions";
import { decodeHeaderScript, encodeHeaderScript } from "../../island-of-settlers-shared/src/script/codec";
import { AI_GOALS } from "../../island-of-settlers-shared/src/script/constants";
import type { ScriptActionRequest } from "../../island-of-settlers-shared/src/script/engine/ports";
import { isActionAllowed, isEventAllowed } from "../../island-of-settlers-shared/src/script/scopes";
import type { MapScript, ScriptEvent, ScriptVariable } from "../../island-of-settlers-shared/src/script/types/index";
import {
  doStep, emptyScript, num, numberVariable, ref, str, trigger
} from "../../island-of-settlers-shared/tests/script-fixtures";
import type { BlockPart, SlotPart } from "../src/app/map-editor/script/block-parts";
import { triggerBlocks } from "../src/app/map-editor/script/blocks";
import { ACTION_GROUPS, EVENT_GROUPS } from "../src/app/map-editor/script/constants";
import { createActionStep } from "../src/app/map-editor/script/factory";
import { setAtPath } from "../src/app/map-editor/script/paths";
import { tabChoices } from "../src/app/map-editor/script/picker-choices";
import { functionChoices } from "../src/app/map-editor/script/picker-options";
import { actionSentence, choiceLabel, eventSentence, functionSentence } from "../src/app/map-editor/script/sentences";
import { validateEditedScript } from "../src/app/map-editor/script/validation";
import type { ScriptActionHost } from "../src/shared/script-world/actions/action-host";
import { FACTION_AI_ACTIONS } from "../src/shared/script-world/actions/faction-ai";
import {
  type DirectorTraceRecord, setDirectorTraceSink
} from "../src/shared/settlement/commander/director-trace";
import type { DirectorTarget, MilitaryDirectorPort } from "../src/shared/settlement/commander/director-types";
import type {
  CommanderStrategicApi, IntentStatus, StrategicIntent
} from "../src/shared/settlement/commander/strategic-intents";
import { GOAL_ATTACK_STRENGTH, GOAL_POST_RADIUS } from "../src/shared/settlement/economy-ai/constants";
import { createFactionAi } from "../src/shared/settlement/economy-ai/faction-ai";
import { factionAiSaveError } from "../src/shared/settlement/economy-ai/faction-ai-save-validation";
import type { FactionAiState } from "../src/shared/settlement/economy-ai/faction-ai-types";
import {
  activeFactionGoal, type FactionGoal, factionGoalIntents, isExpanding, isFactionGoal, runFactionGoal
} from "../src/shared/settlement/economy-ai/faction-goal";
import { applyFactionGoal } from "../src/shared/settlement/faction-ai-script";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation, type SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import { createMapScenario, type MapScenario } from "../src/shared/world/map-scenario";
import type { ScenarioFactionAi } from "../src/shared/world/scenario-faction-ai";
import type { WorldData } from "../src/shared/world/world-data";
import { stateHashOf } from "../tools/bench/military-a14-metrics";
import { economyCampaignScenario } from "./helpers/economy-factions";
import { createFactionAttackFixture } from "./helpers/faction-attack-fixture";
import { huntingWorld } from "./helpers/hunting-world";

vi.mock("../src/shared/world/generation/generate-world", async (importOriginal) =>
  (await import("./helpers/world-cache-store")).cachedGenerateWorldModule(importOriginal));

/**
 * EAI4c: the script action `setFactionGoal`, the computer faction events and readings, and the colony
 * counterattack rule of a `develop` faction: Ready rules, the goal's intents, its clock, the tick, the save and
 * the editor.
 */

type Kind = MapScenario["kind"];
type Step = [op: string, args: Record<string, unknown>];

const COMPUTER = 1;
const TICKS_PER_SECOND = 20;
const faction = (id: number) => ({ faction: id, kind: "slot" as const });
const scenario = (factionAi: ScenarioFactionAi[] | undefined, kind: Kind = "campaign"): MapScenario =>
  ({ ...createMapScenario(), kind, settlers: 0, ...(factionAi ? { factionAi } : {}) });
const entry = (id: number, mode: ScenarioFactionAi["mode"]): ScenarioFactionAi =>
  ({ faction: id, mode, start: { settlers: 10, stock: {} } });
const setGoal = (id: unknown, goal: string, extra: Record<string, unknown> = {}): Step =>
  ["setFactionGoal", { faction: id, goal: str(goal), ...extra }];
const circle = (id: string, x: number, z: number, radius: number) =>
  ({ id, name: id, shape: { centerX: x, centerZ: z, kind: "circle" as const, radius } });
const scriptOf = (steps: Step[], fields: Partial<MapScript> = {}): MapScript => emptyScript({ triggers: [
  trigger("t-goal", { actions: steps.map(([op, args], index) => doStep(`s${index + 1}`, op, args)) })
], ...fields });
const advance = (simulation: { update: (dt: number) => void }, ticks: number) => {
  for (let tick = 0; tick < ticks; tick++) simulation.update(.05);
};

describe("Ready rules of setFactionGoal", () => {
  const MAP = [entry(1, "maintain"), entry(2, "none")];
  const errors = (script: MapScript, map: MapScenario | undefined) =>
    validateEditedScript({ cellsX: 128, cellsZ: 128, scenario: map } as unknown as WorldData, script).errors
      .map(issue => `${issue.code} ${issue.path}`);
  const ARGS = "triggers[0].actions[0].args";

  it("accepts every goal of a faction on the map, with and without a region and a duration", () => {
    const regions = [circle("region-1", 20, 20, 6)];
    const steps = AI_GOALS.map(goal => setGoal(faction(1), goal));
    steps.push(setGoal(faction(2), "attack", { region: ref("region", "region-1"), seconds: num(90) }));
    expect(errors(scriptOf(steps, { regions }), scenario(MAP))).toEqual([]);
  });

  it("refuses a home map, a faction that is not on the map, an unknown goal, region and a duration of 0", () => {
    expect(errors(scriptOf([setGoal(faction(1), "attack")]), scenario(undefined, "home")))
      .toEqual(["notOnMapKind triggers[0].actions[0].op", `factionWithoutAi ${ARGS}.faction`]);
    for (const target of [faction(4), faction(0), { kind: "computers" }])
      expect(errors(scriptOf([setGoal(target, "hold")]), scenario(MAP)), JSON.stringify(target))
        .toEqual([`factionWithoutAi ${ARGS}.faction`]);
    expect(errors(scriptOf([setGoal(faction(1), "conquer")]), scenario(MAP))).toHaveLength(1);
    expect(errors(scriptOf([setGoal(faction(1), "attack", { region: ref("region", "nowhere") })]), scenario(MAP)))
      .toHaveLength(1);
    for (const seconds of [0, -5])
      expect(errors(scriptOf([setGoal(faction(1), "attack", { seconds: num(seconds) })]), scenario(MAP)))
        .toEqual([`factionGoalSecondsNotPositive ${ARGS}.seconds`]);
  });

  it("keeps the action and the faction events off home maps only", () => {
    for (const kind of ["adventure", "campaign", "colony"] as const) {
      expect(isActionAllowed(kind, "setFactionGoal")).toBe(true);
      expect(isEventAllowed(kind, "factionAttackLaunched")).toBe(true);
    }
    expect(isActionAllowed("home", "setFactionGoal")).toBe(false);
    for (const kind of ["factionBuildingStarted", "factionBuildingCompleted", "factionAttackLaunched"] as const)
      expect(isEventAllowed("home", kind)).toBe(false);
  });
});

const target = (uid: number, x: number, z: number, tier = 2): DirectorTarget => ({ tier, uid, x, z });

/** A strategic contract that records what the goal states; `finished` reports the faction's intent as done. */
const fakeStrategy = (targets: readonly DirectorTarget[] = []) => {
  const stated: (readonly StrategicIntent[])[] = [];
  const statuses: IntentStatus[] = [];
  const strategy: CommanderStrategicApi = {
    armyRequests: () => [], fieldStrength: () => 0, knownTargets: () => targets,
    setIntents: (_faction, intents) => {
      stated.push(intents);
      return intents.map((_, index) => ({ index, status: "accepted" as const }));
    },
    status: () => statuses, uncommitted: () => []
  };
  return { stated, statuses, strategy };
};

describe("a goal's intents (A14 strategic contract)", () => {
  const AREA = { radius: 6, x: 30, z: 30 };

  it("accepts the four goals; a post needs its area and only an attack keeps a target", () => {
    const valid: FactionGoal[] = [{ goal: "attack" }, { area: AREA, goal: "attack", target: 7, until: 400 },
      { area: AREA, goal: "defend" }, { area: AREA, goal: "hold", until: 1 }, { goal: "expand" }];
    expect(valid.every(isFactionGoal)).toBe(true);
    const broken = [undefined, {}, { goal: "conquer" }, { goal: "defend" }, { goal: "hold" },
      { goal: "expand", target: 3 }, { goal: "attack", until: -1 }, { goal: "attack", until: 1.5 },
      { area: { radius: -1, x: 0, z: 0 }, goal: "hold" }, { extra: true, goal: "attack" }];
    expect(broken.some(isFactionGoal)).toBe(false);
  });

  it("attacks only a building the faction knows, inside the goal's region, and keeps to it", () => {
    const known = [target(9, 80, 80, 1), target(4, 31, 32), target(6, 28, 30)];
    const anywhere: FactionGoal = { goal: "attack" };
    expect(factionGoalIntents(anywhere, known)).toEqual([
      { kind: "attack", minStrength: GOAL_ATTACK_STRENGTH, target: { kind: "site", uid: 9 } }]);
    const inRegion: FactionGoal = { area: AREA, goal: "attack" };
    expect(factionGoalIntents(inRegion, known)[0]).toMatchObject({ kind: "attack", target: { uid: 4 } });
    expect(inRegion.target).toBe(4);
    // A more urgent building learned later does not pull the attack off its target; a fallen target does.
    expect(factionGoalIntents(inRegion, [target(6, 28, 30, 1), ...known])[0]).toMatchObject({ target: { uid: 4 } });
    expect(factionGoalIntents(inRegion, [target(6, 28, 30)])[0]).toMatchObject({ target: { uid: 6 } });
  });

  it("scouts while the faction knows no building to attack (the region when the goal has one)", () => {
    const blind: FactionGoal = { goal: "attack", target: 5 };
    expect(factionGoalIntents(blind, [])).toEqual([{ kind: "scout" }]);
    expect(blind.target).toBeUndefined();
    expect(factionGoalIntents({ area: AREA, goal: "attack" }, [target(9, 80, 80)]))
      .toEqual([{ area: AREA, kind: "scout" }]);
  });

  it("posts a defend and a hold goal in its area and orders nothing for expand", () => {
    expect(factionGoalIntents({ area: AREA, goal: "defend" }, [])).toEqual([{ area: AREA, kind: "defend",
      priority: 1 }]);
    expect(factionGoalIntents({ area: AREA, goal: "hold" }, [target(4, 31, 32)])).toEqual([{ area: AREA,
      kind: "hold" }]);
    expect(factionGoalIntents({ goal: "expand" }, [target(4, 31, 32)])).toEqual([]);
  });
});

describe("a goal's clock at the military layer", () => {
  const stateWith = (goal: FactionGoal | undefined) => ({ faction: COMPUTER, goal }) as FactionAiState;
  const contextWith = (strategy: CommanderStrategicApi) =>
    ({ militaryDirector: { strategy } as MilitaryDirectorPort }) as SettlementContext;

  it("runs until its tick, then ends once and hands the soldiers back", () => {
    const { stated, strategy } = fakeStrategy([target(4, 31, 32)]);
    const state = stateWith({ goal: "attack", until: 100 });
    expect(activeFactionGoal(state.goal, 99)).toBe(state.goal);
    expect(activeFactionGoal(state.goal, 100)).toBeUndefined();
    runFactionGoal(contextWith(strategy), state, 40, true);
    runFactionGoal(contextWith(strategy), state, 99, true);
    expect(stated).toHaveLength(2);
    expect(stated[1]).toMatchObject([{ kind: "attack", target: { uid: 4 } }]);
    runFactionGoal(contextWith(strategy), state, 100, true);
    expect(stated[2]).toEqual([]);
    expect(state.goal).toBeUndefined();
    runFactionGoal(contextWith(strategy), state, 160, true);
    expect(stated).toHaveLength(3);
  });

  it("stays without a duration, orders nothing while the faction takes no decisions, but still ends", () => {
    const { stated, strategy } = fakeStrategy();
    const lasting = stateWith({ area: { radius: 5, x: 9, z: 9 }, goal: "hold" });
    runFactionGoal(contextWith(strategy), lasting, 1_000_000, true);
    expect(stated).toEqual([[{ area: { radius: 5, x: 9, z: 9 }, kind: "hold" }]]);
    const paused = stateWith({ goal: "attack", until: 50 });
    runFactionGoal(contextWith(strategy), paused, 20, false);
    expect(stated).toHaveLength(1);
    runFactionGoal(contextWith(strategy), paused, 50, false);
    expect(stated[1]).toEqual([]);
    expect(paused.goal).toBeUndefined();
  });

  it("drops a finished intent for one decision, so the next orders it again", () => {
    const { stated, statuses, strategy } = fakeStrategy();
    const state = stateWith({ goal: "attack" });
    runFactionGoal(contextWith(strategy), state, 0, true);
    statuses.push({ index: 0, kind: "scout", status: "done", strength: 0 });
    runFactionGoal(contextWith(strategy), state, 60, true);
    statuses.length = 0;
    runFactionGoal(contextWith(strategy), state, 120, true);
    expect(stated).toEqual([[{ kind: "scout" }], [], [{ kind: "scout" }]]);
  });

  it("gives no order for expand and never touches the director", () => {
    const { stated, strategy } = fakeStrategy([target(4, 31, 32)]);
    const state = stateWith({ goal: "expand", until: 100 });
    expect(isExpanding(state.goal, 50)).toBe(true);
    expect(isExpanding(state.goal, 100)).toBe(false);
    expect(isExpanding({ goal: "attack" }, 0)).toBe(false);
    runFactionGoal(contextWith(strategy), state, 50, true);
    runFactionGoal(contextWith(strategy), state, 100, true);
    expect(stated).toEqual([]);
    expect(state.goal).toBeUndefined();
  });
});

describe("setFactionGoal on an island", () => {
  const island = (map: MapScenario | undefined, buildings: object[] = []) => {
    let now = 0;
    const { stated, strategy } = fakeStrategy();
    const context = {
      buildings, clock: { tick: () => now }, militaryDirector: { strategy },
      options: { world: { cellsX: 128, cellsZ: 128, scenario: map } }
    } as unknown as SettlementContext;
    context.factionAi = createFactionAi(context);
    const regions = [circle("region-1", 40, 44, 5),
      { id: "region-2", name: "box", shape: { kind: "rect" as const, maxX: 26, maxZ: 18, minX: 20, minZ: 10 } }];
    const host = { context, members: { region: (id: string) => regions.find(region => region.id === id) } };
    const perform = ([op, args]: Step) => FACTION_AI_ACTIONS[op]!(host as unknown as ScriptActionHost, {
      args, op, scope: { evaluate: (expr: { value: unknown }) => expr.value }
    } as unknown as ScriptActionRequest).kind === "done";
    const goalOf = (id: number) => context.factionAi!.save()?.find(saved => saved.faction === id)?.goal;
    return { context, goalOf, perform, setNow: (tick: number) => { now = tick; }, stated };
  };
  const MAP = [entry(1, "maintain"), entry(2, "none")];
  const base = { militaryFaction: 1, uid: 12, x: 60.5, z: 70.5 };

  it("saves the goal with its region as a circle and its end tick", () => {
    const { goalOf, perform, setNow } = island(scenario(MAP));
    setNow(200);
    expect(perform(setGoal(faction(1), "attack", { region: ref("region", "region-1"), seconds: num(30) })))
      .toBe(true);
    expect(goalOf(1)).toEqual({ area: { radius: 5, x: 40, z: 44 }, goal: "attack",
      until: 200 + 30 * TICKS_PER_SECOND });
    expect(perform(setGoal(faction(1), "hold", { region: ref("region", "region-2") }))).toBe(true);
    expect(goalOf(1)).toEqual({ area: { radius: 5, x: 23, z: 14 }, goal: "hold" });
    expect(perform(setGoal(faction(1), "expand"))).toBe(true);
    expect(goalOf(1)).toEqual({ goal: "expand" });
  });

  it("posts a defend goal without a region round the faction's oldest building", () => {
    const { goalOf, perform } = island(scenario(MAP), [{ ...base, uid: 30, x: 5, z: 5 }, base,
      { militaryFaction: 2, uid: 3, x: 90, z: 90 }, { uid: 1, x: 10, z: 10 }]);
    expect(perform(setGoal(faction(1), "defend"))).toBe(true);
    expect(goalOf(1)).toEqual({ area: { radius: GOAL_POST_RADIUS, x: 60.5, z: 70.5 }, goal: "defend" });
  });

  it("refuses what cannot run, and changes nothing", () => {
    const { context, goalOf, perform } = island(scenario(MAP));
    const refused: Step[] = [
      setGoal(faction(4), "attack"), setGoal(faction(0), "attack"), setGoal({ kind: "computers" }, "attack"),
      setGoal(faction(1), "conquer"), setGoal(faction(1), "attack", { seconds: num(0) }),
      setGoal(faction(1), "attack", { seconds: str("long") }),
      setGoal(faction(1), "attack", { region: ref("region", "nowhere") }),
      setGoal(faction(1), "defend"), setGoal(faction(1), "hold")
    ];
    for (const step of refused) expect(perform(step), JSON.stringify(step)).toBe(false);
    expect(goalOf(1)).toBeUndefined();
    expect(applyFactionGoal(context, 4, { goal: "attack" })).toBe("factionNotOnMap");
    expect(applyFactionGoal(context, 1, { goal: "conquer" })).toBe("invalidField");
    expect(applyFactionGoal(context, 1, { goal: "attack", seconds: Number.NaN })).toBe("invalidField");
    expect(applyFactionGoal(context, 1, { goal: "hold" })).toBe("goalWithoutPost");
    expect(island(scenario(undefined, "home")).perform(setGoal(faction(1), "attack"))).toBe(false);
  });

  it("keeps a goal for a faction without decisions; expand releases a military goal's soldiers at once", () => {
    const { context, goalOf, perform, stated } = island(scenario(MAP));
    expect(perform(setGoal(faction(2), "attack"))).toBe(true);
    expect(goalOf(2)).toEqual({ goal: "attack" });
    expect(context.factionAi!.posture(2)).toBeUndefined();
    expect(perform(setGoal(faction(1), "attack"))).toBe(true);
    expect(context.factionAi!.posture(1)).toBe("attack");
    expect(stated).toEqual([]);
    expect(perform(setGoal(faction(1), "expand", { seconds: num(10) }))).toBe(true);
    expect(stated).toEqual([[]]);
    expect(context.factionAi!.posture(1)).toBe("expand");
  });

  it("validates a saved goal with the faction AI state", () => {
    const { context, perform } = island(scenario(MAP));
    expect(perform(setGoal(faction(1), "attack", { seconds: num(5) }))).toBe(true);
    const factions = { allowed: [1, 2], cells: 128 * 128, required: [1] };
    const saved = JSON.parse(JSON.stringify(context.factionAi!.save()));
    expect(factionAiSaveError(saved, factions)).toBeNull();
    for (const goal of [{ goal: "conquer" }, { goal: "hold" }, { goal: "attack", until: "soon" }, 7])
      expect(factionAiSaveError([{ ...saved[0], goal }], factions), JSON.stringify(goal)).not.toBeNull();
  });
});

const counter = (id: string, event: Partial<ScriptEvent>) => trigger(id, {
  actions: [doStep("s1", "increaseVariable", { amount: num(1), variable: ref("variable", `v-${id}`) })],
  events: [{ kind: "mapStarted", player: faction(COMPUTER), slots: {}, ...event } as ScriptEvent]
});
const postureVariable: ScriptVariable =
  { id: "v-posture", initial: { type: "string", value: "" }, name: "posture", type: "string" };
const reading = (fn: string, args: Record<string, unknown> = {}) =>
  ({ args: { faction: faction(COMPUTER), ...args }, fn, k: "fn" });

/** The goal at the map's start, a counter of the faction's launched attacks and its posture read every second. */
const attackScript = (seconds?: number): MapScript => emptyScript({
  triggers: [
    trigger("t-goal", { actions: [doStep("s1", ...setGoal(faction(COMPUTER), "attack",
      seconds === undefined ? {} : { seconds: num(seconds) }))] }),
    counter("launched", { kind: "factionAttackLaunched" }),
    trigger("t-read", {
      actions: [doStep("s1", "setVariable", { value: reading("factionPosture"),
        variable: ref("variable", "v-posture") })],
      events: [{ kind: "periodic", player: { kind: "any" }, slots: { seconds: num(1) } }]
    })
  ],
  variables: [numberVariable("v-launched", "launched"), postureVariable]
});

/** The scripted fixture: a `maintain` camp of twelve soldiers and a script that tells the faction to attack. */
const attackFixture = (script: MapScript | undefined) => createFactionAttackFixture({ mode: "maintain" }, script);

const traced = <T>(run: () => T) => {
  const records: DirectorTraceRecord[] = [];
  setDirectorTraceSink(record => { records.push({ ...record }); });
  try {
    return { records, result: run() };
  } finally {
    setDirectorTraceSink(null);
  }
};

const valueOf = (simulation: SettlementSimulation, id: string) =>
  simulation.script()!.engine.state.values[id]?.value;

describe("a scripted attack goal in a running map", () => {
  it("scouts first and attacks only the building the faction has come to know; the event fires once", () => {
    const live = attackFixture(attackScript());
    advance(live.simulation, 80);
    expect(live.simulation.saveState().factionAi?.[0]?.goal).toEqual({ goal: "attack" });
    expect(live.strategy().status(COMPUTER)).toMatchObject([{ kind: "scout" }]);
    expect(valueOf(live.simulation, "v-posture")).toBe("attack");
    expect(valueOf(live.simulation, "v-launched")).toBe(0);

    const { records } = traced(() => advance(live.simulation, 1700));
    expect(records.find(record => record.macro !== "hold")?.macro).toBe("scout");
    const strikes = records.filter(record => record.macro === "strike");
    expect(strikes.length).toBeGreaterThan(0);
    expect(strikes.every(record => record.knownTargets > 0 && record.target === live.guardhouse)).toBe(true);
    expect(records.some(record => record.macro === "raid")).toBe(false);
    expect(live.simulation.saveState().factionAi?.[0]?.goal).toEqual({ goal: "attack", target: live.guardhouse });
    expect(live.strategy().status(COMPUTER)).toMatchObject([{ kind: "attack" }]);
    expect(valueOf(live.simulation, "v-launched")).toBe(1);
  }, 240_000);

  it("is deterministic, and a reload in the middle of the override continues to the same state", () => {
    const live = attackFixture(attackScript(60)), again = attackFixture(attackScript(60));
    const reloaded = attackFixture(attackScript(60));
    advance(live.simulation, 1500);
    advance(again.simulation, 1500);
    expect(stateHashOf(again.simulation)).toBe(stateHashOf(live.simulation));
    advance(reloaded.simulation, 500);
    const saved = reloaded.simulation.saveState();
    expect(saved.factionAi?.[0]?.goal).toMatchObject({ goal: "attack", until: 60 * TICKS_PER_SECOND });
    expect(reloaded.simulation.loadState(JSON.parse(JSON.stringify(saved)))).toEqual({ ok: true });
    advance(reloaded.simulation, 1000);
    expect(stateHashOf(reloaded.simulation)).toBe(stateHashOf(live.simulation));
    // The override ended at its tick: no goal, no intent, the faction's own posture again.
    expect(live.simulation.saveState().factionAi?.[0]?.goal).toBeUndefined();
    expect(live.strategy().status(COMPUTER).filter(entry => entry.force === undefined)).toEqual([]);
    expect(["grow", "fortify"]).toContain(valueOf(live.simulation, "v-posture"));
    // Once its dismissed force is home the director forgets the faction: the quiet-island skip may run again.
    advance(live.simulation, 2400);
    expect(live.simulation.saveState().military?.combat?.director).toBeUndefined();
  }, 240_000);

  it("leaves a map without the action as it was: no goal, no intent, the same state as without a script", () => {
    const quiet = attackFixture(emptyScript({ triggers: [counter("launched", { kind: "factionAttackLaunched" })],
      variables: [numberVariable("v-launched", "launched")] }));
    const plain = attackFixture(undefined);
    advance(quiet.simulation, 400);
    advance(plain.simulation, 400);
    const { scriptRun: _run, scriptSnapshot: _snapshot, ...saved } = quiet.simulation.saveState();
    expect(saved.factionAi?.[0]?.goal).toBeUndefined();
    expect(saved.military?.combat?.director).toBeUndefined();
    expect(saved).toEqual(plain.simulation.saveState());
  }, 240_000);
});

describe("computer faction building events and counts", () => {
  const AI = 2;
  const DEPOT = { typeId: 0, x: 47, z: 46 };
  const WOODCUTTER = { typeId: 17, x: 56, z: 47 };
  const START_KIT = { settlers: 4, stock: { axe: 1, hammer: 2, logs: 12, planks: 12, stone: 12 } };
  const count = (id: string, expr: object) => doStep(id, "setVariable", { value: expr,
    variable: ref("variable", `v-${id}`) });
  const woodcutter = { type: { type: ref("content", "building:woodcutter") } };
  const script = emptyScript({
    triggers: [
      counter("started", { kind: "factionBuildingStarted", player: faction(AI) }),
      counter("completed", { kind: "factionBuildingCompleted", player: faction(AI) }),
      counter("playerStarted", { kind: "factionBuildingStarted", player: faction(0) }),
      counter("anyPlaced", { kind: "constructionPlaced", player: { kind: "any" } }),
      trigger("t-read", {
        actions: [
          count("buildings", { args: { faction: faction(AI) }, fn: "factionBuildingCount", k: "fn" }),
          count("woodcutters", { args: { faction: faction(AI), ...woodcutter }, fn: "factionBuildingCount",
            k: "fn" }),
          count("soldiers", { args: { faction: faction(AI) }, fn: "factionSoldierCount", k: "fn" })
        ],
        events: [{ kind: "periodic", player: { kind: "any" }, slots: { seconds: num(1) } }]
      })
    ],
    variables: ["started", "completed", "playerStarted", "anyPlaced", "buildings", "woodcutters", "soldiers"]
      .map(id => numberVariable(`v-${id}`, id))
  });
  const island = () => {
    const world = huntingWorld();
    world.scenario = economyCampaignScenario([AI]);
    world.script = script;
    return createSettlementSimulation({ canWorkerEnterPlot: () => true, homeBuilding: 0, initialSettlers: 8,
      roads: createRoadNetwork(world), world });
  };

  it("fires started and completed once per building of the faction, never for the player's", () => {
    const simulation = island();
    const depot = simulation.aiPlace(AI, DEPOT, START_KIT);
    expect(depot.ok, depot.reason).toBe(true);
    advance(simulation, 2);
    const afterDepot = valueOf(simulation, "v-started") as number;
    const site = simulation.placeFactionBuilding(AI, WOODCUTTER);
    expect(site.ok, site.reason).toBe(true);
    expect(simulation.connectFactionRoads(AI, depot.building!.access, site.building!.access)).toBeTruthy();
    const own = simulation.placeBuilding(WOODCUTTER.typeId, 17, 11);
    expect(own.ok, own.reason).toBe(true);
    for (let spent = 0; spent < 12_000 && site.building!.construction < 1; spent += 20) advance(simulation, 20);
    advance(simulation, 40);
    expect(site.building!.construction).toBe(1);
    expect((valueOf(simulation, "v-started") as number) - afterDepot).toBe(1);
    expect(valueOf(simulation, "v-completed")).toBe(1);
    expect(valueOf(simulation, "v-playerStarted")).toBe(0);
    expect(valueOf(simulation, "v-anyPlaced")).toBeGreaterThanOrEqual(2);
    expect(valueOf(simulation, "v-buildings")).toBe(2);
    expect(valueOf(simulation, "v-woodcutters")).toBe(1);
    expect(valueOf(simulation, "v-soldiers")).toBe(0);
  }, 240_000);
});

describe("faction goal vocabulary in the script editor", () => {
  const slotsOf = (script: MapScript) => {
    const [row] = triggerBlocks(script.triggers[0]!, { locale: "en", script }).actions;
    const parts: readonly BlockPart[] = row && "block" in row ? row.block.parts : [];
    return parts.filter((part): part is SlotPart => part.kind === "slot");
  };

  it("lists the action, the events and the readings once, with English sentences and labels", () => {
    expect(ACTION_CATALOG.setFactionGoal.args.map(slot => [slot.name, slot.type.kind, slot.optional])).toEqual([
      ["faction", "player", false], ["goal", "choice", false], ["region", "ref", true], ["seconds", "value", true]
    ]);
    expect(Object.values(ACTION_GROUPS).flat().filter(op => op === "setFactionGoal")).toHaveLength(1);
    expect(actionSentence("setFactionGoal", "en")).toBe("set the goal of {faction} to {goal}");
    for (const goal of AI_GOALS) expect(choiceLabel(goal, "en")).toBe(goal);
    for (const kind of ["factionBuildingStarted", "factionBuildingCompleted", "factionAttackLaunched"] as const) {
      expect(Object.values(EVENT_GROUPS).flat().filter(listed => listed === kind), kind).toHaveLength(1);
      expect(eventSentence(kind, "primary", "en")).toContain("{player}");
      expect(EVENT_CATALOG[kind].source).toBe("sim");
    }
    expect(EVENT_CATALOG.factionBuildingCompleted.subject).toBe("building");
    expect(EVENT_CATALOG.factionAttackLaunched.responses).toEqual(["triggeringPlayer", "targetActor"]);
    expect(FUNCTION_CATALOG.factionBuildingCount.result).toBe("number");
    expect(FUNCTION_CATALOG.factionSoldierCount.result).toBe("number");
    expect(FUNCTION_CATALOG.factionPosture.result).toBe("string");
    for (const fn of ["factionBuildingCount", "factionSoldierCount", "factionPosture"] as const)
      expect(functionSentence(fn, "en")).toContain("{faction}");
    const context = { locale: "en", script: emptyScript() };
    const offered = (type: "number" | "string") => functionChoices(type, context).map(choice => choice.key);
    expect(offered("number")).toEqual(expect.arrayContaining(["factionBuildingCount", "factionSoldierCount"]));
    expect(offered("string")).toContain("factionPosture");
  });

  it("edits a new step with the existing pickers and round-trips through the map file", () => {
    let script = emptyScript({ regions: [circle("region-1", 20, 20, 6)],
      triggers: [trigger("t-goal", { actions: [createActionStep("setFactionGoal", "s1")] })] });
    const slots = slotsOf(script);
    expect(slots.map(slot => [slot.path.at(-1), slot.optional, slot.spec.kind])).toEqual([
      ["faction", false, "player"], ["goal", false, "choice"], ["region", true, "ref"], ["seconds", true, "value"]
    ]);
    const [who, goal] = slots;
    expect(tabChoices("list", goal!.spec, { locale: "en", script }).map(choice => choice.key)).toEqual([...AI_GOALS]);
    const pick = (slot: SlotPart, label: string) => {
      const choice = tabChoices("list", slot.spec, { locale: "en", script }).find(found => found.label === label);
      expect(choice, `${slot.label}: ${label}`).toBeDefined();
      script = setAtPath(script, ["triggers", 0, ...slot.path], choice!.value);
    };
    pick(who!, "Player 2");
    pick(goal!, "defend");
    script = setAtPath(script, ["triggers", 0, "actions", 0, "args", "region"], ref("region", "region-1"));
    script = setAtPath(script, ["triggers", 0, "actions", 0, "args", "seconds"], num(120));
    expect(script.triggers[0]!.actions).toEqual([doStep("s1", "setFactionGoal", { faction: faction(1),
      goal: str("defend"), region: ref("region", "region-1"), seconds: num(120) })]);
    const decoded = decodeHeaderScript(encodeHeaderScript(script) as Record<string, unknown>)!.script;
    expect(decoded).toEqual(script);
    const world = { cellsX: 128, cellsZ: 128, scenario: scenario([entry(1, "maintain")]) } as unknown as WorldData;
    expect(validateEditedScript(world, decoded).errors).toEqual([]);
  });
});
