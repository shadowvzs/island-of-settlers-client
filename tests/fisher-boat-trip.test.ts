import { createIslandStockContacts } from "../src/app/settlement/island-stock-contacts";
import { createSettlementRenderFrames } from "../src/app/settlement/settlement-render-frames";
import type { WorkerFrame } from "../src/render-common/workers/worker-unit";
import { fisheryYardSkiffAnchor, fisheryYardSkiffPickup, groundSkiffPickup } from "../src/render-common/ships/fishing-skiff-yard";
import type { WorkerNation } from "../src/render-common/workers/worker-nation";
import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { releaseFisherBoatTrip } from "../src/shared/settlement/fisher-boat-release";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { isBoatFishing } from "../src/shared/settlement/settlement-fisher-boat-mode";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementActor, SettlementBuilding } from "../src/shared/settlement/settlement-types";
import { paintBoatWater } from "./helpers/boat-fishing-world";
import { createWorld } from "./helpers/handcart-fixture";

const FISHERY = 18;

const setup = (playerNation: WorkerNation = "roman", rotation = 0, nativeContacts = false) => {
  const world = createWorld();
  paintBoatWater(world, (_x, z) => z >= 44);
  let blocked: ((x: number, z: number) => boolean) | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => blocked?.(x, z) ?? false });
  const simulation = createSettlementSimulation({ world, roads, playerNation, initialSettlers: 20,
    stockContact: nativeContacts ? createIslandStockContacts(world, (x, z) => blocked?.(x, z) ?? false, () => playerNation) : undefined,
    initialStock: { fishingRod: 2, logs: 40, planks: 40, stone: 40, cloth: 40 }, resourceTargets: () => [] });
  blocked = simulation.isOccupied;
  const [width, depth] = getBuildingDefinition(FISHERY).gridFootprint;
  const placed = simulation.placeBuilding(FISHERY, 30 + width % 2 / 2, 30 + depth % 2 / 2, rotation);
  expect(placed.ok, placed.reason).toBe(true);
  const fishery = placed.building!;
  Object.assign(fishery, { construction: 1, required: {} });
  expect(simulation.connectRoads(fishery.access, simulation.headquarters.access)).toBe(true);
  simulation.headquarters.inventory.boat = 1;
  simulation.update(.05);
  expect(simulation.setFisherMode(fishery.uid, "boat")).toBe(true);
  const phases = new Set<string>();
  const fisher = () => simulation.frames().find(actor => actor.uid === fishery.worker) as SettlementActor | undefined;
  const advance = (seconds: number, until: () => boolean) => {
    for (let tick = 0; tick < seconds * 20; tick++) {
      simulation.update(.05);
      const actor = fisher();
      if (actor) phases.add(actor.phase);
      if (until()) return true;
    }
    return false;
  };
  return { advance, fisher, fishery, phases, simulation };
};

const diffState = (left: string, right: string) => {
  const a = JSON.parse(left) as Record<string, { uid: number }[]>, b = JSON.parse(right) as typeof a;
  return Object.keys(a).flatMap(group => a[group]!.flatMap((entry, index) => {
    const other = b[group]![index] as unknown as Record<string, unknown>;
    return Object.entries(entry).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(other?.[key]))
      .map(([key, value]) =>
        `${group}[${entry.uid}].${key}: ${JSON.stringify(value)} vs ${JSON.stringify(other?.[key])}`.slice(0, 300));
  }));
};

const fish = (building: SettlementBuilding) => building.output.fish ?? 0;

describe("fisher boat trip", () => {
  const nations: WorkerNation[] = ["roman", "viking", "japanese", "nubian", "indigenous", "chinese", "persian", "maya"];
  it.each(nations.flatMap(nation => [0, 1, 2, 3].map(rotation => ({ nation, rotation }))))(
    "fetches the visible yard hull for $nation rotation $rotation before lifting",
    ({ nation, rotation }) => {
      const { advance, fisher, fishery } = setup(nation, rotation);
      expect(advance(600, () => fisher()?.phase === "fisherBoatLift")).toBe(true);
      const expected = fisheryYardSkiffPickup(nation, fishery), actor = fisher()!;
      expect(Math.hypot(actor.x - expected.x, actor.z - expected.z)).toBeLessThan(.01);
      expect(Math.cos(actor.yaw - expected.yaw)).toBeCloseTo(1, 6);
      expect(Math.hypot(actor.x - fishery.workerApproach.x, actor.z - fishery.workerApproach.z)).toBeGreaterThan(1);
      expect(fishery.input.boat).toBe(1);
    }
  );

  it("fetches the delivered boat, rows out and brings four fish in one basket past the shelf limit", () => {
    const { advance, fisher, fishery, phases } = setup();
    expect(advance(600, () => fisher()?.phase === "fisherBoatBeach")).toBe(true);
    fishery.output.fish = 5;
    expect(advance(60, () => fish(fishery) >= 9)).toBe(true);
    expect(fish(fishery)).toBe(9);
    for (const phase of ["fisherBoatFetch", "fisherBoatLift", "fisherBoatCarry", "fisherBoatLaunch",
      "fisherBoatRowOut", "fisherBoatNet", "fisherBoatRowBack", "fisherBoatBeach"]) expect(phases).toContain(phase);
    expect(fishery.fisherBoat).toMatchObject({ place: "slot", slot: 0 });
    expect(fishery.input.boat ?? 0).toBe(0);
    expect(isBoatFishing(fishery)).toBe(true);
  });

  it.each([["roman", 0], ["nubian", 3]] as const)("delivers the boat to the %s yard before the fisher lifts that same hull", (nation, rotation) => {
    const { advance, fishery, simulation } = setup(nation, rotation, true);
    const carrier = () => simulation.frames().find(actor => actor.stockBuilding === fishery.uid && actor.wareTransfer?.ware === "boat");
    expect(advance(600, () => carrier()?.phase === "deliveryTransfer")).toBe(true);
    const actor = carrier()!, anchor = fisheryYardSkiffAnchor(nation, fishery), stance = fisheryYardSkiffPickup(nation, fishery);
    expect(Math.hypot(actor.x - stance.x, actor.z - stance.z)).toBeLessThan(.01);
    expect(actor.wareTransfer!.target).toEqual({ x: anchor.x, y: fishery.y, z: anchor.z });
    expect(fishery.input.boat ?? 0).toBe(0);
    const template = { nation, variant: "test", x: 0, y: 0, z: 0, heading: 0, action: "idle_breathe", animationTime: 0,
      selected: false, gaitPhase: 0, runBlend: 0, target: null } as WorkerFrame;
    const frames = createSettlementRenderFrames([template]);
    frames.updateBuildings(simulation.buildings(), nation); frames.updateWorkers(simulation.frames(), .05);
    expect(frames.workers.find(frame => frame.actorId === actor.uid)?.fisherBoatYard)
      .toEqual({ x: anchor.x, y: fishery.y, z: anchor.z, yaw: anchor.yaw });
    expect(advance(600, () => fish(fishery) >= 4)).toBe(true);
  });

  it("moves an old native-layout front-door boat delivery to the yard after loading", () => {
    const { advance, fishery, simulation } = setup("roman", 0, true);
    const carrier = () => simulation.frames().find(actor => actor.stockBuilding === fishery.uid && actor.wareTransfer?.ware === "boat");
    expect(advance(600, () => carrier()?.phase === "deliveryTransfer")).toBe(true);
    const actor = carrier()!, uid = actor.uid;
    const oldApproach = { x: fishery.workerApproach.x, y: fishery.y, z: fishery.workerApproach.z };
    const oldStock = { ...oldApproach, y: fishery.y + .15 };
    Object.assign(actor, { x: oldApproach.x, z: oldApproach.z });
    actor.stockContact = { ...actor.stockContact!, stock: oldStock, approach: oldApproach };
    actor.wareTransfer = { ...actor.wareTransfer!, target: oldStock, progress: .4 };
    const save = simulation.saveState();
    expect(save.plainStockContacts).not.toBe(true);
    expect(simulation.loadState(save)).toEqual({ ok: true });
    const restored = simulation.frames().find(actor => actor.uid === uid)!;
    expect(restored.phase).toBe("deliveryStockWalk");
    expect(restored.ware).toBe("boat");
    expect(restored.wareTransfer).toBeUndefined();
    const loadedFishery = simulation.buildings().find(building => building.uid === fishery.uid)!;
    expect(loadedFishery.input.boat ?? 0).toBe(0);
    expect(advance(600, () => fish(loadedFishery) >= 4)).toBe(true);
  });

  it("restores a legacy front-door lift by fetching the stored hull before consuming it", () => {
    const { advance, fisher, fishery, simulation } = setup();
    expect(advance(600, () => fisher()?.phase === "fisherBoatLift")).toBe(true);
    const actor = fisher()!;
    Object.assign(actor, { x: fishery.workerApproach.x, z: fishery.workerApproach.z, stockBuilding: undefined });
    delete actor.boatTrip!.yard;
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
    const loaded = simulation.buildings().find(building => building.uid === fishery.uid)!;
    expect(advance(30, () => fisher()?.phase === "fisherBoatFetch")).toBe(true);
    expect(loaded.input.boat).toBe(1);
    expect(advance(60, () => fisher()?.phase === "fisherBoatLift")).toBe(true);
    expect(fisher()!.boatTrip?.yard).toBe(true);
    const pickup = fisheryYardSkiffPickup("roman", loaded);
    expect(Math.hypot(fisher()!.x - pickup.x, fisher()!.z - pickup.z)).toBeLessThan(.01);
    expect(advance(600, () => fish(loaded) >= 4)).toBe(true);
    expect(fish(loaded)).toBe(4);
  });

  it("walks to the parked boat on later trips and leaves it parked after a switch to the rod", () => {
    const { advance, fishery, phases, simulation } = setup();
    expect(advance(600, () => fish(fishery) >= 4)).toBe(true);
    phases.clear();
    expect(advance(600, () => fish(fishery) >= 8)).toBe(true);
    expect(phases).toContain("fisherBoatWalk");
    expect(phases).not.toContain("fisherBoatFetch");
    expect(simulation.setFisherMode(fishery.uid, "rod")).toBe(true);
    advance(30, () => false);
    expect(fishery.fisherBoat).toMatchObject({ place: "slot" });
    expect(simulation.fishingBoatFrames()).toMatchObject([{ crewed: false, id: fishery.uid, rowing: false }]);
    expect(simulation.fisherBoatStatus(fishery.uid)).toMatchObject({ mode: "rod", place: "shore" });
  });

  it("returns the boat to storage and loses the catch when the Fishery is destroyed at sea", () => {
    const { advance, fisher, fishery, simulation } = setup();
    expect(advance(600, () => fisher()?.phase === "fisherBoatNet")).toBe(true);
    const actor = fisher()!;
    expect(actor.visible).toBe(false);
    const [frame] = simulation.fishingBoatFrames();
    expect(frame).toMatchObject({ crewed: true, id: fishery.uid, rowing: false });
    expect(frame!.net).toBeGreaterThanOrEqual(0);
    simulation.demolishBuilding(fishery.uid);
    advance(5, () => !simulation.buildings().some(building => building.uid === fishery.uid));
    expect(simulation.buildings().some(building => building.uid === fishery.uid)).toBe(false);
    expect(simulation.headquarters.inventory.boat).toBe(1);
    expect(actor.boatTrip).toBeUndefined();
    expect(actor.visible).toBe(true);
    expect(actor.ware).toBeNull();
  });

  it("finishes a trip restored from a save taken at sea", () => {
    const { advance, fisher, fishery, simulation } = setup();
    expect(advance(600, () => fisher()?.phase === "fisherBoatNet")).toBe(true);
    const save = simulation.saveState();
    expect(simulation.loadState(save)).toEqual({ ok: true });
    const restored = simulation.buildings().find(building => building.uid === fishery.uid)!;
    expect(advance(300, () => fish(restored) >= 4)).toBe(true);
    expect(fish(restored)).toBe(4);
  });

  it("retrieves an abandoned boat from beside the gunwale before finishing the trip", () => {
    const { advance, fisher, fishery, simulation } = setup();
    expect(advance(600, () => fisher()?.phase === "fisherBoatCarry")).toBe(true);
    releaseFisherBoatTrip(fisher()!, fishery);
    expect(fishery.fisherBoat?.place).toBe("dropped");
    const dropped = { ...fishery.fisherBoat! }, pickup = groundSkiffPickup(dropped);
    const hull = simulation.fishingBoatFrames().find(frame => frame.id === fishery.uid)!;
    expect(hull.y).toBeGreaterThan(0);
    expect(simulation.setFisherMode(fishery.uid, "boat")).toBe(true);
    expect(advance(600, () => fisher()?.phase === "fisherBoatLift")).toBe(true);
    expect(Math.hypot(fisher()!.x - pickup.x, fisher()!.z - pickup.z)).toBeLessThan(.01);
    expect(fisher()!.yaw).toBeCloseTo(pickup.yaw, 5);
    expect(fishery.fisherBoat?.place).toBe("dropped");
    expect(advance(600, () => fish(fishery) >= 4)).toBe(true);
  });

  it("sets a carried boat down where the fisher stands when the trip is abandoned", () => {
    const fishery = { boatSite: undefined, fisherBoat: { place: "carried", slot: 0, x: 1, yaw: 0, z: 1 } } as
      unknown as SettlementBuilding;
    const actor = { boatTrip: { net: 0, slot: 0 }, phase: "fisherBoatCarry", ware: "boat", x: 7, yaw: 1, z: 8 } as
      unknown as SettlementActor;
    releaseFisherBoatTrip(actor, fishery);
    expect(fishery.fisherBoat).toEqual({ place: "dropped", slot: 0, x: 7, yaw: 1, z: 8 });
    expect(actor.ware).toBeNull();
    expect(actor.boatTrip).toBeUndefined();
  });

  it("is deterministic and a save taken at sea continues exactly like the uninterrupted run", () => {
    const tripState = (run: ReturnType<typeof setup>) => {
      const state = run.simulation.saveState();
      return JSON.stringify({ actors: state.actors, buildings: state.buildings });
    };
    const first = setup(), second = setup();
    expect(first.advance(600, () => first.fisher()?.phase === "fisherBoatNet")).toBe(true);
    expect(second.advance(600, () => second.fisher()?.phase === "fisherBoatNet")).toBe(true);
    const firstDiff = diffState(tripState(first), tripState(second));
    expect(firstDiff).toEqual([]);
    expect(second.simulation.loadState(second.simulation.saveState())).toEqual({ ok: true });
    first.advance(120, () => false);
    second.advance(120, () => false);
    expect(diffState(tripState(first), tripState(second))).toEqual([]);
  });
});
