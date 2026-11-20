import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { buildingUnlockLevel } from "../src/shared/progression/building-unlocks";
import { COMMANDER_LODGE_TYPE_ID } from "../src/shared/settlement/building-type-ids";
import { NATION_DRINK_CHAINS } from "../src/shared/settlement/nation-drinks";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import {
  COMMANDER_AURA_RADIUS, COMMANDER_RECOVERY_SECONDS, commanderDamageFactor,
  commanderHealthReady, commanderMaximumHealth,
commanderRecruitCost} from "../src/shared/settlement/settlement-commander";
import { createCommanderSystem } from "../src/shared/settlement/settlement-commander-state";
import type { SettlementSoldier } from "../src/shared/settlement/settlement-military";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import { huntingWorld } from "./helpers/hunting-world";

const lodgeFixture = (level = 23, developmentAllowed = true) => {
  const world = huntingWorld();
  const roads = createRoadNetwork(world);
  const simulation = createSettlementSimulation({
    developmentAllowed, initialSettlers: 20, playerLevel: () => level, roads, world,
    unlockAllBuildings: level < 23,
    initialStock: { beer: 40, coins: 40, wine: 40, planks: 40, shield: 6, stone: 40, sword: 6 }
  });
  const [width, depth] = getBuildingDefinition(COMMANDER_LODGE_TYPE_ID).gridFootprint;
  const placed = simulation.placeBuilding(COMMANDER_LODGE_TYPE_ID, 26 + width / 2, 22 + depth / 2);
  if (!placed.ok || !placed.building) throw new Error(placed.reason);
  const lodge = placed.building;
  Object.assign(lodge, { construction: 1, foundationProgress: 1, required: {} });
  expect(roads.addRoad(simulation.headquarters.access, lodge.access)).toBe(true);
  return { advance: (seconds: number) => { for (let tick = 0; tick < seconds * 20; tick++) simulation.update(.05); },
    lodge, roads, simulation, world };
};

describe("commander core", () => {
  it("unlocks the lodge at level 23 and keeps it out of the retired Stable id", () => {
    const { simulation } = lodgeFixture();
    expect(COMMANDER_LODGE_TYPE_ID).toBe(62);
    expect(getBuildingDefinition(COMMANDER_LODGE_TYPE_ID).name).toBe("Commander's Lodge");
    expect(simulation.commanderStatus(9999)).toBeUndefined();
  });

  it("keeps level 23 as the lodge placement gate", () => {
    const world = huntingWorld(), roads = createRoadNetwork(world);
    const simulation = createSettlementSimulation({
      initialSettlers: 10, playerLevel: () => 22, roads, world,
      initialStock: { planks: 40, stone: 40 }
    });
    expect(buildingUnlockLevel(COMMANDER_LODGE_TYPE_ID)).toBe(23);
    expect(simulation.placeBuilding(COMMANDER_LODGE_TYPE_ID, 30, 30).ok).toBe(false);
  });

  it("recruits one commander with the canonical recipe, level 1 stats and six-tile aura", () => {
    const { lodge, simulation } = lodgeFixture();
    const before = { ...simulation.headquarters.inventory };
    expect(simulation.commanderRecruitStatus(lodge.uid)).toMatchObject({ available: true, hasCommander: false });
    const result = simulation.recruitCommander(lodge.uid);
    expect(result).toMatchObject({ ok: true });
    const commander = simulation.commanderStatus(lodge.uid)!;
    expect(commander).toMatchObject({
      level: 1, hp: commanderMaximumHealth(1), maximumHp: commanderMaximumHealth(1), xp: 0
    });
    expect(commander.definition.aura.radius).toBe(COMMANDER_AURA_RADIUS);
    expect(simulation.recruitCommander(lodge.uid)).toEqual({ ok: false, reason: "A commander already serves this island" });
    expect(simulation.militaryStoredTroops().find(entry => entry.type === "cavalry")?.count ?? 0).toBe(0);
    for (const [ware, count] of Object.entries(commanderRecruitCost("roman")))
      expect(simulation.headquarters.inventory[ware], ware).toBe(before[ware]! - count);
  });

  it("refuses nineteen coins without payment and recruits for exactly twenty", () => {
    const { lodge, simulation } = lodgeFixture(23, false);
    Object.assign(simulation.headquarters.inventory, { beer: 10, coins: 19, shield: 1, sword: 1, wine: 10 });
    const before = simulation.saveState();
    const idleBefore = simulation.availableSettlers();
    expect(simulation.commanderRecruitStatus(lodge.uid)).toMatchObject({ available: false,
      cost: { beer: 10, coins: 20, shield: 1, sword: 1, wine: 10 }, missing: { coins: 1 } });
    expect(simulation.recruitCommander(lodge.uid).ok).toBe(false);
    expect(simulation.saveState()).toEqual(before);
    simulation.headquarters.inventory.coins = 20;
    expect(simulation.recruitCommander(lodge.uid).ok).toBe(true);
    expect(simulation.headquarters.inventory).toMatchObject({ beer: 0, coins: 0, shield: 0, sword: 0, wine: 0 });
    expect(simulation.availableSettlers()).toBe(idleBefore - 1);
  });

  it.each(["roman", "viking", "nubian", "japanese"] as const)("charges ten beer and ten of %s's own drink", nation => {
    const { lodge, simulation } = lodgeFixture();
    simulation.setPlayerNation(nation);
    const drink = NATION_DRINK_CHAINS[nation].drink;
    Object.assign(simulation.headquarters.inventory, { beer: 10, coins: 20, shield: 1, sword: 1,
      mead: 0, sake: 0, toddy: 0, wine: 0 });
    simulation.headquarters.inventory[drink] = 9;
    const before = simulation.saveState();
    expect(simulation.commanderRecruitStatus(lodge.uid).missing).toEqual({ [drink]: 1 });
    expect(simulation.recruitCommander(lodge.uid).ok).toBe(false);
    expect(simulation.saveState()).toEqual(before);
    simulation.headquarters.inventory[drink] = 10;
    expect(simulation.recruitCommander(lodge.uid).ok).toBe(true);
    expect(simulation.headquarters.inventory).toMatchObject({ beer: 0, coins: 0, shield: 0, sword: 0, [drink]: 0 });
  });

  it("accepts only an eligible catalog definition and preserves its identity through reload", () => {
    const { lodge, simulation } = lodgeFixture();
    const before = simulation.saveState();
    expect(simulation.recruitCommander(lodge.uid, "viking-raider").ok).toBe(false);
    expect(simulation.saveState()).toEqual(before);
    const choice = simulation.commanderRecruitStatus(lodge.uid).choices![0]!;
    expect(choice.definitionId).toBe("roman-guardian");
    expect(simulation.recruitCommander(lodge.uid, choice.definitionId).ok).toBe(true);
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
    expect(simulation.commanderSnapshot()).toMatchObject({ definitionId: choice.definitionId,
      definition: { id: choice.definitionId, recruitCost: choice.cost } });
  });

  it("persists the commander through save/reload and keeps one identity", () => {
    const { lodge, simulation } = lodgeFixture();
    const id = simulation.recruitCommander(lodge.uid);
    expect(id).toMatchObject({ ok: true });
    const saved = simulation.saveState();
    expect(saved.military?.commander).toBeDefined();
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    const commander = simulation.commanderStatus(lodge.uid)!;
    expect(commander.id).toBe((id as { id: string }).id);
    expect(commander.name.length).toBeGreaterThan(0);
    expect(simulation.militarySoldiers().filter(soldier => soldier.commanderId).length).toBe(1);
  });

  it("rests and heals at 1% maximum HP per game minute, preserving fractional HP", () => {
    const { advance, lodge, simulation } = lodgeFixture();
    expect(simulation.recruitCommander(lodge.uid).ok).toBe(true);
    const commander = simulation.commanderStatus(lodge.uid)!;
    // Directly wound the persisted combat state only for this timing check.
    const wounded = simulation.saveState();
    wounded.military!.soldiers = wounded.military!.soldiers.map(entry => entry.commanderId
      ? { ...entry, combat: { ...entry.combat!, hp: commander.maximumHp * .5 } } : entry);
    expect(simulation.loadState(wounded)).toEqual({ ok: true });
    advance(59.95);
    expect(simulation.commanderStatus(lodge.uid)!.hp).toBeCloseTo(commander.maximumHp * .5, 5);
    advance(.05);
    expect(simulation.commanderStatus(lodge.uid)!.hp).toBeCloseTo(commander.maximumHp * .51, 5);
  });

  it("starts and finishes the 30-minute recovery concurrently with healing", () => {
    const { advance, lodge, simulation } = lodgeFixture();
    expect(simulation.recruitCommander(lodge.uid).ok).toBe(true);
    const wounded = simulation.saveState();
    wounded.military!.commander = { ...wounded.military!.commander!, location: "recovering",
      recoverySeconds: COMMANDER_RECOVERY_SECONDS };
    wounded.military!.soldiers = wounded.military!.soldiers.map(entry => entry.commanderId
      ? { ...entry, combat: { ...entry.combat!, hp: 1 } } : entry);
    expect(simulation.loadState(wounded)).toEqual({ ok: true });
    advance(60);
    advance(30 * 60 - 60 + .05);
    const commander = simulation.commanderStatus(lodge.uid)!;
    expect(commander.recoveryComplete).toBe(true);
    expect(commander.hp).toBeGreaterThan(commander.maximumHp * .3);
    expect(commander.hp).toBeLessThan(commander.maximumHp * .5);
    expect(commander.ready).toBe(false);
    expect(commander.blockReason).toBe("too-injured");
  }, 20_000);

  it("levels through the authority-gated development action and compounds stats", () => {
    const { lodge, simulation } = lodgeFixture();
    expect(simulation.recruitCommander(lodge.uid).ok).toBe(true);
    const before = simulation.commanderStatus(lodge.uid)!;
    const wounded = simulation.saveState();
    wounded.military!.soldiers = wounded.military!.soldiers.map(entry => entry.commanderId
      ? { ...entry, combat: { ...entry.combat!, hp: entry.combat!.hp * .4 } } : entry);
    expect(simulation.loadState(wounded)).toEqual({ ok: true });
    expect(simulation.levelUpCommander(lodge.uid)).toMatchObject({ ok: true, level: 2, xp: 30 });
    const level2 = simulation.commanderStatus(lodge.uid)!;
    expect(level2.level).toBe(2);
    expect(level2.maximumHp).toBeCloseTo(before.maximumHp * 1.4, 5);
    expect(level2.hp).toBeCloseTo(level2.maximumHp * .4, 5);
    expect(simulation.levelUpCommander(lodge.uid)).toMatchObject({ ok: true, level: 3, xp: 100 });
    expect(simulation.levelUpCommander(lodge.uid)).toMatchObject({ ok: false });
  });

  it("needs authority for the development level-up action", () => {
    const { lodge, simulation } = lodgeFixture(23, false);
    expect(simulation.recruitCommander(lodge.uid).ok).toBe(true);
    expect(simulation.commanderStatus(lodge.uid)!.developmentAllowed).toBe(false);
    expect(simulation.levelUpCommander(lodge.uid)).toEqual({ ok: false, reason: "Development tools are unavailable" });
  });
});

const modifierFixture = (nation: "japanese" | "nubian" | "roman" | "viking") => {
  const actors = [
    { action: "idle", animationTime: 0, building: -1, home: -1, job: "Soldier", path: [], pathIndex: 0,
      phase: "militaryField", timer: 0, uid: 1, visible: true, ware: null, x: 0, y: 0, yaw: 0, z: 0 },
    { action: "idle", animationTime: 0, building: -1, home: -1, job: "Soldier", path: [], pathIndex: 0,
      phase: "militaryField", timer: 0, uid: 2, visible: true, ware: null, x: 1, y: 0, yaw: 0, z: 0 },
    { action: "idle", animationTime: 0, building: -1, home: -1, job: "Soldier", path: [], pathIndex: 0,
      phase: "militaryField", timer: 0, uid: 3, visible: true, ware: null, x: 7, y: 0, yaw: 0, z: 0 }
  ];
  const lodge = { access: { x: 0, z: 0 }, construction: 1, doorThreshold: { x: 0, z: 0 }, militaryFaction: undefined,
    typeId: COMMANDER_LODGE_TYPE_ID, uid: 10, y: 0 };
  const context = { actors, buildings: [lodge], options: { world: { seed: 1 } },
    playerNation: nation } as unknown as SettlementContext;
  const soldiers = new Map<number, SettlementSoldier>([
    [1, { actor: 1, building: -3, commanderId: "commander-test", combat: { cooldown: 0, faction: 0,
      hp: commanderMaximumHealth(2), type: "cavalry" }, rank: 0, stationed: false }],
    [2, { actor: 2, building: -3, combat: { cooldown: 0, faction: 0, hp: 125, type: "shield" }, rank: 0,
      stationed: false }],
    [3, { actor: 3, building: -3, combat: { cooldown: 0, faction: 0, hp: 125, type: "shield" }, rank: 0,
      stationed: false }],
    [4, { actor: 4, building: -3, combat: { cooldown: 0, faction: 1, hp: 125, type: "shield" }, rank: 0,
      stationed: false }]
  ]);
  actors.push({ action: "idle", animationTime: 0, building: -1, home: -1, job: "Soldier", path: [], pathIndex: 0,
    phase: "militaryField", timer: 0, uid: 4, visible: true, ware: null, x: 8, y: 0, yaw: 0, z: 0 });
  const system = createCommanderSystem(context, soldiers);
  system.restore({ healingSeconds: 0, homeLodgeUid: 10, id: "commander-test", level: 2, location: "field",
    name: "Test", nation, recoverySeconds: 0, xp: 30 });
  return { soldiers, system };
};

describe("commander combat modifiers", () => {
  it("uses 3x base maximum HP and compounding personal damage", () => {
    expect(commanderMaximumHealth(1)).toBeCloseTo(315, 8);
    expect(commanderMaximumHealth(2)).toBeCloseTo(315 * 1.4, 8);
    expect(commanderMaximumHealth(3)).toBeCloseTo(315 * 1.4 * 1.4, 8);
    expect(commanderDamageFactor(1)).toBe(1);
    expect(commanderDamageFactor(2)).toBeCloseTo(1.3, 8);
    expect(commanderDamageFactor(3)).toBeCloseTo(1.69, 8);
    expect(commanderHealthReady(157.4, 315)).toBe(false);
    expect(commanderHealthReady(157.5, 315)).toBe(true);
  });

  it("applies the Nubian bow aura and the commander's personal damage once", () => {
    const { soldiers, system } = modifierFixture("nubian");
    const commander = soldiers.get(1)!, ally = soldiers.get(2)!, enemy = soldiers.get(4)!;
    const personal = system.modifyHit({ attacker: commander, defender: enemy, ranged: true, random: () => .99 });
    expect(personal.damageFactor).toBeCloseTo(1.3 * 1.05, 8);
    expect(system.modifyHit({ attacker: ally, defender: enemy, ranged: true, random: () => .99 }).damageFactor)
      .toBeCloseTo(1.05, 8);
    expect(system.modifyHit({ attacker: ally, defender: enemy, ranged: false, random: () => .99 }).damageFactor).toBe(1);
    const far = soldiers.get(3)!;
    expect(system.modifyHit({ attacker: far, defender: enemy, ranged: true, random: () => .99 }).damageFactor).toBe(1);
  });

  it("applies the Viking melee aura only within six tiles", () => {
    const { soldiers, system } = modifierFixture("viking");
    const ally = soldiers.get(2)!, far = soldiers.get(3)!, enemy = soldiers.get(4)!;
    expect(system.modifyHit({ attacker: ally, defender: enemy, ranged: false, random: () => .99 }).damageFactor)
      .toBeCloseTo(1.05, 8);
    expect(system.modifyHit({ attacker: far, defender: enemy, ranged: false, random: () => .99 }).damageFactor).toBe(1);
    expect(system.modifyHit({ attacker: ally, defender: enemy, ranged: true, random: () => .99 }).damageFactor).toBe(1);
  });

  it("reduces incoming arrow damage for the Roman aura", () => {
    const { soldiers, system } = modifierFixture("roman");
    const ally = soldiers.get(2)!, enemy = soldiers.get(4)!;
    expect(system.modifyHit({ attacker: enemy, defender: ally, ranged: true, random: () => .99 }).damageFactor)
      .toBeCloseTo(.95, 8);
    expect(system.modifyHit({ attacker: enemy, defender: ally, ranged: false, random: () => .99 }).damageFactor).toBe(1);
  });

  it("rolls one Japanese melee dodge only for an otherwise connected melee hit", () => {
    const { soldiers, system } = modifierFixture("japanese");
    const ally = soldiers.get(2)!, enemy = soldiers.get(4)!;
    expect(system.modifyHit({ attacker: enemy, defender: ally, ranged: false, random: () => .01 })).toMatchObject({
      damageFactor: 1, dodge: true
    });
    expect(system.modifyHit({ attacker: enemy, defender: ally, ranged: false, random: () => .99 }).dodge).toBe(false);
    expect(system.modifyHit({ attacker: enemy, defender: ally, ranged: true, random: () => .01 }).dodge).toBe(false);
  });
});

