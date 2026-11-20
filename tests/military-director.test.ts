import { describe, expect, it, vi } from "vitest";

import { DIRECTOR_INTERVAL_TICKS, MACRO_SCORES, RAID_RATIO } from "../src/shared/balance/commander-director";
import { dueFaction, firstDueTick, scheduleNext } from "../src/shared/settlement/commander/director-clock";
import { chooseMacro, type MacroInputs, scoreMacros } from "../src/shared/settlement/commander/director-macros";
import { directorSaveError } from "../src/shared/settlement/commander/director-save";
import {
  type DirectorTraceRecord, setDirectorTraceSink
} from "../src/shared/settlement/commander/director-trace";
import type { DirectorFaction } from "../src/shared/settlement/commander/director-types";
import { stateHashOf } from "../tools/bench/military-a14-metrics";
import { fogRaidFixture } from "../tools/bench/military-a14-scenarios";
import { struckColony } from "./helpers/struck-colony";

vi.mock("../src/shared/world/generation/generate-world", async (importOriginal) =>
  (await import("./helpers/world-cache-store")).cachedGenerateWorldModule(importOriginal));

/** A14-4a strategic director: macro table, cadence, save validation, colony permits and determinism. */
const inputs = (patch: Partial<MacroInputs> = {}): MacroInputs => ({
  attackRatio: 1, brokenShare: 0, contact: false, current: "hold", goal: false, kind: "permit", members: 8,
  moraleMean: 70, raidRatio: RAID_RATIO, scoutable: true, spread: 3, start: 800, strength: 800, threat: false,
  ...patch
});
const choose = (patch: Partial<MacroInputs> = {}) => {
  const value = inputs(patch);
  return chooseMacro(scoreMacros(value), value.current);
};

describe("director macros", () => {
  it("scouts without a known target and strikes once one is known", () => {
    expect(choose()).toBe("scout");
    expect(choose({ scoutable: false })).toBe("hold");
    expect(choose({ current: "scout", target: { ratio: 2, tier: 2 } })).toBe("strike");
    expect(choose({ target: { ratio: .5, tier: 2 } })).toBe("strike");
  });

  it("raids a weak tier-3+ target with a small party, never a strong one", () => {
    expect(choose({ members: 5, target: { ratio: 2, tier: 3 } })).toBe("raid");
    expect(choose({ members: 5, target: { ratio: 1, tier: 3 } })).toBe("strike");
    expect(choose({ members: 9, target: { ratio: 2, tier: 3 } })).toBe("strike");
  });

  it("withdraws, defends and regroups by the plan's preconditions; waves never withdraw or defend", () => {
    expect(choose({ current: "strike", strength: 200, target: { ratio: 2, tier: 2 } })).toBe("withdraw");
    expect(choose({ brokenShare: .6, current: "strike", target: { ratio: 2, tier: 2 } })).toBe("withdraw");
    expect(choose({ threat: true })).toBe("defend");
    expect(choose({ current: "strike", spread: 13, target: { ratio: 2, tier: 2 } })).toBe("regroup");
    expect(choose({ contact: true, current: "strike", spread: 13, target: { ratio: 2, tier: 2 } })).toBe("strike");
    const wave = { current: "strike" as const, goal: true, kind: "wave" as const, strength: 100, threat: true };
    expect(choose(wave)).toBe("strike");
  });

  it("keeps the current macro unless another beats it by the commitment", () => {
    const scores = { ...scoreMacros(inputs()), hold: MACRO_SCORES.scout - .1 };
    expect(chooseMacro(scores, "hold")).toBe("hold");
    expect(chooseMacro(scores, "hold", false)).toBe("scout");
  });
});

describe("director cadence", () => {
  it("puts four factions on four different slots and runs one decision per tick", () => {
    const due = [1, 2, 3, 4].map(faction => firstDueTick(faction, 0, DIRECTOR_INTERVAL_TICKS) % DIRECTOR_INTERVAL_TICKS);
    expect(new Set(due).size).toBe(4);
    const factions: DirectorFaction[] = [1, 9].map(faction => ({ faction, forces: [], next: 50, nextForce: 1 }));
    const first = dueFaction(factions, 50)!;
    expect(first.faction).toBe(1);
    scheduleNext(first, 50, DIRECTOR_INTERVAL_TICKS);
    expect(dueFaction(factions, 50)?.faction).toBe(9);
    expect(first.next).toBe(50 + DIRECTOR_INTERVAL_TICKS);
  });
});

describe("director save validation", () => {
  const force = { home: { x: 1, z: 1 }, id: 1, kind: "permit", macro: "scout", members: [5, 7], since: 3,
    staging: { x: 2, z: 2 }, start: 700, task: 1, scout: 5, visited: 0 };
  const save = (patch: object = {}, factionPatch: object = {}) =>
    ({ factions: [{ faction: 1, forces: [{ ...force, ...patch }], next: 10, nextForce: 2, ...factionPatch }] });
  const soldiers = new Set([5, 7]);
  it("accepts a valid save and rejects broken ones", () => {
    expect(directorSaveError(undefined, soldiers)).toBeNull();
    expect(directorSaveError(save(), soldiers)).toBeNull();
    expect(directorSaveError(save({ macro: "charge" }), soldiers)).not.toBeNull();
    expect(directorSaveError(save({ members: [7, 5] }), soldiers)).not.toBeNull();
    expect(directorSaveError(save({ members: [5, 8] }), soldiers)).not.toBeNull();
    expect(directorSaveError(save({ scout: 9 }), soldiers)).not.toBeNull();
    expect(directorSaveError(save({}, { nextForce: 1 }), soldiers)).not.toBeNull();
  });
});

const traced = <T>(run: () => T) => {
  const records: DirectorTraceRecord[] = [];
  setDirectorTraceSink(record => { records.push({ ...record }); });
  try {
    return { records, result: run() };
  } finally {
    setDirectorTraceSink(null);
  }
};

const advance = (simulation: { update: (dt: number) => void }, ticks: number) => {
  for (let tick = 0; tick < ticks; tick++) simulation.update(.05);
};

describe("director in the fog raid fixture", () => {
  it("scouts first, strikes only once a site is known, and reloads mid-run to the same state", () => {
    const live = fogRaidFixture(60);
    const { records } = traced(() => { live.start(); advance(live.simulation, 1200); });
    expect(records[0]?.macro).toBe("scout");
    const strikes = records.filter(record => record.macro === "strike" || record.macro === "raid");
    expect(strikes.length).toBeGreaterThan(0);
    expect(strikes.every(record => record.knownTargets > 0)).toBe(true);

    const reloaded = fogRaidFixture(60);
    reloaded.start();
    advance(reloaded.simulation, 500);
    const saved = reloaded.simulation.saveState();
    expect(saved.military?.combat?.director?.factions.length).toBe(1);
    expect(reloaded.simulation.loadState(JSON.parse(JSON.stringify(saved)))).toEqual({ ok: true });
    advance(reloaded.simulation, 700);
    expect(stateHashOf(reloaded.simulation)).toBe(stateHashOf(live.simulation));
  }, 120_000);
});

describe("director with colony counterattack permits", () => {
  it("turns the first land permit into a director force that scouts while no player site is known", () => {
    const simulation = struckColony("medium");
    const { records } = traced(() => advance(simulation, 20 * 70));
    const colonyForces = records.filter(record => record.kind === "colony");
    expect(colonyForces.length).toBeGreaterThan(0);
    const first = colonyForces[0]!;
    expect(first.macro).toBe(first.knownTargets ? "strike" : "scout");
    expect(colonyForces.filter(record => record.macro === "strike").every(record => record.knownTargets > 0))
      .toBe(true);
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
  }, 120_000);
});
