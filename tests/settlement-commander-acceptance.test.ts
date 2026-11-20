import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createCommandLogRecorder } from "../src/shared/settlement/command-log";
import { replayCommandLog } from "../src/shared/settlement/command-log-replay";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { COMMANDER_DEFINITIONS, commanderDamageFactor, commanderLevelForXp, commanderMaximumHealth } from "../src/shared/settlement/settlement-commander";
import { createCommanderSystem } from "../src/shared/settlement/settlement-commander-state";
import type { SettlementSoldier } from "../src/shared/settlement/settlement-military";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import { huntingWorld } from "./helpers/hunting-world";

/** Acceptance-only checks for thresholds/rank scale; production rules are untouched. */
const lodgeFixture = () => {
  const world = huntingWorld();
  const roads = createRoadNetwork(world);
  const simulation = createSettlementSimulation({
    developmentAllowed: true, initialSettlers: 20, playerLevel: () => 23, roads, world,
    initialStock: { beer: 40, coins: 40, wine: 40, planks: 40, shield: 6, stone: 40, sword: 6 }
  });
  const [width, depth] = getBuildingDefinition(62).gridFootprint;
  const placed = simulation.placeBuilding(62, 26 + width / 2, 22 + depth / 2);
  if (!placed.ok || !placed.building) throw new Error(placed.reason);
  Object.assign(placed.building, { construction: 1, foundationProgress: 1, required: {} });
  roads.addRoad(simulation.headquarters.access, placed.building.access);
  return { lodge: placed.building, simulation };
};

const deployedWithXp = (xp: number) => {
  const { lodge, simulation } = lodgeFixture();
  expect(simulation.recruitCommander(lodge.uid).ok).toBe(true);
  const save = simulation.saveState();
  save.military!.commander = { ...save.military!.commander!, location: "field", level: commanderLevelForXp(xp), xp };
  save.military!.soldiers = save.military!.soldiers.map(soldier => soldier.commanderId
    ? { ...soldier, building: -3 } : soldier);
  save.actors = save.actors.map(actor => actor.uid === save.military!.soldiers.find(soldier =>
    soldier.commanderId)!.actor ? { ...actor, phase: "militaryField", visible: true } : actor);
  expect(simulation.loadState(save)).toEqual({ ok: true });
  return simulation;
};

describe("commander acceptance thresholds", () => {
  it("journals paid recruitment and return refusals so production server replay reproduces them", () => {
    const { lodge, simulation } = lodgeFixture();
    const base = simulation.saveState();
    const recorder = createCommandLogRecorder(simulation, { sourceVersion: "commander-test" });
    recorder.open();
    expect(simulation.recruitCommander(lodge.uid).ok).toBe(true);
    for (let tick = 0; tick < 40; tick++) simulation.update(.05);
    expect(simulation.recruitCommander(lodge.uid).ok).toBe(false);
    expect(simulation.returnCommander().ok).toBe(false);
    const interval = recorder.close("home")!;
    expect(interval.entries.map(entry => entry.command.name))
      .toEqual(["recruitCommander", "recruitCommander", "returnCommander"]);
    const replay = lodgeFixture().simulation;
    expect(replay.loadState(base).ok).toBe(true);
    expect(replayCommandLog(replay, interval)).toEqual({ ok: true, endChecksum: interval.endChecksum });
    expect(replay.commanderState()).toEqual(simulation.commanderState());
    recorder.dispose();
  });

  it("journals development commander level-ups and refuses them in production verification", () => {
    const { lodge, simulation } = lodgeFixture();
    expect(simulation.recruitCommander(lodge.uid).ok).toBe(true);
    const base = simulation.saveState();
    const recorder = createCommandLogRecorder(simulation, { sourceVersion: "commander-test" });
    recorder.open();
    expect(simulation.levelUpCommander(lodge.uid).ok).toBe(true);
    const interval = recorder.close("home")!;
    expect(interval.entries.map(entry => entry.command.name)).toEqual(["levelUpCommander"]);
    const replay = lodgeFixture().simulation;
    expect(replay.loadState(base).ok).toBe(true);
    expect(replayCommandLog(replay, interval)).toMatchObject({ ok: false,
      mismatch: { kind: "invalid", reason: "Rejected command levelUpCommander" } });
    expect(replay.commanderState()!.level).toBe(1);
    recorder.dispose();
  });

  it("crosses 30 XP to level 2 and 100 XP to level 3 with compounding HP, rank 0", () => {
    const at29 = deployedWithXp(29);
    expect(at29.awardCommanderExperience("acceptance-threshold-29")).toBe(true);
    const level2 = at29.commanderSnapshot()!;
    expect(level2).toMatchObject({ level: 2, xp: 30, nextThreshold: 100 });
    expect(level2.maximumHp).toBeCloseTo(commanderMaximumHealth(2), 8);
    expect(at29.militarySoldiers().find(soldier => soldier.commanderId)!.rank).toBe(0);

    const at99 = deployedWithXp(99);
    expect(at99.awardCommanderExperience("acceptance-threshold-99")).toBe(true);
    const level3 = at99.commanderSnapshot()!;
    expect(level3).toMatchObject({ level: 3, xp: 100, nextThreshold: null });
    expect(level3.maximumHp).toBeCloseTo(commanderMaximumHealth(3), 8);
    expect(at99.militarySoldiers().find(soldier => soldier.commanderId)!.rank).toBe(0);
    expect(at99.awardCommanderExperience("acceptance-threshold-overflow")).toBe(true);
    expect(at99.commanderState()!.xp).toBe(100);
  });

  it("keeps the ordinary rank multiplier outside the commander hit hook (no double scale)", () => {
    const actors = [0, 1, 2].map(index => ({
      action: "idle", animationTime: 0, building: -1, home: -1, job: "Soldier", path: [], pathIndex: 0,
      phase: "militaryField", timer: 0, uid: index + 1, visible: true, ware: null, x: index, y: 0, yaw: 0, z: 0
    }));
    const context = { actors, buildings: [{ access: { x: 0, z: 0 }, construction: 1, doorThreshold: { x: 0, z: 0 },
      militaryFaction: undefined, typeId: 62, uid: 10, y: 0 }], options: { developmentAllowed: true,
      world: { seed: 1 } }, playerNation: "viking" } as unknown as SettlementContext;
    const soldiers = new Map<number, SettlementSoldier>([
      [1, { actor: 1, building: -3, commanderId: "commander-rank", combat: { cooldown: 0, faction: 0,
        hp: commanderMaximumHealth(2), type: "cavalry" }, rank: 0, stationed: false }],
      [2, { actor: 2, building: -3, combat: { cooldown: 0, faction: 0, hp: 125, type: "shield" }, rank: 0,
        stationed: false }],
      [3, { actor: 3, building: -3, combat: { cooldown: 0, faction: 1, hp: 125, type: "shield" }, rank: 0,
        stationed: false }]
    ]);
    const system = createCommanderSystem(context, soldiers);
    system.restore({ healingSeconds: 0, homeLodgeUid: 10, id: "commander-rank", level: 2, location: "field",
      name: "Rank test", nation: "viking", recoverySeconds: 0, xp: 30 });
    const commander = soldiers.get(1)!, ally = soldiers.get(2)!, enemy = soldiers.get(3)!;
    const rankZero = system.modifyHit({ attacker: commander, defender: enemy, ranged: false, random: () => 0 });
    soldiers.get(1)!.rank = 1;
    const rankOne = system.modifyHit({ attacker: commander, defender: enemy, ranged: false, random: () => 0 });
    expect(rankZero.damageFactor).toBeCloseTo(commanderDamageFactor(2) * 1.05, 8);
    expect(rankOne.damageFactor).toBe(rankZero.damageFactor);
    expect(system.modifyHit({ attacker: ally, defender: enemy, ranged: false, random: () => 0 }).damageFactor)
      .toBeCloseTo(1.05, 8);
    expect(COMMANDER_DEFINITIONS.viking.aura.radius).toBe(6);
  });
});
