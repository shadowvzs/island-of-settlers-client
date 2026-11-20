import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, PROP, type WorldData } from "../src/shared/world/world-data";

const fixture = (size = 64, start = { x: 12.5, z: 12.5 }) => {
  const world = { seed: 9, cellsX: size, cellsZ: size, seaLevel: -1, start,
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2), mineZones: [],
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(), scale: new Float32Array() }
  } as unknown as WorldData;
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world, roads, initialSettlers: 30,
    initialStock: { sword: 6, shield: 6, beer: 6, axe: 6, bow: 6, horse: 2, planks: 50, stone: 50 },
    canWorkerEnterPlot: () => true,
    // Storage/return fixtures isolate transport; scripted computer sides keep their orders.
    withoutMilitaryCommander: true });
  const advance = (seconds: number) => {
    for (let tick = 0; tick < seconds * 20; tick++) simulation.update(.05);
  };
  return { simulation, advance, world, roads };
};

/** Legacy mounted identities for regression tests; ordinary gameplay cannot create these any more. */
const receiveCavalry = (simulation: ReturnType<typeof fixture>["simulation"], count = 20) => {
  simulation.receiveTroops(Array.from({ length: count }, () => ({ hp: 105, rank: 0, type: "cavalry" as const })));
  return simulation.militaryStoredTroops().find(entry => entry.type === "cavalry")!.actors;
};

it("adds the explicit ordinary-troop training encounter once and persists real stored identities", () => {
  const { simulation } = fixture();
  const before = simulation.saveState();
  expect(simulation.militaryTrainingStarted()).toBe(false);
  expect(simulation.startMilitaryTrainingEncounter()).toEqual({ ok: true });
  expect(simulation.militaryStoredTroops().map(entry => entry.count)).toEqual([20, 20, 20, 0]);
  expect(simulation.militarySoldiers().filter(soldier => soldier.combat?.faction === 1)).toHaveLength(8);
  const saved = simulation.saveState();
  expect(saved.settlers).toBe(before.settlers);
  expect(saved.buildings[0]!.inventory).toEqual(before.buildings[0]!.inventory);
  expect(new Set(saved.military!.soldiers.flatMap(soldier => soldier.combat?.mount === undefined ? [] : [soldier.combat.mount])).size).toBe(0);
  expect(simulation.loadState(saved).ok).toBe(true);
  expect(simulation.startMilitaryTrainingEncounter().ok).toBe(false);
  expect(simulation.militaryTrainingStarted()).toBe(true);
  expect(simulation.militaryStoredTroops().every(entry => entry.count === (entry.type === "cavalry" ? 0 : 20))).toBe(true);
});

it("fails a crowded encounter atomically without manufacturing reserves", () => {
  const { simulation, world } = fixture();
  world.walkCost.fill(0);
  const before = simulation.saveState();
  expect(simulation.startMilitaryTrainingEncounter().ok).toBe(false);
  expect(simulation.saveState()).toEqual(before);
});

it("dispatches the selected actual reserves and excludes naval reservations", () => {
  const { simulation } = fixture();
  simulation.startMilitaryTrainingEncounter();
  const shield = simulation.militaryStoredTroops().find(entry => entry.type === "shield")!;
  const first = simulation.frames().find(actor => actor.uid === shield.actors[0])!;
  first.navalOrder = 42;
  expect(simulation.callOutMilitary(["shield"], { x: 25, z: 25 })).toBe(19);
  expect(first.phase).toBe("militaryReserve");
  expect(simulation.militaryStoredTroops().find(entry => entry.type === "heavy")!.count).toBe(20);
  expect(simulation.militarySoldiers()).toHaveLength(68);
});

it("rejects ordinary cavalry recruitment", () => {
  const { simulation } = fixture();
  const home = simulation.headquarters;
  const before = simulation.saveState();
  const beer = home.inventory.beer;
  expect(simulation.recruitStoredMilitary(home.uid, "cavalry")).toBeNull();
  expect(simulation.saveState()).toEqual(before);
  expect(home.inventory.beer).toBe(beer);
  expect(simulation.saveState().settlers).toBe(before.settlers);
});

it("rejects duplicated horses and false reserve storage before mutating the world", () => {
  const { simulation } = fixture();
  simulation.startMilitaryTrainingEncounter();
  receiveCavalry(simulation, 2);
  const original = simulation.saveState();
  const invalid = structuredClone(original);
  const mounted = invalid.military!.soldiers.filter(soldier => soldier.combat?.type === "cavalry");
  mounted[1]!.combat!.mount = mounted[0]!.combat!.mount;
  expect(simulation.loadState(invalid).ok).toBe(false);
  expect(simulation.saveState()).toEqual(original);
  const bad = structuredClone(original);
  const reserve = bad.actors.find(actor => actor.phase === "militaryReserve")!;
  reserve.building = -5;
  expect(simulation.loadState(bad).ok).toBe(false);
  const hostileReserve = structuredClone(original);
  hostileReserve.military!.soldiers.find(soldier => soldier.building === -1)!.combat!.faction = 1;
  expect(simulation.loadState(hostileReserve).ok).toBe(false);
  expect(simulation.saveState()).toEqual(original);
});

it("garrison entry reserves capacity and excludes mounted troops", () => {
  const { advance, simulation } = fixture();
  simulation.startMilitaryTrainingEncounter();
  const result = simulation.placeBuilding(1, 19, 16);
  expect(result.reason).toBeUndefined();
  expect(result.ok).toBe(true);
  const site = result.building!;
  site.construction = 1; site.required = {};
  const ids = simulation.militaryStoredTroops().flatMap(entry => entry.actors);
  expect(simulation.garrisonMilitary(ids, site.uid)).toBe(2);
  expect(simulation.garrisonMilitary(ids, site.uid)).toBe(0);
  expect(simulation.militarySoldiers().filter(soldier => soldier.building === site.uid)).toHaveLength(2);
  expect(simulation.loadState(simulation.saveState()).ok).toBe(true);
  const cavalry = receiveCavalry(simulation, 1);
  expect(simulation.garrisonMilitary(cavalry, site.uid)).toBe(0);
  advance(40);
  expect(simulation.militaryBuildings().find(building => building.uid === site.uid)!.stationed).toBe(2);
  expect(simulation.loadState(simulation.saveState()).ok).toBe(true);
});


it("all ordinary types clear the HQ doorway through coordinated traffic and preserve saveability", () => {
  const { advance, simulation } = fixture();
  simulation.startMilitaryTrainingEncounter();
  // Isolate doorway throughput from combat: keep the training camp out of this traffic check.
  const saved = simulation.saveState();
  const hostiles = saved.military!.soldiers.filter(soldier => soldier.combat?.faction === 1);
  const removed = new Set(hostiles.flatMap(soldier => [soldier.actor, soldier.combat?.mount]));
  saved.military!.soldiers = saved.military!.soldiers.filter(soldier => soldier.combat?.faction === 0);
  saved.actors = saved.actors.filter(actor => !removed.has(actor.uid));
  expect(simulation.loadState(saved).ok).toBe(true);
  expect(simulation.callOutMilitary(["shield", "heavy", "archer"], { x: 12, z: 38 })).toBe(60);
  advance(240);
  const friendly = simulation.militarySoldiers().filter(soldier => soldier.combat?.faction === 0);
  expect(friendly).toHaveLength(60);
  expect(simulation.frames().filter(actor => friendly.some(soldier => soldier.actor === actor.uid))
    .every(actor => actor.visible && actor.phase === "militaryField")).toBe(true);
  expect(simulation.frames().filter(actor => actor.job === "Mount").every(actor => !actor.visible)).toBe(true);
  expect(simulation.loadState(simulation.saveState()).ok).toBe(true);
}, 60000);


it("nearest storage return preserves a wounded veteran's identity and equipment", () => {
  const { advance, simulation } = fixture();
  const placed = simulation.placeBuilding(29, 21.5, 17.5);
  expect(placed.reason).toBeUndefined();
  const storage = placed.building!;
  storage.construction = 1; storage.required = {};
  const id = simulation.recruitStoredMilitary(simulation.headquarters.uid, "shield")!;
  expect(simulation.commandMilitary([id], { x: 23, z: 25 }, "move")).toBe(true);
  advance(30);
  const saved = simulation.saveState();
  const soldier = saved.military!.soldiers.find(soldier => soldier.actor === id)!;
  soldier.rank = 2; soldier.combat!.hp = 30;
  expect(simulation.loadState(saved).ok).toBe(true);
  expect(simulation.returnMilitaryHome([id])).toBe(true);
  expect(simulation.frames().find(actor => actor.uid === id)!.home).toBe(storage.uid);
  advance(40);
  const returned = simulation.militarySoldiers().find(soldier => soldier.actor === id)!;
  expect(returned.rank).toBe(2);
  expect(returned.combat!.hp).toBe(30);
  expect(returned.combat!.type).toBe("shield");
  expect(simulation.frames().find(actor => actor.uid === id)!.phase).toBe("militaryReserve");
  expect(simulation.loadState(simulation.saveState()).ok).toBe(true);
});

it("twenty mounted troops return through exterior dismounting and the storage FIFO without trapping horses", () => {
  const { advance, simulation } = fixture();
  const ids = receiveCavalry(simulation);
  expect(simulation.callOutMilitary(["cavalry"], { x: 12, z: 38 })).toBe(20);
  advance(120);
  expect(ids.every(id => simulation.frames().find(actor => actor.uid === id)!.mounted)).toBe(true);
  const mounts = simulation.militarySoldiers().filter(soldier => ids.includes(soldier.actor))
    .map(soldier => soldier.combat!.mount);
  expect(simulation.returnMilitaryHome(ids)).toBe(true);
  expect(ids.every(id => simulation.frames().find(actor => actor.uid === id)!.phase === "militaryMountedReturn"))
    .toBe(true);
  expect(simulation.loadState(simulation.saveState()).ok).toBe(true);
  advance(240);
  expect(simulation.militaryStoredTroops().find(entry => entry.type === "cavalry")!.count).toBe(20);
  expect(simulation.frames().filter(actor => ids.includes(actor.uid)).every(actor => !actor.visible && !actor.mounted))
    .toBe(true);
  expect(simulation.militarySoldiers().filter(soldier => ids.includes(soldier.actor)).map(soldier => soldier.combat!.mount))
    .toEqual(mounts);
  expect(simulation.loadState(simulation.saveState()).ok).toBe(true);
}, 60000);

it("keeps twenty horse identities saveable when a return destination is demolished and resumes when terrain opens", () => {
  const { advance, simulation, world } = fixture();
  const placed = simulation.placeBuilding(29, 21.5, 17.5);
  expect(placed.reason).toBeUndefined();
  placed.building!.construction = 1; placed.building!.required = {};
  const ids = receiveCavalry(simulation);
  expect(simulation.callOutMilitary(["cavalry"], { x: 50, z: 48 })).toBe(20);
  advance(120);
  expect(simulation.returnMilitaryHome(ids)).toBe(true);
  const affected = ids.filter(id => simulation.frames().find(actor => actor.uid === id)!.home === placed.building!.uid);
  expect(affected.length).toBeGreaterThan(0);
  const horses = simulation.militarySoldiers().filter(soldier => ids.includes(soldier.actor))
    .map(soldier => soldier.combat!.mount);
  world.walkCost.fill(0);
  expect(simulation.demolishBuilding(placed.building!.uid).ok).toBe(true);
  expect(affected.every(id => simulation.frames().find(actor => actor.uid === id)!.phase === "militaryReturnBlocked"))
    .toBe(true);
  expect(simulation.loadState(simulation.saveState()).ok).toBe(true);
  expect(simulation.militarySoldiers().filter(soldier => ids.includes(soldier.actor)).map(soldier => soldier.combat!.mount))
    .toEqual(horses);
  expect(new Set(horses).size).toBe(20);
  world.walkCost.fill(10);
  advance(300);
  expect(simulation.militaryStoredTroops().find(entry => entry.type === "cavalry")!.count).toBe(20);
  expect(simulation.militarySoldiers().filter(soldier => ids.includes(soldier.actor)).map(soldier => soldier.combat!.mount))
    .toEqual(horses);
  expect(simulation.loadState(simulation.saveState()).ok).toBe(true);
}, 60000);


it("checks the full horse envelope against a boulder in the third spatial bucket", () => {
  const { simulation, world } = fixture();
  const mounted = simulation.spawnMilitaryOpponent({ x: 10.9, z: 40.5 }, "cavalry")!;
  expect(mounted).not.toBeNull();
  world.props = { count: 1, types: new Uint8Array([PROP.largeRock]),
    x: new Float32Array([13]), z: new Float32Array([40.5]), scale: new Float32Array([10]) } as WorldData["props"];
  expect(simulation.commandMilitaryOpponent([mounted], { x: 10.9, z: 40.5 }, 1)).toBe(false);
});


it("infantry enter a garrison through the recorded stationary horse crowd without moving or losing mounts", () => {
  const { advance, simulation } = fixture(128, { x: 61.5, z: 64.5 });
  simulation.startMilitaryTrainingEncounter();
  receiveCavalry(simulation);
  const placed = simulation.placeBuilding(1, 69, 73);
  expect(placed.reason).toBeUndefined();
  const site = placed.building!;
  site.construction = 1; site.required = {};
  const recorded: { horses: { uid: number; x: number; z: number }[]; foot: { x: number; z: number } } =
    JSON.parse(readFileSync(new URL("./fixtures/military-mounted-crowd.json", import.meta.url), "utf8"));
  const saved = simulation.saveState();
  const horseIds = saved.military!.soldiers.filter(soldier => soldier.combat?.type === "cavalry" && soldier.combat.faction === 0)
    .map(soldier => soldier.actor);
  horseIds.forEach((id, index) => {
    const actor = saved.actors.find(actor => actor.uid === id)!;
    const location = recorded.horses[index]!;
    Object.assign(actor, { x: location.x, z: location.z, phase: "militaryField", visible: true,
      mounted: true, action: "idle", path: [], pathIndex: 0 });
    saved.military!.soldiers.find(soldier => soldier.actor === id)!.building = -3;
  });
  const footIds = saved.military!.soldiers.filter(soldier => soldier.combat?.type === "shield" && soldier.combat.faction === 0)
    .slice(0, 2).map(soldier => soldier.actor);
  footIds.forEach((id, index) => {
    const actor = saved.actors.find(actor => actor.uid === id)!;
    Object.assign(actor, { x: recorded.foot.x + index * .4, z: recorded.foot.z, phase: "militaryField",
      visible: true, action: "idle", path: [], pathIndex: 0 });
    saved.military!.soldiers.find(soldier => soldier.actor === id)!.building = -3;
  });
  const mountIds = saved.military!.soldiers.filter(soldier => horseIds.includes(soldier.actor))
    .map(soldier => soldier.combat!.mount);
  expect(simulation.loadState(saved).ok).toBe(true);
  expect(simulation.garrisonMilitary(footIds, site.uid)).toBe(2);
  advance(90);
  expect(simulation.militaryBuildings().find(building => building.uid === site.uid)!.stationed).toBe(2);
  expect(simulation.militarySoldiers().filter(soldier => horseIds.includes(soldier.actor))
    .map(soldier => soldier.combat!.mount)).toEqual(mountIds);
  expect(simulation.loadState(simulation.saveState()).ok).toBe(true);
}, 60000);

it("actual mounted combat death removes the bound horse without refunds or orphaned save identities", () => {
  const { advance, simulation } = fixture();
  const cavalry = simulation.spawnMilitaryOpponent({ x: 45, z: 45 }, "cavalry", 0, 1)!;
  const archer = simulation.spawnMilitaryOpponent({ x: 45, z: 50 }, "archer", 0, 2)!;
  expect(cavalry).not.toBeNull(); expect(archer).not.toBeNull();
  const saved = simulation.saveState();
  const soldier = saved.military!.soldiers.find(soldier => soldier.actor === cavalry)!;
  soldier.combat!.hp = 1;
  const mount = soldier.combat!.mount!;
  // The HQ inventory is a shared-storage view (a Proxy): snapshot its enumerable stock plainly.
  const stock = { ...simulation.headquarters.inventory };
  expect(simulation.loadState(saved).ok).toBe(true);
  // The pressed archer backs away until it has room (owner 2026-10-15), then shoots the rider.
  advance(12);
  expect(simulation.militarySoldiers().some(soldier => soldier.actor === cavalry)).toBe(false);
  expect(simulation.frames().some(actor => actor.uid === mount || actor.uid === cavalry)).toBe(false);
  expect(simulation.headquarters.inventory).toEqual(stock);
  expect(simulation.frames().some(actor => actor.phase === "horseMounted")).toBe(false);
  const after = simulation.saveState();
  expect(new Set(after.actors.map(actor => actor.uid)).size).toBe(after.actors.length);
  expect(simulation.loadState(after).ok).toBe(true);
});

it("infantry melee strikes the mounted body without walking into the horse", () => {
  const { advance, simulation } = fixture();
  const cavalry = simulation.spawnMilitaryOpponent({ x: 45, z: 45 }, "cavalry", 0, 1)!;
  const heavy = simulation.spawnMilitaryOpponent({ x: 45, z: 47.7 }, "heavy", 0, 2)!;
  expect(heavy).not.toBeNull();
  advance(2);
  const mounted = simulation.militarySoldiers().find(soldier => soldier.actor === cavalry);
  expect(mounted?.combat?.hp ?? 0).toBeLessThan(105);
  const a = simulation.frames().find(actor => actor.uid === cavalry);
  const b = simulation.frames().find(actor => actor.uid === heavy);
  if (a && b) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(1.25 - 1e-6);
});

it("mounted opponents fight at actual body contact and the defeated horse is not orphaned", () => {
  const { advance, simulation } = fixture();
  const first = simulation.spawnMilitaryOpponent({ x: 45, z: 45 }, "cavalry", 0, 1)!;
  const second = simulation.spawnMilitaryOpponent({ x: 45, z: 49 }, "cavalry", 0, 2)!;
  let closest = Infinity;
  for (let tick = 0; tick < 60 * 20; tick++) {
    advance(.05);
    const a = simulation.frames().find(actor => actor.uid === first);
    const b = simulation.frames().find(actor => actor.uid === second);
    if (a && b) closest = Math.min(closest, Math.hypot(a.x - b.x, a.z - b.z));
  }
  expect(closest).toBeGreaterThanOrEqual(2.1 - 1e-6);
  expect(simulation.militarySoldiers().filter(soldier => soldier.actor === first || soldier.actor === second))
    .toHaveLength(1);
  expect(simulation.frames().filter(actor => actor.phase === "horseMounted")).toHaveLength(1);
  expect(simulation.loadState(simulation.saveState()).ok).toBe(true);
});

it("a drawn melee strike does not hurt a mounted target that has left contact range", () => {
  const { advance, simulation } = fixture();
  const heavy = simulation.spawnMilitaryOpponent({ x: 45, z: 45 }, "heavy", 0, 1)!;
  const cavalry = simulation.spawnMilitaryOpponent({ x: 45, z: 46.7 }, "cavalry", 0, 2)!;
  // A13 phase 3: a unit spawned this tick is seen from the end of the tick (the vision phase) on.
  advance(.1);
  const saved = simulation.saveState();
  expect(saved.military!.soldiers.find(soldier => soldier.actor === heavy)!.combat!.pendingTarget).toBe(cavalry);
  const target = saved.actors.find(actor => actor.uid === cavalry)!;
  target.x = 60; target.z = 60; target.path = []; target.pathIndex = 0;
  const hp = saved.military!.soldiers.find(soldier => soldier.actor === cavalry)!.combat!.hp;
  expect(simulation.loadState(saved).ok).toBe(true);
  advance(.6);
  expect(simulation.militarySoldiers().find(soldier => soldier.actor === cavalry)!.combat!.hp).toBe(hp);
});


it.each([2, 3, 4])("legacy rank %i preserves full and wounded health fractions through resave", rank => {
  for (const fraction of [1, .4]) {
    const { simulation } = fixture();
    const id = simulation.recruitStoredMilitary(simulation.headquarters.uid, "shield")!;
    const legacy = simulation.saveState();
    delete legacy.military!.rankVersion;
    const soldier = legacy.military!.soldiers.find(soldier => soldier.actor === id)!;
    soldier.rank = rank; soldier.combat!.hp = 125 * 1.2 ** rank * fraction;
    expect(simulation.loadState(legacy).ok).toBe(true);
    const current = simulation.saveState();
    const normalized = current.military!.soldiers.find(soldier => soldier.actor === id)!;
    expect(normalized.combat!.hp).toBeCloseTo(125 * 1.2 ** normalized.rank * fraction);
    expect(legacy.military!.soldiers.find(soldier => soldier.actor === id)!.rank).toBe(rank);
    expect(simulation.loadState(current).ok).toBe(true);
  }
});

it("legacy in-flight arrows normalize their rank and remain saveable", () => {
  const { simulation } = fixture();
  const id = simulation.recruitStoredMilitary(simulation.headquarters.uid, "shield")!;
  const legacy = simulation.saveState();
  delete legacy.military!.rankVersion;
  legacy.military!.soldiers[0]!.rank = 4;
  legacy.military!.soldiers[0]!.combat!.hp = 125 * 1.2 ** 4;
  legacy.military!.combat!.arrows = [{ id: 0, shooter: id, faction: 0, rank: 4,
    x: 30, y: 1, z: 30, vx: 0, vy: 0, vz: 1, age: 0 }];
  legacy.military!.combat!.nextArrow = 1;
  expect(simulation.loadState(legacy).ok).toBe(true);
  const current = simulation.saveState();
  expect(current.military!.combat!.arrows[0]!.rank).toBe(2);
  expect(legacy.military!.combat!.arrows[0]!.rank).toBe(4);
  expect(simulation.loadState(current).ok).toBe(true);
});

it("an active friendly doorway defender rejects new orders without altering the live duel", () => {
  const { simulation } = fixture();
  const placed = simulation.placeBuilding(1, 19, 16);
  const site = placed.building!;
  site.construction = 1; site.required = {};
  const defender = simulation.recruitStoredMilitary(simulation.headquarters.uid, "shield")!;
  const attacker = simulation.spawnMilitaryOpponent({ x: 30, z: 30 }, "shield", 0, 1)!;
  expect(simulation.registerMilitaryDoor(site.uid, 0)).toBe(true);
  const saved = simulation.saveState();
  saved.buildings.find(building => building.uid === site.uid)!.militaryFaction = 0;
  const guard = saved.military!.soldiers.find(soldier => soldier.actor === defender)!;
  guard.building = site.uid; guard.stationed = false;
  const guardActor = saved.actors.find(actor => actor.uid === defender)!;
  Object.assign(guardActor, { phase: "militarySiege", visible: true, building: site.uid,
    x: site.access.x, z: site.access.z, path: [], pathIndex: 0 });
  const enemy = saved.military!.soldiers.find(soldier => soldier.actor === attacker)!;
  enemy.combat!.siege = site.uid;
  const enemyActor = saved.actors.find(actor => actor.uid === attacker)!;
  Object.assign(enemyActor, { phase: "militarySiege", x: site.access.x, z: site.access.z + .8,
    path: [], pathIndex: 0 });
  saved.military!.combat!.exchanges = [{ building: site.uid, attacker, defender, stage: "duel" }];
  expect(simulation.loadState(saved).ok).toBe(true);
  const before = simulation.saveState();
  expect(simulation.commandMilitary([defender], { x: 30, z: 25 })).toBe(false);
  expect(simulation.returnMilitaryHome([defender])).toBe(false);
  expect(simulation.garrisonMilitary([defender], site.uid)).toBe(0);
  expect(simulation.saveState()).toEqual(before);
});

it("returns forty mixed infantry through the HQ queue without a reload", () => {
  const { advance, simulation } = fixture();
  simulation.receiveTroops(Array.from({ length: 40 }, (_, index) =>
    ({ type: (["shield", "heavy", "archer"] as const)[index % 3]!, rank: 0, hp: 60 })));
  const own = simulation.militarySoldiers().map(soldier => soldier.actor);
  expect(own).toHaveLength(40);
  expect(simulation.callOutMilitary(["shield", "heavy", "archer"], { x: 15, z: 20 })).toBe(40);
  advance(80);
  expect(simulation.returnMilitaryHome(own)).toBe(true);
  advance(180);
  expect(simulation.frames().filter(actor => own.includes(actor.uid)).every(actor =>
    actor.phase === "militaryReserve" && !actor.visible)).toBe(true);
});


it("keeps the home guardhouse automatic target at its full original capacity", () => {
  const { simulation } = fixture();
  const placed = simulation.placeBuilding(1, 19, 16);
  expect(placed.ok).toBe(true);
  Object.assign(placed.building!, { construction: 1, required: {} });
  const site = simulation.militaryBuildings().find(building => building.uid === placed.building!.uid)!;
  expect(site.target).toBe(2); expect(site.capacity).toBe(2);
});

it("returns a surviving attacker whose destroyed siege left an orphan siege phase", () => {
  const { advance, simulation } = fixture();
  simulation.receiveTroops([{ type: "shield", rank: 0, hp: 75 }]);
  const soldier = simulation.militarySoldiers()[0]!;
  expect(simulation.callOutMilitary(["shield"], { x: 20, z: 20 })).toBe(1);
  advance(50);
  const actor = simulation.frames().find(actor => actor.uid === soldier.actor)!;
  expect(actor.phase).toBe("militaryField");
  // The siege site is already gone: no active siege owns this surviving attacker any more.
  actor.phase = "militarySiege";
  soldier.combat!.siege = undefined;
  expect(simulation.returnMilitaryHome([soldier.actor])).toBe(true);
  expect(actor.phase).not.toBe("militarySiege");
  advance(60);
  expect(actor.phase).toBe("militaryReserve"); expect(actor.visible).toBe(false);
});

it("returns a distant field soldier around a long blocked wall using the military corridor", () => {
  const { simulation, world } = fixture(96);
  for (let z = 0; z < 81; z++) world.walkCost[z * 96 + 40] = 0;
  world.buildRevision = (world.buildRevision ?? 0) + 1;
  const spawned = simulation.spawnDebugSoldier({ x: 70, z: 20 }, { rank: 1, type: "archer" })!;
  expect(spawned).not.toBeNull();
  const soldier = simulation.militarySoldiers().find(entry => entry.actor === spawned.id)!;
  const actor = simulation.frames().find(entry => entry.uid === spawned.id)!;
  const inventory = structuredClone(simulation.saveState().buildings[0]!.inventory);
  const start = { x: actor.x, z: actor.z }, hp = soldier.combat!.hp;
  expect(simulation.returnMilitaryHome([spawned.id])).toBe(true);
  expect(actor.x).toBe(start.x); expect(actor.z).toBe(start.z);
  expect(actor.phase).toBe("retire");
  let traveled = 0;
  for (let tick = 0; tick < 7000 && actor.phase !== "militaryReserve"; tick++) {
    const previous = { x: actor.x, z: actor.z };
    simulation.update(.05);
    const step = Math.hypot(actor.x - previous.x, actor.z - previous.z);
    expect(step).toBeLessThan(.1);
    traveled += step;
    expect(world.walkCost[Math.floor(actor.z) * 96 + Math.floor(actor.x)]).toBeGreaterThan(0);
  }
  expect(actor.phase).toBe("militaryReserve");
  expect(traveled).toBeGreaterThan(120);
  const returned = simulation.militarySoldiers().find(entry => entry.actor === spawned.id)!;
  expect(returned.actor).toBe(spawned.id);
  expect(returned.rank).toBe(1);
  expect(returned.combat!.type).toBe("archer");
  expect(returned.combat!.hp).toBe(hp);
  expect(simulation.saveState().buildings[0]!.inventory).toEqual(inventory);
});
