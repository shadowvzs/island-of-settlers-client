import { describe, expect, it } from "vitest";

import {
  COMMANDER_PROFILES, MAX_DECISION_INTERVAL, VERY_HARD_COMMANDER_PROFILE
} from "../src/shared/balance/commander-profiles";
import { createCommanderClocks } from "../src/shared/settlement/commander/commander-clock";
import {
  type LegacyMilitaryAiMode, SHIPPED_MILITARY_AI_MODE
} from "../src/shared/settlement/military-ai-mode";
import { militaryAiSaveError } from "../src/shared/settlement/military-ai-save-validation";
import { createCommanderObjectives } from "../src/shared/settlement/military-commander-objectives";
import { REPLAY_COMMANDS } from "../src/shared/settlement/settlement-commands";
import { createBalanceSimulation, spawnAround } from "../tools/bench/garrison-balance-harness";

const LEGACY_MODES: readonly LegacyMilitaryAiMode[] = [
  "current",
  "flowFields",
  "formations",
  "smartCommander"
];

const fixture = () => {
  const simulation = createBalanceSimulation(64, 419);
  const ids = Array.from({ length: 12 }, (_, index) =>
    spawnAround(simulation, { x: 16 + (index % 3), z: 16 + Math.floor(index / 3) }, "shield", 0, 1)
  );
  return { simulation, ids };
};

describe("restored military controller persistence and queued work", () => {
  it("persists the shipped flowCommander mode and keeps one queued route per update", () => {
    const { ids, simulation } = fixture();
    expect(simulation.setMilitaryAiMode(SHIPPED_MILITARY_AI_MODE)).toBe(true);
    expect(simulation.commandMilitaryOpponent(ids, { x: 46, z: 42 }, 1, "move")).toBe(true);
    const pending = simulation.saveState().military!.combat!.pendingMarches!;
    expect(pending).toHaveLength(12);
    simulation.update(0.05);
    expect(simulation.saveState().military!.combat!.pendingMarches).toHaveLength(11);
    const saved = JSON.parse(JSON.stringify(simulation.saveState()));
    const before = structuredClone(saved.military.combat);
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    expect(simulation.militaryAiMode()).toBe("flowCommander");
    const restored = JSON.parse(JSON.stringify(simulation.saveState().military!.combat));
    expect(restored.movement).toEqual(before.movement);
    expect(restored.commander).toEqual(before.commander);
    simulation.update(0.05);
    expect(simulation.saveState().military!.combat!.pendingMarches).toHaveLength(10);
    const debug = simulation.militaryAiDebug();
    expect(debug.commander).toBeDefined();
  });

  it("rejects removed modes and journals the shipped mode command", () => {
    const { simulation } = fixture();
    expect(simulation.militaryAiMode()).toBe(SHIPPED_MILITARY_AI_MODE);
    for (const removed of [...LEGACY_MODES, "missing"] as const)
      expect(simulation.setMilitaryAiMode(removed as never)).toBe(false);
    expect(simulation.militaryAiMode()).toBe(SHIPPED_MILITARY_AI_MODE);
    expect(simulation.setMilitaryAiMode(SHIPPED_MILITARY_AI_MODE)).toBe(true);
    expect(REPLAY_COMMANDS).toContain("setMilitaryAiMode");
  });

  it("loads legacy mode ids and formation-era movement state as the shipped mode", () => {
    const { ids, simulation } = fixture();
    simulation.commandMilitaryOpponent(ids, { x: 46, z: 42 }, 1, "move");
    simulation.update(0.05);
    const saved = JSON.parse(JSON.stringify(simulation.saveState()));
    const group = saved.military.combat.movement.groups[0];
    expect(group).toBeDefined();
    // Frames from the removed formation modes still carry these fields. They are ignored, and a
    // "slot" owner is re-planned by the flow field on the next tick.
    group.formation = { legacy: true };
    group.offsets = [{ across: 1, along: 2 }];
    group.slotGoals = [{ x: 1, z: 2 }];
    group.together = true;
    saved.military.combat.movement.slotRetry = [[ids[0], 3]];
    saved.military.combat.movement.owners[0][1] = "slot";
    for (const legacy of LEGACY_MODES) {
      const old = structuredClone(saved);
      old.military.combat.aiMode = legacy;
      expect(simulation.loadState(old)).toEqual({ ok: true });
      expect(simulation.militaryAiMode()).toBe(SHIPPED_MILITARY_AI_MODE);
      expect(simulation.saveState().military!.combat!.aiMode).toBe(SHIPPED_MILITARY_AI_MODE);
      simulation.update(0.05);
    }
    const legacyMissing = structuredClone(saved);
    delete legacyMissing.military.combat.aiMode;
    delete legacyMissing.military.combat.movement;
    delete legacyMissing.military.combat.commander;
    expect(simulation.loadState(legacyMissing)).toEqual({ ok: true });
    expect(simulation.militaryAiMode()).toBe(SHIPPED_MILITARY_AI_MODE);
  });

  it("rejects corrupt movement snapshots atomically", () => {
    const { ids, simulation } = fixture();
    simulation.commandMilitaryOpponent(ids, { x: 46, z: 42 }, 1, "move");
    const saved = simulation.saveState(),
      invalid = structuredClone(saved);
    invalid.military!.combat!.movement!.groups[0]!.members = [];
    expect(simulation.loadState(invalid).ok).toBe(false);
    expect(simulation.saveState()).toEqual(saved);
  });

  it("accepts the decision clock of every commander level and rejects one beyond them", () => {
    const commanderSave = (clocks: [number, number][]) => ({
      clocks, memories: [], objectives: { led: [], objectives: [] }, retreating: []
    });
    // Regression (A14-5): an easy faction's clock runs up to its 2 s interval, past the old fixed 1.5 s bound.
    const profiles = [...Object.values(COMMANDER_PROFILES), VERY_HARD_COMMANDER_PROFILE];
    for (const profile of profiles) {
      const clocks = createCommanderClocks({ profile: () => profile, units: () => [] });
      // Faction 1 starts a quarter interval in; stop one 50 ms tick before its decision.
      const ticks = Math.round((profile.decisionInterval * 0.75) / 0.05) - 1;
      for (let tick = 0; tick < ticks; tick++) clocks.advance([1], 0.05);
      const saved = clocks.save(), clock = saved[0]![1];
      expect(clock).toBeGreaterThan(profile.decisionInterval - 0.1);
      expect(clock).toBeLessThan(profile.decisionInterval);
      expect(militaryAiSaveError(undefined, commanderSave(saved), new Set())).toBeNull();
    }
    expect(MAX_DECISION_INTERVAL).toBe(COMMANDER_PROFILES.easy.decisionInterval);
    const tooLate = commanderSave([[1, MAX_DECISION_INTERVAL + 0.01]]);
    expect(militaryAiSaveError(undefined, tooLate, new Set())).toBe("Invalid military commander memory");
    expect(militaryAiSaveError(undefined, commanderSave([[1, -0.1]]), new Set())).not.toBeNull();
  });

  it("retains a diverted scripted objective across JSON snapshots", () => {
    const original = createCommanderObjectives();
    const unit = {
      uid: 12,
      x: 4,
      z: 4,
      marching: true,
      order: "attackMove" as const,
      destination: { x: 40, z: 40 }
    };
    original.observe(unit);
    original.lead([12], false);
    const restored = createCommanderObjectives();
    restored.restore(JSON.parse(JSON.stringify(original.save())));
    expect(restored.of([unit])).toEqual(original.of([unit]));
    expect(restored.isOwnRetreat({ ...unit, order: "retreat" })).toBe(false);
  });
});

// Compare the bucket implementation against the original exact connected-component semantics.
import { type CommanderUnit, formSquads } from "../src/shared/settlement/military-commander";
const commanderUnit = (uid: number, x: number, z: number): CommanderUnit => ({
  uid,
  x,
  z,
  faction: 1,
  type: "shield",
  rank: 0,
  health: 1,
  home: { x, z },
  busy: false,
  fighting: false,
  marching: false
});
it("spatial squad assembly retains every unit and the uid-ordered transitive chain", () => {
  const units = [
    commanderUnit(4, 17, 0),
    commanderUnit(1, 0, 0),
    commanderUnit(5, 50, 50),
    commanderUnit(3, 11, 0),
    commanderUnit(2, 5, 0)
  ];
  expect(formSquads(units).map((squad) => squad.map((unit) => unit.uid))).toEqual([
    [1, 2, 3, 4],
    [5]
  ]);
  const dense = Array.from({ length: 1000 }, (_, uid) =>
    commanderUnit(uid, (uid % 20) * 0.1, Math.floor(uid / 20) * 0.1)
  );
  const squads = formSquads(dense);
  expect(squads).toHaveLength(1);
  expect(new Set(squads.flat().map((unit) => unit.uid)).size).toBe(1000);
  expect(dense[0]?.uid).toBe(0);
});
