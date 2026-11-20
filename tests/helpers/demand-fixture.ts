/** Demand ranking fixture: HQ, a paused pig breeder as the only pig source, and pig consumers on one road. */
import { expect } from "vitest";

import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import type { SettlementBuilding } from "../../src/shared/settlement/settlement-types";
import { createWorld, totalOf } from "./handcart-fixture";

export const BUTCHER = 21;
export const PIG_BREEDER = 28;
export const SKINNER = 3;
export const TANNER = 8;
const ROAD_Z = 13.5;

/** `consumers` are placed west to east in building order after the breeder. */
export const demandFixture = (consumers: readonly number[] = [BUTCHER, SKINNER]) => {
  const world = createWorld();
  let blocked: ((x: number, z: number) => boolean) | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => blocked?.(x, z) ?? false });
  const simulation = createSettlementSimulation({ world, roads, initialSettlers: 20,
    initialStock: { logs: 60, planks: 60, stone: 60 }, resourceTargets: () => [] });
  blocked = simulation.isOccupied;
  const headquarters = simulation.headquarters;
  const connect = (from: { x: number; z: number }, to: { x: number; z: number }) =>
    expect(simulation.connectRoads(from, to)).toBe(true);
  const place = (type: number, x: number) => {
    const [width, depth] = getBuildingDefinition(type).gridFootprint;
    const placed = simulation.placeBuilding(type, x + width % 2 / 2, 8 + depth % 2 / 2, 0);
    expect(placed.ok, placed.reason).toBe(true);
    Object.assign(placed.building!, { construction: 1, required: {} });
    connect(placed.building!.access, { x: placed.building!.access.x, z: ROAD_Z });
    return placed.building!;
  };
  connect(headquarters.access, { x: headquarters.access.x, z: ROAD_Z });
  connect({ x: headquarters.access.x, z: ROAD_Z }, { x: 18 + consumers.length * 8, z: ROAD_Z });
  const breeder = place(PIG_BREEDER, 14);
  breeder.productionPaused = true;
  const placed: SettlementBuilding[] = consumers.map((type, index) => place(type, 22 + index * 8));
  simulation.update(.05);
  const advance = (seconds: number, until?: () => boolean, beforeTick?: () => void) => {
    for (let tick = 0; tick < seconds * 20; tick++) {
      beforeTick?.();
      simulation.update(.05);
      if (until?.()) return true;
    }
    return false;
  };
  const carriers = (ware = "pig") => simulation.frames().filter(actor => actor.delivery?.ware === ware);
  const destinations = (ware = "pig") => carriers(ware).map(actor => actor.delivery!.destination);
  const pigTotal = () => totalOf(simulation.buildings(), simulation.frames(), "pig");
  return { advance, breeder, carriers, consumers: placed, destinations, headquarters, pigTotal, simulation };
};
