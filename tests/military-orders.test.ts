import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { militaryHealth } from "../src/shared/settlement/military-combat-rules";
import { SELECTABLE_MILITARY_PHASES } from "../src/shared/settlement/military-orders";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const ALL_TYPES = ["shield", "heavy", "archer"] as const;

const fixture = (size = 72) => {
  const world = {
    seed: 31,
    cellsX: size,
    cellsZ: size,
    seaLevel: -1,
    start: { x: 6.5, z: 6.5 },
    heights: new Float32Array((size + 1) ** 2),
    blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10),
    buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(size ** 2),
    mineZone: new Uint16Array(size ** 2),
    mineZones: [],
    props: {
      count: 0,
      types: new Uint8Array(),
      x: new Float32Array(),
      z: new Float32Array(),
      scale: new Float32Array()
    }
  } as unknown as WorldData;
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, {
    isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false
  });
  simulation = createSettlementSimulation({
    world,
    roads,
    initialSettlers: 20,
    initialStock: { sword: 4, shield: 4, beer: 4, bow: 4, axe: 4, planks: 80, stone: 80 },
    canWorkerEnterPlot: () => true,
    // These regressions are about the player's orders; scripted computer sides keep their orders.
    withoutMilitaryCommander: true
  });
  const advance = (seconds: number) => {
    for (let tick = 0; tick < seconds * 20; tick++) simulation.update(0.05);
  };
  const body = (id: number) => simulation.frames().find((actor) => actor.uid === id);
  const place = (type: number, x: number, z: number) => {
    const [width, depth] = getBuildingDefinition(type).gridFootprint;
    const result = simulation.placeBuilding(
      type,
      Math.floor(x) + (width % 2) / 2,
      Math.floor(z) + (depth % 2) / 2
    );
    if (!result.ok || !result.building) throw new Error(result.reason);
    Object.assign(result.building, { construction: 1, required: {} });
    return result.building;
  };
  /** A mine face / rock outcrop: cells no one can stand on. */
  const blockArea = (x0: number, z0: number, x1: number, z1: number) => {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) world.walkCost[z * size + x] = 0;
  };
  return { advance, blockArea, body, place, roads, simulation, world };
};

describe("military orders (returning defenders regression, owner bug 2026-10-13)", () => {
  it("keeps HQ defenders selectable and commandable, also while they walk back inside", () => {
    const { advance, body, simulation } = fixture();
    expect(simulation.startMilitaryTrainingEncounter().ok).toBe(true);
    const hq = simulation.headquarters;
    const raiders = [0, 1].map((offset) =>
      simulation.spawnDebugEnemy({ x: hq.x + 10 + offset, z: hq.z + 10 }, { rank: 0, type: "shield" })!.id
    );
    expect(simulation.callOutMilitary(["heavy"], { x: hq.x + 10, z: hq.z + 10 })).toBeGreaterThan(0);
    for (let second = 0; second < 60 && raiders.some((id) => body(id)); second++) advance(1);
    expect(raiders.every((id) => body(id) === undefined)).toBe(true);
    const defenders = simulation
      .militarySoldiers()
      .filter((soldier) => soldier.combat?.faction === 0 && body(soldier.actor)?.phase === "militaryField")
      .map((soldier) => soldier.actor);
    expect(simulation.returnMilitaryHome(defenders)).toBe(true);
    advance(1);
    const returning = defenders.find((id) =>
      body(id)?.visible && ["retire", "militaryMountedReturn"].includes(body(id)!.phase)
    );
    expect(returning).toBeDefined();
    expect(SELECTABLE_MILITARY_PHASES).toContain(body(returning!)!.phase);
    expect(simulation.commandMilitary([returning!], { x: hq.x + 10, z: hq.z + 10 }, "move")).toBe(
      true
    );
    expect(["militaryField", "militaryLeaving"]).toContain(body(returning!)!.phase);
    advance(3);
    expect(body(returning!)?.phase).toBe("militaryField");
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
  });

  it("calls troops onto enemies standing beside rocks: the order ends on the nearest open ground", () => {
    const { advance, blockArea, body, simulation } = fixture();
    blockArea(30, 30, 34, 34);
    expect(simulation.startMilitaryTrainingEncounter().ok).toBe(true);
    const rider = simulation.spawnMilitaryOpponent({ x: 37.5, z: 32.5 }, "cavalry")!;
    expect(rider).not.toBeNull();
    // The click lands on the rock face behind the rider.
    expect(simulation.callOutMilitary([...ALL_TYPES], { x: 32.5, z: 32.5 })).toBeGreaterThan(0);
    const banner = simulation.militaryRally()!;
    expect(Math.hypot(banner.x - 32.5, banner.z - 32.5)).toBeLessThan(3.5);
    for (let second = 0; second < 240 && body(rider); second++) advance(1);
    expect(body(rider)).toBeUndefined();
  });

  it("gathers stored and outside troops alike, leaving garrisons in their buildings", () => {
    const { advance, body, place, roads, simulation } = fixture();
    const barracks = place(1, 15, 12);
    roads.addRoad(simulation.headquarters.access, barracks.access);
    for (let index = 0; index < 2; index++)
      simulation.recruitStoredMilitary(simulation.headquarters.uid, "shield");
    advance(120);
    const stationed = simulation
      .militarySoldiers()
      .filter((soldier) => soldier.stationed)
      .map((soldier) => soldier.actor);
    expect(stationed.length).toBeGreaterThan(0);
    // The gathering point lies away from the training camp (east of the HQ) so no guard steps out.
    simulation.startMilitaryTrainingEncounter();
    expect(simulation.callOutMilitary(["shield"], { x: 10, z: 40 })).toBe(20);
    advance(40);
    expect(simulation.militaryFreeTroops().map((entry) => entry.count)).toEqual([20, 20, 20, 0]);
    expect(simulation.callOutMilitary([...ALL_TYPES], { x: 45, z: 20 })).toBe(60);
    expect(stationed.every((id) => body(id)?.phase === "garrison")).toBe(true);
  });

  it("keeps the rally banner across saves, sends landings to it and sieges the enemy building it marks", () => {
    const { advance, body, place, simulation } = fixture(48);
    expect(simulation.callOutMilitary(["shield"], { x: 30, z: 30 })).toBe(0);
    expect(simulation.militaryRally()).toEqual({ x: 30, z: 30 });
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
    expect(simulation.militaryRally()).toEqual({ x: 30, z: 30 });
    simulation.receiveTroops(
      Array.from({ length: 3 }, () => ({
        hp: militaryHealth("shield", 0),
        rank: 0,
        type: "shield" as const
      }))
    );
    const landed = simulation.militarySoldiers().map((soldier) => soldier.actor);
    expect(landed.every((id) => body(id)?.phase === "militaryLeaving")).toBe(true);
    advance(40);
    expect(landed.every((id) => Math.hypot(body(id)!.x - 30, body(id)!.z - 30) < 3)).toBe(true);
    const fort = place(2, 25.5, 16.5);
    const guard = simulation.spawnMilitaryOpponent({ x: 31, z: 27 }, "shield")!;
    expect(simulation.registerMilitaryGarrison(fort.uid, [guard], 1)).toBe(true);
    expect(simulation.callOutMilitary(["shield"], { x: fort.x, z: fort.z })).toBe(3);
    expect(simulation.militaryRally()).toEqual({
      x: fort.access.x,
      z: fort.access.z,
      building: fort.uid
    });
    expect(
      simulation.militarySoldiers().filter((soldier) => soldier.combat?.siege === fort.uid)
    ).toHaveLength(3);
    expect(simulation.removeMilitaryScenarioBuilding(fort.uid).ok).toBe(true);
    advance(0.1);
    expect(simulation.militaryRally()).toBeUndefined();
  });

  it("rejects a malformed rally banner in a save", () => {
    const { simulation } = fixture(48);
    simulation.callOutMilitary(["shield"], { x: 30, z: 30 });
    const broken = simulation.saveState();
    broken.military!.rally = { x: Number.NaN, z: 3 };
    expect(simulation.loadState(broken).ok).toBe(false);
  });
});

it("cancels a rally banner and keeps it absent after save/load", () => {
  const { simulation } = fixture();
  expect(simulation.plantMilitaryRally({ x: 15, z: 15 })).toBe(true);
  expect(simulation.militaryRally()).toBeDefined();
  simulation.cancelMilitaryRally();
  expect(simulation.militaryRally()).toBeUndefined();
  expect(simulation.loadState(structuredClone(simulation.saveState()))).toEqual({ ok: true });
  expect(simulation.militaryRally()).toBeUndefined();
});

it("releases surviving doorway attackers after rally capture and keeps the capturer stationed", () => {
  const { advance, body, place, simulation } = fixture(48);
  const fort = place(2, 25.5, 16.5);
  const defender = simulation.spawnMilitaryOpponent({ x: 28, z: 19 }, "shield")!;
  expect(simulation.registerMilitaryGarrison(fort.uid, [defender], 1)).toBe(true);
  const setup = simulation.saveState();
  setup.military!.soldiers.find((soldier) => soldier.actor === defender)!.combat!.hp = 2;
  expect(simulation.loadState(setup).ok).toBe(true);
  simulation.receiveTroops(
    Array.from({ length: 6 }, () => ({
      hp: militaryHealth("shield", 2),
      rank: 2,
      type: "shield" as const
    }))
  );
  expect(simulation.callOutMilitary(["shield"], { x: fort.x, z: fort.z })).toBe(6);
  const owned = () =>
    simulation.buildings().find((site) => site.uid === fort.uid)?.militaryFaction === 0;
  for (let tick = 0; tick < 4800 && !owned(); tick++) simulation.update(0.05);
  expect(owned()).toBe(true);
  const captured = simulation.saveState();
  const survivors = captured.military!.soldiers.filter((soldier) => soldier.combat?.faction === 0);
  const capturer = survivors.find((soldier) => soldier.stationed && soldier.building === fort.uid);
  expect(capturer).toBeDefined();
  expect(survivors.every((soldier) => soldier.combat?.siege === undefined)).toBe(true);
  expect(
    survivors
      .filter((soldier) => !soldier.stationed)
      .every((soldier) => body(soldier.actor)?.phase !== "militarySiege")
  ).toBe(true);
  // Small releases can route immediately; larger releases use the bounded saved queue.
  // Both must survive reload and leave no attacker assigned to the captured doorway.
  const survivorIds = new Set(survivors.map((soldier) => soldier.actor));
  for (const pending of captured.military!.combat!.pendingMarches ?? []) {
    expect(survivorIds.has(pending.uid)).toBe(true);
    expect(pending.uid).not.toBe(capturer!.actor);
  }
  expect(simulation.loadState(captured)).toEqual({ ok: true });
  advance(90);
  expect(body(capturer!.actor)?.phase).toBe("garrison");
  const completed = simulation.saveState();
  expect(completed.military!.combat!.pendingMarches).toHaveLength(0);
  const remaining = completed.military!.soldiers.filter((soldier) =>
    survivorIds.has(soldier.actor)
  );
  expect(remaining).toHaveLength(survivors.length);
  expect(remaining.every((soldier) => soldier.combat?.siege === undefined)).toBe(true);
});

it("the public return command releases only accepted banner members and retains others", () => {
  const { place, simulation } = fixture(48);
  const fort = place(2, 25.5, 16.5);
  const defender = simulation.spawnMilitaryOpponent({ x: 28, z: 19 }, "shield")!;
  expect(simulation.registerMilitaryGarrison(fort.uid, [defender], 1)).toBe(true);
  expect(simulation.plantMilitaryRally({ x: fort.x, z: fort.z })).toBe(true);
  simulation.receiveTroops(
    Array.from({ length: 2 }, () => ({
      hp: militaryHealth("shield", 0),
      rank: 0,
      type: "shield" as const
    }))
  );
  const members = simulation.saveState().military!.rally!.participants!;
  expect(members).toHaveLength(2);
  expect(simulation.returnMilitaryHome([-99999])).toBe(false);
  expect(simulation.saveState().military!.rally!.participants).toEqual(members);
  expect(simulation.returnMilitaryHome([members[0]!, -99999])).toBe(true);
  expect(simulation.saveState().military!.rally!.participants).toEqual([members[1]]);
});
