import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementActor } from "../src/shared/settlement/settlement-types";
import { islandStorageCapacity } from "../src/shared/settlement/storage-capacity";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const worldFixture = () => {
  const size = 64;
  return { seed: 3, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 8, z: 8 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array() }
  } as unknown as WorldData;
};

const fixture = (stone: boolean, initialSettlers = 40) => {
  const world = worldFixture();
  let blocked: ((x: number, z: number) => boolean) | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => blocked?.(x, z) ?? false });
  const simulation = createSettlementSimulation({ world, roads, initialSettlers,
    initialStock: { logs: 50, planks: 50, stone: 500, saw: 1 }, resourceTargets: () => [] });
  blocked = simulation.isOccupied;
  const place = (id: number, x: number, z: number) => {
    const [width, depth] = getBuildingDefinition(id).gridFootprint;
    const result = simulation.placeBuilding(id, x + width % 2 / 2, z + depth % 2 / 2);
    expect(result.ok, result.reason).toBe(true);
    Object.assign(result.building!, { construction: 1, required: {}, productionPaused: true });
    return result.building!;
  };
  const source = place(33, 30, 9), destination = place(29, 44, 30), home = simulation.headquarters;
  for (const [a, b] of [[home, source], [source, destination]]) {
    expect(simulation.connectRoads(a!.access, b!.access)).toBe(true);
    if (stone) expect(simulation.upgradeRoad(a!.access, b!.access)).toBeTruthy();
  }
  home.handcarts = stone ? 1 : 0;
  const advance = (until: () => boolean, seconds = 120) => {
    for (let tick = 0; tick < seconds * 20; tick++) {
      if (until()) return true;
      simulation.update(.05);
    }
    return until();
  };
  return { advance, destination, home, simulation, source };
};

it("keeps one cart, crew and original owner through a claimed three-stop handover and full reload", () => {
  const { advance, destination, home, simulation, source } = fixture(true);
  expect(simulation.transferWare(home.uid, source.uid, "logs", 2)).toBe(true);
  let actor: SettlementActor | undefined;
  expect(advance(() => {
    actor = simulation.frames().find(person => person.phase === "cartUnloading" &&
      person.handcart?.trip?.destination === source.uid);
    return Boolean(actor);
  })).toBe(true);
  const id = actor!.uid, cart = actor!.handcart;
  // A finite production receipt becomes ready while this crew is still putting down the logs.
  source.output.planks = 2;
  expect(simulation.transferWare(source.uid, destination.uid, "planks", 2)).toBe(true);
  expect(advance(() => actor!.nextDelivery !== undefined, 2)).toBe(true);
  expect(actor!.nextDelivery).toMatchObject({ source: source.uid, destination: destination.uid,
    mode: "handcart", ware: "planks", units: 2 });
  expect(actor!.handcart!.trip!.ware).toBe("logs");
  expect(actor!.handcart!.cargo).toBeGreaterThan(0);
  expect(source.output.planks).toBe(2);
  expect(destination.incoming.planks).toBe(2);
  // The next claim owns the final two slots; handover must not count its own incoming twice.
  home.inventory.planks = islandStorageCapacity(simulation.buildings()).capacity - 2;
  const finalPooledPlanks = home.inventory.planks + 2;
  const saved = simulation.saveState();
  const restored = fixture(true);
  expect(restored.simulation.loadState(saved)).toEqual({ ok: true });
  for (const branch of [simulation, restored.simulation]) {
    let reused: SettlementActor | undefined;
    for (let tick = 0; tick < 100; tick++) {
      reused = branch.frames().find(person => person.uid === id &&
        person.handcart?.trip?.source === source.uid && person.handcart.trip.destination === destination.uid);
      if (reused) break;
      branch.update(.05);
    }
    expect(reused).toBeDefined();
    expect(reused!.home).toBe(home.uid);
    expect(reused!.handcart!.owner).toBe(home.uid);
    if (branch === simulation) expect(reused!.handcart).toBe(cart);
    if (branch === restored.simulation) {
      const handover = branch.saveState(), trip = structuredClone(reused!.handcart!.trip);
      expect(branch.loadState(handover)).toEqual({ ok: true });
      reused = branch.frames().find(person => person.uid === id);
      expect(reused!.handcart!.trip).toEqual(trip);
      for (let tick = 0; tick < 100 && !(reused!.handcart!.cargo > 0); tick++) branch.update(.05);
      expect(reused!.handcart!.cargo).toBeGreaterThan(0);
      expect(branch.loadState(branch.saveState())).toEqual({ ok: true });
    }
    let completed = false;
    for (let tick = 0; tick < 2400; tick++) {
      branch.update(.05);
      if ((branch.buildings().find(building => building.uid === destination.uid)!.inventory.planks ?? 0) === finalPooledPlanks) {
        completed = true; break;
      }
    }
    expect(completed).toBe(true);
    expect(branch.buildings().find(building => building.uid === destination.uid)!.handcarts).toBe(1);
    expect(branch.buildings().find(building => building.uid === source.uid)!.input.logs).toBe(2);
    expect(branch.buildings().find(building => building.uid === source.uid)!.output.planks).toBe(0);
    expect(branch.frames().filter(person => person.job === "Carrier" && person.uid !== id &&
      (person.delivery?.ware === "planks" || person.handcart?.trip?.ware === "planks"))).toHaveLength(0);
  }
});

it("reuses the walking carrier for a return load after the physical putdown", () => {
  const { advance, home, simulation, source } = fixture(false);
  expect(simulation.transferWare(home.uid, source.uid, "logs", 1)).toBe(true);
  let actor: SettlementActor | undefined;
  expect(advance(() => {
    actor = simulation.frames().find(person => person.phase === "deliveryTransfer" &&
      person.delivery?.destination === source.uid);
    return Boolean(actor);
  })).toBe(true);
  const id = actor!.uid, before = home.inventory.planks ?? 0;
  source.output.planks = 1;
  expect(simulation.transferWare(source.uid, home.uid, "planks", 1)).toBe(true);
  expect(advance(() => actor!.delivery?.source === source.uid && actor!.delivery.destination === home.uid, 3))
    .toBe(true);
  expect(actor!.uid).toBe(id);
  expect(actor!.home).toBe(home.uid);
  expect(source.input.logs).toBe(1);
  expect(advance(() => (home.inventory.planks ?? 0) === before + 1)).toBe(true);
  expect(source.output.planks).toBe(0);
  expect(simulation.frames().filter(person => person.uid !== id && person.delivery?.ware === "planks"))
    .toHaveLength(0);
});

it("reuses a returning carrier from its real position for a storage pickup", () => {
  const { advance, destination, home, simulation, source } = fixture(false, 1);
  expect(simulation.transferWare(home.uid, source.uid, "logs", 1)).toBe(true);
  let actor: SettlementActor | undefined;
  expect(advance(() => {
    actor = simulation.frames().find(person => person.phase === "deliveryTransfer" &&
      person.delivery?.destination === source.uid);
    return Boolean(actor);
  })).toBe(true);
  expect(advance(() => actor!.phase === "home" && actor!.ware === null && !actor!.delivery, 5)).toBe(true);
  const start = { x: actor!.x, z: actor!.z };
  home.inventory.boat = 1;
  expect(simulation.transferWare(home.uid, destination.uid, "boat", 1)).toBe(true);
  let pathStart: { x: number; z: number } | undefined;
  for (let tick = 0; tick < 60 && !pathStart; tick++) {
    simulation.update(.05);
    if (actor!.delivery?.source === home.uid) pathStart = actor!.path[0];
  }
  expect(pathStart).toBeDefined();
  expect(actor!.phase).toBe("pickup");
  expect(Math.hypot(pathStart!.x - start.x, pathStart!.z - start.z)).toBeLessThan(1.5);
});

it("repairs a saved carrier route that starts at a storage while the carrier is elsewhere", () => {
  const { advance, destination, home, simulation, source } = fixture(false);
  expect(simulation.transferWare(home.uid, source.uid, "logs", 1)).toBe(true);
  let actor: SettlementActor | undefined;
  expect(advance(() => {
    actor = simulation.frames().find(person => person.phase === "deliveryTransfer" &&
      person.delivery?.destination === source.uid);
    return Boolean(actor);
  })).toBe(true);
  expect(advance(() => actor!.phase === "home" && actor!.ware === null, 5)).toBe(true);
  const saved = simulation.saveState();
  const malformed = saved.actors.find(person => person.uid === actor!.uid)!;
  Object.assign(malformed, { phase: "exitLoaded", ware: "planks", pathIndex: 0,
    path: [{ ...home.access }, { ...destination.access }],
    delivery: { source: home.uid, destination: destination.uid, ware: "planks" } });
  const away = { x: source.access.x, z: source.access.z };
  malformed.x = away.x; malformed.z = away.z;
  malformed.y = 0;
  expect(simulation.loadState(saved)).toEqual({ ok: true });
  const repaired = simulation.frames().find(person => person.uid === actor!.uid)!;
  expect(repaired.phase).toBe("exitLoaded");
  expect(repaired.delivery).toMatchObject({ source: home.uid, destination: destination.uid, ware: "planks" });
  expect(Math.hypot(repaired.path[0]!.x - away.x, repaired.path[0]!.z - away.z)).toBeLessThan(1.5);
});

it("chooses largest real remaining need before route distance, then nearest route before queue age", () => {
  for (const farNeed of [2, 1]) {
    const { advance, destination, home, simulation, source } = fixture(false);
    expect(simulation.transferWare(home.uid, source.uid, "logs", 1)).toBe(true);
    let actor: SettlementActor | undefined;
    expect(advance(() => {
      actor = simulation.frames().find(person => person.phase === "deliveryTransfer" &&
        person.delivery?.destination === source.uid);
      return Boolean(actor);
    })).toBe(true);
    source.output.planks = farNeed + 1;
    // The farther order is older. Equal need must still choose the shorter real road to home.
    expect(simulation.transferWare(source.uid, destination.uid, "planks", farNeed)).toBe(true);
    expect(simulation.transferWare(source.uid, home.uid, "planks", 1)).toBe(true);
    expect(advance(() => actor!.delivery?.source === source.uid, 3)).toBe(true);
    const expected = farNeed > 1 ? destination.uid : home.uid;
    expect(actor!.delivery!.destination).toBe(expected);
    expect(actor!.home).toBe(home.uid);
  }
});

it("cancels a lost next target before pickup and preserves real cargo after pickup", () => {
  for (const pickedUp of [false, true]) {
    const { advance, destination, home, simulation, source } = fixture(true);
    expect(simulation.transferWare(home.uid, source.uid, "logs", 2)).toBe(true);
    let actor: SettlementActor | undefined;
    expect(advance(() => {
      actor = simulation.frames().find(person => person.phase === "cartUnloading" &&
        person.handcart?.trip?.destination === source.uid);
      return Boolean(actor);
    })).toBe(true);
    source.output.planks = 2;
    expect(simulation.transferWare(source.uid, destination.uid, "planks", 2)).toBe(true);
    expect(advance(() => Boolean(actor!.nextDelivery), 2)).toBe(true);
    if (pickedUp) expect(advance(() => actor!.handcart?.trip?.ware === "planks" &&
      actor!.handcart.cargo > 0, 5)).toBe(true);
    const trip = structuredClone(actor!.handcart!.trip), cargo = actor!.handcart!.cargo;
    const stock = source.output.planks ?? 0, homeStock = home.inventory.planks ?? 0;
    expect(simulation.demolishBuilding(destination.uid).ok).toBe(true);
    expect(actor!.nextDelivery).toBeUndefined();
    expect(source.output.planks ?? 0).toBe(stock);
    expect(home.inventory.planks ?? 0).toBe(homeStock);
    expect(actor!.handcart!.cargo).toBe(cargo);
    if (!pickedUp) expect(actor!.handcart!.trip).toEqual(trip);
    else expect(actor!.handcart!.trip!.ware).toBe("planks");
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
  }
});
