import { afterEach, describe, expect, it, vi } from "vitest";

import { doStep, emptyScript, num, ref, str, trigger } from "../../island-of-settlers-shared/tests/script-fixtures";
import { type DirectorTraceRecord, setDirectorTraceSink } from "../src/shared/settlement/commander/director-trace";
import type { DirectorTarget, MilitaryDirectorPort } from "../src/shared/settlement/commander/director-types";
import type {
  CommanderStrategicApi, IntentStatus, StrategicIntent
} from "../src/shared/settlement/commander/strategic-intents";
import { GOAL_POST_RADIUS, STRATEGY_LEVELS } from "../src/shared/settlement/economy-ai/constants";
import { createFactionAiState } from "../src/shared/settlement/economy-ai/faction-ai-state";
import { factionAiSaveError } from "../src/shared/settlement/economy-ai/faction-ai-save-validation";
import type { FactionAiState } from "../src/shared/settlement/economy-ai/faction-ai-types";
import { runFactionStrategy } from "../src/shared/settlement/economy-ai/faction-strategy";
import { strategyRowOf } from "../src/shared/settlement/economy-ai/style-strategy";
import type { KnownUnitRecord } from "../src/shared/settlement/faction-knowledge";
import { setVisionProbe, visionProbeReport } from "../src/shared/settlement/faction-vision-probe";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import type { FactionAiLevel, FactionAiMode, FactionAiStyle } from "../src/shared/world/scenario-faction-ai";
import { stateHashOf } from "../tools/bench/military-a14-metrics";
import { ATTACK_FIXTURE_FACTION, createFactionAttackFixture } from "./helpers/faction-attack-fixture";

vi.mock("../src/shared/world/generation/generate-world", async (importOriginal) =>
  (await import("./helpers/world-cache-store")).cachedGenerateWorldModule(importOriginal));

/**
 * EAI4b: a computer faction's own strategic intents through the director's strategic contract (A14 plan §5.4):
 * posture rules on a recorded contract, then a develop camp in a running map that scouts, finds the player's
 * Guardhouse and attacks only it; determinism, a reload mid-attack, the A13 probe and a scripted override.
 */

const FACTION = 1;
const HARD = STRATEGY_LEVELS.hard;
const BASE = { uid: 10, x: 40, z: 40 };

const record = (uid: number, x: number, z: number): KnownUnitRecord =>
  ({ faction: 0, firstKnownTick: 0, health: 1, rank: 0, tick: 0, type: "shield", uid, x, z });
const target = (uid: number, x: number, z: number): DirectorTarget => ({ tier: 2, uid, x, z });

/** A strategic contract that records every stated list; tests set its statuses, targets and field strength. */
const recordingContract = () => {
  const stated: (readonly StrategicIntent[])[] = [];
  const contract = { field: 0, statuses: [] as IntentStatus[], targets: [] as DirectorTarget[] };
  const strategy: CommanderStrategicApi = {
    armyRequests: () => [], fieldStrength: () => contract.field, knownTargets: () => contract.targets,
    setIntents: (_faction, intents) => {
      stated.push(intents);
      return intents.map((_, index) => ({ index, status: "accepted" as const }));
    },
    status: () => contract.statuses, uncommitted: () => []
  };
  return { contract, stated, strategy };
};

/** A faction's AI state and an island context round the recording contract (no simulation). */
const decider = (
  mode: FactionAiMode, level: FactionAiLevel = "hard", buildings: object[] = [BASE], style?: FactionAiStyle
) => {
  const { contract, stated, strategy } = recordingContract();
  const records: KnownUnitRecord[] = [];
  const entry = { faction: FACTION, level, mode, ...(style ? { style } : {}) };
  const context = {
    buildings: buildings.map(building => ({ militaryFaction: FACTION, ...building })),
    factionKnowledge: { remembered: () => records },
    militaryDirector: { strategy } as MilitaryDirectorPort,
    options: { world: { scenario: { factionAi: [entry] } } }
  } as unknown as SettlementContext;
  const state: FactionAiState = createFactionAiState(entry, 0);
  const decide = (now: number) => runFactionStrategy(context, state, now);
  return { contract, decide, records, stated, state };
};

describe("styles scale the level's offensive row (EAI5a)", () => {
  it("balanced plays the level's row; turtle later, larger, never raids; aggressive sooner, smaller, raids", () => {
    for (const level of ["easy", "medium", "hard"] as const) {
      expect(strategyRowOf("balanced", level)).toEqual(STRATEGY_LEVELS[level]);
      expect(strategyRowOf("turtle", level).firstAttackTicks).toBeGreaterThan(STRATEGY_LEVELS[level].firstAttackTicks);
      expect(strategyRowOf("turtle", level).raids).toBe(false);
      expect(strategyRowOf("aggressive", level).firstAttackTicks).toBeLessThan(STRATEGY_LEVELS[level].firstAttackTicks);
      expect(strategyRowOf("aggressive", level).raids).toBe(true);
    }
  });

  it("an aggressive easy faction raids at its early tick; a hard turtle waits for its late one and never raids", () => {
    const aggressive = decider("develop", "easy", [BASE], "aggressive");
    // Below its attack strength (easy 400 × 75 %), above a raid's 200.
    aggressive.contract.field = 250;
    aggressive.contract.targets.push(target(91, 80, 80));
    aggressive.decide(strategyRowOf("aggressive", "easy").firstAttackTicks);
    expect(aggressive.stated.at(-1)).toEqual([{ kind: "raid", target: { kind: "site", uid: 91 } }]);
    const turtle = decider("develop", "hard", [BASE], "turtle");
    turtle.contract.field = 300;
    turtle.contract.targets.push(target(91, 80, 80));
    turtle.decide(HARD.firstAttackTicks);
    turtle.decide(strategyRowOf("turtle", "hard").firstAttackTicks);
    expect(turtle.stated).toEqual([]);
    turtle.contract.field = 2000;
    turtle.decide(strategyRowOf("turtle", "hard").firstAttackTicks + 60);
    expect(turtle.stated.at(-1)).toEqual([{ kind: "attack", minStrength: strategyRowOf("turtle", "hard").attackStrength,
      target: { kind: "site", uid: 91 } }]);
  });
});

describe("a faction's own strategic intents (posture rules)", () => {
  it("states nothing and never touches the director while it knows no enemy and may not attack yet", () => {
    const { contract, decide, stated, state } = decider("develop");
    contract.field = 1200;
    decide(HARD.firstAttackTicks - 1);
    expect(stated).toEqual([]);
    expect(state.strategy).toEqual({ failures: 0, retryTick: 0, stated: false });
  });

  it("defends its base against a known enemy near it, and attacks nothing then", () => {
    const { contract, decide, records, stated } = decider("develop");
    contract.field = 1200;
    contract.targets.push(target(90, 80, 80));
    records.push(record(500, BASE.x + GOAL_POST_RADIUS, BASE.z));
    decide(HARD.firstAttackTicks);
    expect(stated.at(-1)).toEqual([{ area: { radius: GOAL_POST_RADIUS, x: BASE.x, z: BASE.z }, kind: "defend",
      priority: 1 }]);
  });

  it("scouts while it knows no target, then attacks the most urgent known building with its level's strength", () => {
    const { contract, decide, stated, state } = decider("develop");
    contract.field = 1200;
    decide(HARD.firstAttackTicks);
    expect(stated.at(-1)).toEqual([{ kind: "scout" }]);
    contract.statuses = [{ index: 0, kind: "scout", status: "done", strength: 0 }];
    contract.targets.push(target(91, 80, 80), target(92, 10, 10));
    decide(HARD.firstAttackTicks + 60);
    expect(stated.at(-1)).toEqual([{ kind: "attack", minStrength: HARD.attackStrength,
      target: { kind: "site", uid: 91 } }]);
    expect(state.strategy).toMatchObject({ stated: true, target: 91 });
  });

  it("raids when too weak for an attack, and waits while the known enemy outweighs it", () => {
    const hard = decider("develop");
    hard.contract.field = 300;
    hard.contract.targets.push(target(91, 80, 80));
    hard.decide(HARD.firstAttackTicks);
    expect(hard.stated.at(-1)).toEqual([{ kind: "raid", target: { kind: "site", uid: 91 } }]);
    const outweighed = decider("develop");
    outweighed.contract.field = 900;
    outweighed.contract.targets.push(target(91, 80, 80));
    for (let uid = 0; uid < 10; uid++) outweighed.records.push(record(uid, 90, 90));
    outweighed.decide(HARD.firstAttackTicks);
    expect(outweighed.stated.at(-1)?.map(intent => intent.kind)).toEqual(["hold"]);
  });

  it("on easy only raids, never before its late first tick and never an attack, and rests after each raid", () => {
    const EASY = STRATEGY_LEVELS.easy;
    const { contract, decide, state, stated } = decider("develop", "easy");
    contract.field = 1200;
    contract.targets.push(target(91, 80, 80));
    decide(HARD.firstAttackTicks);
    decide(EASY.firstAttackTicks - 1);
    expect(stated).toEqual([]);
    decide(EASY.firstAttackTicks);
    expect(stated.at(-1)).toEqual([{ kind: "raid", target: { kind: "site", uid: 91 } }]);
    const done = EASY.firstAttackTicks + 600;
    contract.statuses = [{ index: 0, kind: "raid", status: "done", strength: 0 }];
    decide(done);
    expect(state.strategy).toMatchObject({ failures: 0, retryTick: done + EASY.offensiveRestTicks });
    contract.statuses = [];
    decide(done + EASY.offensiveRestTicks - 1);
    expect(stated.at(-1)).toEqual([]);
    decide(done + EASY.offensiveRestTicks);
    expect(stated.at(-1)?.map(intent => intent.kind)).toEqual(["raid"]);
  });

  it("backs off after a failed attack, then attacks again; a rejected target is scouted first", () => {
    const { contract, decide, stated, state } = decider("develop");
    contract.field = 1200;
    contract.targets.push(target(91, 80, 80));
    const now = HARD.firstAttackTicks;
    decide(now);
    contract.statuses = [{ index: 0, kind: "attack", status: "failed", strength: 0 }];
    decide(now + 60);
    expect(stated.at(-1)).toEqual([]);
    expect(state.strategy).toEqual({ failures: 1, retryTick: now + 60 + HARD.retryTicks, stated: false });
    contract.statuses = [];
    decide(now + 60 + HARD.retryTicks);
    expect(stated.at(-1)?.map(intent => intent.kind)).toEqual(["attack"]);
    contract.statuses = [{ index: 0, kind: "attack", status: "rejectedUnknownTarget", strength: 0 }];
    decide(now + 120 + HARD.retryTicks);
    expect(stated.at(-1)).toEqual([{ kind: "scout" }]);
  });

  it("keeps its running attack and retreats once it is broken", () => {
    const { contract, decide, records, stated, state } = decider("develop");
    contract.field = 1000;
    contract.targets.push(target(91, 80, 80));
    decide(HARD.firstAttackTicks);
    contract.field = 0;
    contract.statuses = [{ index: 0, kind: "attack", status: "underway", strength: 900 }];
    decide(HARD.firstAttackTicks + 60);
    expect(stated.at(-1)?.map(intent => intent.kind)).toEqual(["attack"]);
    contract.statuses = [{ index: 0, kind: "attack", status: "underway", strength: 200 }];
    for (let uid = 0; uid < 6; uid++) records.push(record(uid, 80, 80));
    decide(HARD.firstAttackTicks + 120);
    expect(stated.at(-1)).toEqual([{ kind: "retreat" }]);
    expect(state.strategy).toMatchObject({ failures: 1 });
  });

  it("lets a maintain faction only defend and hold its front, never attack or scout", () => {
    const { contract, decide, records, stated } = decider("maintain", "hard", [BASE, { uid: 11, x: 70, z: 40 }]);
    contract.field = 2000;
    contract.targets.push(target(91, 80, 80));
    decide(HARD.firstAttackTicks);
    expect(stated).toEqual([]);
    records.push(record(500, 95, 40));
    decide(HARD.firstAttackTicks + 60);
    expect(stated.at(-1)).toEqual([{ area: { radius: 20, x: 70, z: 40 }, kind: "hold" }]);
    records.push(record(501, BASE.x, BASE.z + 4));
    decide(HARD.firstAttackTicks + 120);
    expect(stated.at(-1)?.map(intent => intent.kind)).toEqual(["defend"]);
  });

  it("validates its saved memory with the faction AI state", () => {
    const factions = { allowed: [1], cells: 16, required: [1] };
    const saved = { due: [0, 0, 0, 0], faction: 1, mode: "develop" };
    const strategies = [{ failures: 2, retryTick: 4000, stated: true, target: 91 }, { stated: true }];
    for (const strategy of strategies) expect(factionAiSaveError([{ ...saved, strategy }], factions)).toBeNull();
    for (const strategy of [{ failures: 0 }, { failures: 9 }, { stated: false }, { target: -1 }, { other: 1 }])
      expect(factionAiSaveError([{ ...saved, strategy }], factions), JSON.stringify(strategy)).not.toBeNull();
  });
});

const advance = (simulation: { update: (dt: number) => void }, ticks: number) => {
  for (let tick = 0; tick < ticks; tick++) simulation.update(.05);
};

const traced = (run: () => void) => {
  const records: DirectorTraceRecord[] = [];
  setDirectorTraceSink(entry => { records.push({ ...entry }); });
  try {
    run();
  } finally {
    setDirectorTraceSink(null);
  }
  return records;
};

/** The develop camp at the hard level (first offensive at 120 s). */
const developCamp = (script?: Parameters<typeof createFactionAttackFixture>[1]) =>
  createFactionAttackFixture({ level: "hard", mode: "develop" }, script);

const offensiveOf = (strategy: () => CommanderStrategicApi) =>
  strategy().status(ATTACK_FIXTURE_FACTION).find(entry => entry.kind === "attack" || entry.kind === "raid");

afterEach(() => {
  setVisionProbe(null);
  setDirectorTraceSink(null);
});

describe("a develop faction's own offensive in a running map", () => {
  it("scouts, finds the player's Guardhouse and attacks only it; the A13 probe reads nothing unseen", () => {
    setVisionProbe("latest");
    const live = developCamp();
    advance(live.simulation, HARD.firstAttackTicks - 20);
    expect(live.simulation.saveState().factionAi?.[0]?.strategy).toBeUndefined();
    const records = traced(() => advance(live.simulation, 2400));
    expect(records.find(entry => entry.macro !== "hold")?.macro).toBe("scout");
    const offensive = records.filter(entry => entry.macro === "strike" || entry.macro === "raid");
    expect(offensive.length).toBeGreaterThan(0);
    expect(offensive.every(entry => entry.knownTargets > 0 && entry.target === live.guardhouse)).toBe(true);
    expect(live.simulation.saveState().factionAi?.[0]?.strategy).toMatchObject({ stated: true });
    const report = visionProbeReport();
    expect(report.reduce((sum, site) => sum + site.reads, 0)).toBeGreaterThan(0);
    expect(report.reduce((sum, site) => sum + site.unseen, 0)).toBe(0);
  }, 300_000);

  it("is deterministic, and a reload in the middle of its attack continues to the same state", () => {
    const live = developCamp(), again = developCamp(), reloaded = developCamp();
    const attackTick = HARD.firstAttackTicks + 1500;
    advance(reloaded.simulation, attackTick);
    expect(offensiveOf(reloaded.strategy)).toBeDefined();
    const saved = reloaded.simulation.saveState();
    expect(reloaded.simulation.loadState(JSON.parse(JSON.stringify(saved)))).toEqual({ ok: true });
    advance(reloaded.simulation, 600);
    advance(live.simulation, attackTick + 600);
    advance(again.simulation, attackTick + 600);
    expect(stateHashOf(again.simulation)).toBe(stateHashOf(live.simulation));
    expect(stateHashOf(reloaded.simulation)).toBe(stateHashOf(live.simulation));
  }, 300_000);

  it("gives way to a script's goal while it runs and takes the intents back when it ends", () => {
    const region = { id: "camp", name: "camp", shape: { centerX: 64, centerZ: 48, kind: "circle" as const,
      radius: 10 } };
    const hold = emptyScript({ regions: [region], triggers: [trigger("t-goal", { actions: [doStep("s1",
      "setFactionGoal", { faction: { faction: FACTION, kind: "slot" }, goal: str("hold"),
        region: ref("region", "camp"), seconds: num(150) })] })] });
    const live = developCamp(hold);
    advance(live.simulation, HARD.firstAttackTicks + 200);
    expect(live.simulation.saveState().factionAi?.[0]?.goal).toMatchObject({ goal: "hold" });
    expect(live.strategy().status(FACTION).map(entry => entry.kind)).toEqual(["hold"]);
    expect(live.simulation.saveState().factionAi?.[0]?.strategy).toBeUndefined();
    advance(live.simulation, 600);
    expect(live.simulation.saveState().factionAi?.[0]?.goal).toBeUndefined();
    expect(live.strategy().status(FACTION).map(entry => entry.kind)).toEqual(["scout"]);
    expect(live.simulation.saveState().factionAi?.[0]?.strategy).toEqual({ stated: true });
  }, 300_000);
});
