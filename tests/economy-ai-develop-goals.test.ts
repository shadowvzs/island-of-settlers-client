import { beforeEach, describe, expect, it } from "vitest";

import { resolvedBuildProgram } from "../src/shared/settlement/economy-ai/build-program";
import {
  DEVELOP_LAYER_TICKS, DEVELOP_PACES, FACTION_AI_LAYER_TICKS, FORTIFY_POSTURE, GROW_POSTURE
} from "../src/shared/settlement/economy-ai/constants";
import {
  chooseBuildGoal, fillWantedCounts, goalDeficit, goalScore, goalTarget, prerequisitesMet, programPosture
} from "../src/shared/settlement/economy-ai/develop-goals";
import { developSaveError } from "../src/shared/settlement/economy-ai/develop-state";

const program = resolvedBuildProgram("balanced", "roman");
const indexOf = (id: string) => program.goals.findIndex(goal => goal.id === id);
const goal = (id: string) => program.goals[indexOf(id)]!;
const WOODCUTTER = indexOf("woodcutter");
const SAWMILL = indexOf("sawmill");
const QUARRY = indexOf("quarry");
const RESIDENCE = indexOf("smallResidence");

/** Plenty of every program ware, so only the counts decide. */
const stockAll = (amount: number) => program.view.stock.fill(amount);

/** Sets a goal's buildings: `finished` of `count` stand finished. */
const own = (index: number, count: number, finished = count) => {
  program.view.counts[index] = count;
  program.view.finished[index] = finished;
  fillWantedCounts(program);
};

beforeEach(() => {
  const { blocked, counts, finished } = program.view;
  blocked.fill(0);
  counts.fill(0);
  finished.fill(0);
  stockAll(100);
  program.view.ownBuildings = 1;
  fillWantedCounts(program);
});

describe("build program resolution", () => {
  it("plays its nation's target curve: the Indigenous cloth chain from the start, others for the armour", () => {
    expect(goalTarget(goal("weaver"), 0)).toBe(0);
    const indigenous = resolvedBuildProgram("balanced", "indigenous");
    expect(goalTarget(indigenous.goals.find(entry => entry.id === "weaver")!, 0)).toBe(1);
    expect(indigenous.wares).toContain("cloth");
    expect(resolvedBuildProgram("balanced", "roman")).toBe(program);
    const turtle = resolvedBuildProgram("turtle", "roman");
    expect(turtle).not.toBe(program);
    expect(turtle.goals.some(entry => entry.id === "watchtower")).toBe(true);
  });

  it("the Academy pulls its whole weapons, armour and beer chain once the town is large enough (EAI4a)", () => {
    program.view.ownBuildings = 20;
    fillWantedCounts(program);
    for (const id of ["militaryAcademy", "armory", "ironSmelter", "ironMine", "charburner", "leatherworks",
      "tannery", "skinner", "pigFarm", "weaver", "flaxFarm", "brewery", "farm", "well"])
      expect(program.view.wanted[indexOf(id)], id).toBeGreaterThanOrEqual(1);
    expect(goal("guardhouse").expands).toBe(true);
    expect(program.expansion).toBe(indexOf("guardhouse"));
  });

  it("resolves real building types and the nation's construction cost", () => {
    expect(goal("woodcutter").typeId).toBe(17);
    // Construction wares and the tools of the goals' workers.
    expect(program.wares).toEqual(expect.arrayContaining(["axe", "planks", "saw", "stone"]));
    const planks = program.wares.indexOf("planks"), stone = program.wares.indexOf("stone");
    expect([goal("woodcutter").cost[planks], goal("woodcutter").cost[stone]]).toEqual([3, 0]);
    expect(goal("woodcutter").tool).toBe(program.wares.indexOf("axe"));
    expect(goal("smallResidence").tool).toBe(-1);
    expect(program.goalOfType[17]).toBe(WOODCUTTER);
    expect(program.goalOfType[0]).toBe(-1);
  });
});

describe("target curve and deficit", () => {
  it("steps up with the faction's own building count", () => {
    expect([0, 13, 14, 27, 28, 400].map(count => goalTarget(goal("woodcutter"), count))).toEqual([2, 2, 3, 3, 4, 4]);
    expect([0, 9, 10, 30].map(count => goalTarget(goal("farm"), count))).toEqual([0, 0, 1, 2]);
  });

  it("counts sites as there and never goes below zero", () => {
    own(WOODCUTTER, 1, 0);
    expect(goalDeficit(program, WOODCUTTER)).toBe(1);
    own(WOODCUTTER, 5);
    expect(goalDeficit(program, WOODCUTTER)).toBe(0);
  });
});

describe("prerequisites", () => {
  it("need finished buildings of the earlier goal, not sites", () => {
    own(WOODCUTTER, 1, 0);
    expect(prerequisitesMet(program, goal("sawmill"))).toBe(false);
    own(WOODCUTTER, 1, 1);
    expect(prerequisitesMet(program, goal("sawmill"))).toBe(true);
    own(indexOf("mill"), 1);
    expect(prerequisitesMet(program, goal("bakery"))).toBe(false);
    own(indexOf("well"), 1);
    expect(prerequisitesMet(program, goal("bakery"))).toBe(true);
  });
});

describe("scoring", () => {
  it("is deficit × weight × style × posture − cost/stock, in hundredths", () => {
    expect(goalScore(program, goal("woodcutter"), 2, 0)).toBe(2 * 10 * 100 - 3 * 100 / 100);
    stockAll(10);
    expect(goalScore(program, goal("woodcutter"), 2, 0)).toBe(2000 - 30);
  });

  it("lowers exposed groups per known enemy soldier and weighs the fortify posture", () => {
    expect(goalScore(program, goal("woodcutter"), 2, 2)).toBe(2 * 10 * 80 - 3 - 2 * 3 * 100);
    expect(goalScore(program, goal("smallResidence"), 2, 2)).toBe(2 * 7 * 60 - (4 + 2));
  });
});

describe("chooseBuildGoal", () => {
  it("starts with woodcutters, then the sawmill once one stands", () => {
    expect(chooseBuildGoal(program, -1, 0)).toBe(WOODCUTTER);
    own(WOODCUTTER, 2, 1);
    expect(chooseBuildGoal(program, -1, 0)).toBe(SAWMILL);
  });

  it("skips goals the free stock cannot pay and goals in backoff", () => {
    program.view.stock[program.wares.indexOf("planks")] = 2;
    expect(chooseBuildGoal(program, -1, 0)).toBe(-1);
    stockAll(100);
    program.view.stock[program.wares.indexOf("axe")] = 0;
    // No axe: no woodcutter could work, so it is not built.
    expect(chooseBuildGoal(program, -1, 0)).toBe(-1);
    stockAll(100);
    program.view.blocked[WOODCUTTER] = 1;
    expect(chooseBuildGoal(program, -1, 0)).toBe(-1);
  });

  it("keeps the committed goal unless a new one beats it by more than the 10 % margin", () => {
    own(WOODCUTTER, 2);
    own(SAWMILL, 1);
    own(indexOf("forester"), 1);
    // Quarry 8 × 100 vs small residence 2 × 7 × 100: the residences win on their own.
    expect(chooseBuildGoal(program, -1, 0)).toBe(RESIDENCE);
    own(RESIDENCE, 1);
    // Residence 1 × 700 − 6 against the quarry 800 − 3: 797 ≤ 694 × 1.1 is false, so the quarry takes over.
    expect(chooseBuildGoal(program, RESIDENCE, 0)).toBe(QUARRY);
    // One known enemy: quarry 8 × 90 − 3 − 300 = 417 beats residence 7 × 60 − 6 = 414, but not by 10 %.
    expect(chooseBuildGoal(program, -1, 1)).toBe(QUARRY);
    expect(chooseBuildGoal(program, RESIDENCE, 1)).toBe(RESIDENCE);
    // A reached committed goal is dropped.
    own(RESIDENCE, 2);
    expect(chooseBuildGoal(program, RESIDENCE, 0)).toBe(QUARRY);
  });

  it("scores at most 8 open goals, in program order", () => {
    program.view.ownBuildings = 40;
    for (let index = 0; index < program.goals.length; index++) own(index, 0);
    program.goals.forEach((_, index) => { program.view.finished[index] = 9; });
    // Every goal is open; the 9th and later (farm, mill, bakery, medium residence) are never scored.
    const chosen = chooseBuildGoal(program, -1, 0);
    expect(chosen).toBeLessThan(8);
    program.view.blocked.fill(1, 0, 8);
    expect(chooseBuildGoal(program, -1, 0)).toBeGreaterThanOrEqual(8);
  });

  it("raises an unbuilt prerequisite to what a waiting later goal requires, so the faction commits to it", () => {
    for (const id of ["woodcutter", "sawmill", "forester", "quarry", "smallResidence", "fishery", "hunter"])
      own(indexOf(id), 2);
    // Below 10 own buildings the well and the farm want none, but the bakery and the mill wait for them.
    expect(goalTarget(goal("well"), program.view.ownBuildings)).toBe(0);
    expect(goalDeficit(program, indexOf("well"))).toBe(1);
    expect(goalDeficit(program, indexOf("farm"))).toBe(1);
    // The farm (weight 5) before the well (4); neither had a target of its own yet.
    expect(chooseBuildGoal(program, -1, 0)).toBe(indexOf("farm"));
    own(indexOf("bakery"), 1);
    own(indexOf("mill"), 1);
    expect(goalDeficit(program, indexOf("well"))).toBe(0);
  });

  it("holds every exposed goal back while many enemies are known", () => {
    own(WOODCUTTER, 2);
    own(SAWMILL, 1);
    own(indexOf("forester"), 1);
    expect(chooseBuildGoal(program, -1, 20)).toBe(RESIDENCE);
    own(RESIDENCE, 2);
    expect(chooseBuildGoal(program, -1, 20)).toBe(-1);
  });
});

describe("styles and levels (EAI5a)", () => {
  it("a turtle plays the fortify posture while calm; every style fortifies once an enemy is known", () => {
    const turtle = resolvedBuildProgram("turtle", "roman");
    expect(programPosture(program, 0)).toBe(GROW_POSTURE);
    expect(programPosture(turtle, 0)).toBe(FORTIFY_POSTURE);
    expect(programPosture(resolvedBuildProgram("aggressive", "roman"), 0)).toBe(GROW_POSTURE);
    expect(programPosture(program, 1)).toBe(FORTIFY_POSTURE);
  });

  it("the level's commitment margin: a stubborn easy faction keeps the goal a medium one drops", () => {
    own(WOODCUTTER, 2);
    own(SAWMILL, 1);
    own(indexOf("forester"), 1);
    own(RESIDENCE, 1);
    const easy = program.commitmentPercent * DEVELOP_PACES.easy.commitmentPercent / 100;
    // Quarry 797 against the committed residence 694: beyond medium's 10 %, within easy's 20 %.
    expect(chooseBuildGoal(program, RESIDENCE, 0)).toBe(QUARRY);
    expect(chooseBuildGoal(program, RESIDENCE, 0, easy)).toBe(RESIDENCE);
  });

  it("paces the layers by level: medium keeps plan §3.3's intervals, easy slower, hard and Very hard faster", () => {
    expect(DEVELOP_LAYER_TICKS.medium).toEqual(FACTION_AI_LAYER_TICKS);
    DEVELOP_LAYER_TICKS.easy.forEach((ticks, layer) => expect(ticks).toBeGreaterThan(FACTION_AI_LAYER_TICKS[layer]!));
    DEVELOP_LAYER_TICKS.hard.forEach((ticks, layer) => expect(ticks).toBeLessThan(FACTION_AI_LAYER_TICKS[layer]!));
    DEVELOP_LAYER_TICKS.veryHard.forEach((ticks, layer) =>
      expect(ticks).toBeLessThan(DEVELOP_LAYER_TICKS.hard[layer]!));
  });
});

describe("develop save validation", () => {
  it("accepts a goal and unique backoffs and refuses empty or malformed memory", () => {
    expect(developSaveError(undefined)).toBeNull();
    expect(developSaveError({ goal: { id: "woodcutter", target: 2 } })).toBeNull();
    expect(developSaveError({ backoffs: [{ attempts: 1, goal: "quarry", retryTick: 400 }] })).toBeNull();
    for (const invalid of [{}, { backoffs: [] }, { goal: { id: "woodcutter", target: 0 } }, { goal: "woodcutter" },
      { backoffs: [{ attempts: 1, goal: "quarry", retryTick: 4 }, { attempts: 2, goal: "quarry", retryTick: 5 }] },
      { extra: 1, goal: { id: "woodcutter", target: 2 } }])
      expect(developSaveError(invalid), JSON.stringify(invalid)).not.toBeNull();
  });
});
