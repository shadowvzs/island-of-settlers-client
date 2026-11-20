import { LEVEL_THRESHOLDS } from "@shared/catalog/balance";
import { describe, expect, it } from "vitest";

import { effectiveRules } from "../../island-of-settlers-shared/src/game-settings/effective-rules";
import { LEGACY_SIM_RULES, type SimRules } from "../../island-of-settlers-shared/src/game-settings/sim-rules";
import { createPlayerSession } from "../src/app/settlement/player-session";
import { createPlayerProgress, type LevelUp } from "../src/shared/progression/player-progress";
import {
  FULL_PROGRESSION, progressionVisibility, TALENTS_OFF
} from "../src/shared/progression/progression-rules";
import { addToHome } from "../src/shared/settlement/colony-economy";
import type { SettlementSimulation } from "../src/shared/settlement/settlement-simulation";

/** PROG (plan §9): the player session and the progression UI under the rules of the island on screen. */

const NOW = () => Date.UTC(2026, 9, 12, 9);
const rulesWith = (change: Partial<SimRules>, role: "home" | "campaign" = "home") =>
  effectiveRules({ ...LEGACY_SIM_RULES, ...change }, undefined, role);

const islandWith = (rules: ReturnType<typeof rulesWith>, sent: unknown[] = []) => {
  const hq = { construction: 1, inventory: {} as Record<string, number>, typeId: 0 };
  return {
    buildings: () => [hq],
    effectiveGameRules: () => rules,
    home: () => hq,
    islandRole: () => "home",
    militarySoldiers: () => [],
    playerNation: () => "roman",
    receiveHomeGoods: (goods: Record<string, number>) => addToHome([hq], goods),
    resourceTotal: () => 0,
    setTalentRanks: (ranks: unknown) => { sent.push(ranks); return true; }
  } as unknown as SettlementSimulation;
};

const completeBuildings = (session: ReturnType<typeof createPlayerSession>, count = 10) => {
  for (let building = 0; building < count; building++) session.buildingCompleted({ typeId: 37 } as never);
};

describe("experience rules in the player session", () => {
  it("grants no experience, level-up or level claim while experience is off", () => {
    const levelUps: LevelUp[] = [], claimed: number[] = [];
    const economy = { claimLevel: (level: number) => claimed.push(level), onGems: () => () => undefined,
      startGems: 7 } as never;
    const session = createPlayerSession({ economy, now: NOW, onLevelUp: ups => levelUps.push(...ups), seed: 3 });
    session.bind(islandWith(rulesWith({ experience: false })));
    completeBuildings(session);
    session.grantRewardExperience(5000);
    session.claimServerLevel();
    expect(session.progress()).toMatchObject({ experience: 0, gems: 7 });
    expect(session.level()).toBe(1);
    expect(levelUps).toEqual([]);
    expect(claimed).toEqual([]);
    expect(session.colonyConquered("easy")).toBe(0);
  });

  it("still earns experience under a fixed level but announces no level-up", () => {
    const levelUps: LevelUp[] = [];
    const session = createPlayerSession({ now: NOW, onLevelUp: ups => levelUps.push(...ups), seed: 3 });
    session.bind(islandWith(rulesWith({ level: { kind: "fixed", level: 20 } })));
    completeBuildings(session);
    expect(session.accountLevel()).toBe(3);
    expect(session.level()).toBe(20);
    expect(levelUps).toEqual([]);
  });
});

describe("talent rules in the player session", () => {
  const initial = { ...createPlayerProgress(3), experience: LEVEL_THRESHOLDS[9]!, gems: 150,
    talents: { productionSpeed: 2 } };

  it("sends no ranks, refuses the commands and counts no modifiers while talents are off", () => {
    const sent: unknown[] = [];
    const session = createPlayerSession({ initial, now: NOW, seed: 3 });
    session.bind(islandWith(rulesWith({ talents: false }), sent));
    expect(sent).toEqual([]);
    expect(session.applyTalents({ productionSpeed: 3 })).toBe(TALENTS_OFF);
    expect(session.resetTalents()).toBe(TALENTS_OFF);
    expect(session.talentModifiers().productionSpeed).toBe(0);
    expect(session.progress()).toMatchObject({ gems: 150, talents: { productionSpeed: 2 } });
  });

  it("checks new talent points at the level the island plays with", () => {
    const session = createPlayerSession({ initial, now: NOW, seed: 3 });
    session.bind(islandWith(rulesWith({ level: { kind: "fixed", level: 1 } })));
    expect(session.applyTalents({ productionSpeed: 3 })).not.toBe(true);
    session.bind(islandWith(rulesWith({})));
    expect(session.applyTalents({ productionSpeed: 3 })).toBe(true);
  });
});

describe("progression UI visibility (plan §9.4)", () => {
  it("shows everything without rules and under today's rules", () => {
    expect(progressionVisibility(undefined)).toBe(FULL_PROGRESSION);
    expect(progressionVisibility(rulesWith({}), "earned")).toEqual(FULL_PROGRESSION);
  });

  it("hides the experience bar when experience is off", () => {
    expect(progressionVisibility(rulesWith({ experience: false }), "earned")).toMatchObject(
      { experienceShown: false, levelLocked: false, levelShown: true, talentsShown: true });
  });

  it("hides level and experience when the game settings fix the level", () => {
    const rules = rulesWith({ experience: false, level: { kind: "fixed", level: 50 }, talents: false });
    expect(progressionVisibility(rules, "fixed")).toMatchObject(
      { experienceShown: false, levelLocked: false, levelShown: false, talentsShown: false });
  });

  it("shows a locked level without an experience bar when only the map fixes or caps it", () => {
    const fixedByMap = effectiveRules(LEGACY_SIM_RULES, { level: { kind: "fixed", level: 12 } } as never, "campaign");
    expect(progressionVisibility(fixedByMap, "earned")).toMatchObject(
      { experienceShown: false, levelLocked: true, levelShown: true, talentsShown: true });
    const capped = effectiveRules(LEGACY_SIM_RULES, { level: { kind: "fixed", level: 12 } } as never, "adventure");
    expect(progressionVisibility(capped, "earned").levelLocked).toBe(true);
  });

  it("hides only the talent entry when talents are off", () => {
    expect(progressionVisibility(rulesWith({ talents: false }), "earned")).toEqual(
      { ...FULL_PROGRESSION, talentsShown: false });
  });
});
