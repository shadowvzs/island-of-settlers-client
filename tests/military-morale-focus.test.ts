import { describe, expect, it } from "vitest";

import {
  COMMANDER_PROFILES, DANGER_MATRIX, FOCUS_BONUS, HERO_DANGER, PLAYER_DANGER_WEIGHT
} from "../src/shared/balance/commander-profiles";
import { DECISION_INTERVAL } from "../src/shared/balance/military";
import {
  MORALE_BROKEN, MORALE_CALM_TICKS, MORALE_CORNERED_RANGE, MORALE_SHAKEN, MORALE_SHAKEN_LEASH, MORALE_STEADY,
  MORALE_WAVERING
} from "../src/shared/balance/morale";
import {
  createTargetingWeights, dangerOf, focusValue
} from "../src/shared/settlement/commander/commander-focus";
import type { CommanderUnit } from "../src/shared/settlement/commander/commander-types";
import { awayPoint } from "../src/shared/settlement/commander/military-morale-effects";
import {
  baseMorale, type MoraleInputs, nextMoraleState, stepMorale, targetMorale
} from "../src/shared/settlement/commander/military-morale";
import { militaryMoraleSaveError } from "../src/shared/settlement/commander/military-morale-update";
import { militaryAiSaveError } from "../src/shared/settlement/military-ai-save-validation";
import { createMilitaryCommander, MAX_SQUADS_PER_DECISION } from "../src/shared/settlement/military-commander";
import {
  isOverClaimed, moraleAcquireRadius, moraleLeash, type TargetCandidate, targetScore
} from "../src/shared/settlement/military-targeting";
import { freshFieldMemory } from "../src/shared/settlement/settlement-combat-core";

/** A14-2 focus fire, danger matrix and morale (plan §3.3, §4, §8): pure rules, quotas and saves. */

const calm: MoraleInputs = {
  aura: false, deaths: 0, fort: false, healthPercent: 100, ratioPercent: 0, rank: 0, routedNeighbours: 0, sectors: 0
};

describe("target morale", () => {
  it.each([
    ["a fresh soldier", {}, 70],
    ["rank 2", { rank: 2 }, 80],
    ["in a friendly aura near a fort", { aura: true, fort: true }, 90],
    ["after two falls nearby", { deaths: 2 }, 54],
    ["after many falls (capped) and a routed neighbour", { deaths: 5, routedNeighbours: 1 }, 46],
    ["half encircled", { sectors: 4 }, 60],
    ["mostly encircled", { sectors: 6 }, 50],
    ["outnumbered two to one", { ratioPercent: 200 }, 55],
    ["outnumbered three to one", { ratioPercent: 300 }, 45],
    ["badly wounded", { healthPercent: 29 }, 60],
    ["everything at once (clamped)", { deaths: 9, healthPercent: 1, ratioPercent: 900, sectors: 8 }, 0]
  ] as const)("%s", (_name, inputs, expected) => {
    expect(targetMorale({ ...calm, ...inputs })).toBe(expected);
  });

  it("falls fast and recovers slowly towards the target", () => {
    expect(stepMorale(70, 30)).toBe(62);
    expect(stepMorale(34, 30)).toBe(30);
    expect(stepMorale(30, 70)).toBe(32);
    expect(baseMorale(10)).toBe(100);
  });

  it("enters states at once and leaves them with hysteresis; wavering and broken rally only when calm", () => {
    expect(nextMoraleState(MORALE_STEADY, 49, 0)).toBe(MORALE_SHAKEN);
    expect(nextMoraleState(MORALE_STEADY, 14, 0)).toBe(MORALE_BROKEN);
    expect(nextMoraleState(MORALE_SHAKEN, 59, 0)).toBe(MORALE_SHAKEN);
    expect(nextMoraleState(MORALE_SHAKEN, 60, 0)).toBe(MORALE_STEADY);
    expect(nextMoraleState(MORALE_WAVERING, 45, 0)).toBe(MORALE_WAVERING);
    expect(nextMoraleState(MORALE_WAVERING, 45, MORALE_CALM_TICKS)).toBe(MORALE_SHAKEN);
    expect(nextMoraleState(MORALE_BROKEN, 25, MORALE_CALM_TICKS - 1)).toBe(MORALE_BROKEN);
    expect(nextMoraleState(MORALE_BROKEN, 25, MORALE_CALM_TICKS)).toBe(MORALE_WAVERING);
  });

  it("caps a hesitating soldier's reach and lets a broken one fight only when cornered", () => {
    expect(moraleAcquireRadius(24, "seek", "shield", undefined)).toBe(24);
    expect(moraleAcquireRadius(24, "seek", "shield", MORALE_SHAKEN)).toBe(7);
    expect(moraleAcquireRadius(6, "march", "shield", MORALE_SHAKEN)).toBe(6);
    expect(moraleAcquireRadius(10, "camp", "archer", MORALE_BROKEN)).toBe(MORALE_CORNERED_RANGE);
    expect(moraleLeash(Infinity, MORALE_SHAKEN)).toBe(MORALE_SHAKEN_LEASH);
    expect(moraleLeash(10, undefined)).toBe(10);
  });
});

describe("focus and danger", () => {
  const candidate = (overrides: Partial<TargetCandidate>): TargetCandidate => ({
    attackedMe: false, claims: 0, distance: 4, health: 1, inReach: false, mounted: false, ...overrides
  });

  it("weighs the danger matrix without cavalry: swordsmen hunt archers, archers shoot axemen", () => {
    expect(dangerOf("shield", "archer")).toBe(DANGER_MATRIX.shield.archer);
    expect(dangerOf("archer", "heavy")).toBeGreaterThan(dangerOf("archer", "shield"));
    expect(dangerOf("heavy", "shield", true)).toBe(DANGER_MATRIX.heavy.shield + HERO_DANGER);
    expect(focusValue("shield", { health: 0.5, rank: 0, type: "archer" }))
      .toBeGreaterThan(focusValue("shield", { health: 1, rank: 0, type: "archer" }));
  });

  it("gives the player a small danger weight and no focus; a computer faction its level's weights", () => {
    const weightsOf = createTargetingWeights(() => COMMANDER_PROFILES.hard);
    expect(weightsOf(0)).toEqual({ danger: PLAYER_DANGER_WEIGHT, focus: 0 });
    expect(weightsOf(1)).toEqual({ danger: 1.25, focus: FOCUS_BONUS * 1.25 });
  });

  it("prefers a focused, dangerous foe, but never over the melee claim cap (3 foot / 2 riders)", () => {
    const plain = targetScore(candidate({ distance: 3 }), false);
    expect(targetScore(candidate({ danger: 2, distance: 5, focusBonus: 2 }), false)).toBeLessThan(plain);
    for (const [claims, mounted] of [[3, false], [2, true]] as const) {
      const claimed = candidate({ claims, danger: 2, distance: 3, focusBonus: 2, mounted });
      expect(targetScore(claimed, false)).toBeGreaterThan(plain);
    }
    expect([isOverClaimed(2, false), isOverClaimed(3, false), isOverClaimed(2, true)]).toEqual([false, true, true]);
    // Archers have no claim cap: their focus is the real focus fire.
    expect(targetScore(candidate({ claims: 5, distance: 3, focusBonus: 2 }), true)).toBeLessThan(
      targetScore(candidate({ distance: 3 }), true));
  });
});

describe("morale saves and helpers", () => {
  it("validates the recent falls block", () => {
    expect(militaryMoraleSaveError(undefined)).toBeNull();
    expect(militaryMoraleSaveError({ deaths: [[1, 10.5, 20, 300]] })).toBeNull();
    expect(militaryMoraleSaveError({ deaths: [[1, 10.5, 20]] })).not.toBeNull();
    expect(militaryMoraleSaveError({ deaths: "x" })).not.toBeNull();
  });

  it("carries morale and the player's order tick over a new order, nothing else", () => {
    expect(freshFieldMemory({ seekTime: 0.5, struck: true })).toBeUndefined();
    expect(freshFieldMemory({ calm: 16, focus: 4, morale: 40, moraleState: MORALE_SHAKEN, orderedTick: 9,
      seekTime: 0.5, struck: true }))
      .toEqual({ calm: 16, morale: 40, moraleState: MORALE_SHAKEN, orderedTick: 9, seekTime: 0, struck: false });
  });

  it("finds a clear way back away from the enemy, turning when straight back is blocked", () => {
    const straight = awayPoint({ x: 10, z: 10 }, { x: 14, z: 10 }, 6, () => true)!;
    expect(straight.x).toBeCloseTo(4);
    expect(straight.z).toBeCloseTo(10);
    const turned = awayPoint({ x: 10, z: 10 }, { x: 14, z: 10 }, 6, point => Math.abs(point.z - 10) > 0.01);
    expect(turned!.x).toBeLessThan(10);
    expect(awayPoint({ x: 10, z: 10 }, { x: 10, z: 10 }, 6, () => true)).toBeUndefined();
  });
});

describe("squad quota", () => {
  const lone = (uid: number): CommanderUnit => {
    const x = 6 + (uid % 5) * 14, z = 6 + Math.floor(uid / 5) * 14;
    return { busy: false, faction: 1, fighting: false, health: 1, home: { x, z }, marching: false, rank: 0,
      type: "shield", uid, x, z };
  };

  it("decides at most 16 squads per decision and the rest at the next one (cursor saved)", () => {
    const units = Array.from({ length: 20 }, (_, uid) => lone(uid));
    const commander = createMilitaryCommander({ cellsX: 96, cellsZ: 96, command: () => true, isClear: () => true,
      profile: () => COMMANDER_PROFILES.medium, units: () => units });
    const decided = () => commander.debug().decisions.map(decision => decision.squad);
    commander.update(DECISION_INTERVAL);
    expect(decided()).toEqual(Array.from({ length: MAX_SQUADS_PER_DECISION }, (_, uid) => uid));
    const saved = commander.save();
    expect(saved.cursors).toEqual([[1, MAX_SQUADS_PER_DECISION - 1]]);
    expect(saved.memories[0]![1]).toHaveLength(MAX_SQUADS_PER_DECISION);
    expect(militaryAiSaveError(undefined, JSON.parse(JSON.stringify(saved)), new Set(units.map(unit => unit.uid))))
      .toBeNull();
    commander.update(DECISION_INTERVAL);
    expect(decided()).toEqual([16, 17, 18, 19, ...Array.from({ length: 12 }, (_, uid) => uid)]);
    expect(commander.save().memories[0]![1]).toHaveLength(20);
  });
});
