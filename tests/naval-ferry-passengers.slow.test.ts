import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { isFerryLoad } from "../src/shared/settlement/settlement-naval-ferries";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

/**
 * Passengers by boat (owner, 2026-10-21) on a real island: land in the west, open sea from x = 36; two harbours
 * on the coast, one own ship on the water. Settlers (and soldiers) sail from the north harbour to the south one.
 */
const SIZE = 64, COAST = 36;
const coastWorld = (secondLandmass = false) => {
  const heights = new Float32Array((SIZE + 1) ** 2);
  for (let z = 0; z <= SIZE; z++) for (let x = COAST; x <= SIZE; x++) heights[z * (SIZE + 1) + x] = -2;
  const data = { seed: 4, cellsX: SIZE, cellsZ: SIZE, seaLevel: -1, start: { x: 12.5, z: 32.5 }, heights,
    blocking: new Uint8Array(SIZE ** 2), walkCost: new Uint8Array(SIZE ** 2).fill(10),
    buildClass: new Uint8Array(SIZE ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(SIZE ** 2), mineZone: new Uint16Array(SIZE ** 2), mineZones: [],
    props: { count: 0, scale: new Float32Array(), types: new Uint8Array(), x: new Float32Array(),
      z: new Float32Array() }
  } as unknown as WorldData;
  for (let z = 0; z < SIZE; z++) for (let x = COAST; x < SIZE; x++) {
    data.walkCost[z * SIZE + x] = 0; data.blocking[z * SIZE + x] = 1;
  }
  // A second landmass where a test needs real scouting: it is hidden on a one-island map.
  if (secondLandmass) for (let z = 2; z <= 12; z++) for (let x = 48; x <= 60; x++) {
    data.walkCost[z * SIZE + x] = 10; data.blocking[z * SIZE + x] = 0;
    data.buildClass[z * SIZE + x] = BUILD.large;
    data.heights[z * (SIZE + 1) + x] = .5;
  }
  return data;
};
type Simulation = ReturnType<typeof createSettlementSimulation>;
const create = (world: WorldData) => {
  let simulation: Simulation;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ canWorkerEnterPlot: () => true, initialSettlers: 40,
    initialStock: { planks: 200, stone: 100 }, now: () => 50_000, playerLevel: () => 1, roads,
    unlockAllBuildings: true, world });
  return simulation;
};

interface Options { boats?: number; busy?: boolean; destinationBoats?: number; scoutIsland?: boolean }
/** Two finished harbours (north `boats`, south `destinationBoats` stored), road-linked, and one idle ship. */
const island = ({ boats = 0, busy = false, destinationBoats = 0, scoutIsland = false }: Options = {}) => {
  const world = coastWorld(scoutIsland), built = create(world);
  const [width, depth] = getBuildingDefinition(39).gridFootprint;
  const harbour = (z: number, stored: number) => {
    const placed = built.placeBuilding(39, Math.floor(32 - width / 2) + width / 2,
      Math.floor(z - depth / 2) + depth / 2);
    expect(placed.ok, placed.reason).toBe(true);
    Object.assign(placed.building!, { construction: 1, input: {}, required: {}, worker: undefined });
    expect(built.connectRoads(built.headquarters.access, placed.building!.access)).toBe(true);
    // Rowers: settlers resting in the harbour (moved from the headquarters, the island's count unchanged).
    placed.building!.inventory = { boat: stored };
    placed.building!.idleSettlers = 14;
    built.headquarters.idleSettlers = (built.headquarters.idleSettlers ?? 0) - 14;
    return placed.building!.uid;
  };
  const source = harbour(14, boats), destination = harbour(50, destinationBoats);
  built.update(.05);
  const saved = JSON.parse(JSON.stringify(built.saveState()));
  saved.naval.fleet.ships.push({ cargo: {}, cargoCount: 0, cursor: 0, id: saved.naval.fleet.nextShip, phase: "idle",
    route: [], speed: 0, timer: 0, x: 48.5, y: -1, yaw: 0, z: 30.5 });
  saved.naval.fleet.nextShip++;
  const simulation = create(world);
  expect(simulation.loadState(saved)).toEqual({ ok: true });
  if (busy) occupyPier(simulation, source);
  return { destination, simulation, source, world };
};
/** Long supply visitors take every berth of harbour `uid` (its pier is busy while they unload). */
const occupyPier = (simulation: Simulation, uid: number) => {
  const berths = simulation.harbourBerths(uid).length;
  const held = () => simulation.saveState().naval.fleet.ships.filter(ship => ship.visitor &&
    ship.phase === "unloading" && ship.destinationUid === uid).length;
  for (let visitor = 0; visitor < 2 * berths + 1; visitor++)
    expect(simulation.sendVisitorShip({ stone: 3000 }, [], "reward")).not.toBeNull();
  for (let tick = 0; tick < 4000 && held() < berths; tick++) simulation.update(.25);
  expect(held()).toBe(berths);
};
const reload = (simulation: Simulation, world: WorldData) => {
  const saved = JSON.parse(JSON.stringify(simulation.saveState())), restored = create(world);
  expect(restored.loadState(saved)).toEqual({ ok: true });
  return restored;
};
/** The island's people as the game counts them, births aside: inside, out, rowing or aboard (none lost or doubled). */
const people = (simulation: Simulation) => simulation.population().people - simulation.settlerBirths();

interface Trip { boarded: number; dockedAtPier: boolean; ferried: boolean; seen: Set<string>; settled: boolean }
/** Runs until every passenger is ashore at the destination (or `seconds`), noting how the ship was worked. */
const sail = (simulation: () => Simulation, seconds = 1500, each?: () => void): Trip => {
  const trip: Trip = { boarded: 0, dockedAtPier: false, ferried: false, seen: new Set(), settled: false };
  let loading = 0;
  for (let tick = 0; tick < seconds / .25; tick++) {
    simulation().update(.25);
    each?.();
    const ship = simulation().ships().find(each => !each.visitor)!;
    const frame = simulation().shipFrames().find(each => each.id === ship.id);
    if (ship.phase === "loading") loading = tick;
    // Loaded: seconds from the order until the ship leaves its loading (any wait for a berth included).
    if (ship.phase !== "loading" && loading && !trip.boarded) trip.boarded = (tick + 1) * .25;
    trip.ferried ||= Boolean(frame?.lighterWork);
    trip.dockedAtPier ||= Boolean(frame?.cargoWork) || simulation().frames().some(actor =>
      actor.phase === "navalBoarding" || actor.phase === "navalDisembark");
    for (const actor of simulation().frames()) if (actor.navalOrder !== undefined) trip.seen.add(actor.phase);
    if (trip.boarded && ship.phase === "idle" && !simulation().frames().some(actor => actor.navalOrder !== undefined)) {
      trip.settled = true; break;
    }
  }
  return trip;
};

describe("passengers by boat (owner, 2026-10-21)", () => {
  it("ferries settlers out by lighter while the pier is busy, a barge load per trip; lands at a free pier", () => {
    const { destination, simulation, source } = island({ boats: 2, busy: true });
    const before = people(simulation);
    expect(simulation.queueSeaPassengers(source, destination, 3)).not.toBeNull();
    let riders = 0;
    const trip = sail(() => simulation, 1500, () => {
      expect(people(simulation)).toBe(before);
      riders = Math.max(riders, simulation.frames().filter(actor => actor.phase === "navalFerry" &&
        !actor.visible).length);
    });
    expect(trip.settled).toBe(true);
    expect(trip.ferried).toBe(true);
    expect(trip.seen.has("navalFerry")).toBe(true);
    // Loaded by boat, unloaded over the destination's free pier.
    expect(trip.seen.has("navalDisembark")).toBe(true);
    expect(riders).toBeGreaterThan(1);
    expect(people(simulation)).toBe(before);
  }, 120000);

  it("docks at a free pier as before, even where both harbours have lighters", () => {
    const { destination, simulation, source } = island({ boats: 2, destinationBoats: 2 });
    expect(simulation.queueSeaPassengers(source, destination, 2)).not.toBeNull();
    const trip = sail(() => simulation);
    expect(trip.settled).toBe(true);
    expect(trip.ferried).toBe(false);
    expect(trip.dockedAtPier).toBe(true);
  }, 120000);

  it("ferries only settlers and scouts: anything military keeps the ship at the pier", () => {
    const soldier = (uid: number) => uid === 9;
    expect(isFerryLoad({ passengers: [1, 2] }, soldier)).toBe(true);
    expect(isFerryLoad({ passengers: [1, 9] }, soldier)).toBe(false);
    expect(isFerryLoad({ passengers: [1], troops: [{ hp: 100, rank: 1, type: "shield" }] }, soldier)).toBe(false);
    expect(isFerryLoad({ passengers: [] }, soldier)).toBe(false);
  });

  it("restores a settler in the boat after a save mid-trip, and returns the rest ashore on cancel", () => {
    const setup = island({ boats: 2, busy: true });
    let simulation = setup.simulation;
    const order = simulation.queueSeaPassengers(setup.source, setup.destination, 4)!;
    const inBoat = () => simulation.frames().some(actor => actor.phase === "navalFerry" && !actor.visible);
    for (let tick = 0; tick < 4000 && !inBoat(); tick++) simulation.update(.25);
    expect(inBoat()).toBe(true);
    const before = people(simulation);
    simulation = reload(simulation, setup.world);
    expect(people(simulation)).toBe(before);
    simulation.update(.25);
    expect(inBoat()).toBe(true);
    expect(simulation.cancelSeaTransport(order)).toBe(true);
    // Those still ashore or in a boat go back into the harbour; those aboard sail back and land there.
    sail(() => simulation, 900);
    expect(simulation.frames().filter(actor => actor.navalOrder !== undefined)).toEqual([]);
    expect(people(simulation)).toBe(before);
  }, 120000);

  it("keeps one spyglass with a real Scout ferry rider through restore and one cancellation", () => {
    const setup = island({ boats: 2, busy: true, scoutIsland: true });
    let simulation = setup.simulation;
    const source = simulation.buildings().find(building => building.uid === setup.source)!;
    source.inventory.spyglass = 1;
    source.inventory.bow = 7;
    const before = people(simulation);
    const order = simulation.queueSeaExploration(setup.source)!;
    expect(order).not.toBeNull();
    const inBoat = () => simulation.frames().some(actor => actor.job === "Scout" &&
      actor.phase === "navalFerry" && !actor.visible);
    for (let tick = 0; tick < 4000 && !inBoat(); tick++) simulation.update(.25);
    expect(inBoat()).toBe(true);
    expect(source.inventory.spyglass).toBe(0);
    const crew = simulation.frames().filter(actor => actor.navalOrder === order);
    expect(crew).toHaveLength(1);
    expect(crew.every(actor => actor.job === "Scout" && actor.tool === "spyglass")).toBe(true);
    simulation = reload(simulation, setup.world);
    expect(inBoat()).toBe(true);
    expect(people(simulation)).toBe(before);
    expect(simulation.cancelSeaTransport(order)).toBe(true);
    expect(simulation.cancelSeaTransport(order)).toBe(false);
    sail(() => simulation, 900);
    const returned = simulation.buildings().find(building => building.uid === setup.source)!;
    expect(returned.inventory.spyglass).toBe(1);
    expect(returned.inventory.bow).toBe(7);
    expect(simulation.frames().filter(actor => actor.navalOrder !== undefined)).toEqual([]);
    expect(people(simulation)).toBe(before);
    simulation = reload(simulation, setup.world);
    for (let tick = 0; tick < 240; tick++) simulation.update(.25);
    expect(simulation.buildings().find(building => building.uid === setup.source)!.inventory.spyglass).toBe(1);
    expect(simulation.cancelSeaTransport(order)).toBe(false);
  }, 120000);

  it("measures loading 2 and 10 settlers: free pier, busy pier with lighters, busy pier waiting for a berth", () => {
    const loadingSeconds = (settlers: number, busy: boolean, boats: number) => {
      const { destination, simulation, source } = island({ boats, busy });
      expect(simulation.queueSeaPassengers(source, destination, settlers)).not.toBeNull();
      const trip = sail(() => simulation, 2400);
      return { ferried: trip.ferried, seconds: trip.boarded };
    };
    const times = [2, 10].map(settlers => ({ settlers, free: loadingSeconds(settlers, false, 2),
      lighters: loadingSeconds(settlers, true, 2), wait: loadingSeconds(settlers, true, 0) }));
    process.stderr.write(`\nFERRY ${JSON.stringify(times)}`);
    // By boat only where it is sooner than waiting for the pier (the rule estimates both).
    for (const row of times) {
      expect(row.free.ferried).toBe(false);
      expect(row.lighters.seconds).toBeLessThanOrEqual(row.wait.seconds);
    }
  }, 240000);
});
