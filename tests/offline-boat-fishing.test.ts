import { describe, expect, it } from "vitest";

import {
  BOAT_FISHERY_SHELF, offlineBoatFisheryShelf, offlineCyclesPerJobCycle
} from "../src/app/settlement/offline-boat-fishing";
import { runOfflineEconomyEvents } from "../src/app/settlement/offline-economy-events";
import { prepareOfflineEconomyLogistics } from "../src/app/settlement/offline-economy-logistics";
import { estimateOfflineEconomyRates } from "../src/app/settlement/offline-economy-rates";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementActor } from "../src/shared/settlement/settlement-types";
import { paintBoatWater } from "./helpers/boat-fishing-world";
import { createWorld } from "./helpers/handcart-fixture";

const FISHERY = 18;

/** A boat Fishery after three landed baskets, with the live seconds between the last two. */
const liveBoatFishery = () => {
  const world = createWorld();
  paintBoatWater(world, (_x, z) => z >= 44);
  let blocked: ((x: number, z: number) => boolean) | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => blocked?.(x, z) ?? false });
  const simulation = createSettlementSimulation({ world, roads, initialSettlers: 20,
    initialStock: { fishingRod: 2, logs: 40, planks: 40, stone: 40 }, resourceTargets: () => [] });
  blocked = simulation.isOccupied;
  const [width, depth] = getBuildingDefinition(FISHERY).gridFootprint;
  const placed = simulation.placeBuilding(FISHERY, 30 + width % 2 / 2, 30 + depth % 2 / 2, 0);
  expect(placed.ok, placed.reason).toBe(true);
  const fishery = placed.building!;
  Object.assign(fishery, { construction: 1, required: {} });
  expect(simulation.connectRoads(fishery.access, simulation.headquarters.access)).toBe(true);
  simulation.headquarters.inventory.boat = 1;
  simulation.update(.05);
  expect(simulation.setFisherMode(fishery.uid, "boat")).toBe(true);
  const landings: number[] = [];
  let seconds = 0, previous = 0;
  while (landings.length < 3 && seconds < 900) {
    simulation.update(.05); seconds += .05;
    const fish = fishery.output.fish ?? 0;
    if (fish > previous) landings.push(seconds);
    // Keep the shelf low like a served yard, so every trip starts as soon as the fisher is ready.
    if (fish >= 4) fishery.output.fish = 0;
    previous = fishery.output.fish ?? 0;
  }
  expect(landings).toHaveLength(3);
  return { fishery, liveTrip: landings[2]! - landings[1]!, simulation, world };
};

const saveOf = (simulation: ReturnType<typeof liveBoatFishery>["simulation"]) =>
  ({ settlement: simulation.saveState(), savedAt: 1_000_000 }) as GameSaveV1;

describe("fast offline boat fishing", () => {
  it("credits four fish per full trip without a finite fishing site, close to the live trip time", () => {
    const { fishery, liveTrip, simulation, world } = liveBoatFishery();
    const rates = estimateOfflineEconomyRates(saveOf(simulation), world);
    expect(rates.unsupported.find(row => row.uid === fishery.uid)).toBeUndefined();
    const job = rates.jobs.find(entry => entry.uid === `building:${fishery.uid}`)!;
    expect(job.outputs).toEqual({ fish: 4 });
    expect(Object.keys(job.inputs).filter(ware => ware.startsWith("~"))).toEqual([]);
    const rate = rates.buildings.find(entry => entry.uid === fishery.uid)!;
    // Static free-flow estimate: within a fifth of the measured live trip.
    expect(rate.cycleSeconds / liveTrip).toBeGreaterThan(.8);
    expect(rate.cycleSeconds / liveTrip).toBeLessThan(1.2);
    expect(offlineCyclesPerJobCycle(fishery)).toBe(4);
    // Deterministic: the same save gives the same job.
    expect(estimateOfflineEconomyRates(saveOf(simulation), world).jobs).toEqual(rates.jobs);
  });

  it("keeps the yard below the 9 cap and starts a trip only below six fish", () => {
    const { fishery, simulation, world } = liveBoatFishery();
    const save = saveOf(simulation);
    const saved = save.settlement.buildings.find(building => building.uid === fishery.uid)!;
    const worker = save.settlement.actors.find(actor => actor.uid === saved.worker);
    const rates = estimateOfflineEconomyRates(save, world);
    const logistics = prepareOfflineEconomyLogistics(save, "home", 600, world, rates.jobs, rates.storageUids);
    const job = rates.jobs.find(entry => entry.uid === `building:${fishery.uid}`)!;
    expect(job.outputAccountId).toBeDefined();
    const yard = logistics.islands.find(island => island.islandId === job.outputAccountId)!;
    expect(yard.totalCapacity).toBe(offlineBoatFisheryShelf(saved, worker, 0));
    const run = (fish: number) => runOfflineEconomyEvents({ horizonTicks: 10_000_000, islands: [
      { islandId: "home", stock: {}, capacities: { fish: 100 }, workCapacity: 0 },
      { islandId: "yard", ownerIslandId: "home", totalCapacity: BOAT_FISHERY_SHELF, maxCapacity: BOAT_FISHERY_SHELF,
        stock: { fish } }
    ], jobs: [{ uid: "boat", islandId: "home", outputAccountId: "yard", cycleTicks: 60_000, inputs: {},
      outputs: { fish: 4 } }] });
    const yardFish = (fish: number) => run(fish).islands.find(island => island.islandId === "yard")!.stock.fish;
    expect(yardFish(5)).toBe(9);
    expect(yardFish(6)).toBe(6);
    expect(yardFish(0)).toBe(8);
  });

  it("holds the shelf space of a catch still in progress", () => {
    const building = { fisherMode: "boat", fisherBoat: { place: "slot", slot: 0, x: 0, yaw: 0, z: 0 }, input: {},
      typeId: FISHERY } as never;
    expect(offlineBoatFisheryShelf(building, undefined, 0)).toBe(9);
    expect(offlineBoatFisheryShelf(building, { boatTrip: { net: 0, slot: 0 } } as SettlementActor, 0)).toBe(5);
    expect(offlineBoatFisheryShelf(building, { ware: "fish", wareUnits: 4 } as SettlementActor, 1)).toBe(4);
    expect(offlineBoatFisheryShelf({ input: {}, typeId: FISHERY } as never, undefined, 0)).toBeUndefined();
  });
});
