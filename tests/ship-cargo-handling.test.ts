import { shipDeckCapacity } from "@shared/catalog";
import { describe, expect, it } from "vitest";

import { deckTroopsView } from "../src/app/settlement/deck-troops-view";
import { dockPorters } from "../src/app/settlement/dock-porters";
import { SHIP_DECK_HORSE_WORLD } from "../src/render-common/ships/ship-deck-layout";
import { createHarbourDocks } from "../src/shared/settlement/settlement-harbour-docks";
import { createNavalFleet } from "../src/shared/settlement/settlement-naval-fleet";
import {
  deckBoxesAt, DOCK_PORTER_SPEED, dockPorterSpeedFactor, MAX_DOCK_PORTERS, PIER_TARGET_SECONDS, planCargoHandling,
  porterPlaceAt,
  porterSpeed, RIDER_LANDING_INTERVAL, TROOP_LANDING_INTERVAL,
  TROOP_LANDING_SPEED, troopLandingDistance, troopLandingSeconds, troopLandingStart, TYPICAL_PORTER_ROUTE
} from "../src/shared/settlement/ship-cargo-handling";
import { createShipSea, SHIP_TICK } from "./helpers/ship-motion-scenarios";

/** One full sailing-ship deck (catalog `ship:sailingShip` capacity). */
const { boxes: SHIP_DECK_BOXES } = shipDeckCapacity();

describe("dock porters of an upgraded harbour (owner 2026-10-19)", () => {
  it("walk and lift 10% faster per harbour level; level 0 plans are unchanged", () => {
    const level0 = planCargoHandling(33, 12, 0), level1 = planCargoHandling(33, 12, 0, dockPorterSpeedFactor(1));
    expect(dockPorterSpeedFactor(0)).toBe(1);
    expect(dockPorterSpeedFactor(1)).toBeCloseTo(1.1, 10);
    expect(level0).toEqual(planCargoHandling(33, 12, 0, dockPorterSpeedFactor(0)));
    expect(level0.speed).toBeUndefined();
    expect(level1.walk).toBeCloseTo(level0.walk / 1.1, 10);
    expect(level1.seconds).toBeLessThan(level0.seconds);
    expect(porterSpeed(level0)).toBe(DOCK_PORTER_SPEED);
    expect(porterSpeed(level1)).toBeCloseTo(DOCK_PORTER_SPEED * 1.1, 10);
    // Every box still moves once, only sooner; the fixed minimum stays.
    expect(deckBoxesAt(level1, level1.seconds, false)).toBe(33);
    expect(planCargoHandling(1, 0, 10, dockPorterSpeedFactor(1)).seconds).toBe(10);
  });
});

describe("dock porters' plan", () => {
  it("shares the boxes out, takes at least the ship's own time and moves every box once", () => {
    const plan = planCargoHandling(20, 12, 10);
    // 20 boxes would take two rounds (over 40 s): ten porters carry two stacked boxes each, in one round.
    expect(plan).toMatchObject({ perTrip: 2, porters: 10 });
    expect(plan.seconds).toBeLessThan(PIER_TARGET_SECONDS);
    expect(planCargoHandling(8, 12, 10)).toMatchObject({ porters: 8 });
    expect(planCargoHandling(8, 12, 10).perTrip).toBeUndefined();
    expect(planCargoHandling(SHIP_DECK_BOXES, 12, 10).porters).toBe(MAX_DOCK_PORTERS);
    expect(planCargoHandling(SHIP_DECK_BOXES, 12, 10).seconds).toBeLessThan(PIER_TARGET_SECONDS + 10);
    expect(plan.seconds).toBeGreaterThan(10);
    expect(planCargoHandling(0, 12, 10)).toMatchObject({ boxes: 0, porters: 0, seconds: 10 });
    let previous = 0;
    for (let time = 0; time <= plan.seconds; time += .25) {
      const loaded = deckBoxesAt(plan, time, false);
      expect(loaded).toBeGreaterThanOrEqual(previous);
      expect(deckBoxesAt(plan, time, true)).toBe(20 - loaded);
      previous = loaded;
    }
    expect(previous).toBe(20);
    expect(deckBoxesAt(plan, 0, false)).toBe(0);
  });

  it("walks each porter out with a box and back empty when loading, the other way round unloading", () => {
    const plan = planCargoHandling(2, 11, 0);
    const out = porterPlaceAt(plan, 0, plan.walk / 2, false)!, back = porterPlaceAt(plan, 0, plan.walk * 1.6, false)!;
    expect(out).toMatchObject({ carrying: true, outward: true });
    expect(back).toMatchObject({ carrying: false, outward: false });
    expect(porterPlaceAt(plan, 0, plan.walk / 2, true)).toMatchObject({ carrying: false, outward: true });
    expect(porterPlaceAt(plan, 0, plan.walk * 1.6, true)).toMatchObject({ carrying: true, outward: false });
    expect(porterPlaceAt(plan, 1, 0, false)).toBeNull();
    expect(porterPlaceAt(plan, 0, plan.seconds + 1, false)).toBeNull();
  });

  it("loads a full deck over a usual pier in under a minute: two stacked boxes a trip (owner, 2026-10-21)", () => {
    const seconds = planCargoHandling(SHIP_DECK_BOXES, TYPICAL_PORTER_ROUTE, 0).seconds;
    expect(seconds).toBeLessThan(50);
    expect(seconds).toBeGreaterThan(30);
  });

  it("sends soldiers ashore one after another", () => {
    expect(troopLandingDistance(0, 2)).toBeGreaterThan(troopLandingDistance(1, 2));
    expect(troopLandingDistance(3, 1)).toBeLessThan(0);
  });

  it("lands riders last, farther apart than men on foot (owner, 2026-10-15)", () => {
    // Three on foot, then two riders: a horse's length and more between riders, and behind the last man.
    const starts = [0, 1, 2, 3, 4].map(index => troopLandingStart(index, 3));
    expect(starts[2]).toBeCloseTo(2 * TROOP_LANDING_INTERVAL);
    expect(starts[3]! - starts[2]!).toBeCloseTo(RIDER_LANDING_INTERVAL);
    expect(starts[4]! - starts[3]!).toBeCloseTo(RIDER_LANDING_INTERVAL);
    expect(RIDER_LANDING_INTERVAL * TROOP_LANDING_SPEED).toBeGreaterThanOrEqual(SHIP_DECK_HORSE_WORLD.depth + .5);
    expect(troopLandingDistance(4, starts[4]! + 1, 3)).toBeCloseTo(TROOP_LANDING_SPEED);
    expect(troopLandingSeconds(5, 10, 2)).toBeCloseTo(troopLandingSeconds(5, 10) +
      starts[4]! - 4 * TROOP_LANDING_INTERVAL);
  });
});

describe("boxes over the pier", () => {
  const voyage = () => {
    const sea = createShipSea(), source = sea.harbour(30), destination = sea.harbour(90);
    // Seven boxes: five boats (one each), 20 planks and 12 stone (owner box sizes 2026-10-21).
    source.inventory = { boat: 5, planks: 20, stone: 12 };
    const fleet = createNavalFleet(sea.context, sea.sea);
    fleet.addShip({ x: 40.5, z: 30.5 }, 0);
    expect(fleet.queueTransport(source.uid, destination.uid, { boat: 5, planks: 20, stone: 12 })).not.toBeNull();
    return { destination, fleet, sea };
  };
  const run = (fleet: ReturnType<typeof createNavalFleet>, until: () => boolean, seconds = 600) => {
    for (let tick = 0; tick < seconds / SHIP_TICK && !until(); tick++) fleet.update(SHIP_TICK);
  };

  it("loads them one porter trip at a time and unloads them the same way into the harbour", () => {
    const { destination, fleet, sea } = voyage(), docks = createHarbourDocks(sea.context);
    const ship = () => fleet.frames()[0]!;
    run(fleet, () => ship().phase === "loading");
    expect(ship().deckBoxes).toBe(0);
    const seen = new Set<number>();
    let porters = 0, nearest = Infinity;
    run(fleet, () => {
      seen.add(ship().deckBoxes!);
      const walking = dockPorters(sea.world, docks(fleet.snapshot(), fleet.frames()));
      porters = Math.max(porters, walking.length);
      nearest = Math.min(nearest, ...walking.flatMap((one, index) => walking.slice(index + 1)
        .map(other => Math.hypot(one.x - other.x, one.z - other.z))));
      return ship().phase === "sailing";
    });
    // Two lanes, a tile apart in file: porters never walk into one another.
    expect(nearest).toBeGreaterThan(.3);
    expect(ship().deckBoxes).toBe(7);
    expect(seen.size).toBeGreaterThan(3);
    expect(porters).toBeGreaterThan(1);
    run(fleet, () => ship().phase === "unloading");
    expect(ship().deckBoxes).toBe(7);
    expect(destination.inventory.planks ?? 0).toBe(0);
    run(fleet, () => ship().phase === "idle");
    expect(ship().deckBoxes).toBe(0);
    expect(destination.inventory).toMatchObject({ boat: 5, planks: 20, stone: 12 });
  });

  it("an upgraded harbour's porters load sooner, drawn at the plan's speed", () => {
    const loadingSeconds = (level: 0 | 1) => {
      const { fleet, sea } = voyage(), docks = createHarbourDocks(sea.context);
      const source = sea.context.buildings[0]!;
      if (level) source.workshopUpgrade = { level };
      const speeds = new Set<number>();
      let seconds = 0;
      run(fleet, () => {
        if (fleet.frames()[0]!.phase === "loading") seconds += SHIP_TICK;
        for (const porter of dockPorters(sea.world, docks(fleet.snapshot(), fleet.frames())))
          speeds.add(porter.locomotionSpeed ?? 0);
        return fleet.frames()[0]!.phase === "sailing";
      });
      return { seconds, speeds: [...speeds] };
    };
    const level0 = loadingSeconds(0), level1 = loadingSeconds(1);
    expect(level0.speeds).toEqual([DOCK_PORTER_SPEED]);
    expect(level1.speeds).toHaveLength(1);
    expect(level1.speeds[0]).toBeCloseTo(DOCK_PORTER_SPEED * 1.1, 10);
    expect(level1.seconds).toBeLessThan(level0.seconds);
  });

  it("carries on loading where it was after a save in the middle of it", () => {
    const { fleet, sea } = voyage(), ship = () => fleet.frames()[0]!;
    run(fleet, () => ship().phase === "loading" && (ship().deckBoxes ?? 0) >= 3);
    const boxes = ship().deckBoxes, saved = structuredClone(fleet.saveState());
    const restored = createNavalFleet(sea.context, sea.sea);
    restored.restore(saved);
    expect(restored.frames()[0]!.deckBoxes).toBe(boxes);
    run(restored, () => restored.frames()[0]!.phase === "sailing");
    expect(restored.frames()[0]!.deckBoxes).toBe(7);
  });

  it("shows soldiers from another island on deck and walks them ashore over the pier", () => {
    const sea = createShipSea(), harbour = sea.harbour(60), fleet = createNavalFleet(sea.context, sea.sea, {
      embark: () => undefined, ready: () => true, release: () => undefined,
      landTroops: troops => landed.push(...troops) });
    const landed: unknown[] = [];
    const troops = (["shield", "archer", "heavy"] as const).map(type => ({ hp: 100, rank: 1, type }));
    expect(fleet.sendVisitor(harbour.uid, { fish: 5 }, [], "troops", troops)).not.toBeNull();
    const docks = createHarbourDocks(sea.context), view = () =>
      deckTroopsView(sea.world, fleet.frames(), docks(fleet.snapshot(), fleet.frames()));
    run(fleet, () => fleet.frames()[0]?.phase === "sailing" && view().actors.length === 3, 60);
    expect(view().actors).toHaveLength(3);
    run(fleet, () => fleet.frames()[0]?.phase === "unloading");
    let walked = 0;
    run(fleet, () => {
      walked = Math.max(walked, view().actors.filter(actor => actor.action === "walk").length);
      return landed.length > 0;
    });
    expect(walked).toBeGreaterThan(0);
    expect(landed).toHaveLength(3);
  });

  it("has porters carry a visitor's pickup aboard in boxes, also after a save (owner, 2026-10-15)", () => {
    const sea = createShipSea(), harbour = sea.harbour(60), loaded: unknown[] = [];
    harbour.inventory = { stone: 40 };
    const fleet = createNavalFleet(sea.context, sea.sea, { embark: () => undefined, ready: () => true,
      release: () => undefined, visitorLoaded: goods => loaded.push(goods) });
    expect(fleet.sendVisitor(harbour.uid, { fish: 5 }, ["stone"])).not.toBeNull();
    const ship = (current = fleet) => current.frames()[0]!;
    run(fleet, () => ship().phase === "loading");
    // The pickup is reserved in storage as loading begins and leaves it with the last box (owner, 2026-10-21).
    expect(harbour.inventory).toMatchObject({ fish: 5, stone: 0 });
    expect(harbour.shipReserve).toEqual({ stone: 40 });
    expect(ship().deckBoxes).toBe(0);
    const docks = createHarbourDocks(sea.context);
    let porters = 0;
    run(fleet, () => {
      porters = Math.max(porters, dockPorters(sea.world, docks(fleet.snapshot(), fleet.frames())).length);
      return (ship().deckBoxes ?? 0) >= 1;
    });
    expect(porters).toBeGreaterThan(1);
    expect(loaded).toHaveLength(0);
    expect(harbour.shipReserve).toEqual({ stone: 40 });
    const restored = createNavalFleet(sea.context, sea.sea, { embark: () => undefined, ready: () => true,
      release: () => undefined, visitorLoaded: goods => loaded.push(goods) });
    restored.restore(structuredClone(fleet.saveState()));
    expect(ship(restored).deckBoxes).toBe(1);
    run(restored, () => ship(restored).phase === "sailing");
    expect(ship(restored).deckBoxes).toBe(2);
    expect(harbour.shipReserve).toBeUndefined();
    expect(loaded).toEqual([{ stone: 40 }]);
    expect(harbour.inventory.stone).toBe(0);
  });
});
