import { describe, expect, it } from "vitest";

import { canGarrisonMilitaryType, militaryDamage, militaryHealth } from "../src/shared/settlement/military-combat-rules";
import { type MilitaryArrow,shootMilitaryArrow, sweepMilitaryArrow }
  from "../src/shared/settlement/military-projectiles";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

type RecruitedType = "archer" | "heavy" | "shield";
const fixture = (types: readonly RecruitedType[] = ["shield", "shield"]) => {
  const size = 40;
  const world = { seed: 9, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 5.5, z: 5.5 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2), mineZones: [],
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(), scale: new Float32Array() }
  } as unknown as WorldData;
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world, roads, initialSettlers: 20,
    initialStock: { sword: 4, shield: 4, beer: 4, bow: 4, axe: 4, planks: 48, stone: 48 },
    canWorkerEnterPlot: () => true });
  const result = simulation.placeBuilding(1, 15, 12);
  if (!result.ok || !result.building) throw new Error(result.reason);
  const building = result.building; building.construction = 1; building.required = {};
  roads.addRoad(simulation.headquarters.access, building.access);
  const advance = (seconds: number) => {
    for (let index = 0; index < seconds * 20; index++) simulation.update(.05);
  };
  // Recruit the fixed troop types this scenario needs; later equipment changes are impossible.
  for (const type of types) simulation.recruitStoredMilitary(simulation.headquarters.uid, type);
  advance(120);
  /** Two more stored swordsmen refill the barracks when a garrisoned soldier is called out. */
  const storeReplacements = () => {
    for (let index = 0; index < 2; index++) simulation.recruitStoredMilitary(simulation.headquarters.uid, "shield");
  };
  return { world, simulation, advance, building, storeReplacements };
};

describe("live military combat", () => {
  it("allows all three foot types in garrisons but rejects mounted garrison save records", () => {
    for (const type of ["shield", "heavy", "archer"] as const)
      expect(canGarrisonMilitaryType(type)).toBe(true);
    expect(canGarrisonMilitaryType(undefined)).toBe(true); // Existing shield soldiers predate explicit type.
    expect(canGarrisonMilitaryType("cavalry")).toBe(false);
    const { simulation } = fixture();
    const saved = simulation.saveState();
    const soldier = saved.military!.soldiers.find(entry => entry.stationed)!;
    soldier.combat = { type: "cavalry", faction: 0, hp: 105, cooldown: 0 };
    const before = simulation.militarySoldiers();
    expect(simulation.loadState(saved)).toEqual({ ok: false,
      reason: "Only foot soldiers can garrison military buildings" });
    expect(simulation.militarySoldiers()).toEqual(before);
  });

  it("keeps recruited types fixed while selecting, deploying through doors and saving the battlefield", () => {
    const { advance, simulation } = fixture(["archer", "shield"]);
    const ids = simulation.militarySoldiers().map(soldier => soldier.actor);
    const before = { ...simulation.headquarters.inventory };
    expect(simulation.militarySoldiers().find(soldier => soldier.actor === ids[0])?.combat?.type).toBe("archer");
    simulation.selectMilitary([], "archer");
    expect(simulation.militarySoldiers().filter(soldier => soldier.combat?.selected).map(soldier => soldier.actor))
      .toEqual([ids[0]]);
    expect(simulation.commandMilitary(ids, { x: 23, z: 15 })).toBe(true);
    // A building that claimed territory keeps one soldier; every other commanded soldier leaves.
    const commanded = () => simulation.frames().filter(actor => ids.includes(actor.uid));
    expect(commanded().map(actor => actor.phase).sort()).toEqual(["garrison", "militaryLeaving"]);
    const fieldIds = commanded().filter(actor => actor.phase === "militaryLeaving").map(actor => actor.uid);
    expect(fieldIds).toEqual([ids[0]]);
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
    advance(30);
    const troops = commanded().filter(actor => fieldIds.includes(actor.uid));
    expect(troops.every(actor => actor.phase === "militaryField" && actor.visible)).toBe(true);
    // An attack move gathers by kind: the archer stands just behind the swordsmen.
    expect(troops.every(actor => Math.hypot(actor.x - 23, actor.z - 15) < 1.5)).toBe(true);
    expect(simulation.equipMilitary(ids[0]!, "heavy")).toBe(false);
    expect(simulation.equipMilitary(ids[0]!, "archer")).toBe(false);
    expect(simulation.militarySoldiers().find(soldier => soldier.actor === ids[0])?.combat?.type).toBe("archer");
    expect(simulation.headquarters.inventory).toEqual(before);
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
    const corrupted = simulation.saveState(); corrupted.military!.soldiers[0]!.combat!.hp = Infinity;
    expect(simulation.loadState(corrupted).ok).toBe(false);
  });

  it("damages registered hostile doors and returns fixed-type soldiers without losing issued gear", () => {
    const { advance, building, simulation, storeReplacements } = fixture(["heavy", "shield"]);
    storeReplacements();
    const id = simulation.militarySoldiers()[0]!.actor;
    expect(simulation.militarySoldiers()[0]?.combat?.type).toBe("heavy");
    simulation.commandMilitary([id], { x: 23, z: 20 }); advance(30);
    const inventory = { ...building.inventory };
    expect(simulation.registerMilitaryDoor(building.uid, 1, 20)).toBe(true);
    expect(simulation.siegeMilitary([id], building.uid)).toBe(true); advance(45);
    expect(simulation.militaryDoors()[0]!.hp).toBe(0);
    expect(building.inventory).toEqual(inventory);
    expect(simulation.returnMilitaryHome([id])).toBe(true); advance(45);
    const soldier = simulation.militarySoldiers().find(entry => entry.actor === id)!;
    expect(soldier.combat?.type).toBe("heavy");
    expect(simulation.frames().find(actor => actor.uid === id)?.phase).toBe("militaryReserve");
    expect(simulation.commandMilitary([id], { x: 23, z: 20 })).toBe(true);
  });

  it("kills and removes actual actors without equipment or settler refunds; mist expires and cannot revive on load", () => {
    const { advance, simulation } = fixture();
    const id = simulation.militarySoldiers()[0]!.actor;
    simulation.commandMilitary([id], { x: 24, z: 15 }); advance(30);
    const actor = simulation.frames().find(entry => entry.uid === id)!;
    const enemy = simulation.spawnMilitaryOpponent({ x: actor.x + .7, z: actor.z }, "heavy", 2)!;
    const stock = { ...simulation.headquarters.inventory };
    let death = false;
    for (let tick = 0; tick < 1200 && !death; tick++) {
      simulation.update(.05); death = simulation.militaryDeaths().some(effect => effect.id === id || effect.id === enemy);
    }
    expect(death).toBe(true);
    const dead = simulation.militaryDeaths()[0]!.id;
    expect(simulation.frames().some(entry => entry.uid === dead)).toBe(false);
    expect(simulation.militarySoldiers().some(entry => entry.actor === dead)).toBe(false);
    expect(simulation.headquarters.inventory).toEqual(stock);
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
    expect(simulation.militaryDeaths()).toEqual([]);
    advance(4); expect(simulation.frames().some(entry => entry.uid === dead)).toBe(false);
  });

  it("archers obey 2–8 tiles, release after draw and back away from a close enemy", () => {
    const { advance, simulation } = fixture(["archer", "shield"]);
    const id = simulation.militarySoldiers()[0]!.actor;
    simulation.commandMilitary([id], { x: 23, z: 15 }); advance(30);
    const actor = simulation.frames().find(entry => entry.uid === id)!;
    const enemy = simulation.spawnMilitaryOpponent({ x: actor.x + 1, z: actor.z }, "shield")!;
    const body = simulation.frames().find(entry => entry.uid === enemy)!;
    let fired = false;
    for (let tick = 0; tick < 160; tick++) {
      body.path = []; body.pathIndex = 0; body.action = "idle";
      simulation.update(.05);
      fired ||= simulation.militaryArrows().some(arrow => arrow.shooter === id);
    }
    expect(Math.hypot(actor.x - body.x, actor.z - body.z)).toBeGreaterThanOrEqual(2);
    expect(fired).toBe(true);
    expect(actor.tool).toBe("bow");
    expect(simulation.spawnMilitaryOpponent({ x: 30, z: 30 }, "cavalry")).not.toBeNull();
  });
});

describe("physical military arrows and damage", () => {
  it.each([0, 1, 2])("tier %i increases HP by 20%%, and glancing contacts never crit", rank => {
    expect(militaryHealth("shield", rank)).toBeCloseTo(125 * 1.2 ** rank);
    expect(militaryDamage("archer", rank, "shield", 0, false, () => 0).critical).toBe(false);
    expect(militaryDamage("heavy", rank, "shield", 2, true, () => 0).bypass).toBe(true);
  });
  it.each([0, .2, .3])("swept trajectories classify lateral offset %s as full, glancing or a real miss", offset => {
    const { world } = fixture();
    const arrow: MilitaryArrow = { id: 0, shooter: 0, faction: 0, rank: 0,
      ...shootMilitaryArrow({ x: 20, y: .78, z: 20 }, { x: 28, y: .62, z: 20 },
        { x: 0, z: 0 }, 0, () => .25) };
    let result: ReturnType<typeof sweepMilitaryArrow> = { stopped: false };
    for (let step = 0; step < 60 && !result.stopped; step++)
      result = sweepMilitaryArrow(arrow, .05, world,
        [{ id: 1, faction: 1, x: 28, y: 0, z: 20 + offset }], []);
    if (offset === .3) expect(result.target).toBeUndefined();
    else { expect(result.target).toBe(1); expect(result.full).toBe(offset === 0); }
  });
  it("arrows fly through friendly soldiers to the enemy behind them; terrain stops them", () => {
    const { world } = fixture();
    const makeArrow = (): MilitaryArrow => ({ id: 0, shooter: 0, faction: 0, rank: 0,
      ...shootMilitaryArrow({ x: 20, y: .78, z: 20 }, { x: 28, y: .62, z: 20 },
        { x: 0, z: 0 }, 0, () => .25) });
    const arrow = makeArrow();
    let result: ReturnType<typeof sweepMilitaryArrow> = { stopped: false };
    const targets = [{ id: 1, faction: 0, x: 27, y: 0, z: 20 }, { id: 2, faction: 1, x: 28, y: 0, z: 20 }];
    for (let step = 0; step < 60 && !result.stopped; step++)
      result = sweepMilitaryArrow(arrow, .05, world, targets, []);
    expect(result.stopped).toBe(true); expect(result.target).toBe(2);
    expect(arrow.x).toBeGreaterThan(27.5);
    const blocked = makeArrow(); world.heights.fill(3);
    expect(sweepMilitaryArrow(blocked, .05, world, [], []).stopped).toBe(true);
  });
});
