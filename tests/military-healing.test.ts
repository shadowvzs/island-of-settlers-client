import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { militaryHealth } from "../src/shared/settlement/military-combat-rules";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { promoteSettlementSoldier, type SettlementSoldier } from "../src/shared/settlement/settlement-military";
import {
  advanceMilitaryRecovery, advanceSavedMilitaryRecovery, savedMilitaryCombatBuildings
} from "../src/shared/settlement/settlement-military-recovery";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementActor, SettlementBuilding } from "../src/shared/settlement/settlement-types";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const SIZE = 64;
const fixture = () => {
  const world = { seed: 9, cellsX: SIZE, cellsZ: SIZE, seaLevel: -1, start: { x: 12.5, z: 12.5 },
    heights: new Float32Array((SIZE + 1) ** 2), blocking: new Uint8Array(SIZE ** 2),
    walkCost: new Uint8Array(SIZE ** 2).fill(10), buildClass: new Uint8Array(SIZE ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(SIZE ** 2), mineZone: new Uint16Array(SIZE ** 2), mineZones: [],
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(),
      scale: new Float32Array() }
  } as unknown as WorldData;
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world, roads, initialSettlers: 20,
    initialStock: { axe: 6, beer: 6, bow: 6, shield: 6, sword: 6, planks: 80, stone: 80 },
    canWorkerEnterPlot: () => true, withoutMilitaryCommander: true });
  const place = (typeId: number, x: number, z: number) => {
    const [width, depth] = getBuildingDefinition(typeId).gridFootprint;
    const result = simulation.placeBuilding(typeId, x + width % 2 / 2, z + depth % 2 / 2);
    if (!result.ok || !result.building) throw new Error(result.reason);
    const building = result.building; building.construction = 1; building.required = {};
    roads.addRoad(simulation.headquarters.access, building.access);
    return building;
  };
  const advance = (seconds: number) => {
    for (let tick = 0; tick < Math.round(seconds * 20); tick++) simulation.update(.05);
  };
  return { advance, place, roads, simulation };
};

type Simulation = ReturnType<typeof fixture>["simulation"];
const recruit = (simulation: Simulation, type: "archer" | "shield" = "shield", hp = 100) => {
  simulation.receiveTroops([{ hp, rank: 0, type }]);
  return simulation.militarySoldiers()[0]!.actor;
};
const savedSoldier = (simulation: Simulation, id: number) =>
  simulation.saveState().military!.soldiers.find(soldier => soldier.actor === id)!;
const soldierHp = (simulation: Simulation, id: number) => savedSoldier(simulation, id).combat!.hp;
const setRecovery = (simulation: Simulation, id: number, hp: number, seconds: number | undefined) => {
  const save = simulation.saveState();
  const soldier = save.military!.soldiers.find(entry => entry.actor === id)!;
  soldier.combat!.hp = hp;
  if (seconds === undefined) delete soldier.recoverySeconds;
  else soldier.recoverySeconds = seconds;
  expect(simulation.loadState(save)).toEqual({ ok: true });
};
const moveReserveTo = (simulation: Simulation, id: number, uid: number) => {
  const save = simulation.saveState();
  const soldier = save.military!.soldiers.find(entry => entry.actor === id)!;
  soldier.building = -1; soldier.stationed = false;
  const actor = save.actors.find(entry => entry.uid === id)!;
  actor.building = uid; actor.home = uid; actor.phase = "militaryReserve"; actor.visible = false;
  expect(simulation.loadState(save)).toEqual({ ok: true });
};
const stationAt = (simulation: Simulation, id: number, uid: number) => {
  const save = simulation.saveState();
  const soldier = save.military!.soldiers.find(entry => entry.actor === id)!;
  soldier.building = uid; soldier.stationed = true;
  const actor = save.actors.find(entry => entry.uid === id)!;
  actor.building = uid; actor.phase = "garrison"; actor.visible = false;
  expect(simulation.loadState(save)).toEqual({ ok: true });
};

const actorOf = (overrides: Partial<SettlementActor> = {}) => ({
  uid: 1, x: 0, y: 0, z: 0, yaw: 0, visible: false, job: "Soldier", action: "idle", ware: null,
  phase: "militaryReserve", building: 5, home: 5, path: [], pathIndex: 0, timer: 0, animationTime: 0,
  ...overrides
}) as SettlementActor;
const buildingOf = (overrides: Partial<SettlementBuilding> = {}) => ({
  uid: 5, typeId: 39, construction: 1, militaryFaction: undefined, ...overrides
}) as SettlementBuilding;
const soldierOf = (overrides: Partial<SettlementSoldier> = {}) => ({
  actor: 1, rank: 0, building: -1, stationed: false, recoverySeconds: 0,
  combat: { type: "shield", faction: 0, hp: 100, cooldown: 0 }, ...overrides
}) as SettlementSoldier;

describe("resting military recovery", () => {
  it("heals exactly one actual HP at 60 eligible seconds", () => {
    const { advance, simulation } = fixture();
    const id = recruit(simulation);
    setRecovery(simulation, id, 124, 59.9);
    advance(.05);
    expect(soldierHp(simulation, id)).toBe(124);
    expect(savedSoldier(simulation, id).recoverySeconds).toBeCloseTo(59.95, 10);
    advance(.05);
    expect(soldierHp(simulation, id)).toBe(125);
    expect(savedSoldier(simulation, id).recoverySeconds).toBeUndefined();
    advance(.05);
    expect(soldierHp(simulation, id)).toBe(125);
    expect(savedSoldier(simulation, id).recoverySeconds).toBeUndefined();
  });

  it("applies several minutes at once with fractional saved HP", () => {
    const soldier = soldierOf({ combat: { type: "shield", faction: 0, hp: 50.5, cooldown: 0 },
      recoverySeconds: 30 });
    expect(advanceMilitaryRecovery([soldier], [actorOf()], [buildingOf()], 90)).toBe(2);
    expect(soldier.combat!.hp).toBe(52.5);
    expect(soldier.recoverySeconds).toBeUndefined();
    expect(advanceMilitaryRecovery([soldier], [actorOf()], [buildingOf()], 59)).toBe(0);
    expect(soldier.recoverySeconds).toBe(59);
    expect(advanceMilitaryRecovery([soldier], [actorOf()], [buildingOf()], 1)).toBe(1);
    expect(soldier.combat!.hp).toBe(53.5);
    expect(soldier.recoverySeconds).toBeUndefined();
  });

  it("clamps at maximum without banking excess time or overhealing", () => {
    const soldier = soldierOf({ combat: { type: "shield", faction: 0, hp: 124.5, cooldown: 0 },
      recoverySeconds: 59.9 });
    expect(advanceMilitaryRecovery([soldier], [actorOf()], [buildingOf()], 10)).toBe(.5);
    expect(soldier.combat!.hp).toBe(125);
    expect(soldier.recoverySeconds).toBeUndefined();
    expect(advanceMilitaryRecovery([soldier], [actorOf()], [buildingOf()], 600)).toBe(0);
    expect(soldier.combat!.hp).toBe(125);
    expect(soldier.recoverySeconds).toBeUndefined();
  });

  it("turns 100 missing HP into exactly 100 eligible minutes", () => {
    const soldier = soldierOf({ combat: { type: "shield", faction: 0, hp: 25, cooldown: 0 } });
    expect(advanceMilitaryRecovery([soldier], [actorOf()], [buildingOf()], 5_999)).toBe(99);
    expect(soldier.combat!.hp).toBe(124);
    expect(soldier.recoverySeconds).toBe(59);
    expect(advanceMilitaryRecovery([soldier], [actorOf()], [buildingOf()], 1)).toBe(1);
    expect(soldier.combat!.hp).toBe(125);
    expect(soldier.recoverySeconds).toBeUndefined();
  });

  it("pauses through travel and field idling, then resumes the saved minute", () => {
    const { advance, simulation } = fixture();
    const id = recruit(simulation);
    setRecovery(simulation, id, 124, 40);
    expect(simulation.callOutMilitary(["shield"], { x: 30, z: 30 })).toBe(1);
    advance(300);
    expect(soldierHp(simulation, id)).toBe(124);
    expect(savedSoldier(simulation, id).recoverySeconds).toBe(40);
    expect(simulation.returnMilitaryHome([id])).toBe(true);
    for (let tick = 0; tick < 400 * 20 &&
      simulation.frames().find(actor => actor.uid === id)?.phase !== "militaryReserve"; tick++)
      simulation.update(.05);
    expect(simulation.frames().find(actor => actor.uid === id)?.phase).toBe("militaryReserve");
    expect(savedSoldier(simulation, id).recoverySeconds).toBe(40);
    advance(20);
    expect(soldierHp(simulation, id)).toBe(125);
    expect(savedSoldier(simulation, id).recoverySeconds).toBeUndefined();
  });

  it("does not heal while the garrison or building is fighting", () => {
    const actor = actorOf({ building: 5, phase: "garrison", visible: false });
    const building = buildingOf({ typeId: 1 });
    const soldier = soldierOf({ building: 5, recoverySeconds: 30, stationed: true });
    expect(advanceMilitaryRecovery([soldier], [actor], [building], 120, uid => uid === 5)).toBe(0);
    expect(soldier.combat!.hp).toBe(100);
    expect(soldier.recoverySeconds).toBe(30);
    expect(advanceMilitaryRecovery([soldier], [actor], [building], 30)).toBe(1);
    expect(soldier.combat!.hp).toBe(101);
    expect(soldier.recoverySeconds).toBeUndefined();
  });

  it("does not heal in foreign, unfinished or missing buildings, or near doors, ships and combat", () => {
    const cases: [string, Partial<SettlementActor>, Partial<SettlementBuilding>, number][] = [
      ["unfinished", {}, { construction: .5 }, 5],
      ["foreign", {}, { militaryFaction: 1 }, 5],
      ["approaching", { phase: "enterAssigned" }, {}, 5],
      ["leaving", { phase: "retire" }, {}, 5],
      ["aboard", { navalOrder: 7 }, {}, 5],
      ["missing", { building: 9 }, {}, 9],
      ["field", { phase: "militaryField", visible: true }, {}, 5],
      ["siege", { phase: "militarySiege", visible: true }, {}, 5]
    ];
    for (const [, actorOverrides, buildingOverrides, uid] of cases) {
      const actor = actorOf({ ...actorOverrides, building: uid });
      const building = buildingOf({ uid, typeId: 39, ...buildingOverrides });
      const soldier = soldierOf({ recoverySeconds: 30 });
      expect(advanceMilitaryRecovery([soldier], [actor], uid === 9 ? [] : [building], 120)).toBe(0);
      expect(soldier.recoverySeconds).toBe(30);
      expect(soldier.combat!.hp).toBe(100);
    }
  });

  it("keeps partial time through demolition or ownership loss and resumes on valid entry", () => {
    const soldier = soldierOf({ recoverySeconds: 30 });
    expect(advanceMilitaryRecovery([soldier], [actorOf()], [buildingOf({ militaryFaction: 1 })], 60)).toBe(0);
    expect(soldier.recoverySeconds).toBe(30);
    expect(advanceMilitaryRecovery([soldier], [actorOf()], [], 60)).toBe(0);
    expect(soldier.recoverySeconds).toBe(30);
    expect(advanceMilitaryRecovery([soldier], [actorOf()], [buildingOf()], 30)).toBe(1);
    expect(soldier.combat!.hp).toBe(101);
  });

  it("never heals a dead soldier and discards its pending time", () => {
    const soldier = soldierOf({ combat: { type: "shield", faction: 0, hp: 0, cooldown: 0 },
      recoverySeconds: 59.99 });
    expect(advanceMilitaryRecovery([soldier], [actorOf()], [buildingOf()], 120)).toBe(0);
    expect(soldier.combat!.hp).toBe(0);
    expect(soldier.recoverySeconds).toBeUndefined();
  });

  it("promotes proportionally without resetting partial recovery", () => {
    const soldier = soldierOf({ combat: { type: "shield", faction: 0, hp: 62.5, cooldown: 0 },
      recoverySeconds: 30 });
    expect(promoteSettlementSoldier(soldier, 1)).toBe(true);
    expect(soldier.combat!.hp).toBe(75);
    expect(soldier.recoverySeconds).toBe(30);
    soldier.combat!.hp = 150;
    expect(promoteSettlementSoldier(soldier, 2)).toBe(true);
    expect(soldier.combat!.hp).toBe(180);
    expect(soldier.recoverySeconds).toBeUndefined();
  });

  it("leaves health and timer unchanged when an equipment change is rejected", () => {
    const { simulation } = fixture();
    const id = recruit(simulation);
    setRecovery(simulation, id, 100, 30);
    expect(simulation.equipMilitary(id, "cavalry")).toBe(false);
    const soldier = savedSoldier(simulation, id);
    expect(soldier.combat!.hp).toBe(100);
    expect(soldier.recoverySeconds).toBe(30);
    expect(soldier.combat!.type).toBe("shield");
  });

  it("heals in every eligible building category", () => {
    const { advance, place, simulation } = fixture();
    const id = recruit(simulation);
    const reserveCategories = [["HQ", simulation.headquarters.uid],
      ["storehouse", place(29, 20, 15).uid]] as const;
    for (const [label, uid] of reserveCategories) {
      moveReserveTo(simulation, id, uid);
      setRecovery(simulation, id, 100, 0);
      advance(60);
      expect({ hp: soldierHp(simulation, id), label }).toEqual({ hp: 101, label });
      expect(savedSoldier(simulation, id).recoverySeconds).toBeUndefined();
    }
    const barracks = place(1, 19, 27);
    simulation.setMilitaryTarget(barracks.uid, 1);
    stationAt(simulation, id, barracks.uid);
    setRecovery(simulation, id, 100, 0);
    advance(60);
    expect({ hp: soldierHp(simulation, id), label: "barracks" }).toEqual({ hp: 101, label: "barracks" });
    expect(savedSoldier(simulation, id).recoverySeconds).toBeUndefined();
  });

  it("treats a completed friendly harbour as a resting storage", () => {
    const soldier = soldierOf({ recoverySeconds: 0 });
    expect(advanceMilitaryRecovery([soldier], [actorOf()], [buildingOf({ typeId: 39 })], 60)).toBe(1);
    expect(soldier.combat!.hp).toBe(101);
  });

  it("saves and reloads a partial minute without duplicating or resetting it", () => {
    const { advance, simulation } = fixture();
    const id = recruit(simulation);
    setRecovery(simulation, id, 115, 40);
    advance(60);
    expect(soldierHp(simulation, id)).toBe(116);
    expect(savedSoldier(simulation, id).recoverySeconds).toBeCloseTo(40, 6);
    const saved = simulation.saveState();
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    expect(savedSoldier(simulation, id).recoverySeconds).toBeCloseTo(40, 6);
    advance(60);
    expect(soldierHp(simulation, id)).toBe(117);
    expect(savedSoldier(simulation, id).recoverySeconds).toBeCloseTo(40, 6);
  });

  it("matches continuous and split/reloaded recovery", () => {
    const continuous = fixture(), split = fixture();
    const continuousId = recruit(continuous.simulation);
    const splitId = recruit(split.simulation);
    setRecovery(continuous.simulation, continuousId, 115, 40);
    setRecovery(split.simulation, splitId, 115, 40);
    continuous.advance(120);
    split.advance(60);
    expect(split.simulation.loadState(split.simulation.saveState())).toEqual({ ok: true });
    split.advance(60);
    expect(soldierHp(continuous.simulation, continuousId)).toBe(soldierHp(split.simulation, splitId));
    expect(savedSoldier(continuous.simulation, continuousId).recoverySeconds)
      .toBe(savedSoldier(split.simulation, splitId).recoverySeconds);
  });

  it("rejects an invalid saved partial minute", () => {
    const { simulation } = fixture();
    const id = recruit(simulation);
    for (const invalid of [60, -1, Number.NaN]) {
      const save = simulation.saveState();
      save.military!.soldiers.find(soldier => soldier.actor === id)!.recoverySeconds = invalid;
      expect(simulation.loadState(save).ok).toBe(false);
    }
  });

  it("applies recovery in measured fast-forwarded time", () => {
    const { simulation } = fixture();
    const id = recruit(simulation);
    setRecovery(simulation, id, 100, 0);
    simulation.fastForward({ births: 0, recoverySeconds: 60, resources: {} });
    expect(soldierHp(simulation, id)).toBe(101);
    expect(savedSoldier(simulation, id).recoverySeconds).toBeUndefined();
  });

  it("carries a partial resting minute through troop transport", () => {
    const { simulation } = fixture();
    simulation.receiveTroops([{ hp: 100, rank: 0, recoverySeconds: 30, type: "shield" }]);
    const id = simulation.militarySoldiers()[0]!.actor;
    expect(savedSoldier(simulation, id).recoverySeconds).toBe(30);
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
    expect(savedSoldier(simulation, id).recoverySeconds).toBe(30);
  });

  it("does not treat a damaged door as an active fight", () => {
    const damagedDoor = { doors: [{ building: 5, hp: 40, maximum: 200 }] } as unknown as
      Parameters<typeof savedMilitaryCombatBuildings>[0];
    expect(savedMilitaryCombatBuildings(damagedDoor).has(5)).toBe(false);
    expect(savedMilitaryCombatBuildings({ exchanges: [{ building: 5 }] }).has(5)).toBe(true);
    expect(savedMilitaryCombatBuildings({ arrows: [{ building: 5 }] }).has(5)).toBe(true);
    expect(savedMilitaryCombatBuildings({ arrows: [{ wall: 5 }] }).has(5)).toBe(true);
    const damaged = soldierOf({ building: 5, recoverySeconds: 30, stationed: true });
    const save = { actors: [actorOf({ building: 5, phase: "garrison" })],
      buildings: [buildingOf({ typeId: 1 })], military: { soldiers: [damaged],
        combat: { doors: [{ building: 5, hp: 40, maximum: 200 }] } } } as unknown as
      Parameters<typeof advanceSavedMilitaryRecovery>[0];
    expect(advanceSavedMilitaryRecovery(save, 30)).toBe(1);
    expect(damaged.combat!.hp).toBe(101);
    expect(damaged.recoverySeconds).toBeUndefined();
    const contested = soldierOf({ building: 5, recoverySeconds: 30, stationed: true });
    const fighting = { ...save, military: { soldiers: [contested], combat: { exchanges: [{ building: 5 }] } } } as
      unknown as Parameters<typeof advanceSavedMilitaryRecovery>[0];
    expect(advanceSavedMilitaryRecovery(fighting, 30)).toBe(0);
    expect(contested.combat!.hp).toBe(100);
    expect(contested.recoverySeconds).toBe(30);
  });

  it("native recovery continues after an old door hit when no fight is active", () => {
    const { advance, place, simulation } = fixture();
    const id = recruit(simulation);
    const barracks = place(1, 19, 27);
    simulation.setMilitaryTarget(barracks.uid, 1);
    stationAt(simulation, id, barracks.uid);
    const save = simulation.saveState();
    save.military!.combat!.doors.push({ building: barracks.uid, faction: 0, hp: 40, maximum: 200 });
    const soldier = save.military!.soldiers.find(entry => entry.actor === id)!;
    soldier.combat!.hp = 100; soldier.recoverySeconds = 0;
    expect(simulation.loadState(save)).toEqual({ ok: true });
    advance(60);
    expect(soldierHp(simulation, id)).toBe(101);
    expect(savedSoldier(simulation, id).recoverySeconds).toBeUndefined();
  });

  it("credits a long saved recovery interval at whole minutes", () => {
    const { simulation } = fixture();
    const id = recruit(simulation);
    const save = simulation.saveState();
    save.military!.soldiers.find(soldier => soldier.actor === id)!.combat!.hp = 25;
    const expected = militaryHealth("shield", 0);
    expect(advanceSavedMilitaryRecovery(save, 6_000)).toBe(expected - 25);
    expect(save.military!.soldiers.find(soldier => soldier.actor === id)!.combat!.hp).toBe(expected);
    expect(save.military!.soldiers.find(soldier => soldier.actor === id)!.recoverySeconds).toBeUndefined();
  });
});
