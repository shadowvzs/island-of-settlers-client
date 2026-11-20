import { describe, expect, it } from "vitest";

import { pierLandingPlaces } from "../src/shared/settlement/harbour-lighter-landings";
import { harbourLighterCount, lighterPlaceAt, planLighters } from "../src/shared/settlement/harbour-lighters";
import { createNavalFleet } from "../src/shared/settlement/settlement-naval-fleet";
import { cargoBoxValues, wareBoxUnits } from "../src/shared/settlement/ship-cargo-boxes";
import { createLighterScenario, runLighterScenario } from "./helpers/harbour-lighter-scenario";
import { createShipSea, SHIP_TICK } from "./helpers/ship-motion-scenarios";

const total = (boxes: readonly { count: number }[]) => boxes.reduce((sum, box) => sum + box.count, 0);

describe("one box rule (owner, 2026-10-20; box sizes 2026-10-21)", () => {
  it("fills boxes of the ware's units, the last box holding the rest", () => {
    expect([["logs", 15], ["stone", 20], ["planks", 30], ["ironOre", 80], ["coins", 250], ["boat", 1],
      ["unknownWare", 25]].every(([ware, units]) => wareBoxUnits(ware as string) === units)).toBe(true);
    expect(cargoBoxValues({ stone: 100 }).map(box => box.count)).toEqual(Array(5).fill(20));
    expect(cargoBoxValues({ fish: 125, stone: 50 }).map(box => `${box.ware}:${box.count}`))
      .toEqual(["fish:50", "fish:50", "fish:25", "stone:20", "stone:20", "stone:10"]);
  });
  it("spreads a cargo bigger than the deck over its boxes in equal shares, the last holding the remainder", () => {
    const boxes = cargoBoxValues({ stone: 1000 }, 33);
    expect(boxes).toHaveLength(33);
    expect(boxes.slice(0, 32).every(box => box.count === 30)).toBe(true);
    expect(boxes[32]!.count).toBe(40);
    const mixed = cargoBoxValues({ fish: 3330, planks: 7010, stone: 997 }, 33);
    expect(mixed).toHaveLength(33);
    for (const ware of ["fish", "planks", "stone"])
      expect(total(mixed.filter(box => box.ware === ware))).toBe({ fish: 3330, planks: 7010, stone: 997 }[ware]);
  });
});

const runFleet = (fleet: ReturnType<typeof createNavalFleet>, stop: () => boolean, seconds = 900) => {
  for (let tick = 0; tick < seconds / SHIP_TICK && !stop(); tick++) fleet.update(SHIP_TICK);
};
/** Seconds into the ship's cargo job (pier porters or lighters), 0 while it has none. */
const jobElapsed = (fleet: ReturnType<typeof createNavalFleet>) => {
  const frame = fleet.frames()[0];
  return frame?.cargoWork?.elapsed ?? frame?.lighterWork?.elapsed ?? 0;
};

describe("goods change hands at the last box (owner, 2026-10-21)", () => {
  /** A supply visitor unloading `cargo` at a harbour; the fleet can be saved and restored. */
  const visitorUnloading = (cargo: Record<string, number>) => {
    const sea = createShipSea(), harbour = sea.harbour(60);
    const fleet = createNavalFleet(sea.context, sea.sea);
    expect(fleet.sendVisitor(harbour.uid, cargo, [], "supply")).not.toBeNull();
    return { harbour, fleet, sea };
  };
  it("credits the whole unload when the last box is in, also across a save in the middle", () => {
    const { fleet, harbour, sea } = visitorUnloading({ stone: 1000 });
    runFleet(fleet, () => jobElapsed(fleet) > 20);
    expect(harbour.inventory.stone ?? 0).toBe(0);
    expect(fleet.saveState().ships[0]!.cargo.stone).toBe(1000);
    const restored = createNavalFleet(sea.context, sea.sea), seen = new Set<number>();
    restored.restore(structuredClone(fleet.saveState()));
    runFleet(restored, () => { seen.add(harbour.inventory.stone ?? 0); return restored.frames().length === 0; });
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1000]);
  });
  it("reserves a visitor's pickup when loading begins and hands it over at the last box", () => {
    const { fleet, harbour } = visitorUnloading({ stone: 100 });
    harbour.inventory = { fish: 30 };
    fleet.saveState().ships[0]!.visitor!.pickup.push("fish");
    const states = new Set<string>();
    runFleet(fleet, () => {
      states.add(`${harbour.inventory.fish ?? 0}/${harbour.shipReserve?.fish ?? 0}`);
      return fleet.frames().length === 0;
    });
    expect(harbour.inventory.stone).toBe(100);
    // In storage, then reserved (one box of 30 fish), then gone with the ship.
    expect([...states]).toEqual(["30/0", "0/30", "0/0"]);
  });
});

describe("own transport orders load from a storage reservation", () => {
  const ownLoad = () => {
    const sea = createShipSea(), source = sea.harbour(20), destination = sea.harbour(90);
    const fleet = createNavalFleet(sea.context, sea.sea);
    source.inventory = { stone: 50 };
    fleet.addShip({ x: 30.5, z: 30.5 }, 0);
    const order = fleet.queueTransport(source.uid, destination.uid, { stone: 40 })!;
    return { destination, fleet, order, sea, source };
  };
  const midLoad = (setup: ReturnType<typeof ownLoad>) => {
    setup.fleet.update(SHIP_TICK);
    runFleet(setup.fleet, () => setup.fleet.saveState().ships[0]!.phase === "loading" && jobElapsed(setup.fleet) > 2);
  };
  /** Stone in the harbour's free stock, its reservation, aboard the ship and delivered. */
  const stone = (setup: Omit<ReturnType<typeof ownLoad>, "order">) => ({
    aboard: setup.fleet.saveState().ships[0]!.cargo.stone ?? 0, delivered: setup.destination.inventory.stone ?? 0,
    free: setup.source.inventory.stone ?? 0, reserved: setup.source.shipReserve?.stone ?? 0 });
  it("keeps the order's wares reserved until the last box is aboard, also across a save", () => {
    const setup = ownLoad();
    expect(stone(setup)).toEqual({ aboard: 0, delivered: 0, free: 10, reserved: 40 });
    midLoad(setup);
    expect(setup.source.shipReserve).toEqual({ stone: 40 });
    const restored = createNavalFleet(setup.sea.context, setup.sea.sea);
    restored.restore(structuredClone(setup.fleet.saveState()));
    runFleet(restored, () => setup.destination.inventory.stone === 40, 1800);
    expect(stone({ ...setup, fleet: restored })).toEqual({ aboard: 0, delivered: 40, free: 10, reserved: 0 });
    expect(setup.source.shipReserve).toBeUndefined();
  }, 60000);
  it("hands the reservation back when a queued order is cancelled", () => {
    const setup = ownLoad();
    expect(setup.fleet.cancelTransport(setup.order)).toBe(true);
    expect(setup.source.inventory.stone).toBe(50);
    expect(setup.source.shipReserve).toBeUndefined();
  });
  it("hands the whole reservation back when the order is cancelled mid-load", () => {
    const setup = ownLoad();
    midLoad(setup);
    expect(setup.fleet.cancelTransport(setup.order)).toBe(true);
    expect(stone(setup)).toEqual({ aboard: 0, delivered: 0, free: 50, reserved: 0 });
    runFleet(setup.fleet, () => setup.fleet.saveState().ships[0]!.phase === "idle", 1200);
    expect(setup.source.inventory.stone).toBe(50);
    expect(setup.destination.inventory.stone ?? 0).toBe(0);
  }, 60000);
});

describe("harbour lighters", () => {
  it("need a stored boat each, two slots per harbour: none without boats", () => {
    expect([0, 1, 2, 3].map(harbourLighterCount)).toEqual([0, 1, 2, 2]);
  });
  it("land beside a pier's foot and, where a barge fits, along its deck", () => {
    const pier = (length: number) => ({ point: { x: length, z: 0 }, shore: { x: 0, z: 0 } });
    const water = (point: { x: number }) => point.x > 0;
    const along = (length: number) => pierLandingPlaces(pier(length), length - 1, [], water)
      .map(place => place.landing.x.toFixed(1));
    expect(along(2)).toEqual(["0.9", "0.9"]);
    expect(along(6)).toEqual(["0.9", "0.9"]);
    expect(along(7)).toEqual(["0.9", "3.7", "0.9", "3.7"]);
    // The farther places are worked from the deck's edge.
    expect(pierLandingPlaces(pier(7), 6, [], water)[1]!.route.at(-1)!.x).toBeCloseTo(3.7);
  });
  it("fade in when their job starts and out when it ends", () => {
    const plan = planLighters(8, 1, 12, 6, true);
    expect(lighterPlaceAt(plan, 0, 0, true)?.opacity ?? 0).toBe(0);
    expect(lighterPlaceAt(plan, 0, 1, true)?.opacity).toBe(1);
    expect(lighterPlaceAt(plan, 0, plan.seconds + .01, true)).toBeNull();
  });
  it("are never slower than the piers alone; every box arrives and the rowers rest in the harbour after", () => {
    const load = { stone: 132 };
    const piers = runLighterScenario({ boats: 0, idle: 0, load, ships: 8 }).seconds;
    for (const boats of [1, 2]) {
      const { fleet, harbour } = createLighterScenario({ boats, load, ships: 8 });
      let tick = 0;
      for (; tick < 3600 / SHIP_TICK && (harbour.inventory.stone ?? 0) < 1056; tick++) fleet.update(SHIP_TICK);
      expect(tick * SHIP_TICK).toBeLessThanOrEqual(piers + SHIP_TICK);
      for (let rest = 0; rest < 600 && fleet.frames().some(frame => frame.lighterWork); rest++) fleet.update(SHIP_TICK);
      fleet.update(SHIP_TICK);
      expect(harbour.inventory.stone).toBe(1056);
      expect(harbour.idleSettlers).toBe(12);
    }
  }, 60000);
});
