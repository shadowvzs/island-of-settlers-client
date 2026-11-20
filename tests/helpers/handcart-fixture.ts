/** The hand-cart logistics fixture: HQ, a storehouse and a paused producer on stone roads. */
import { expect } from "vitest";

import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import { STORAGE_IDS } from "../../src/shared/settlement/production-rules";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { isOnStoneRoad } from "../../src/shared/settlement/settlement-handcart-roads";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "../../src/shared/settlement/settlement-types";
import { BUILD, type WorldData } from "../../src/shared/world/world-data";

export const STORAGE = 29;
/** Retain the actual old frontage cut; the producer/consumer spur joins to its west. */
// The owner's 2026-11-03 widened reserved strip puts the HQ-storehouse road on z = 13.5.
export const MID_ROAD = { end: { x: 20.5, z: 13.5 }, start: { x: 20, z: 13.5 } };
export const createWorld = () => {
  const size = 64;
  return { seed: 3, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 8, z: 8 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array() }
  } as unknown as WorldData;
};

/** Count shared stock once, plus real local buffers, paid custody, cart beds and carried units. */
export const totalOf = (buildings: readonly SettlementBuilding[], actors: readonly SettlementActor[], ware: string) => {
  const seen = new Set<number>();
  const stock = buildings.reduce((sum, building) => {
    let inventory = building.inventory[ware] ?? 0;
    if (STORAGE_IDS.has(building.typeId) && building.storagePoolId !== undefined) {
      if (seen.has(building.storagePoolId)) inventory = 0;
      seen.add(building.storagePoolId);
    }
    return sum + inventory + (building.input[ware] ?? 0) + (building.output[ware] ?? 0);
  }, 0);
  return stock + actors.reduce((sum, actor) => {
    const trip = actor.handcart?.trip;
    return sum + (trip?.ware === ware ? actor.handcart!.cargo + trip.prepaid : 0) +
      (actor.ware === ware ? actor.wareUnits ?? 1 : 0);
  }, 0);
};

/** Finite authored stocks; actual paused producer19 output or paused sawmill33 input, never pool balancing. */
export const fixture = (stone = true, rotation: 0 | 1 | 2 | 3 = 0, input = false) => {
  const world = createWorld();
  let blocked: ((x: number, z: number) => boolean) | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => blocked?.(x, z) ?? false });
  const simulation = createSettlementSimulation({ world, roads, initialSettlers: 40,
    initialStock: { iron: 10, logs: 40, planks: 30, saw: 2, stone: 240 }, resourceTargets: () => [] });
  blocked = simulation.isOccupied;
  const place = (type: number, x: number, z: number, turn: 0 | 1 | 2 | 3 = 0) => {
    const [width, depth] = getBuildingDefinition(type).gridFootprint;
    const placed = simulation.placeBuilding(type, x + width % 2 / 2, z + depth % 2 / 2, turn);
    expect(placed.ok, placed.reason).toBe(true);
    Object.assign(placed.building!, { construction: 1, productionPaused: true, required: {} });
    if (STORAGE_IDS.has(type)) placed.building!.idleSettlers = 0;
    return placed.building!;
  };
  const storehouse = place(STORAGE, 30, 9, rotation), source = place(input ? 33 : 19, 14, 8);
  const headquarters = simulation.headquarters;
  const connect = (from: { x: number; z: number }, to: { x: number; z: number }) => {
    expect(simulation.connectRoads(from, to)).toBe(true);
    if (stone) expect(simulation.upgradeRoad(from, to)).toBeTruthy();
  };
  connect(headquarters.access, storehouse.access);
  // The owner's 2026-11-03 widened reserved road strip moves the east-west road to z = 13.5;
  // end the spur on that junction so the whole stone route to storage stays continuous.
  connect(source.access, { x: 14, z: 13.5 });
  headquarters.handcarts = 1;
  // Adopt the authored completed access into the real pool before any dispatch/save boundary.
  simulation.update(.05);
  const stoneCheck = { options: { roads } } as unknown as SettlementContext;
  const crews = () => simulation.frames().filter(actor => actor.handcart);
  const advance = (seconds: number, until?: () => boolean) => {
    for (let tick = 0; tick < seconds * 20; tick++) {
      simulation.update(.05);
      // Only a loaded cart must never leave the upgraded ribbon. Empty carts queue on the
      // designed off-road lay-bys beside a source/destination apron (cartLayByBooking).
      for (const actor of crews()) if (actor.handcart!.state === "hitched" &&
        actor.phase !== "cartReturn" && actor.handcart!.cargo > 0)
        expect(isOnStoneRoad(stoneCheck, actor), `cart on dirt at ${actor.x},${actor.z}`).toBe(true);
      if (until?.()) return true;
    }
    return false;
  };
  const stoneTotal = () => totalOf(simulation.buildings(), simulation.frames(), "stone");
  const available = (ware = "stone") => simulation.storageSnapshot(headquarters.uid)!.available[ware] ?? 0;
  const dispatch = (amount = 3) => {
    source.output.stone = amount;
    const before = stoneTotal(), baseline = available();
    expect(simulation.transferWare(source.uid, storehouse.uid, "stone", amount)).toBe(true);
    return { baseline, before };
  };
  const delivered = (baseline: number, amount = 3) => available() === baseline + amount &&
    (source.output.stone ?? 0) === 0 && (storehouse.incoming.stone ?? 0) === 0;
  return { advance, available, crews, delivered, dispatch, headquarters, roads, simulation, source, stoneTotal,
    storehouse, world };
};
export const loadedCart = (crews: () => SettlementActor[]) => () => crews().some(actor =>
  actor.phase === "cartToDestination" && actor.handcart!.cargo > 0 && actor.x > 15 && actor.x < 20);
