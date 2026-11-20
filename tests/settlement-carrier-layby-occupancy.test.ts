import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { CARRIER_CLAIM_LEASE_TICKS, carrierClaimProgress } from "../src/shared/settlement/settlement-carrier-claims";
import { selectCarrierFleet } from "../src/shared/settlement/settlement-carrier-fleet";
import {
  cartLayByBooking,
  claimCartLayBys,
  expireLayByClaims,
  findLayByOccupant,
  refreshLayByClaimsOnProgress
} from "../src/shared/settlement/settlement-carrier-laybys";
import { cancelEmptyTrip } from "../src/shared/settlement/settlement-handcart-ledger";
import { validateSavedActors } from "../src/shared/settlement/settlement-save-actors";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type {
  SettlementActor,
  SettlementBuilding,
  SettlementContext,
  SettlementHandcart,
  SettlementHandcartTrip
} from "../src/shared/settlement/settlement-types";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const DESTINATION = 21; // Butcher: a local input, so HQ stock must travel by carrier.
const createWorld = () => {
  const size = 64;
  return { seed: 3, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 8, z: 8 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array() }
  } as unknown as WorldData;
};

/** Headquarters and a storehouse joined by a stone road, with carts at the HQ. */
const fixture = () => {
  const world = createWorld();
  let blocked: ((x: number, z: number) => boolean) | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => blocked?.(x, z) ?? false });
  const simulation = createSettlementSimulation({ world, roads, initialSettlers: 40,
    initialStock: { iron: 10, logs: 40, planks: 20, saw: 2, stone: 200 }, resourceTargets: () => [] });
  blocked = simulation.isOccupied;
  const [width, depth] = getBuildingDefinition(DESTINATION).gridFootprint;
  const placed = simulation.placeBuilding(DESTINATION, 30 + width % 2 / 2, 9 + depth % 2 / 2);
  expect(placed.ok, placed.reason).toBe(true);
  const storehouse = placed.building!;
  Object.assign(storehouse, { construction: 1, required: {} });
  const headquarters = simulation.headquarters;
  expect(simulation.connectRoads(headquarters.access, storehouse.access)).toBe(true);
  expect(simulation.upgradeRoad(headquarters.access, storehouse.access)).toBeTruthy();
  headquarters.handcarts = 1;
  const context = { actors: simulation.frames(), buildings: simulation.buildings(),
    clock: { tick: () => 0 }, navigationRevision: 1,
    options: { roads, world } } as unknown as SettlementContext;
  const advance = (seconds: number, until?: () => boolean) => {
    for (let tick = 0; tick < seconds * 20; tick++) {
      simulation.update(.05);
      if (until?.()) return true;
    }
    return false;
  };
  const crews = () => simulation.frames().filter(actor => actor.handcart);
  const deliveries = () => simulation.frames().filter(actor => actor.delivery?.ware === "stone" && !actor.handcart);
  return { advance, context, crews, deliveries, headquarters, simulation, storehouse };
};

const claim = (bay: number, actor: number, x = 10, z = 10) => ({
  bay, x, z, walk: 1, actor, leaseStartedTick: 0, leaseDeadlineTick: 600
});

const synthetic = (tick: () => number) => {
  const building = { uid: 7 } as SettlementBuilding;
  const trip: SettlementHandcartTrip = { source: 7, destination: 8, ware: "stone",
    planned: 2, loaded: 2, delivered: 0, prepaid: 0, capacity: 2,
    leaseStartedTick: 0, leaseDeadlineTick: 600 };
  const cart: SettlementHandcart = { owner: 7, state: "parked", cargo: 2, trip,
    parked: { x: 12.5, z: 9.5, yaw: .5 },
    bays: { source: claim(7, 1), destination: claim(8, 1, 11, 10) } };
  const actor = { uid: 1, x: 3, z: 4, y: 0, yaw: 0, visible: true, job: "Carrier",
    action: "idle", phase: "cartRecover", building: 7, home: 7, ware: null, path: [],
    pathIndex: 0, timer: 0, animationTime: 0, handcart: cart } as SettlementActor;
  const context = { actors: [actor], buildings: [building], clock: { tick } } as unknown as SettlementContext;
  return { actor, building, cart, context };
};

describe("lay-by occupancy and lifecycle", () => {
  it("reserves both end bays at dispatch and refuses a second cart on the same bay", () => {
    const { advance, context, crews, deliveries, headquarters, simulation, storehouse } = fixture();
    headquarters.handcarts = 2;
    simulation.transferWare(headquarters.uid, storehouse.uid, "stone", 3);
    expect(advance(5, () => crews().length > 0)).toBe(true);
    const crew = crews()[0]!;
    expect(crew.handcart!.bays).toMatchObject({
      source: { actor: crew.uid, bay: headquarters.uid },
      destination: { actor: crew.uid, bay: storehouse.uid }
    });
    expect(crew.handcart!.bays!.source!.leaseDeadlineTick)
      .toBeGreaterThan(crew.handcart!.bays!.source!.leaseStartedTick!);

    // The second plan must see the occupied source/destination bays and never reserve one twice.
    expect(selectCarrierFleet(context, headquarters, storehouse, "stone", 3).fleet).toBe("cartless");
    expect(claimCartLayBys(context, 999, headquarters, storehouse)).toBeUndefined();
    // Owner cart priority (2026-11-08): the cart-worthy job waits for the bay instead of walkers,
    // while a small job still goes to a walker at once.
    simulation.transferWare(headquarters.uid, storehouse.uid, "stone", 3);
    expect(advance(2, () => deliveries().length > 0)).toBe(false);
    simulation.transferWare(headquarters.uid, storehouse.uid, "stone", 1);
    expect(advance(2, () => deliveries().length > 0)).toBe(true);
    expect(advance(60, () => crews().length === 2)).toBe(true);
  });

  it("releases the source bay on departure and the destination bay on completion", () => {
    const { advance, context, crews, headquarters, simulation, storehouse } = fixture();
    simulation.transferWare(headquarters.uid, storehouse.uid, "stone", 3);
    expect(advance(30, () => crews().some(actor => actor.phase === "cartToDestination"))).toBe(true);
    const travelling = crews().find(actor => actor.phase === "cartToDestination")!;
    expect(travelling.handcart!.bays?.source).toBeUndefined();
    expect(travelling.handcart!.bays?.destination).toMatchObject({ bay: storehouse.uid });

    expect(advance(80, () => crews().length === 0)).toBe(true);
    expect(cartLayByBooking(context, headquarters, storehouse)).toBeDefined();
  });

  it("expires stale ownership at the deterministic deadline without moving cart or cargo", () => {
    let tick = 0;
    const { building, cart, context } = synthetic(() => tick);
    const bay = { x: 10, z: 10 };
    tick = 599;
    expect(findLayByOccupant(context, building, bay)?.actor).toBe(1);
    expect(expireLayByClaims(context, cart)).toBe(false);

    tick = 600;
    expect(findLayByOccupant(context, building, bay)).toBeUndefined();
    expect(expireLayByClaims(context, cart)).toBe(true);
    expect(cart.bays).toBeUndefined();
    expect(cart.cargo).toBe(2);
    expect(cart.state).toBe("parked");
    expect(cart.parked).toEqual({ x: 12.5, z: 9.5, yaw: .5 });
    expect(cart.trip?.planned).toBe(2);
  });

  it("refreshes a bay lease only after real movement or handling", () => {
    const tick = 300;
    const { actor, cart, context } = synthetic(() => tick);
    const before = carrierClaimProgress(actor);
    refreshLayByClaimsOnProgress(context, actor, before);
    expect(cart.bays!.source!.leaseDeadlineTick).toBe(600);

    actor.x = 4;
    refreshLayByClaimsOnProgress(context, actor, before);
    expect(cart.bays!.source).toMatchObject({ leaseStartedTick: 300,
      leaseDeadlineTick: 300 + CARRIER_CLAIM_LEASE_TICKS });
    expect(cart.bays!.destination).toMatchObject({ leaseStartedTick: 300,
      leaseDeadlineTick: 300 + CARRIER_CLAIM_LEASE_TICKS });
  });

  it("releases both saved bays when an empty trip is cancelled", () => {
    const tick = 0;
    const { cart, context } = synthetic(() => tick);
    cancelEmptyTrip(context, cart);
    expect(cart.bays).toBeUndefined();
    expect(cart.trip).toBeUndefined();
  });

  it("save/reload keeps the claim and rejects duplicate ownership on load", () => {
    const { advance, crews, headquarters, simulation, storehouse } = fixture();
    simulation.transferWare(headquarters.uid, storehouse.uid, "stone", 3);
    expect(advance(30, () => crews().some(actor => actor.phase === "cartToDestination"))).toBe(true);
    const saved = JSON.parse(JSON.stringify(simulation.saveState()));
    const savedCrew = saved.actors.find((actor: SettlementActor) => actor.handcart?.bays);
    expect(savedCrew).toBeDefined();
    expect(savedCrew.handcart.bays.destination)
      .toMatchObject({ bay: savedCrew.handcart.trip.destination });

    expect(simulation.loadState(saved)).toEqual({ ok: true });
    const resumed = crews().find(actor => actor.handcart?.bays);
    expect(resumed?.handcart?.bays).toEqual(savedCrew.handcart.bays);

    const ids = new Set<number>(saved.buildings.map((building: SettlementBuilding) => building.uid));
    const duplicate = JSON.parse(JSON.stringify(savedCrew));
    duplicate.uid = 9999;
    for (const role of ["source", "destination"] as const)
      if (duplicate.handcart.bays[role]) duplicate.handcart.bays[role].actor = 9999;
    expect(validateSavedActors([savedCrew, duplicate], ids, new Set()))
      .toBe("Duplicate lay-by occupancy");

    const corrupt = JSON.parse(JSON.stringify(savedCrew));
    corrupt.handcart.bays.destination.bay = 99999;
    expect(validateSavedActors([corrupt], ids, new Set()))
      .toBe("Invalid hand cart lay-by claim");
  });
});
