import { describe, expect, it } from "vitest";

import { recoverOfflineMilitary } from "../src/app/settlement/offline-military-recovery";
import {
  ARCHER_HEALTH_VERSION, LEGACY_ARCHER_HEALTH_SCALE, MILITARY_PROFILES
} from "../src/shared/balance/military";
import { militaryDamage, militaryHealth } from "../src/shared/settlement/military-combat-rules";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { promoteSettlementSoldier } from "../src/shared/settlement/settlement-military";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const SIZE = 48;
const fixture = () => {
  const world = { seed: 9, cellsX: SIZE, cellsZ: SIZE, seaLevel: -1, start: { x: 5.5, z: 5.5 },
    heights: new Float32Array((SIZE + 1) ** 2), blocking: new Uint8Array(SIZE ** 2),
    walkCost: new Uint8Array(SIZE ** 2).fill(10), buildClass: new Uint8Array(SIZE ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(SIZE ** 2), mineZone: new Uint16Array(SIZE ** 2), mineZones: [],
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(),
      scale: new Float32Array() }
  } as unknown as WorldData;
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world, roads, initialSettlers: 20,
    initialStock: { axe: 4, beer: 4, bow: 4, shield: 4, sword: 4, planks: 80, stone: 80 },
    canWorkerEnterPlot: () => true, withoutMilitaryCommander: true });
  return simulation;
};

const archerSoldier = (simulation: ReturnType<typeof createSettlementSimulation>) =>
  simulation.saveState().military!.soldiers.find(soldier => soldier.combat?.type === "archer")!;

describe("archer balance", () => {
  it("keeps the exact fractional base profile and rank scaling", () => {
    expect(MILITARY_PROFILES.archer).toMatchObject({
      armour: [.05, .1, .15], damage: 18.75, hp: 56.25, interval: 1.6, minimumRange: 2, range: 8, speed: 1.3
    });
    const health = [0, 1, 2].map(rank => militaryHealth("archer", rank));
    const damage = [0, 1, 2].map(rank => MILITARY_PROFILES.archer.damage * 1.2 ** rank);
    expect(health).toEqual([56.25, 67.5, 81]);
    expect(damage).toEqual([18.75, 22.5, 27]);
    // Unchanged neighbours show the reduction did not touch other profile fields.
    expect(MILITARY_PROFILES.archer.range).toBe(8);
    expect(MILITARY_PROFILES.archer.minimumRange).toBe(2);
    expect(MILITARY_PROFILES.archer.interval).toBe(1.6);
    expect(MILITARY_PROFILES.shield.hp).toBe(125);
  });

  it("uses 0.67 against shields, then the defender's rank armour", () => {
    const noCritical = () => .99;
    for (const rank of [0, 1, 2] as const) {
      const hit = militaryDamage("archer", rank, "shield", rank, true, noCritical);
      const expected = 18.75 * 1.2 ** rank * .67 * (1 - MILITARY_PROFILES.shield.armour[rank]!);
      expect(hit.damage).toBeCloseTo(expected, 10);
      expect(hit.bypass).toBe(false);
      expect(hit.critical).toBe(false);
    }
    const glancing = militaryDamage("archer", 0, "shield", 0, false, noCritical);
    expect(glancing.damage).toBeCloseTo(18.75 * .67 * (1 - .2) * .5, 10);
  });

  it("heavy attacks bypass armour below 0.33 and not at or above it, against every target", () => {
    const withRoll = (roll: number) => {
      let calls = 0;
      return () => calls++ === 0 ? roll : .99;
    };
    const below = militaryDamage("heavy", 0, "shield", 2, true, withRoll(.329999));
    expect(below.bypass).toBe(true);
    expect(below.damage).toBeCloseTo(18, 10);
    const at = militaryDamage("heavy", 0, "shield", 2, true, withRoll(.33));
    expect(at.bypass).toBe(false);
    expect(at.damage).toBeCloseTo(18 * (1 - .4), 10);
    for (const defender of ["shield", "heavy", "archer", "cavalry"] as const) {
      const bypass = militaryDamage("heavy", 0, defender, 2, true, withRoll(.1));
      const armoured = militaryDamage("heavy", 0, defender, 2, true, withRoll(.9));
      expect(bypass.bypass).toBe(true);
      expect(bypass.damage).toBeCloseTo(18, 10);
      expect(armoured.damage).toBeCloseTo(18 * (1 - MILITARY_PROFILES[defender].armour[2]!), 10);
    }
  });

  it("recruits and returns archers at the new maximum instead of the old 75", () => {
    const simulation = fixture();
    expect(simulation.recruitStoredMilitary(simulation.headquarters.uid, "archer")).not.toBeNull();
    expect(archerSoldier(simulation).combat!.hp).toBe(56.25);
    simulation.receiveTroops([{ hp: 75, rank: 0, type: "archer" }]);
    const received = simulation.militarySoldiers().filter(soldier => soldier.combat?.type === "archer");
    expect(received.some(soldier => soldier.combat!.hp === 56.25)).toBe(true);
  });

  it("promotes with the new rank cap and proportional health", () => {
    const simulation = fixture();
    simulation.recruitStoredMilitary(simulation.headquarters.uid, "archer");
    const soldier = (simulation.saveState().military!.soldiers.find(entry => entry.combat?.type === "archer"))!;
    soldier.combat!.hp = 28.125;
    soldier.recoverySeconds = 30;
    expect(promoteSettlementSoldier(soldier, 1)).toBe(true);
    expect(soldier.rank).toBe(1);
    expect(soldier.combat!.hp).toBeCloseTo(33.75, 10);
    expect(soldier.recoverySeconds).toBe(30);
    soldier.combat!.hp = 67.5;
    expect(promoteSettlementSoldier(soldier, 2)).toBe(true);
    expect(soldier.combat!.hp).toBe(81);
    expect(soldier.recoverySeconds).toBeUndefined();
  });

  it("migrates full and wounded old archer saves once, then reloads unchanged", () => {
    const simulation = fixture();
    simulation.receiveTroops([{ hp: 75, rank: 0, type: "archer" }]);
    const id = archerSoldier(simulation).actor;
    const legacy = simulation.saveState();
    delete legacy.military!.archerHealthVersion;
    legacy.military!.soldiers.find(soldier => soldier.actor === id)!.combat!.hp = 75;
    expect(simulation.loadState(legacy)).toEqual({ ok: true });
    const full = archerSoldier(simulation);
    expect(full.combat!.hp).toBe(56.25);
    expect(simulation.saveState().military!.archerHealthVersion).toBe(ARCHER_HEALTH_VERSION);
    const resaved = simulation.saveState();
    expect(simulation.loadState(resaved)).toEqual({ ok: true });
    expect(archerSoldier(simulation).combat!.hp).toBe(56.25);

    const wounded = simulation.saveState();
    delete wounded.military!.archerHealthVersion;
    const woundedSoldier = wounded.military!.soldiers.find(soldier => soldier.actor === id)!;
    woundedSoldier.combat!.hp = 60;
    expect(simulation.loadState(wounded)).toEqual({ ok: true });
    expect(archerSoldier(simulation).combat!.hp).toBeCloseTo(60 * LEGACY_ARCHER_HEALTH_SCALE, 10);
    const afterWounded = simulation.saveState();
    expect(simulation.loadState(afterWounded)).toEqual({ ok: true });
    expect(archerSoldier(simulation).combat!.hp).toBeCloseTo(45, 10);
  });

  it("preserves a wounded fraction through legacy rank and archer migration", () => {
    const simulation = fixture();
    simulation.receiveTroops([{ hp: 75, rank: 0, type: "archer" }]);
    const id = archerSoldier(simulation).actor;
    const legacy = simulation.saveState();
    delete legacy.military!.rankVersion;
    delete legacy.military!.archerHealthVersion;
    const soldier = legacy.military!.soldiers.find(entry => entry.actor === id)!;
    soldier.rank = 1;
    soldier.combat!.hp = 45; // half of the old 90 HP soldier rank
    expect(simulation.loadState(legacy)).toEqual({ ok: true });
    const migrated = archerSoldier(simulation);
    expect(migrated.rank).toBe(1);
    expect(migrated.combat!.hp).toBeCloseTo(67.5 * .5, 10);
  });

  it("migrates before fast-catch-up healing without double-scaling or overheal", () => {
    const simulation = fixture();
    simulation.receiveTroops([{ hp: 75, rank: 0, type: "archer" }]);
    const save = simulation.saveState();
    delete save.military!.archerHealthVersion;
    save.military!.soldiers.find(soldier => soldier.combat?.type === "archer")!.combat!.hp = 75;
    expect(recoverOfflineMilitary(save, 60)).toBe(0);
    expect(save.military!.soldiers.find(soldier => soldier.combat?.type === "archer")!.combat!.hp).toBe(56.25);
    expect(recoverOfflineMilitary(save, 60)).toBe(0);
    expect(save.military!.soldiers.find(soldier => soldier.combat?.type === "archer")!.combat!.hp).toBe(56.25);
  });
});
