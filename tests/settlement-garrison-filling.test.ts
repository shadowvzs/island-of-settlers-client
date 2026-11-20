import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { BUILDING_STRUCTURE_HP } from "../src/shared/balance/military";
import { FORT_REMOVAL_SECONDS } from "../src/shared/settlement/fort-assault-rules";
import { catapultLocalStone } from "../src/shared/settlement/military-catapult-resupply";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const session = () => {
  const size = 96;
  const world = {
    seed: 9, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 30, z: 48 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2), mineZones: [],
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(), scale: new Float32Array() }
  } as unknown as WorldData;
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world, roads, initialSettlers: 20,
    initialStock: { planks: 200, stone: 200 }, canWorkerEnterPlot: () => true });
  const advance = (seconds: number) => { for (let tick = 0; tick < seconds * 20; tick++) simulation.update(.05); };
  const tower = (typeId: number) => {
    const [width, depth] = getBuildingDefinition(typeId).gridFootprint;
    const { x, z } = simulation.headquarters;
    const result = simulation.placeBuilding(typeId, x + 14 + width % 2 / 2, z + depth % 2 / 2);
    if (!result.ok || !result.building) throw new Error(result.reason);
    Object.assign(result.building, { construction: 1, foundationProgress: 1, required: {} });
    expect(simulation.connectRoads(simulation.headquarters.access, result.building.access)).toBe(true);
    return result.building;
  };
  const inside = (uid: number) => simulation.militaryBuildings().find(entry => entry.uid === uid)!;
  return { advance, inside, simulation, tower };
};

it("puts archers on the tower posts, melee in the rest, and swaps melee out for a later archer", () => {
  const { advance, inside, simulation, tower } = session();
  simulation.receiveTroops([...Array(6)].map(() => ({ hp: 125, rank: 0, type: "shield" as const })));
  simulation.receiveTroops([{ hp: 56.25, rank: 0, type: "archer" }]);
  const guardhouse = tower(2);
  advance(90);
  expect(inside(guardhouse.uid).stationedTroops).toEqual({ archer: 1, heavy: 0, shield: 2 });
  simulation.receiveTroops([{ hp: 56.25, rank: 0, type: "archer" }]);
  advance(90);
  expect(inside(guardhouse.uid).stationedTroops).toEqual({ archer: 2, heavy: 0, shield: 1 });
});

it("follows manual per-type counts and sends extras back to storage", () => {
  const { advance, inside, simulation, tower } = session();
  simulation.receiveTroops([...Array(4)].map(() => ({ hp: 125, rank: 0, type: "shield" as const })));
  simulation.receiveTroops([...Array(3)].map(() => ({ hp: 56.25, rank: 0, type: "archer" as const })));
  const watchtower = tower(4);
  advance(120);
  expect(inside(watchtower.uid).stationedTroops).toEqual({ archer: 3, heavy: 0, shield: 3 });
  expect(simulation.setMilitaryComposition(watchtower.uid, { archer: 1, heavy: 0, shield: 4 })).toBe(true);
  advance(120);
  expect(inside(watchtower.uid).stationedTroops).toEqual({ archer: 1, heavy: 0, shield: 4 });
  expect(inside(watchtower.uid).manual).toEqual({ archer: 1, heavy: 0, shield: 4 });
  expect(simulation.setMilitaryComposition(watchtower.uid, { archer: 5, heavy: 0, shield: 4 })).toBe(false);
  expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
  expect(inside(watchtower.uid).manual).toEqual({ archer: 1, heavy: 0, shield: 4 });
  expect(simulation.setMilitaryComposition(watchtower.uid, { archer: 0, heavy: 0, shield: 2 })).toBe(true);
  advance(60);
  expect(inside(watchtower.uid).stationedTroops).toEqual({ archer: 0, heavy: 0, shield: 2 });
  expect(simulation.setMilitaryComposition(watchtower.uid, null)).toBe(true);
  expect(inside(watchtower.uid).manual).toBeNull();
});

it("shoots from a tower post at enemies beyond the walls, but not at those under them", () => {
  const { advance, inside, simulation, tower } = session();
  simulation.receiveTroops([{ hp: 56.25, rank: 0, type: "archer" }]);
  const watchtower = tower(4);
  simulation.setMilitaryTarget(watchtower.uid, 1);
  advance(90);
  expect(inside(watchtower.uid).stationedTroops.archer).toBe(1);
  const far = simulation.spawnMilitaryOpponent({ x: watchtower.x, z: watchtower.z - 7 }, "shield");
  expect(far).not.toBeNull();
  advance(3);
  const enemy = () => simulation.militarySoldiers().find(soldier => soldier.actor === far);
  // Hit by tower arrows (or already dead).
  expect(enemy()?.combat?.hp ?? 0).toBeLessThan(125);
  for (let second = 0; second < 90 && (enemy() || simulation.militaryArrows().length); second++) advance(1);
  expect(enemy()).toBeUndefined();
  // An enemy idling under the walls is not shot; it besieges the tower instead (MIL-ASSAULT 2026-11-08).
  const near = simulation.spawnMilitaryOpponent({ x: watchtower.x, z: watchtower.z + 3.2 }, "shield");
  expect(near).not.toBeNull();
  advance(3);
  expect(simulation.militaryArrows()).toHaveLength(0);
  expect(simulation.militarySoldiers().find(soldier => soldier.actor === near)?.combat?.siege).toBe(watchtower.uid);
});

// Owner decision 2026-10-13: a pressed archer backs away while it can and shoots its bow (the
// cornered point-blank shot is covered by tests/military-battle-ai.test.ts).
it("lets a pressed field archer back away and shoot instead of standing idle", () => {
  const { advance, simulation } = session();
  simulation.receiveTroops([{ hp: 56.25, rank: 2, type: "archer" }]);
  const { x, z } = simulation.headquarters;
  expect(simulation.callOutMilitary(["archer"], { x: x + 8, z: z + 8 })).toBe(1);
  advance(30);
  const archer = simulation.militarySoldiers().find(soldier => soldier.combat?.faction === 0)!;
  const body = simulation.frames().find(actor => actor.uid === archer.actor)!;
  const enemy = simulation.spawnMilitaryOpponent({ x: body.x + 1, z: body.z }, "heavy");
  expect(enemy).not.toBeNull();
  let wounded = false;
  for (let second = 0; second < 40 && !wounded; second++) {
    advance(1);
    const foe = simulation.militarySoldiers().find(soldier => soldier.actor === enemy);
    wounded = !foe || foe.combat!.hp < 100;
  }
  expect(body.tool).toBe("bow");
  expect(wounded).toBe(true);
});

it("supplies the Catapult Tower with six stones and stations only shield/heavy troops", () => {
  const { advance, inside, simulation, tower } = session();
  simulation.receiveTroops([{ hp: 150, rank: 0, type: "heavy" },
    { hp: 125, rank: 0, type: "shield" }, { hp: 56.25, rank: 0, type: "archer" }]);
  const catapult = tower(16);
  advance(90);
  expect(inside(catapult.uid).stationedTroops).toEqual({ archer: 0, heavy: 1, shield: 1 });
  // Owner 2026-11-03: six site stones total, roof capacity two; the other four stay on the ground pile.
  for (let tick = 0; tick < 6000 && (catapult.input.stone !== 2 || catapult.catapultSupply?.porter); tick++)
    simulation.update(.05);
  expect(catapult.input.stone).toBe(2);
  expect(catapult.catapultSupply?.ground).toBe(4);
  expect(catapultLocalStone(catapult)).toBe(6);
  expect(catapult.input.coins ?? 0).toBe(0);
  expect(catapult.input.wine ?? 0).toBe(0);
  expect(inside(catapult.uid).catapultStatus).toBe("ready");
  const targetPost = { x: catapult.x + 6, z: catapult.z };
  const enemy = simulation.spawnMilitaryOpponent(targetPost, "shield");
  expect(enemy).not.toBeNull();
  let launched = false;
  for (let tick = 0; tick < 20 * 30; tick++) {
    simulation.commandMilitaryOpponent([enemy!], targetPost, 1, "move");
    simulation.update(.05);
    if (simulation.militaryArrows().some(shot => shot.boulder)) { launched = true; break; }
  }
  expect(launched).toBe(true);
  const shot = simulation.militaryArrows().find(projectile => projectile.boulder)!;
  expect(shot.boulder!.target).toBe(enemy);
  const save = simulation.saveState();
  expect(save.military!.combat!.arrows.some(projectile => projectile.boulder)).toBe(true);
  const inFlight = structuredClone(simulation.militaryArrows());
  save.military!.combat!.arrows.find(projectile => projectile.boulder)!.boulder!.x += 1;
  expect(simulation.militaryArrows()).toEqual(inFlight);
  save.military!.combat!.arrows = inFlight;
  expect(simulation.loadState(structuredClone(save))).toEqual({ ok: true });
  expect(simulation.militaryArrows()).toEqual(inFlight);
  const collapsed = simulation.saveState();
  const structure = collapsed.military!.combat!.doors.find(door => door.building === catapult.uid)!.structure!;
  structure.hp = 0; structure.fallen = FORT_REMOVAL_SECONDS - .1;
  expect(simulation.loadState(collapsed)).toEqual({ ok: true });
  advance(.2);
  expect(simulation.buildings().some(building => building.uid === catapult.uid)).toBe(false);
  expect(simulation.militaryArrows().some(projectile => projectile.boulder)).toBe(true);
});

it("takes the Catapult heavy off the engine for door defense before an earlier shield", () => {
  const { advance, simulation, tower } = session();
  simulation.receiveTroops([{ hp: 125, rank: 0, type: "shield" }, { hp: 100, rank: 0, type: "heavy" }]);
  const catapult = tower(16);
  advance(90);
  const heavy = simulation.militarySoldiers().find(soldier => soldier.building === catapult.uid &&
    soldier.combat?.type === "heavy")!;
  const shield = simulation.militarySoldiers().find(soldier => soldier.building === catapult.uid &&
    soldier.combat?.type === "shield")!;
  expect(shield.actor).toBeLessThan(heavy.actor);
  const enemy = simulation.spawnMilitaryOpponent({ x: catapult.workerApproach.x + .45, z: catapult.workerApproach.z }, "shield");
  expect(enemy).not.toBeNull();
  let defending = false;
  for (let tick = 0; tick < 20 * 15; tick++) {
    simulation.update(.05);
    const guard = simulation.militarySoldiers().find(soldier => soldier.actor === heavy.actor);
    if (guard && !guard.stationed) { defending = true; break; }
  }
  expect(defending).toBe(true);
  expect(simulation.militarySoldiers().find(soldier => soldier.actor === shield.actor)?.stationed).toBe(true);
  expect(catapult.catapultCycle).toBeUndefined();
});


it("stops a ruined home Catapult, evacuates crew, preserves damage on reload and clears its plot", () => {
  const { advance, simulation, tower } = session();
  simulation.receiveTroops([{ hp: 100, rank: 0, type: "heavy" }]);
  const catapult = tower(16); advance(90);
  const saved = simulation.saveState();
  const structure = saved.military!.combat!.doors.find(door => door.building === catapult.uid)!.structure!;
  expect(structure.maximum).toBe(BUILDING_STRUCTURE_HP[16]);
  expect(structure.maximum).toBeGreaterThan(BUILDING_STRUCTURE_HP[2]!);
  expect(structure.maximum).toBeLessThan(BUILDING_STRUCTURE_HP[4]!);
  structure.hp = 0; structure.fallen = 0;
  expect(simulation.loadState(saved)).toEqual({ ok: true });
  advance(.1);
  expect(simulation.militaryBuildings().some(building => building.uid === catapult.uid)).toBe(false);
  expect(simulation.militarySoldiers().some(soldier => soldier.building === catapult.uid)).toBe(false);
  expect(simulation.militaryArrows()).toHaveLength(0);
  expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
  expect(simulation.militaryDoors().find(door => door.building === catapult.uid)!.structure!.hp).toBe(0);
  advance(FORT_REMOVAL_SECONDS + .2);
  expect(simulation.buildings().some(building => building.uid === catapult.uid)).toBe(false);
  expect(simulation.militaryDoors().some(door => door.building === catapult.uid)).toBe(false);
});

it("lets an ordinary adjacent enemy destroy an unguarded Catapult and clear its finite ground-ammo state", () => {
  const { advance, simulation, tower } = session();
  const catapult = tower(16); advance(60);
  expect(catapultLocalStone(catapult)).toBe(6);
  const saved = simulation.saveState();
  const fort = saved.military!.combat!.doors.find(door => door.building === catapult.uid)!.structure!;
  expect(fort.maximum).toBe(27_500);
  // Start from one remaining HP to exercise the real enemy strike/lifecycle rather than a long balance soak.
  fort.hp = 1;
  expect(simulation.loadState(saved)).toEqual({ ok: true });
  let foe: number | null = null;
  for (const offset of [.45, -.45, .9, -.9, 1.4, -1.4]) {
    foe = simulation.spawnMilitaryOpponent({ x: catapult.workerApproach.x + offset, z: catapult.workerApproach.z }, "heavy");
    if (foe !== null) break;
  }
  expect(foe).not.toBeNull();
  let fell = false;
  for (let tick = 0; tick < 1200; tick++) {
    simulation.update(.05);
    if (simulation.militaryDoors().find(door => door.building === catapult.uid)?.structure?.hp === 0) { fell = true; break; }
  }
  expect(fell).toBe(true);
  expect(simulation.militaryBuildings().some(site => site.uid === catapult.uid)).toBe(false);
  expect(simulation.militaryArrows()).toHaveLength(0);
  advance(FORT_REMOVAL_SECONDS + .2);
  expect(simulation.buildings().some(site => site.uid === catapult.uid)).toBe(false);
  const after = simulation.saveState();
  expect(simulation.loadState(after)).toEqual({ ok: true });
});
