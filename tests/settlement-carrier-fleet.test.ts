import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { cartCapacityFor } from "../src/render-common/logistics/handcart-rules";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { selectCarrierFleet } from "../src/shared/settlement/settlement-carrier-fleet";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementActor, SettlementContext } from "../src/shared/settlement/settlement-types";
import { ensureWorkerMovementPlan } from "../src/shared/settlement/settlement-worker-movement-plan";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const DESTINATION = 21; // Butcher: a local input, so HQ stock must travel by carrier.
const STORAGE = 29;
const createWorld = () => {
  const size = 64;
  return { seed: 3, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 8, z: 8 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array() }
  } as unknown as WorldData;
};

/** Headquarters and a storehouse joined by a dirt or stone road, with one cart at the HQ. */
const fixture = (stone = true) => {
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
  if (stone) expect(simulation.upgradeRoad(headquarters.access, storehouse.access)).toBeTruthy();
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
  return { advance, context, headquarters, roads, simulation, storehouse, world };
};

const handcartCrew = (simulation: ReturnType<typeof fixture>["simulation"]) =>
  simulation.frames().find(actor => actor.handcart?.trip);

const deliveryCrew = (simulation: ReturnType<typeof fixture>["simulation"]) =>
  simulation.frames().find(actor => actor.delivery?.ware === "stone" && !actor.handcart);

describe("carrier fleet assignment", () => {
  it("selects a handcart with the ware capacity on a complete stone route", () => {
    const { context, headquarters, storehouse } = fixture();
    const assignment = selectCarrierFleet(context, headquarters, storehouse, "stone", 3);
    expect(assignment).toMatchObject({ fleet: "handcart", capacity: cartCapacityFor("stone"), units: 3,
      depot: headquarters });
  });

  it("dispatches exactly the fleet, capacity and unit count the plan selected", () => {
    const { advance, context, headquarters, simulation, storehouse } = fixture();
    const assignment = selectCarrierFleet(context, headquarters, storehouse, "stone", 3);
    simulation.transferWare(headquarters.uid, storehouse.uid, "stone", 3);
    expect(advance(2, () => handcartCrew(simulation) !== undefined)).toBe(true);
    const trip = handcartCrew(simulation)!.handcart!.trip!;
    expect(trip.planned).toBe(assignment.units);
    expect(trip.capacity).toBe(assignment.capacity);
    expect(storehouse.incoming.stone).toBe(assignment.units);
  });

  it("carries the selected fleet and capacity in a handcart movement manifest", () => {
    const { advance, context, headquarters, simulation, storehouse } = fixture();
    simulation.transferWare(headquarters.uid, storehouse.uid, "stone", 3);
    expect(advance(2, () => handcartCrew(simulation) !== undefined)).toBe(true);
    const crew = handcartCrew(simulation)!;
    const plan = ensureWorkerMovementPlan(context, crew)!;
    expect(plan.manifest).toMatchObject({
      source: headquarters.uid, destination: storehouse.uid, ware: "stone", units: 3,
      fleet: "handcart", capacity: cartCapacityFor("stone")
    });
    expect(plan.claims?.leaseStartedTick).toBe(crew.handcart!.trip!.leaseStartedTick);
    expect(plan.claims?.leaseDeadlineTick).toBe(crew.handcart!.trip!.leaseDeadlineTick);
  });

  it("falls back to the visible cartless capacity-1 carrier on dirt", () => {
    const { advance, context, headquarters, simulation, storehouse } = fixture(false);
    expect(selectCarrierFleet(context, headquarters, storehouse, "stone", 3).fleet).toBe("cartless");
    simulation.transferWare(headquarters.uid, storehouse.uid, "stone", 3);
    expect(advance(2, () => deliveryCrew(simulation) !== undefined)).toBe(true);
    expect(handcartCrew(simulation)).toBeUndefined();
    const crew: SettlementActor = deliveryCrew(simulation)!;
    expect(crew.wareUnits ?? 1).toBe(1);
    expect(crew.delivery!.leaseDeadlineTick).toBeGreaterThan(crew.delivery!.leaseStartedTick!);
  });

  it("refuses the cart fleet when the stone route has no valid lay-by", () => {
    const storage = (uid: number, extra: Record<string, unknown> = {}) => ({
      uid, typeId: STORAGE, x: uid * 20, z: 0, y: 0, width: 5, depth: 5, rotation: 0,
      access: { x: uid * 20, z: 3 }, workerApproach: { x: uid * 20, z: 2.5 },
      doorThreshold: { x: uid * 20, z: 1 }, hasDoor: true, construction: 1, working: false,
      door: 0, status: "", input: {}, output: {}, inventory: {}, incoming: {}, required: {},
      accepts: {}, selected: false, cycle: 0, ...extra
    });
    const source = storage(0, { handcarts: 1, idleSettlers: 1, inventory: { stone: 3 } });
    const destination = storage(1);
    const roads = {
      revision: 1,
      route: () => ({ points: [], cost: 1, length: 1 }),
      stoneRoute: () => ({ points: [], cost: 1, length: 1 }),
      segments: () => []
    };
    const context = { actors: [], buildings: [source, destination], clock: { tick: () => 0 },
      options: { roads, world: { cellsX: 64, cellsZ: 64, blocking: new Uint8Array(64 * 64) } }
    } as unknown as SettlementContext;
    expect(selectCarrierFleet(context, source as never, destination as never, "stone", 3))
      .toMatchObject({ fleet: "cartless", capacity: 1, units: 1 });
  });

  it("keeps single items cartless even on a stone route", () => {
    const { advance, context, headquarters, simulation, storehouse } = fixture();
    expect(selectCarrierFleet(context, headquarters, storehouse, "stone", 1).fleet).toBe("cartless");
    simulation.transferWare(headquarters.uid, storehouse.uid, "stone", 1);
    expect(advance(2, () => deliveryCrew(simulation) !== undefined)).toBe(true);
    expect(handcartCrew(simulation)).toBeUndefined();
    expect(storehouse.incoming.stone).toBe(1);
  });
});
