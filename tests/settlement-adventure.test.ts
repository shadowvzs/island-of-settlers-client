import { describe, expect, it, vi } from "vitest";

import { colonySettlementOptions } from "../src/app/settlement/colony-boot";
import {
  ADVENTURE_WORLD_SIZE, adventureEnemyCount, type AdventureIsland,
adventureOffers} from "../src/shared/settlement/adventure-rules";
import { chooseAdventureWorld } from "../src/shared/settlement/colony-world-choice";
import { doorAngleTo, islandCentre } from "../src/shared/settlement/enemy-building-facing";
import { militaryGroundPath } from "../src/shared/settlement/military-routing";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { CAMP_LANDING_DISTANCE, CAMP_UNIT_SPACING } from "../src/shared/settlement/settlement-adventure";
import { gatherSlot } from "../src/shared/settlement/settlement-adventure-landing";
import { reachableCells } from "../src/shared/settlement/settlement-colony";
import {
  createSettlementSimulation, type SettlementOptions
} from "../src/shared/settlement/settlement-simulation";

// Production code generates these islands itself: serve them from the shared world cache.
vi.mock("../src/shared/world/generation/generate-world", async (importOriginal) =>
  (await import("./helpers/world-cache-store")).cachedGenerateWorldModule(importOriginal));

type Simulation = ReturnType<typeof createSettlementSimulation>;
const offers = adventureOffers(1234);
const offer = (difficulty: AdventureIsland["difficulty"]) =>
  offers.find(entry => entry.difficulty === difficulty)!;
const adventure = (
  island: AdventureIsland, now = () => 5000, homeBuilding: SettlementOptions["homeBuilding"] = null
) => {
  const world = chooseAdventureWorld(island);
  let simulation: Simulation;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ canWorkerEnterPlot: () => true, homeBuilding, initialSettlers: 0,
    initialStock: {}, now, roads, world });
  return { simulation, world };
};
const troops = (count: number) => Array.from({ length: count }, () => ({ hp: 125, rank: 1, type: "heavy" as const }));
const hostile = (simulation: Simulation) =>
  simulation.militarySoldiers().filter(soldier => (soldier.combat?.faction ?? 0) > 0);
const own = (simulation: Simulation) =>
  simulation.militarySoldiers().filter(soldier => (soldier.combat?.faction ?? 0) === 0);
const actorOf = (simulation: Simulation, uid: number) => simulation.frames().find(actor => actor.uid === uid)!;
const run = (simulation: Simulation, seconds: number) => {
  for (let step = 0; step < seconds * 20; step++) simulation.update(.05);
};

describe("adventure islands", () => {
  it("refuses to start, untouched, when the camps cannot be manned (never an instant win)", () => {
    const island = offer("easy");
    const { simulation, world } = adventure(island);
    const actors = simulation.frames(), population = actors.length, blockers = [];
    for (let z = .25; z < world.cellsZ; z += .5) for (let x = .25; x < world.cellsX; x += .5)
      blockers.push({ uid: -1 - blockers.length, visible: true, x, z });
    actors.push(...blockers as never[]);
    expect(simulation.startAdventure({ island, troops: troops(3) }).ok).toBe(false);
    expect(hostile(simulation)).toHaveLength(0);
    expect(actors).toHaveLength(population + blockers.length);
    expect(simulation.adventure()).toBeUndefined();
    actors.splice(population, blockers.length);
    expect(simulation.startAdventure({ island, troops: troops(3) })).toEqual({ ok: true });
    run(simulation, 1);
    expect(simulation.adventure()!.status).toBe("contested");
  }, 60000);

  it.each(["easy", "medium", "hard"] as const)("%s: mostly open field battles with sparse defences", difficulty => {
    const island = offer(difficulty);
    const { simulation, world } = adventure(island);
    expect([world.cellsX, world.cellsZ]).toEqual([ADVENTURE_WORLD_SIZE, ADVENTURE_WORLD_SIZE]);
    expect(simulation.startAdventure({ island, troops: troops(5) })).toEqual({ ok: true });
    expect(simulation.buildings().length).toBeLessThanOrEqual(difficulty === "hard" ? 3 : 2);
    expect(simulation.home()).toBeUndefined();
    const shore = simulation.saveState().adventure!.landing!.gangway.shore;
    for (const soldier of hostile(simulation)) {
      const actor = actorOf(simulation, soldier.actor);
      expect(actor.yaw).toBeCloseTo(Math.atan2(shore.x - actor.x, shore.z - actor.z));
    }
    const campSites = simulation.adventureCampSites();
    expect(campSites.length).toBeGreaterThan(0);
    expect(campSites.length).toBeLessThanOrEqual(6);
    const savedCamps = simulation.saveState().adventure!.campSites;
    expect(savedCamps).toEqual(campSites.map(({ x, z }) => ({ x, z })));
    expect(campSites.every(site => site.x >= 0 && site.x < world.cellsX &&
      site.z >= 0 && site.z < world.cellsZ)).toBe(true);
    const enemies = hostile(simulation), landing = simulation.adventure()!.landing!;
    expect(enemies).toHaveLength(adventureEnemyCount(difficulty));
    const field = enemies.filter(soldier => !soldier.stationed);
    const fieldPositions = field.map(soldier => actorOf(simulation, soldier.actor));
    for (let i = 0; i < fieldPositions.length; i++) for (let j = i + 1; j < fieldPositions.length; j++) {
      const first = fieldPositions[i]!, second = fieldPositions[j]!;
      expect(Math.hypot(first.x - second.x, first.z - second.z)).toBeGreaterThanOrEqual(CAMP_UNIT_SPACING - 1e-8);
    }
    expect(field.length).toBeGreaterThan(enemies.length * .75);
    expect(field.every(soldier => soldier.building === -3)).toBe(true);
    const centre = islandCentre(world);
    for (const site of simulation.buildings()) {
      expect(site.militaryFaction).toBe(1);
      // Owner 2026-10-22: fronts face the island centre (a half-cell plot offset adds slack).
      const slack = Math.atan(.75 / Math.hypot(centre.x - site.x, centre.z - site.z));
      expect(doorAngleTo(site.rotation, site, centre)).toBeLessThanOrEqual(Math.PI / 4 + slack);
      expect(site.bandit).toBeDefined();
      if (site.typeId === 4) expect(enemies.filter(soldier => soldier.building === site.uid)
        .every(soldier => soldier.combat?.type === "archer")).toBe(true);
    }
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
    expect(new Set(enemies.map(soldier => soldier.combat!.type)).size).toBeGreaterThanOrEqual(3);
    const context = { buildings: [], occupied: new Uint8Array(world.cellsX * world.cellsZ), options: { world } };
    const reachable = reachableCells(context as never, landing.shore);
    const mountedStart = gatherSlot(context as never, landing.shore, 0);
    for (const soldier of field) {
      const body = actorOf(simulation, soldier.actor);
      expect(reachable(body)).toBe(true);
      expect(militaryGroundPath(context as never, landing.shore, body)).not.toBeNull();
      expect(militaryGroundPath(context as never, mountedStart, body, true)).not.toBeNull();
      // Camps keep clear of the beach: at most a camp's spawn ring nearer than the camp centre.
      expect(Math.hypot(body.x - landing.shore.x, body.z - landing.shore.z))
        .toBeGreaterThan(CAMP_LANDING_DISTANCE - 4);
    }
    expect(simulation.adventure())
      .toMatchObject({ enemies: enemies.length, hostileBuildings: simulation.buildings().length, status: "contested" });
    expect(simulation.allowsBuilding(2)).toBe(false);
    expect(simulation.placeBuilding(2, landing.shore.x + 4, landing.shore.z).ok).toBe(false);
    expect(simulation.grantCoins(5)).toBe(false);
  }, 30000);

  it("lands the troops from an anchored ship down a gangway and gathers them ashore", () => {
    const island = offer("easy");
    const { simulation } = adventure(island);
    simulation.startAdventure({ island, troops: troops(4) });
    const ship = simulation.shipFrames().find(frame => frame.id === 1_900_000)!;
    const gangway = simulation.shipSites().find(site => site.kind === "dock")!;
    expect(ship).toMatchObject({ phase: "idle" });
    expect(gangway).toMatchObject({ progress: 1, x: ship.x, z: ship.z });
    expect(gangway.workPier!.shore).toEqual(simulation.adventure()!.landing!.shore);
    const phases = () => own(simulation).map(soldier => actorOf(simulation, soldier.actor).phase);
    expect(phases().every(phase => phase === "adventureAboard")).toBe(true);
    // Everyone stands on the deck in view; mounted landing geometry has its own focused tests.
    for (const soldier of own(simulation)) {
      const body = actorOf(simulation, soldier.actor);
      expect(body.visible).toBe(true);
      expect(Math.hypot(body.x - ship.x, body.z - ship.z)).toBeLessThan(5);
    }
    run(simulation, 4);
    expect(phases()).toContain("adventureGangway");
    run(simulation, 30);
    const shore = simulation.adventure()!.landing!.shore;
    for (const soldier of own(simulation)) {
      const body = actorOf(simulation, soldier.actor);
      expect(body.phase).toBe("militaryField");
      expect(body.visible).toBe(true);
      expect(Math.hypot(body.x - shore.x, body.z - shore.z)).toBeLessThan(14);
    }
    // The ship stays anchored as the return point.
    expect(simulation.shipFrames().some(frame => frame.id === 1_900_000)).toBe(true);
  }, 30000);

  it.each([1308404504, 42])("seed %s connects every enemy to the real unloading point", seed => {
    const island = { ...offer("hard"), seed };
    const { simulation, world } = adventure(island);
    expect(simulation.startAdventure({ island, troops: troops(1) })).toEqual({ ok: true });
    const context = { actors: simulation.frames(), buildings: [],
      occupied: new Uint8Array(world.cellsX * world.cellsZ), options: { world } };
    const shore = simulation.adventure()!.landing!.shore;
    const mountedStart = gatherSlot(context as never, shore, 0);
    for (const soldier of hostile(simulation).filter(soldier => !soldier.stationed)) {
      const enemy = actorOf(simulation, soldier.actor);
      expect(militaryGroundPath(context as never, shore, enemy)).not.toBeNull();
      expect(militaryGroundPath(context as never, mountedStart, enemy, true)).not.toBeNull();
    }
  }, 30000);

  it("keeps the landing through save and load, half-way down the gangway", () => {
    const island = offer("easy");
    const { simulation } = adventure(island);
    simulation.startAdventure({ island, troops: troops(6) });
    run(simulation, 3);
    const saved = simulation.saveState();
    expect(saved.adventure!.landing).toBeDefined();
    expect(saved.buildings).toEqual([]);
    const { simulation: reloaded } = adventure(island);
    expect(reloaded.loadState(saved)).toEqual({ ok: true });
    expect(reloaded.shipSites().some(site => site.kind === "dock")).toBe(true);
    run(reloaded, 30);
    expect(own(reloaded).every(soldier => actorOf(reloaded, soldier.actor).phase === "militaryField")).toBe(true);
    const { simulation: withHarbour } = adventure(island, () => 5000, 39);
    expect(withHarbour.loadState(saved)).toMatchObject({ ok: false });
  }, 30000);

  it("is won when every hostile soldier is dead", () => {
    const island = offer("easy");
    let clock = 5000;
    const { simulation } = adventure(island, () => clock);
    simulation.startAdventure({ island, troops: troops(3) });
    run(simulation, 1);
    expect(simulation.adventure()).toMatchObject({ status: "contested" });
    const remaining = simulation.saveState();
    const camp = new Set(remaining.military!.soldiers.filter(soldier => soldier.combat?.faction).map(soldier =>
      soldier.actor));
    const mounts = new Set(remaining.military!.soldiers.filter(soldier => camp.has(soldier.actor))
      .map(soldier => soldier.combat?.mount));
    remaining.military!.soldiers = remaining.military!.soldiers.filter(soldier => !camp.has(soldier.actor));
    remaining.actors = remaining.actors.filter(actor => !camp.has(actor.uid) && !mounts.has(actor.uid));
    expect(simulation.loadState(remaining)).toEqual({ ok: true });
    clock = 9000;
    run(simulation, 1);
    expect(simulation.adventure()).toMatchObject({ endedAt: 9000, hostileSoldiers: 0, status: "won" });
  }, 30000);

  it("is lost when no player soldier is left", () => {
    const island = offer("easy");
    const { simulation } = adventure(island);
    simulation.startAdventure({ island, troops: [] });
    run(simulation, 1);
    expect(simulation.adventure()!.status).toBe("defeated");
  }, 30000);

  it("rejects a corrupt adventure record in a save", () => {
    const island = offer("easy");
    const { simulation } = adventure(island);
    simulation.startAdventure({ island, troops: troops(1) });
    const saved = simulation.saveState();
    expect(simulation.loadState({ ...saved, adventure: { ...saved.adventure!, status: "conquered" } }))
      .toMatchObject({ ok: false, reason: "Invalid adventure island state" });
    expect(simulation.loadState({ ...saved, adventure: { ...saved.adventure!, island: { ...island, size: 7 } } }))
      .toMatchObject({ ok: false });
    const brokenLanding = { ...saved, adventure: { ...saved.adventure!, landing: { ashore: -1 } } };
    expect(simulation.loadState(brokenLanding as never))
      .toMatchObject({ ok: false, reason: "Invalid adventure island state" });
  }, 30000);

  it("boots a restored adventure with a landing harbour only when its save still has one", () => {
    const restored = (settlement: object) => ({ settlement: { buildings: [], ...settlement } }) as never;
    expect(colonySettlementOptions(restored({ adventure: {} }), null)).toEqual({ homeBuilding: null });
    expect(colonySettlementOptions(restored({ adventure: {}, buildings: [{ colonyHome: true, typeId: 39 }] }), null))
      .toEqual({ homeBuilding: 39 });
    expect(colonySettlementOptions(restored({ colony: {} }), null)).toEqual({ homeBuilding: 39 });
    expect(colonySettlementOptions(restored({}), null)).toEqual({});
  });

  it("still loads an adventure saved before 2026-10-13 (64-cell island, landing harbour)", () => {
    const island = { ...offer("easy"), size: 64 };
    const { simulation, world } = adventure(island, () => 5000, 39);
    expect(world.cellsX).toBe(64);
    simulation.startAdventure({ island, troops: troops(2) });
    const saved = simulation.saveState();
    const record = { enemies: 15, island, status: "contested" as const, version: 1 as const };
    const legacy = { ...saved, adventure: record };
    const { simulation: reloaded } = adventure(island, () => 5000, 39);
    expect(reloaded.loadState(legacy)).toEqual({ ok: true });
    expect(reloaded.home()).toMatchObject({ colonyHome: true, typeId: 39 });
    expect(reloaded.shipSites().some(site => site.kind === "dock")).toBe(false);
  }, 30000);
});
