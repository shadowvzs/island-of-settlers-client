import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ownerOf } from "../src/shared/settlement/settlement-ownership";
import { FACTION_AI_STYLES } from "../src/shared/world/constants";
import type { FactionAiStyle } from "../src/shared/world/scenario-faction-ai";
import {
  createDevelopReferenceIsland, DEVELOP_REFERENCE_MAPS, type DevelopReferenceSimulation, REFERENCE_AI
} from "./helpers/develop-reference-maps";
import { createMilitaryIsland, MILITARY_AI } from "./helpers/military-island";

/**
 * Enemy economy AI P5 acceptance (plan §7 P5, lane EAI5a): the three styles play visibly differently. A build-order
 * trace per style on the three P3 reference maps (openings) and on the P4 military island (army timing). With
 * `STYLE_TRACE_OUTPUT=<file>` the traces are written as JSON for the lane receipt.
 */
const TICKS_PER_SECOND = 20;
const TICKS_PER_MINUTE = 60 * TICKS_PER_SECOND;
const SAMPLE_TICKS = 10 * TICKS_PER_SECOND;
const OPENING_MINUTES = 45;
const ARMY_MINUTES = 60;
const OPENING_LENGTH = 16;
const TEST_TIMEOUT = 3_600_000;
const GARRISON_TYPES = new Set([1, 2, 4, 9]);
/** Charburner, iron mine, iron smelter, armory, pig farm, skinner, tannery, leatherworks, brewery, Academy. */
const MILITARY_CHAIN = new Set([27, 12, 26, 24, 28, 3, 8, 15, 23, 40]);
const ARMS_GOALS = new Set(["armory", "brewery", "charburner", "ironMine", "ironSmelter", "leatherworks",
  "militaryAcademy", "pigFarm", "skinner", "tannery"]);
const TOWER_GOALS = new Set(["guardhouse", "watchtower"]);
const ACADEMY = new Set([40]);

type Simulation = DevelopReferenceSimulation;

interface StyleTrace {
  /** The build goals the faction committed to or backed off, in the order first seen (its intent). */
  goals: string[];
  /** Placements in order: building type and the game minute it was first seen. */
  order: { minute: number; typeId: number }[];
  /** Soldiers of the faction at each sampled whole 5 minutes. */
  soldiers: Record<number, number>;
}

const minuteOf = (simulation: Simulation) => Math.round(simulation.gameTick() / TICKS_PER_MINUTE * 10) / 10;

const ownBuildings = (simulation: Simulation, faction: number) =>
  simulation.buildings().filter(building => ownerOf(building) === faction);

const soldierCount = (simulation: Simulation, faction: number) =>
  simulation.saveState().military?.soldiers.filter(soldier => soldier.combat?.faction === faction).length ?? 0;

/** The goal the faction holds now and the goals it backed off join the trace's goals in first-seen order. */
const recordGoals = (simulation: Simulation, trace: StyleTrace) => {
  const develop = simulation.factionAiDiagnostics()[0]?.develop;
  const ids = [develop?.goal?.id, ...(develop?.backoffs ?? []).map(entry => entry.goal)];
  for (const id of ids) if (id !== undefined && !trace.goals.includes(id)) trace.goals.push(id);
};

/**
 * Plays `minutes`, sampling every 10 s: the faction's goals and new own buildings join the trace; soldiers every
 * 5 minutes.
 */
const traceOf = (simulation: Simulation, faction: number, minutes: number): StyleTrace => {
  const seen = new Set<number>();
  const trace: StyleTrace = { goals: [], order: [], soldiers: {} };
  while (simulation.gameTick() < minutes * TICKS_PER_MINUTE) {
    const next = simulation.gameTick() + SAMPLE_TICKS;
    while (simulation.gameTick() < next) simulation.update(.05);
    recordGoals(simulation, trace);
    const fresh = ownBuildings(simulation, faction).filter(building => building.typeId !== 0 && !seen.has(building.uid))
      .sort((first, second) => first.uid - second.uid);
    for (const building of fresh) {
      seen.add(building.uid);
      trace.order.push({ minute: minuteOf(simulation), typeId: building.typeId });
    }
    if (simulation.gameTick() % (5 * TICKS_PER_MINUTE) === 0) trace.soldiers[minuteOf(simulation)] = soldierCount(
      simulation, faction);
  }
  return trace;
};

const firstMinute = (trace: StyleTrace, types: ReadonlySet<number>) =>
  trace.order.find(entry => types.has(entry.typeId))?.minute ?? Infinity;
const countOf = (trace: StyleTrace, types: ReadonlySet<number>) =>
  trace.order.filter(entry => types.has(entry.typeId)).length;
const opening = (trace: StyleTrace) => trace.goals.slice(0, OPENING_LENGTH).join(",");
/** The position of the first goal of `ids` in the faction's goals; Infinity: never. */
const firstGoal = (trace: StyleTrace, ids: ReadonlySet<string>) => {
  const index = trace.goals.findIndex(id => ids.has(id));
  return index < 0 ? Infinity : index;
};

const summary = (trace: StyleTrace) => ({
  firstGarrison: firstMinute(trace, GARRISON_TYPES), firstMilitaryChain: firstMinute(trace, MILITARY_CHAIN),
  garrisons: countOf(trace, GARRISON_TYPES), militaryChain: countOf(trace, MILITARY_CHAIN),
  opening: opening(trace), placed: trace.order.map(entry => entry.typeId).join(","), soldiers: trace.soldiers
});

const traces: Record<string, Record<string, StyleTrace>> = {};

const report = (name: string, style: string, trace: StyleTrace) => {
  (traces[name] ??= {})[style] = trace;
  process.stderr.write(`P5 ${name} ${style}: ${JSON.stringify(summary(trace))}\n`);
  const output = process.env.STYLE_TRACE_OUTPUT;
  if (output) writeFileSync(output, `${JSON.stringify(traces, null, 1)}\n`);
};

/**
 * How the three styles' openings differ: distinct goal sequences, the turtle goes for towers (and places one)
 * before the others, the aggressive faction for its weapons chain before the others.
 */
const styleContrast = (byStyle: Readonly<Record<FactionAiStyle, StyleTrace>>) => {
  const { aggressive, balanced, turtle } = byStyle;
  return {
    aggressiveArmsFirst: firstGoal(aggressive, ARMS_GOALS) < Math.min(firstGoal(balanced, ARMS_GOALS),
      firstGoal(turtle, ARMS_GOALS)),
    openings: new Set(FACTION_AI_STYLES.map(style => opening(byStyle[style]))).size,
    turtleTowerPlaced: firstMinute(turtle, GARRISON_TYPES) < firstMinute(balanced, GARRISON_TYPES),
    turtleTowersFirst: firstGoal(turtle, TOWER_GOALS) < Math.min(firstGoal(balanced, TOWER_GOALS),
      firstGoal(aggressive, TOWER_GOALS))
  };
};

const DISTINCT_STYLES = {
  aggressiveArmsFirst: true, openings: FACTION_AI_STYLES.length, turtleTowerPlaced: true, turtleTowersFirst: true
};

describe("styles on the reference maps (P5: openings differ by style)", () => {
  for (const map of DEVELOP_REFERENCE_MAPS)
    it(`${map.name}: balanced, turtle and aggressive open differently`, () => {
      const byStyle = Object.fromEntries(FACTION_AI_STYLES.map(style => {
        const trace = traceOf(createDevelopReferenceIsland(map, { style }).simulation, REFERENCE_AI, OPENING_MINUTES);
        report(map.name, style, trace);
        return [style, trace];
      })) as Record<FactionAiStyle, StyleTrace>;
      expect(styleContrast(byStyle)).toEqual(DISTINCT_STYLES);
    }, TEST_TIMEOUT);
});

const academyMinute = (trace: StyleTrace) => firstMinute(trace, ACADEMY);
const soldiersAt = (trace: StyleTrace, minute: number) => trace.soldiers[minute] ?? 0;

describe("styles on the military island (P5: army timing differs by style)", () => {
  it("the aggressive faction trains first and the most; the turtle builds the most towers", () => {
    const byStyle = Object.fromEntries(FACTION_AI_STYLES.map(style => {
      const trace = traceOf(createMilitaryIsland(style).simulation, MILITARY_AI, ARMY_MINUTES);
      report("military", style, trace);
      return [style, trace];
    })) as Record<FactionAiStyle, StyleTrace>;
    const { aggressive, balanced, turtle } = byStyle;
    expect(academyMinute(aggressive)).toBeLessThan(academyMinute(balanced));
    expect(soldiersAt(aggressive, ARMY_MINUTES)).toBeGreaterThan(soldiersAt(balanced, ARMY_MINUTES));
    expect(countOf(turtle, GARRISON_TYPES)).toBeGreaterThan(countOf(balanced, GARRISON_TYPES));
  }, TEST_TIMEOUT);
});
