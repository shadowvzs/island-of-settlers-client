import { describe, expect, it, vi } from "vitest";

import {
  armedOrderTone, type ArmyTarget, type ArmyTargetBuilding, armyTargetCursor, type ArmyTargetPicks, armyTargetTone,
  classifyArmyTargetBuilding, groupCentre, queuedArmyStep, refusedSiegeArchers, resolveArmyTarget, routeRightTap,
  selectedQueueRoutes, splitRiders
} from "../src/app/settlement/army-target/helpers";
import { createSmartArmyOrder } from "../src/app/settlement/army-target/smart-order";
import { createMilitaryOrderDispatch } from "../src/app/settlement/military-order-dispatch";
import type { MilitarySelection } from "../src/app/settlement/military-selection";
import type { MilitaryTroopType } from "../src/shared/settlement/military-combat-rules";
import type { SettlementSimulation } from "../src/shared/settlement/settlement-simulation";

const ground = { x: 10, z: 12 };
const access = { x: 4, z: 5 };
const building = (kind: ArmyTargetBuilding["kind"], uid = 7): ArmyTargetBuilding => ({ access, kind, uid });
const enemy = { uid: 99, x: 3, z: 4 };

describe("smart right-click resolution (military controls §6)", () => {
  it.each<[string, ArmyTargetPicks, ArmyTarget]>([
    ["click on an enemy body", { building: building("hostile"), enemy, enemyBody: enemy, ground },
      { kind: "targetUnit", point: { x: 3, z: 4 }, targetUid: 99 }],
    ["click near an enemy", { building: building("hostile"), enemy, ground },
      { kind: "attackUnit", point: { x: 3, z: 4 }, targetUid: 99 }],
    ["enemy building", { building: building("hostile"), ground, ownShip: { id: "s1" } },
      { building: building("hostile"), kind: "siege" }],
    ["own ship", { building: building("storage"), ground, ownShip: { id: "s1" } }, { kind: "board", shipId: "s1" }],
    ["own ship the selection cannot board", { ground, ownShip: { id: "s1", refusal: "The ship is under way" } },
      { kind: "boardRefused", reason: "The ship is under way", shipId: "s1" }],
    ["own soldier", { ground, ownSoldier: true }, { kind: "ownSoldier", point: ground }],
    ["own soldier beside an enemy", { enemy, ground, ownSoldier: true },
      { kind: "attackUnit", point: { x: 3, z: 4 }, targetUid: 99 }],
    ["own military building", { building: building("military"), ground },
      { building: building("military"), kind: "garrison" }],
    ["own storage", { building: building("storage"), ground }, { building: building("storage"), kind: "store" }],
    ["other own building", { building: building("other"), ground }, { building: building("other"), kind: "gather" }],
    ["ground", { ground }, { kind: "ground", mode: "attackMove", point: ground }],
    ["nothing reachable", { ground: null }, { kind: "noGround" }]
  ])("%s", (_name, picks, expected) => {
    expect(resolveArmyTarget(picks)).toEqual(expected);
  });

  it("Ctrl retreats and Alt moves to the ground point, whatever lies there", () => {
    const picks = { building: building("hostile"), enemy, ground };
    expect(resolveArmyTarget(picks, { ctrlKey: true })).toEqual({ kind: "ground", mode: "retreat", point: ground });
    expect(resolveArmyTarget(picks, { altKey: true })).toEqual({ kind: "ground", mode: "move", point: ground });
    expect(resolveArmyTarget({ ground: null }, { altKey: true })).toEqual({ kind: "noGround" });
  });

  it("lets an armed rail or hotkey order take the tap, and ignores taps without soldiers", () => {
    expect(routeRightTap("retreat", 3)).toBe("armed");
    expect(routeRightTap("rally", 0)).toBe("armed");
    expect(routeRightTap(null, 2)).toBe("smart");
    expect(routeRightTap(null, 0)).toBe("none");
  });

  it("classifies buildings by owner, completion and catalogue role", () => {
    const tables = {
      garrisonCapacity: (typeId: number) => (typeId === 1 ? 6 : 0), isStorage: (typeId: number) => typeId === 29
    };
    expect(classifyArmyTargetBuilding({ construction: 1, militaryFaction: 1, typeId: 1 }, tables)).toBe("hostile");
    expect(classifyArmyTargetBuilding({ construction: 1, typeId: 1 }, tables)).toBe("military");
    expect(classifyArmyTargetBuilding({ construction: .5, typeId: 1 }, tables)).toBe("other");
    expect(classifyArmyTargetBuilding({ construction: 1, typeId: 29 }, tables)).toBe("storage");
    expect(classifyArmyTargetBuilding({ construction: 1, militaryFaction: 0, typeId: 3 }, tables)).toBe("other");
  });

  it("gives each order its marker tone", () => {
    expect(armyTargetTone({ kind: "ground", mode: "retreat", point: ground })).toBe("retreat");
    expect(armyTargetTone({ kind: "ground", mode: "move", point: ground })).toBe("move");
    expect(armyTargetTone({ building: building("military"), kind: "garrison" })).toBe("station");
    expect(armyTargetTone({ building: building("hostile"), kind: "siege" })).toBe("attack");
    expect(armedOrderTone("enter", true)).toBe("station");
    expect(armedOrderTone("move", false)).toBe("refused");
  });

  it("maps each target to its cursor-art mode", () => {
    expect([
      armyTargetCursor({ building: building("hostile"), kind: "siege" }),
      armyTargetCursor({ kind: "board", shipId: "s1" }),
      armyTargetCursor({ building: building("storage"), kind: "store" }),
      armyTargetCursor({ building: building("military"), kind: "garrison" }),
      armyTargetCursor({ building: building("other"), kind: "gather" }),
      armyTargetCursor({ kind: "attackUnit", point: ground, targetUid: 1 }),
      armyTargetCursor({ kind: "targetUnit", point: ground, targetUid: 1 }),
      armyTargetCursor({ kind: "ground", mode: "move", point: ground }),
      armyTargetCursor({ kind: "noGround" }),
      armyTargetCursor({ kind: "boardRefused", reason: "The ship is full", shipId: "s1" }),
      armyTargetCursor({ kind: "ownSoldier", point: ground })
    ]).toEqual(["siege", "board", "store", "enter", "attack", "attack", "target", "move", "invalid", "invalid", null]);
  });

  it("splits riders from infantry and finds the archers a siege refused", () => {
    const types: Record<number, MilitaryTroopType> = { 1: "shield", 2: "cavalry", 3: "archer", 4: "archer" };
    expect(splitRiders([1, 2, 3], id => types[id])).toEqual({ infantry: [1, 3], riders: [2] });
    const sieges: Record<number, number | undefined> = { 1: 7, 2: 7, 3: undefined, 4: 7 };
    expect(refusedSiegeArchers([1, 2, 3, 4], id => ({ siege: sieges[id], type: types[id] }), 7)).toEqual([3]);
  });
});

interface FakeSoldier {
  actor: number;
  building: number;
  combat: { faction: number; siege?: number; type: MilitaryTroopType };
}

const fakeSimulation = (soldiers: FakeSoldier[], overrides: Partial<Record<string, unknown>> = {}) => {
  const simulation = {
    buildings: () => [{ access, typeId: 1, uid: 7 }, { access, typeId: 29, uid: 8 }],
    commandMilitary: vi.fn(() => true),
    garrisonMilitary: vi.fn((ids: readonly number[]) => ids.length),
    militarySoldiers: () => soldiers,
    returnMilitaryHome: vi.fn(() => true),
    saveState: () => ({}),
    siegeMilitary: vi.fn(() => true),
    storyLockedSoldiers: () => [],
    ...overrides
  };
  return simulation as typeof simulation & SettlementSimulation;
};

const soldier = (actor: number, type: MilitaryTroopType, siege?: number): FakeSoldier =>
  ({ actor, building: -1, combat: { faction: 0, siege, type } });

describe("smart order execution with existing recorded commands", () => {
  it("garrisons infantry and sends riders to wait at the door", () => {
    const simulation = fakeSimulation([soldier(1, "shield"), soldier(2, "cavalry"), soldier(3, "heavy")]);
    const order = createSmartArmyOrder({ simulation });
    const result = order({ building: building("military"), kind: "garrison" }, [1, 2, 3]);
    expect(simulation.garrisonMilitary).toHaveBeenCalledWith([1, 3], 7);
    expect(simulation.commandMilitary).toHaveBeenCalledWith([2], access, "attackMove");
    expect(result).toEqual({
      accepted: true, text: "2 soldiers entering; riders wait outside (riders cannot garrison)."
    });
  });

  it("reports a full garrison and only riders", () => {
    const assigned = Array.from({ length: 60 }, (_, index) => ({ ...soldier(100 + index, "shield"), building: 7 }));
    const full = fakeSimulation([soldier(1, "shield"), ...assigned], { garrisonMilitary: vi.fn(() => 0) });
    const order = createSmartArmyOrder({ simulation: full });
    expect(order({ building: building("military"), kind: "garrison" }, [1]))
      .toEqual({ accepted: false, text: "That building has no room for infantry." });
    const riders = fakeSimulation([soldier(2, "cavalry")]);
    expect(createSmartArmyOrder({ simulation: riders })({ building: building("military"), kind: "garrison" }, [2]))
      .toEqual({ accepted: true, text: "Riders cannot garrison; they wait outside the building." });
    expect(riders.garrisonMilitary).not.toHaveBeenCalled();
  });

  it("besieges with foot soldiers and moves refused archers up to shoot", () => {
    const simulation = fakeSimulation([soldier(1, "shield", 7), soldier(3, "archer"), soldier(4, "archer")]);
    const order = createSmartArmyOrder({ simulation });
    const result = order({ building: building("hostile"), kind: "siege" }, [1, 3, 4]);
    expect(simulation.siegeMilitary).toHaveBeenCalledWith([1, 3, 4], 7);
    expect(simulation.commandMilitary).toHaveBeenCalledWith([3, 4], access, "attackMove");
    expect(result.text).toBe("Soldiers besiege the building; 2 archers move up to shoot the defenders.");
    const archersOnly = fakeSimulation([soldier(3, "archer")], { siegeMilitary: vi.fn(() => false) });
    expect(createSmartArmyOrder({ simulation: archersOnly })({ building: building("hostile"), kind: "siege" }, [3]))
      .toEqual({
        accepted: true, text: "Archers cannot storm the door; they move up to shoot the defenders until it falls."
      });
  });

  it("stores at the clicked storehouse, gathers at other buildings and leaves boarding for later", () => {
    const simulation = fakeSimulation([soldier(1, "shield")]);
    const order = createSmartArmyOrder({ simulation });
    expect(order({ building: building("storage", 8), kind: "store" }, [1]).accepted).toBe(true);
    expect(simulation.returnMilitaryHome).toHaveBeenCalledWith([1], 8);
    expect(order({ building: building("other"), kind: "gather" }, [1]).text).toBe("Soldiers gather at the building.");
    expect(order({ kind: "ground", mode: "retreat", point: ground }, [1]).text)
      .toBe("Retreat: soldiers ignore enemies on the way.");
    expect(simulation.commandMilitary).toHaveBeenLastCalledWith([1], ground, "retreat");
  });

  it("boards an own ship through embarkMilitary and reports who waits at the pier", () => {
    const embarkMilitary = vi.fn(() => ({ boarding: [1, 2], ok: true, waiting: [3] }));
    const simulation = fakeSimulation([soldier(1, "shield")], { embarkMilitary, islandRole: () => "home" });
    const order = createSmartArmyOrder({ simulation });
    expect(order({ kind: "board", shipId: "12" }, [1, 2, 3])).toEqual({
      accepted: true, text: "2 soldiers boarding, 1 waits at the pier (ship full)."
    });
    expect(embarkMilitary).toHaveBeenCalledWith([1, 2, 3], 12);
    embarkMilitary.mockReturnValueOnce({ boarding: [1], ok: true, waiting: [] });
    expect(order({ kind: "board", shipId: "12" }, [1]).text).toBe("1 soldier boarding.");
    const colony = fakeSimulation([soldier(1, "shield")], { embarkMilitary, islandRole: () => "colony" });
    expect(createSmartArmyOrder({ simulation: colony })({ kind: "board", shipId: "12" }, [1, 2, 3]).text)
      .toBe("A troop ship is called for 2 soldiers; 1 waits at the harbour (ship full).");
  });

  it("shows the simulation's boarding refusal and attack-moves over an own soldier", () => {
    const embarkMilitary = vi.fn(() => ({ ok: false, reason: "The ship is under way" }));
    const simulation = fakeSimulation([soldier(1, "shield")], { embarkMilitary });
    const order = createSmartArmyOrder({ simulation });
    expect(order({ kind: "board", shipId: "12" }, [1])).toEqual({ accepted: false, text: "The ship is under way" });
    expect(order({ kind: "boardRefused", reason: "The ship is full", shipId: "12" }, [1]))
      .toEqual({ accepted: false, text: "The ship is full" });
    expect(order({ kind: "ownSoldier", point: ground }, [1]).accepted).toBe(true);
    expect(simulation.commandMilitary).toHaveBeenLastCalledWith([1], ground, "attackMove");
  });

  it("chases a clicked enemy body; a target it cannot lock onto still gets the attack-move", () => {
    const targetMilitary = vi.fn(() => ({ chasing: 1, ok: true }));
    const simulation = fakeSimulation([soldier(1, "shield")], { targetMilitary });
    const order = createSmartArmyOrder({ simulation });
    const target: ArmyTarget = { kind: "targetUnit", point: { x: 3, z: 4 }, targetUid: 99 };
    expect(order(target, [1])).toEqual({ accepted: true, text: "Soldiers chase the targeted enemy." });
    expect(targetMilitary).toHaveBeenCalledWith([1], 99);
    expect(simulation.commandMilitary).not.toHaveBeenCalled();
    targetMilitary.mockReturnValueOnce({ ok: false, reason: "targetUnreachable" } as never);
    expect(order(target, [1])).toEqual({ accepted: true, text: "Soldiers attack the enemy." });
    expect(simulation.commandMilitary).toHaveBeenLastCalledWith([1], { x: 3, z: 4 }, "attackMove");
    const stuck = fakeSimulation([soldier(1, "shield")], {
      commandMilitary: vi.fn(() => false), targetMilitary: vi.fn(() => ({ ok: false, reason: "targetHidden" }))
    });
    expect(createSmartArmyOrder({ simulation: stuck })(target, [1]))
      .toEqual({ accepted: false, text: "That enemy is out of sight." });
  });

  it("explains a refusal: story-locked soldiers, unreachable storehouse, unreachable ground", () => {
    const locked = fakeSimulation([soldier(1, "shield")], {
      commandMilitary: vi.fn(() => false), returnMilitaryHome: vi.fn(() => false), storyLockedSoldiers: () => [1]
    });
    const order = createSmartArmyOrder({ simulation: locked });
    expect(order({ kind: "attackUnit", point: ground, targetUid: 9 }, [1]).text).toBe("Busy with a story task.");
    expect(order({ building: building("storage", 8), kind: "store" }, [1]).text).toBe("Busy with a story task.");
    const blocked = fakeSimulation([soldier(1, "shield")], {
      commandMilitary: vi.fn(() => false), returnMilitaryHome: vi.fn(() => false)
    });
    const refuse = createSmartArmyOrder({ simulation: blocked });
    expect(refuse({ building: building("storage", 8), kind: "store" }, [1]).text)
      .toBe("No soldier of this selection can reach that storehouse.");
    expect(refuse({ kind: "ground", mode: "attackMove", point: ground }, [1]).text)
      .toBe("No eligible troops can reach that target.");
    expect(refuse({ kind: "noGround" }, [1])).toEqual({ accepted: false, text: "Choose reachable land." });
  });
});

describe("Shift queue: steps, execution and waypoint routes", () => {
  it("queues ground, target, building and ship orders", () => {
    expect(queuedArmyStep({ kind: "ground", mode: "retreat", point: ground }))
      .toEqual({ kind: "ground", mode: "retreat", x: 10, z: 12 });
    expect(queuedArmyStep({ kind: "targetUnit", point: { x: 3, z: 4 }, targetUid: 99 }))
      .toEqual({ kind: "target", uid: 99, x: 3, z: 4 });
    expect(queuedArmyStep({ kind: "attackUnit", point: { x: 3, z: 4 }, targetUid: 99 }))
      .toEqual({ kind: "ground", mode: "attackMove", x: 3, z: 4 });
    expect(queuedArmyStep({ kind: "ownSoldier", point: ground }))
      .toEqual({ kind: "ground", mode: "attackMove", x: 10, z: 12 });
    for (const kind of ["siege", "garrison", "store"] as const)
      expect(queuedArmyStep({ building: building("hostile"), kind }))
        .toEqual({ kind, building: 7, x: 4, z: 5 });
    expect(queuedArmyStep({ building: building("hostile"), kind: "gather" })).toBeNull();
    expect(queuedArmyStep({ kind: "board", point: { x: 8, z: 9 }, shipId: "1" }))
      .toEqual({ kind: "board", ship: 1, x: 8, z: 9 });
    // Shift does not change what the click resolves to.
    expect(resolveArmyTarget({ enemyBody: enemy, ground }, { shiftKey: true }).kind).toBe("targetUnit");
  });

  it("sends Shift orders through queueMilitaryOrder and words the result", () => {
    const queueMilitaryOrder = vi.fn(() => ({ immediate: false, ok: true, waiting: 2 }));
    const simulation = fakeSimulation([soldier(1, "shield")], { queueMilitaryOrder });
    const order = createSmartArmyOrder({ simulation });
    expect(order({ kind: "ground", mode: "move", point: ground }, [1], true))
      .toEqual({ accepted: true, text: "Order queued: 2 orders wait after the current one." });
    expect(queueMilitaryOrder).toHaveBeenCalledWith([1], { kind: "ground", mode: "move", x: 10, z: 12 });
    expect(simulation.commandMilitary).not.toHaveBeenCalled();
    queueMilitaryOrder.mockReturnValueOnce({ immediate: true, ok: true, waiting: 0 });
    expect(order({ kind: "targetUnit", point: { x: 3, z: 4 }, targetUid: 99 }, [1], true).text)
      .toBe("Soldiers chase the targeted enemy.");
    queueMilitaryOrder.mockReturnValueOnce({ ok: false, reason: "queueFull" } as never);
    expect(order({ kind: "ground", mode: "move", point: ground }, [1], true))
      .toEqual({ accepted: false, text: "This group's order queue is full." });
    queueMilitaryOrder.mockReturnValueOnce({ ok: false, reason: "targetHidden" } as never);
    expect(order({ kind: "targetUnit", point: ground, targetUid: 99 }, [1], true).text)
      .toBe("That enemy is out of sight.");
    expect(order({ building: building("hostile"), kind: "siege" }, [1], true))
      .toEqual({ accepted: true, text: "Order queued: 2 orders wait after the current one." });
    expect(queueMilitaryOrder).toHaveBeenCalledWith([1], { kind: "siege", building: 7, x: 4, z: 5 });
    expect(simulation.siegeMilitary).not.toHaveBeenCalled();
    expect(order({ kind: "noGround" }, [1], true)).toEqual({ accepted: false, text: "Choose reachable land." });
  });

  it("draws only the selected groups' queues, toned per order, from the group's centre", () => {
    const views = [
      { id: 1, members: [1, 2], steps: [{ kind: "ground" as const, mode: "retreat" as const, x: 1, z: 2 },
        { kind: "target" as const, x: 3, z: 4 }] },
      { id: 2, members: [5], steps: [{ kind: "ground" as const, mode: "move" as const, x: 9, z: 9 }] }
    ];
    expect(selectedQueueRoutes(views, new Set([2, 7]))).toEqual([{ members: [1, 2],
      steps: [{ tone: "retreat", x: 1, z: 2 }, { tone: "attack", x: 3, z: 4 }] }]);
    expect(selectedQueueRoutes(views, new Set())).toEqual([]);
    expect(groupCentre([{ x: 0, z: 0 }, { x: 4, z: 2 }])).toEqual({ x: 2, z: 1 });
    expect(groupCentre([])).toBeUndefined();
  });
});

describe("armed orders aim at the picked building (renderer frame id `settlement-<uid>`)", () => {
  const fort = { depth: 2, uid: 7, width: 2, x: 20, z: 30 };
  const dispatchFor = (picked: string | null) => {
    const simulation = {
      buildings: () => [fort],
      callOutMilitary: vi.fn(() => 3),
      commandMilitary: vi.fn(() => true),
      garrisonMilitary: vi.fn(() => 2),
      militaryDoors: () => [],
      militaryRally: () => ({ building: 7 }),
      plantMilitaryRally: vi.fn(() => true),
      saveState: () => ({}),
      storyLockedSoldiers: () => []
    };
    const dispatch = createMilitaryOrderDispatch({
      message: vi.fn(), pick: () => ({ x: 26, z: 36 }), pickBuilding: () => picked, rallyTypes: () => ["shield"],
      selection: { ids: () => [1, 2] } as unknown as MilitarySelection,
      simulation: simulation as unknown as SettlementSimulation
    });
    return { dispatch, simulation };
  };

  it("enters and rallies at the clicked building's centre, not at the ground behind its roof", () => {
    const { dispatch, simulation } = dispatchFor("settlement-7");
    expect(dispatch.dispatch("enter", 5, 5)).toBe(true);
    expect(simulation.garrisonMilitary).toHaveBeenCalledWith([1, 2], 7);
    dispatch.dispatch("rally", 5, 5);
    expect(simulation.plantMilitaryRally).toHaveBeenCalledWith({ x: 20, z: 30 });
    dispatch.dispatch("attack", 5, 5);
    expect(simulation.commandMilitary).toHaveBeenLastCalledWith([1, 2], { x: 20, z: 30 }, "attackMove");
  });

  it("keeps the ground point for moves, for a bare uid and when no building was picked", () => {
    const { dispatch, simulation } = dispatchFor("settlement-7");
    dispatch.dispatch("move", 5, 5);
    expect(simulation.commandMilitary).toHaveBeenLastCalledWith([1, 2], { x: 26, z: 36 }, "move");
    for (const picked of ["7", null]) {
      const other = dispatchFor(picked);
      expect(other.dispatch.dispatch("enter", 5, 5)).toBe(false);
      other.dispatch.dispatch("rally", 5, 5);
      expect(other.simulation.plantMilitaryRally).toHaveBeenCalledWith({ x: 26, z: 36 });
    }
  });
});
