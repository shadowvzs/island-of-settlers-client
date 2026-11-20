import { describe, expect, it, vi } from "vitest";

import { ACTION_CATALOG } from "../../island-of-settlers-shared/src/script/catalog/actions";
import type { ScriptActionRequest } from "../../island-of-settlers-shared/src/script/engine/ports";
import { validateMapScript } from "../../island-of-settlers-shared/src/script/validate";
import { secondsToTicks } from "../../island-of-settlers-shared/src/time/constants";
import {
  doStep, emptyScript, str, TEST_CATALOG, trigger
} from "../../island-of-settlers-shared/tests/script-fixtures";
import { ACTION_GROUPS } from "../src/app/map-editor/script/constants";
import { actionSentence, sentenceSlots } from "../src/app/map-editor/script/sentences";
import { CHOICE_LABELS, SLOT_LABELS } from "../src/app/map-editor/script/sentences-data";
import {
  DIRECTOR_INTERVAL_TICKS, DIRECTOR_SLOTS, RAID_RATIO, SCOUT_AGE_TICKS, UNCERTAINTY_MARGIN
} from "../src/shared/balance/commander-director";
import {
  COMMANDER_PROFILES, type CommanderLevel, VERY_HARD_COMMANDER_PROFILE
} from "../src/shared/balance/commander-profiles";
import { COMMANDER_WEIGHTS, DECISION_INTERVAL } from "../src/shared/balance/military";
import type { ScriptActionHost } from "../src/shared/script-world/actions/action-host";
import { COMMANDER_ACTIONS } from "../src/shared/script-world/actions/commander";
import { createTargetingWeights } from "../src/shared/settlement/commander/commander-focus";
import {
  commanderLevelsSaveError, createCommanderLevels
} from "../src/shared/settlement/commander/commander-levels";
import {
  type CommanderLevelSources, createCommanderProfileSource, resolveCommanderProfile
} from "../src/shared/settlement/commander/commander-profile-source";
import { assignRoles, createRoleGroupSplitter } from "../src/shared/settlement/commander/commander-roles";
import type { CommanderUnit } from "../src/shared/settlement/commander/commander-types";
import { firstDueTick, scheduleNext } from "../src/shared/settlement/commander/director-clock";
import { targetRatio } from "../src/shared/settlement/commander/director-inputs";
import { type MacroInputs, scoreMacros } from "../src/shared/settlement/commander/director-macros";
import type { DirectorFaction } from "../src/shared/settlement/commander/director-types";
import { planScoutTrip } from "../src/shared/settlement/commander/scout-plan";
import type { DifficultyLevel } from "../src/shared/settlement/difficulty";
import type { FactionKnowledge } from "../src/shared/settlement/faction-knowledge";
import type { MilitaryTroopType } from "../src/shared/settlement/military-combat-rules";
import { createCommanderPerception } from "../src/shared/settlement/settlement-combat-tick-inputs";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import type { WorldData } from "../src/shared/world/world-data";
import { createBalanceSimulation, spawnAround } from "../tools/bench/garrison-balance-harness";
import { stateHashOf } from "../tools/bench/military-a14-metrics";

vi.mock("../src/shared/world/generation/generate-world", async (importOriginal) =>
  (await import("./helpers/world-cache-store")).cachedGenerateWorldModule(importOriginal));

/** A14-5 difficulty: the profile table, the level resolution, each level's consumers and `setCommanderLevel`. */

const LEVELS: readonly CommanderLevel[] = ["easy", "medium", "hard"];

describe("commander profile table (plan §7)", () => {
  it("keeps medium at the values the commander had before levels", () => {
    expect(COMMANDER_PROFILES.medium).toEqual({
      dangerWeight: 1,
      decisionInterval: DECISION_INTERVAL,
      directorIntervalTicks: DIRECTOR_INTERVAL_TICKS,
      focusWeight: 1,
      moraleUse: 1,
      raidRatio: RAID_RATIO,
      reactionTicks: 0,
      roleUse: "all",
      scoutAgeTicks: SCOUT_AGE_TICKS,
      uncertaintyMargin: UNCERTAINTY_MARGIN,
      weights: COMMANDER_WEIGHTS.medium
    });
  });

  it("gives easy and hard the plan's rows", () => {
    expect(COMMANDER_PROFILES.easy).toMatchObject({
      dangerWeight: 0.5, decisionInterval: 2, directorIntervalTicks: secondsToTicks(9), focusWeight: 0.5,
      moraleUse: 0.5, raidRatio: 1.5, roleUse: "frontAndOverwatch", scoutAgeTicks: secondsToTicks(90),
      uncertaintyMargin: 0.6
    });
    expect(COMMANDER_PROFILES.hard).toMatchObject({
      dangerWeight: 1.25, decisionInterval: 1, directorIntervalTicks: secondsToTicks(4), focusWeight: 1.25,
      moraleUse: 1.25, raidRatio: 1, roleUse: "flankPreferred", scoutAgeTicks: secondsToTicks(45),
      uncertaintyMargin: 0.25
    });
    for (const level of LEVELS) expect(COMMANDER_PROFILES[level].weights).toBe(COMMANDER_WEIGHTS[level]);
  });

  it("never lets a harder level react later or decide less often", () => {
    const ordered = [COMMANDER_PROFILES.easy, COMMANDER_PROFILES.medium, COMMANDER_PROFILES.hard,
      VERY_HARD_COMMANDER_PROFILE];
    for (let index = 1; index < ordered.length; index++) {
      const slower = ordered[index - 1]!, faster = ordered[index]!;
      expect(faster.decisionInterval).toBeLessThan(slower.decisionInterval);
      expect(faster.directorIntervalTicks).toBeLessThan(slower.directorIntervalTicks);
      expect(faster.reactionTicks).toBeLessThanOrEqual(slower.reactionTicks);
    }
    expect(COMMANDER_PROFILES.easy.reactionTicks).toBe(secondsToTicks(2));
  });

  it("plays Very hard as hard at 0.75 times the intervals, in whole director ticks", () => {
    expect(VERY_HARD_COMMANDER_PROFILE).toEqual({
      ...COMMANDER_PROFILES.hard, decisionInterval: 0.75, directorIntervalTicks: secondsToTicks(3), reactionTicks: 0
    });
  });
});

describe("level resolution (plan §7: the first match wins)", () => {
  const { easy, hard, medium } = COMMANDER_PROFILES;
  const veryHard = VERY_HARD_COMMANDER_PROFILE;
  const cases: readonly [string, CommanderLevelSources, unknown][] = [
    ["nothing given: medium", {}, medium],
    ["island alone", { island: "easy" }, easy],
    ["map before island", { island: "easy", map: "hard" }, hard],
    ["script before map and island", { island: "hard", map: "hard", script: "easy" }, easy],
    ["global normal keeps the island level", { global: "normal", island: "hard" }, hard],
    ["global hard: easy plays medium", { global: "hard", island: "easy" }, medium],
    ["global hard: medium plays hard", { global: "hard", map: "medium" }, hard],
    ["global hard: hard stays hard", { global: "hard", island: "hard" }, hard],
    ["global hard with no level: hard", { global: "hard" }, hard],
    ["global very hard: hard at the faster pace", { global: "veryHard", island: "easy" }, veryHard],
    ["global very hard with no level", { global: "veryHard" }, veryHard],
    ["a script level is exact under global hard", { global: "hard", script: "easy" }, easy],
    ["a script level is exact under global very hard", { global: "veryHard", map: "hard", script: "medium" }, medium]
  ];

  it.each(cases)("%s", (_name, sources, expected) => {
    expect(resolveCommanderProfile(sources)).toBe(expected);
  });

  const contextOf = (parts: { adventure?: CommanderLevel; colony?: CommanderLevel; global?: DifficultyLevel;
    map?: [number, CommanderLevel][]; }) => {
    const island = (difficulty: CommanderLevel | undefined) =>
      ({ save: () => difficulty && { island: { difficulty } } });
    const context = {
      adventure: island(parts.adventure),
      colony: island(parts.colony),
      commanderLevels: createCommanderLevels(),
      difficulty: parts.global,
      options: { world: { scenario: parts.map && {
        factionAi: parts.map.map(([faction, level]) => ({ faction, level, mode: "none" }))
      } } }
    };
    return context as unknown as SettlementContext & { commanderLevels: ReturnType<typeof createCommanderLevels> };
  };

  it("reads the script, the map's factionAi level, the island and the global difficulty of an island", () => {
    const context = contextOf({ colony: "easy", map: [[2, "hard"]] });
    const profile = createCommanderProfileSource(context);
    expect(profile(1)).toBe(easy);
    expect(profile(2)).toBe(hard);
    expect(context.commanderLevels.set(2, "medium")).toBe(true);
    expect(profile(2)).toBe(medium);
    expect(profile(1)).toBe(easy);
    expect(createCommanderProfileSource(contextOf({ adventure: "hard" }))(1)).toBe(hard);
    expect(createCommanderProfileSource(contextOf({ colony: "medium", global: "hard" }))(1)).toBe(hard);
    expect(createCommanderProfileSource(contextOf({ global: "veryHard", map: [[1, "easy"]] }))(1)).toBe(veryHard);
    expect(createCommanderProfileSource(contextOf({}))(7)).toBe(medium);
  });
});

describe("script commander levels", () => {
  it("accepts computer factions and known levels only, and counts every change", () => {
    const levels = createCommanderLevels();
    expect(levels.set(0, "hard")).toBe(false);
    expect(levels.set(17, "hard")).toBe(false);
    expect(levels.set(1.5, "hard")).toBe(false);
    expect(levels.set(3, "veryHard")).toBe(false);
    expect(levels.revision()).toBe(0);
    expect(levels.save()).toBeUndefined();
    expect(levels.set(3, "hard")).toBe(true);
    expect(levels.set(1, "easy")).toBe(true);
    expect(levels.revision()).toBe(2);
    expect(levels.set(1, "easy")).toBe(true);
    expect(levels.revision()).toBe(2);
    expect(levels.save()).toEqual([[1, "easy"], [3, "hard"]]);
    expect(levels.of(3)).toBe("hard");
    levels.restore([[2, "medium"]]);
    expect(levels.of(3)).toBeUndefined();
    expect(levels.save()).toEqual([[2, "medium"]]);
    expect(levels.revision()).toBe(3);
  });

  it("validates the saved levels", () => {
    expect(commanderLevelsSaveError(undefined)).toBeNull();
    expect(commanderLevelsSaveError([[1, "easy"], [4, "hard"]])).toBeNull();
    for (const broken of [[], {}, [[0, "easy"]], [[2, "easy"], [1, "hard"]], [[1, "easy"], [1, "hard"]],
      [[1, "veryHard"]], [[17, "hard"]], [[1]], [[1, "easy", 2]]])
      expect(commanderLevelsSaveError(broken), JSON.stringify(broken)).not.toBeNull();
  });

  it("re-reads a faction's targeting weights after its level changed", () => {
    const levels = createCommanderLevels();
    const weightsOf = createTargetingWeights(
      faction => COMMANDER_PROFILES[levels.of(faction) ?? "medium"], levels.revision);
    expect(weightsOf(1).danger).toBe(1);
    levels.set(1, "hard");
    expect(weightsOf(1).danger).toBe(1.25);
    expect(weightsOf(2).danger).toBe(1);
  });
});

describe("the levels' consumers", () => {
  const unit = (uid: number, faction: number, type: MilitaryTroopType, x = uid): CommanderUnit => ({
    busy: false, faction, fighting: false, health: 1, home: { x, z: 0 }, marching: false, rank: 0, type, uid, x,
    z: 0
  });

  it("director clock: each level's interval, slots in whole ticks", () => {
    for (const interval of [secondsToTicks(9), DIRECTOR_INTERVAL_TICKS, secondsToTicks(4), secondsToTicks(3)]) {
      const due = Array.from({ length: DIRECTOR_SLOTS }, (_, faction) => firstDueTick(faction, 0, interval));
      expect(due.every(Number.isSafeInteger)).toBe(true);
      expect(new Set(due).size).toBe(DIRECTOR_SLOTS);
      expect(Math.max(...due) - Math.min(...due)).toBeLessThan(interval);
    }
    const entry: DirectorFaction = { faction: 1, forces: [], next: 50, nextForce: 1 };
    scheduleNext(entry, 50, secondsToTicks(4));
    expect(entry.next).toBe(50 + secondsToTicks(4));
    // A level change mid-game: the next decision comes one new interval after the last.
    scheduleNext(entry, entry.next, secondsToTicks(9));
    expect(entry.next).toBe(50 + secondsToTicks(4) + secondsToTicks(9));
  });

  it("role use: easy keeps front and overwatch, hard flanks with more swordsmen", () => {
    const split = createRoleGroupSplitter();
    const rolesOf = (squad: CommanderUnit[], roleUse: Parameters<typeof assignRoles>[2]) => {
      const groups = split(squad);
      assignRoles(groups, undefined, roleUse);
      return Object.fromEntries(groups.map(group => [group.type, group.role]));
    };
    const squad = (swordsmen: number, axemen: number, wounded = false) => [
      ...Array.from({ length: swordsmen }, (_, index) => unit(index + 1, 1, "shield")),
      ...Array.from({ length: axemen }, (_, index) => ({ ...unit(index + 20, 1, "heavy"), health: wounded ? .2 : 1 })),
      unit(40, 1, "archer")
    ];
    expect(rolesOf(squad(2, 2), "all")).toEqual({ archer: "overwatch", heavy: "front", shield: "flank" });
    expect(rolesOf(squad(3, 2), "all")).toEqual({ archer: "overwatch", heavy: "reserve", shield: "front" });
    expect(rolesOf(squad(3, 2), "flankPreferred")).toEqual({ archer: "overwatch", heavy: "front", shield: "flank" });
    expect(rolesOf(squad(4, 2), "flankPreferred")).toEqual({ archer: "overwatch", heavy: "reserve", shield: "front" });
    for (const [swordsmen, wounded] of [[2, false], [4, false], [2, true]] as const)
      expect(rolesOf(squad(swordsmen, 2, wounded), "frontAndOverwatch"))
        .toEqual({ archer: "overwatch", heavy: "front", shield: "front" });
    expect(rolesOf([unit(1, 1, "cavalry"), unit(2, 1, "archer")], "frontAndOverwatch"))
      .toEqual({ archer: "overwatch", cavalry: "front" });
  });

  it("raid ratio and uncertainty margin: an easy director needs more, a hard one less", () => {
    const inputs = (level: CommanderLevel, ratio: number): MacroInputs => ({
      attackRatio: 1, brokenShare: 0, contact: false, current: "hold", goal: false, kind: "permit", members: 5,
      moraleMean: 70, raidRatio: COMMANDER_PROFILES[level].raidRatio, scoutable: true, spread: 3, start: 500,
      strength: 500, target: { ratio, tier: 3 }, threat: false
    });
    const raids = (level: CommanderLevel, ratio: number) => scoreMacros(inputs(level, ratio)).raid > -Infinity;
    expect(LEVELS.map(level => raids(level, 1.3))).toEqual([false, true, true]);
    expect(LEVELS.map(level => raids(level, 1.1))).toEqual([false, false, true]);
    expect(LEVELS.map(level => raids(level, 1.5))).toEqual([true, true, true]);

    const remembered = [{ ...unit(9, 0, "shield", 10), remembered: true }];
    const ratios = LEVELS.map(level =>
      targetRatio(1, remembered, { x: 10, z: 0 }, 100, COMMANDER_PROFILES[level].uncertaintyMargin));
    // One remembered full-health swordsman (100 points): strength / (100 × (1 + margin)).
    expect(ratios[0]).toBeCloseTo(1 / 1.6, 12);
    expect(ratios[1]).toBeCloseTo(1 / 1.4, 12);
    expect(ratios[2]).toBeCloseTo(1 / 1.25, 12);
  });

  it("scout age: a sector seen 50 s ago is stale for hard only", () => {
    const now = secondsToTicks(100), seen = now - secondsToTicks(50);
    const goalsAt = (level: CommanderLevel) => planScoutTrip({
      centreOf: sector => ({ x: sector * 16 + 8, z: 8 }), isClear: () => true, lastSeen: () => seen,
      scoutAgeTicks: COMMANDER_PROFILES[level].scoutAgeTicks, sectorOf: point => Math.floor(point.x / 16),
      sectorsX: 4, sectorsZ: 1
    }, { x: 8, z: 8 }, [{ x: 56, z: 8 }], now).length;
    expect(LEVELS.map(goalsAt)).toEqual([0, 0, 3]);
  });

  it("reaction delay: the commander weighs an enemy only once known long enough; medium at once", () => {
    let now = 100;
    const since = new Map<number, number>([[10, 70], [11, 90]]);
    const knowledge = {
      knownSince: (_viewer: number, uid: number) => since.get(uid),
      knows: () => true,
      now: () => now,
      remembered: () => [
        { faction: 0, firstKnownTick: 50, health: 1, rank: 0, tick: 60, type: "archer", uid: 20, x: 5, z: 5 },
        { faction: 0, firstKnownTick: 95, health: 1, rank: 0, tick: 99, type: "archer", uid: 21, x: 6, z: 5 }
      ]
    } as unknown as FactionKnowledge;
    // 10: known 30 ticks; 11: known 10 ticks; 12: first known this tick (not in the memory yet).
    const units = [unit(1, 1, "shield"), unit(10, 0, "shield"), unit(11, 0, "shield"), unit(12, 0, "shield")];
    const uidsAt = (reactionTicks: number) =>
      createCommanderPerception(knowledge, () => reactionTicks)(1, units).map(seen => seen.uid);
    expect(uidsAt(0)).toEqual([1, 10, 11, 12, 20, 21]);
    expect(uidsAt(20)).toEqual([1, 10, 20]);
    expect(uidsAt(40)).toEqual([1, 20]);
    now = 120;
    expect(uidsAt(20)).toEqual([1, 10, 11, 20, 21]);
  });
});

describe("setCommanderLevel", () => {
  const perform = (levels: ReturnType<typeof createCommanderLevels> | undefined, faction: unknown, level: string) =>
    COMMANDER_ACTIONS.setCommanderLevel!({ context: { commanderLevels: levels } } as unknown as ScriptActionHost, {
      args: { faction, level: str(level) }, op: "setCommanderLevel",
      scope: { evaluate: (expr: { value: unknown }) => expr.value }
    } as unknown as ScriptActionRequest);

  it("sets a computer faction's level and refuses the player, player groups and unknown levels", () => {
    const levels = createCommanderLevels();
    expect(perform(levels, { faction: 2, kind: "slot" }, "hard")).toEqual({ kind: "done" });
    expect(levels.save()).toEqual([[2, "hard"]]);
    const refused = { kind: "failed", outcome: "refused" };
    expect(perform(levels, { faction: 0, kind: "slot" }, "hard")).toEqual(refused);
    expect(perform(levels, { kind: "computers" }, "hard")).toEqual(refused);
    expect(perform(levels, { faction: 2, kind: "slot" }, "brutal")).toEqual(refused);
    expect(perform(undefined, { faction: 2, kind: "slot" }, "hard")).toEqual(refused);
    expect(levels.save()).toEqual([[2, "hard"]]);
  });

  it("is a catalogue action with a faction and a level slot, worded and listed in the editor", () => {
    expect(ACTION_CATALOG.setCommanderLevel.args.map(slot => [slot.name, slot.type.kind, slot.optional])).toEqual([
      ["faction", "player", false], ["level", "choice", false]
    ]);
    const [, level] = ACTION_CATALOG.setCommanderLevel.args;
    expect(level!.type).toMatchObject({ values: ["easy", "medium", "hard"] });
    expect(Object.values(ACTION_GROUPS).flat().filter(op => op === "setCommanderLevel")).toHaveLength(1);
    expect(sentenceSlots(actionSentence("setCommanderLevel", "en")).sort()).toEqual(["faction", "level"]);
    expect(actionSentence("setCommanderLevel", "en")).toBe("set the commander level of {faction} to {level}");
    for (const name of ["faction", "level"]) expect(SLOT_LABELS).toHaveProperty(name);
    for (const value of LEVELS) expect(CHOICE_LABELS[value]?.[0]).toBe(value);
  });

  const LEVEL_SCRIPT = (level: string) => emptyScript({ triggers: [trigger("t-level", { actions: [
    doStep("s1", "setCommanderLevel", { faction: { faction: 1, kind: "slot" }, level: str(level) })
  ] })] });

  it("validates in a map script; an unknown level is an error", () => {
    const issues = (level: string) => validateMapScript(LEVEL_SCRIPT(level), { catalog: TEST_CATALOG,
      mapKind: "campaign" }).errors;
    expect(issues("hard")).toEqual([]);
    expect(issues("brutal")).toHaveLength(1);
  });

  const battle = (level?: string) => {
    const simulation = createBalanceSimulation(96, 43, { x: 10.5, z: 48.5 }, (world: WorldData) => {
      if (level) world.script = LEVEL_SCRIPT(level);
    });
    for (let index = 0; index < 6; index++) spawnAround(simulation, { x: 60, z: 48 }, "shield", 0, 1);
    for (let index = 0; index < 6; index++) spawnAround(simulation, { x: 50, z: 48 }, "shield", 0, 2);
    return simulation;
  };
  const advance = (simulation: ReturnType<typeof battle>, ticks: number) => {
    for (let tick = 0; tick < ticks; tick++) simulation.update(.05);
  };

  const bodies = (simulation: ReturnType<typeof battle>) => JSON.stringify(simulation.saveState().actors);

  it.each(["easy", "hard"] as const)(
    "%s runs from a map script, is saved, and a reload mid-battle continues to the same state", level => {
      const live = battle(level), reloaded = battle(level), plain = battle();
      for (const simulation of [live, plain]) advance(simulation, 400);
      advance(reloaded, 150);
      const saved = reloaded.saveState();
      expect(saved.military?.combat?.commanderLevels).toEqual([[1, level]]);
      expect(plain.saveState().military?.combat).not.toHaveProperty("commanderLevels");
      expect(reloaded.loadState(JSON.parse(JSON.stringify(saved)))).toEqual({ ok: true });
      advance(reloaded, 250);
      expect(stateHashOf(reloaded)).toBe(stateHashOf(live));
      // The faction decides at its level's cadence: not the default (medium) battle.
      expect(bodies(live)).not.toBe(bodies(plain));
    }, 120_000);

  it("a script level of medium fights the default battle", () => {
    const medium = battle("medium"), plain = battle();
    for (const simulation of [medium, plain]) advance(simulation, 400);
    expect(bodies(medium)).toBe(bodies(plain));
  }, 120_000);

  it("refuses a save with a broken level", () => {
    const simulation = battle("easy");
    advance(simulation, 20);
    const saved = JSON.parse(JSON.stringify(simulation.saveState()));
    saved.military.combat.commanderLevels = [[1, "brutal"]];
    expect(simulation.loadState(saved)).toMatchObject({ ok: false });
  }, 120_000);
});
