import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import type { SettlementActor, SettlementBuilding } from "../src/shared/settlement/settlement-types";
import { fixture, loadedCart, MID_ROAD, totalOf } from "./helpers/handcart-fixture";

describe("hand-cart dispatch", () => {
  it("moves 60 finite producer stones by carriers/carts, without a mount or pool balancing", () => {
    const f = fixture(); f.headquarters.handcarts = 2;
    const { baseline, before } = f.dispatch(60);
    expect(f.advance(360, () => {
      expect(f.simulation.frames().some(actor => actor.job === "Mount")).toBe(false);
      return f.delivered(baseline, 60);
    })).toBe(true);
    expect(f.stoneTotal()).toBe(before);
    expect(f.simulation.transferWare(f.headquarters.uid, f.storehouse.uid, "stone", 1)).toBe(false);
  });
  it("keeps timed producer pickup but deposits at storage in one transaction", () => {
    const f = fixture(), { baseline, before } = f.dispatch();
    expect(f.advance(60, () => f.crews().some(actor => actor.phase === "cartLoading"))).toBe(true);
    const crew = f.crews()[0]!, cargo = crew.handcart!.cargo;
    f.advance(.1); expect(crew.phase).toBe("cartLoading"); expect(crew.handcart!.cargo).toBe(cargo);
    expect(f.advance(100, () => { expect(f.stoneTotal()).toBe(before);
      expect([baseline, baseline + 3]).toContain(f.available()); return f.delivered(baseline); })).toBe(true);
    expect(f.storehouse.handcarts).toBe(1); expect(f.crews()).toHaveLength(0);
  });
  it("redirects loaded producer output when its selected access stops receiving", () => {
    const f = fixture(), { baseline, before } = f.dispatch();
    expect(f.advance(60, loadedCart(f.crews))).toBe(true);
    expect(f.simulation.setStorageAcceptance(f.storehouse.uid, "stone", false)).toBe(true);
    expect(f.crews()[0]!.handcart!.trip!.destination).toBe(f.headquarters.uid);
    expect(f.advance(120, () => f.crews().length === 0 && f.available() === baseline + 3)).toBe(true);
    expect(f.storehouse.incoming.stone ?? 0).toBe(0); expect(f.stoneTotal()).toBe(before);
  });
  it("keeps an already committed receiver when no alternative accepts the ware", () => {
    const f = fixture(), { baseline, before } = f.dispatch();
    expect(f.advance(60, loadedCart(f.crews))).toBe(true);
    f.simulation.setStorageAcceptance(f.headquarters.uid, "stone", false);
    f.simulation.setStorageAcceptance(f.storehouse.uid, "stone", false);
    expect(f.crews()[0]!.handcart!.trip!.destination).toBe(f.storehouse.uid);
    expect(f.advance(120, () => f.delivered(baseline))).toBe(true); expect(f.stoneTotal()).toBe(before);
  });
  it("adopts a physically delivered full cart at the receiving access, leaving shared goods once", () => {
    const f = fixture(), { baseline, before } = f.dispatch();
    expect(f.advance(60, loadedCart(f.crews))).toBe(true);
    expect(f.crews()[0]!.handcart!.trip!.planned).toBe(3);
    expect(f.advance(120, () => f.delivered(baseline))).toBe(true);
    expect(f.headquarters.inventory.stone).toBe(f.storehouse.inventory.stone);
    expect(f.storehouse.handcarts).toBe(1); expect(f.headquarters.handcarts).toBe(0);
    expect(f.crews()).toHaveLength(0); expect(f.stoneTotal()).toBe(before);
  });
  it("returns a cart rather than exceeding the receiving depot's four-cart limit", () => {
    const f = fixture(); f.storehouse.handcarts = 4;
    const { baseline, before } = f.dispatch();
    expect(f.advance(180, () => { expect(f.simulation.handcarts(f.storehouse.uid)).toBeLessThanOrEqual(4);
      return f.delivered(baseline) && f.crews().length === 0; })).toBe(true);
    expect(f.storehouse.handcarts).toBe(4); expect(f.headquarters.handcarts).toBe(1);
    expect(f.stoneTotal()).toBe(before); expect(f.simulation.loadState(f.simulation.saveState())).toEqual({ ok: true });
  });
  it("counts a cart on the producer route against its original local depot limit", () => {
    const f = fixture(); f.headquarters.handcarts = 4; f.dispatch();
    expect(f.advance(30, () => f.crews().length > 0)).toBe(true);
    expect(f.headquarters.handcarts).toBe(3); expect(f.simulation.handcarts(f.headquarters.uid)).toBe(4);
  });
  it("moves demolished storage carts only into free local room and refunds the rest", () => {
    const f = fixture(); f.headquarters.handcarts = 4; f.storehouse.handcarts = 3;
    const logs = f.available("logs"), iron = f.available("iron");
    expect(f.simulation.demolishBuilding(f.storehouse.uid).ok).toBe(true);
    expect(f.headquarters.handcarts).toBe(4); expect(f.available("logs")).toBe(logs + 12);
    expect(f.available("iron")).toBe(iron);
  });
  it("clamps over-limit local carts on restore and credits the one pool refund", () => {
    const f = fixture(), save = JSON.parse(JSON.stringify(f.simulation.saveState()));
    save.buildings.find((building: SettlementBuilding) => building.uid === f.headquarters.uid).handcarts = 6;
    const logs = f.available("logs"), iron = f.available("iron");
    expect(f.simulation.loadState(save)).toEqual({ ok: true });
    expect(f.headquarters.handcarts).toBe(4); expect(f.available("logs")).toBe(logs + 8);
    expect(f.available("iron")).toBe(iron);
  });
  it("plans only the two finite producer items when fewer than a full cart exist", () => {
    const f = fixture(), { baseline, before } = f.dispatch(2);
    expect(f.advance(30, () => f.crews().length > 0)).toBe(true);
    expect(f.crews()[0]!.handcart!.trip!.planned).toBe(2);
    expect(f.advance(120, () => f.delivered(baseline, 2))).toBe(true); expect(f.stoneTotal()).toBe(before);
  });
  it("keeps single items and dirt-road deliveries on ordinary carriers", () => {
    for (const [stone, amount] of [[true, 1], [false, 3]] as const) {
      const f = fixture(stone), { baseline, before } = f.dispatch(amount);
      f.advance(2); expect(f.crews()).toHaveLength(0);
      expect(f.simulation.frames().some(actor => actor.delivery?.ware === "stone")).toBe(true);
      expect(f.advance(180, () => f.delivered(baseline, amount))).toBe(true);
      expect(f.stoneTotal()).toBe(before); expect(f.headquarters.handcarts).toBe(1);
    }
  });
  it("restores a loaded real producer trip with exact cart pose/cargo and one final credit", () => {
    const f = fixture(), { baseline, before } = f.dispatch();
    expect(f.advance(60, loadedCart(f.crews))).toBe(true);
    const save = JSON.parse(JSON.stringify(f.simulation.saveState())); f.advance(5);
    expect(f.simulation.loadState(save)).toEqual({ ok: true });
    const saved = save.actors.find((actor: SettlementActor) => actor.handcart)!;
    const actor = f.crews()[0]!;
    expect({ x: actor.x, z: actor.z, yaw: actor.yaw, pathIndex: actor.pathIndex, handcart: actor.handcart })
      .toEqual({ x: saved.x, z: saved.z, yaw: saved.yaw, pathIndex: saved.pathIndex, handcart: saved.handcart });
    expect(actor.handcart!.cargo).toBe(3);
    expect(f.advance(120, () => f.available() === baseline + 3 && f.crews().length === 0)).toBe(true);
    expect(f.stoneTotal()).toBe(before);
    expect(f.simulation.handcarts(f.storehouse.uid)).toBe(1);
    expect(f.simulation.handcarts(f.headquarters.uid)).toBe(0);
  });
  it("atomically rejects overloaded, orphaned and corrupt cart trips", () => {
    const f = fixture(); f.dispatch(); expect(f.advance(60, loadedCart(f.crews))).toBe(true);
    const original = f.simulation.saveState(), index = original.actors.findIndex(actor => actor.handcart);
    for (const corrupt of [
      (cart: Record<string, unknown>) => { cart.cargo = 9; },
      (cart: Record<string, unknown>) => { cart.owner = 999; },
      (cart: Record<string, unknown>) => { (cart.trip as Record<string, unknown>).planned = 10; },
      (cart: Record<string, unknown>) => { cart.state = "flying"; }
    ]) {
      const save = JSON.parse(JSON.stringify(original)); corrupt(save.actors[index].handcart);
      expect(f.simulation.loadState(save).ok).toBe(false); expect(f.simulation.saveState()).toEqual(original);
    }
  });
});

describe("hand-cart recovery", () => {
  it("parks at a real missing road edge, walks goods over and returns the emptied cart", () => {
    const f = fixture(), { baseline, before } = f.dispatch();
    expect(f.advance(60, loadedCart(f.crews))).toBe(true);
    expect(f.simulation.removeRoad(MID_ROAD.start, MID_ROAD.end)).toBe(true);
    let parked = false;
    f.advance(240, () => { parked ||= f.crews().some(actor => actor.handcart!.state === "parked");
      expect(f.stoneTotal()).toBe(before); return false; });
    expect(parked).toBe(true); expect(f.delivered(baseline)).toBe(true);
    expect(f.crews()).toHaveLength(0); expect(f.headquarters.handcarts).toBe(1);
  });
  it("redirects recovered cargo after the selected access disables receiving", () => {
    const f = fixture(), { baseline, before } = f.dispatch();
    expect(f.advance(60, loadedCart(f.crews))).toBe(true);
    expect(f.simulation.removeRoad(MID_ROAD.start, MID_ROAD.end)).toBe(true);
    expect(f.advance(100, () => f.crews().some(actor => actor.handcart!.state === "parked"))).toBe(true);
    f.simulation.setStorageAcceptance(f.storehouse.uid, "stone", false);
    expect(f.advance(240, () => f.crews().length === 0 && f.available() === baseline + 3)).toBe(true);
    expect(f.storehouse.incoming.stone ?? 0).toBe(0); expect(f.stoneTotal()).toBe(before);
  });
  it("takes an actually upgraded detour instead of parking at a removed edge", () => {
    const f = fixture();
    const detour = [{ x: 18, z: 13.5 }, { x: 18, z: 15 }, { x: 23, z: 15 }, { x: 23, z: 13.5 }];
    for (let i = 1; i < detour.length; i++) {
      expect(f.simulation.connectRoads(detour[i - 1]!, detour[i]!)).toBe(true);
      expect(f.simulation.upgradeRoad(detour[i - 1]!, detour[i]!)).toBeTruthy();
    }
    const { baseline, before } = f.dispatch(); expect(f.advance(60, loadedCart(f.crews))).toBe(true);
    expect(f.simulation.removeRoad(MID_ROAD.start, MID_ROAD.end)).toBe(true);
    let detoured = false;
    f.advance(160, () => { detoured ||= f.crews().some(actor => actor.z > 14.5);
      expect(f.crews().some(actor => actor.handcart!.state === "parked")).toBe(false); return false; });
    expect(detoured).toBe(true); expect(f.delivered(baseline)).toBe(true); expect(f.stoneTotal()).toBe(before);
  });
  it("never drags a loaded cart across a downgraded road section", () => {
    const f = fixture(), { baseline, before } = f.dispatch();
    expect(f.advance(60, loadedCart(f.crews))).toBe(true);
    expect(f.roads.replaceSegments(f.roads.segments().map(segment =>
      segment.start.x === MID_ROAD.start.x && segment.end.x === MID_ROAD.end.x &&
        segment.start.z === MID_ROAD.start.z
        ? { ...segment, tier: "dirt" as const } : segment))).toBe(true);
    let parked = false;
    f.advance(240, () => { parked ||= f.crews().some(actor => actor.handcart!.state === "parked");
      expect(f.stoneTotal()).toBe(before); return false; });
    expect(parked).toBe(true); expect(f.delivered(baseline)).toBe(true); expect(f.crews()).toHaveLength(0);
  });
  it.each([0, 1, 2, 3] as const)("salvages an actual loaded delivery when receiving storage rotation %i is demolished", rotation => {
    const f = fixture(true, rotation), { baseline, before } = f.dispatch();
    expect(f.advance(60, loadedCart(f.crews))).toBe(true);
    expect(f.simulation.demolishBuilding(f.storehouse.uid).ok).toBe(true);
    expect(f.crews()[0]!.handcart!.trip!.destination).toBe(f.headquarters.uid);
    expect(f.simulation.loadState(f.simulation.saveState())).toEqual({ ok: true });
    expect(f.advance(180, () => f.crews().length === 0 && f.available() === baseline + 3)).toBe(true);
    expect(f.stoneTotal()).toBe(before); expect(f.headquarters.handcarts).toBe(1);
  });
  it.each([0, 1, 2, 3] as const)("refunds a prepaid warehouse→paused sawmill trip after source rotation %i disappears", rotation => {
    const f = fixture(true, rotation, true), ware = "logs";
    const before = totalOf(f.simulation.buildings(), f.simulation.frames(), ware);
    expect(f.simulation.transferWare(f.storehouse.uid, f.source.uid, ware, 3)).toBe(true);
    expect(f.advance(60, () => f.crews().some(actor => actor.phase === "cartToSource" && actor.x > 17))).toBe(true);
    const trip = f.crews()[0]!.handcart!.trip!; expect(trip.prepaid).toBe(3);
    expect(f.simulation.demolishBuilding(f.storehouse.uid).ok).toBe(true);
    expect(totalOf(f.simulation.buildings(), f.simulation.frames(), ware)).toBe(before);
    expect(f.crews()[0]!.handcart!.trip).toBeUndefined();
    expect(f.simulation.loadState(f.simulation.saveState())).toEqual({ ok: true });
    f.advance(120); expect(totalOf(f.simulation.buildings(), f.simulation.frames(), ware)).toBe(before);
    expect(f.headquarters.handcarts).toBe(1);
    expect(f.simulation.buildings().find(building => building.uid === f.source.uid)!.incoming.logs ?? 0).toBe(0);
  });
  it("keeps unreachable parked goods, then recovers them after the original route is restored", () => {
    const f = fixture(), { baseline, before } = f.dispatch();
    expect(f.advance(60, loadedCart(f.crews))).toBe(true);
    const saved = f.roads.segments(); expect(f.roads.replaceSegments([])).toBe(true);
    const actor = f.crews()[0]!, walk = f.world.walkCost.slice();
    for (let z = 0; z < 64; z++) for (const x of [Math.floor(actor.x) - 3, Math.floor(actor.x) + 3])
      f.world.walkCost[z * 64 + x] = 0;
    f.world.buildRevision = (f.world.buildRevision ?? 0) + 1; f.advance(20);
    expect(actor.handcart!.state).toBe("parked");
    expect(actor.handcart!.cargo + (actor.ware === "stone" ? actor.wareUnits ?? 1 : 0)).toBe(3);
    expect(f.stoneTotal()).toBe(before); expect(f.available()).toBe(baseline);
    f.world.walkCost.set(walk); f.world.buildRevision++;
    expect(f.roads.replaceSegments(saved)).toBe(true);
    expect(f.advance(180, () => f.delivered(baseline))).toBe(true); expect(f.stoneTotal()).toBe(before);
  });
});

const SAWMILL = 33;

/** A finished, road-connected Sawmill south of the HQ-storehouse road, in the chosen mode. */
const sawmillFixture = (mode: "handcart" | "planks" = "handcart") => {
  const setup = fixture();
  const [width, depth] = getBuildingDefinition(SAWMILL).gridFootprint;
  const placed = setup.simulation.placeBuilding(SAWMILL, 18 + width % 2 / 2, 20 + depth % 2 / 2);
  expect(placed.ok, placed.reason).toBe(true);
  const sawmill = placed.building!;
  Object.assign(sawmill, { construction: 1, required: {} });
  expect(setup.simulation.connectRoads(sawmill.access, setup.headquarters.access)).toBe(true);
  expect(setup.simulation.upgradeRoad(sawmill.access, setup.headquarters.access)).toBeTruthy();
  expect(setup.simulation.setSawmillMode(sawmill.uid, mode)).toBe(true);
  const logsTotal = () => totalOf(setup.simulation.buildings(), setup.simulation.frames(), "logs") +
    setup.simulation.frames().reduce((sum, actor) => sum + (actor.consumed?.logs ?? 0), 0);
  return { ...setup, logsTotal, sawmill };
};

describe("Sawmill hand carts", () => {
  it.each(["input", "output"] as const)("retains timed cart %s handling at production buildings", direction => {
    const { advance, crews, headquarters, sawmill } = sawmillFixture("planks");
    if (direction === "output") { headquarters.inventory.logs = 0; sawmill.output.planks = 4; }
    const phase = direction === "input" ? "cartUnloading" : "cartLoading";
    expect(advance(90, () => crews().some(actor => actor.phase === phase))).toBe(true);
    const actor = crews().find(actor => actor.phase === phase)!;
    const before = actor.handcart!.cargo;
    advance(.1);
    expect(actor.phase).toBe(phase);
    expect(actor.handcart!.cargo).toBe(before);
  });
  it("keeps a new cart parked until its route home is upgraded", () => {
    const { advance, crews, headquarters, roads, sawmill, simulation } = sawmillFixture();
    expect(roads.replaceSegments(roads.segments().map(segment => ({ ...segment, tier: "dirt" })))).toBe(true);
    expect(advance(120, () => crews().some(actor => actor.handcart?.state === "parked"))).toBe(true);
    advance(10);
    expect(crews().some(actor => actor.handcart?.state === "hitched")).toBe(false);
    expect(simulation.upgradeRoad(sawmill.access, headquarters.access)).toBeTruthy();
    expect(advance(30, () => crews().some(actor => actor.handcart?.state === "hitched"))).toBe(true);
  });
  it.each(["input", "output"] as const)("automatically carts production %s on continuous stone roads", direction => {
    const { advance, crews, headquarters, sawmill, simulation } = sawmillFixture("planks");
    expect(simulation.upgradeRoad(sawmill.access, headquarters.access)).toBeTruthy();
    if (direction === "output") {
      headquarters.inventory.logs = 0;
      sawmill.output.planks = 4;
    }
    const source = direction === "input" ? headquarters : sawmill;
    const destination = direction === "input" ? sawmill : headquarters;
    expect(advance(90, () => crews().some(actor => {
      const trip = actor.handcart?.trip;
      return trip?.source === source.uid && trip.destination === destination.uid &&
        actor.phase === "cartToDestination" && actor.handcart!.cargo >= 2;
    }))).toBe(true);
  });
  it("turns four logs into a cart that a carrier pulls to the nearest storage with room", () => {
    const { advance, crews, headquarters, logsTotal, sawmill, simulation } = sawmillFixture();
    const logs = logsTotal(), planks = totalOf(simulation.buildings(), simulation.frames(), "planks");
    let parkedInYard = false;
    expect(advance(240, () => {
      parkedInYard ||= crews().some(actor => actor.handcart!.state === "parked");
      return headquarters.handcarts === 2;
    })).toBe(true);
    expect(parkedInYard).toBe(true);
    expect(sawmill.handcarts ?? 0).toBe(0);
    // Halved production (BAL-01) may start the next cart before the slower carrier arrives:
    // every started cart spends exactly four logs.
    const spent = logs - logsTotal();
    expect(spent).toBeGreaterThanOrEqual(4);
    expect(spent % 4).toBe(0);
    expect(totalOf(simulation.buildings(), simulation.frames(), "planks")).toBe(planks);
  });

  it("asks for a whole cart's logs and waits while every storage is full", () => {
    const { advance, headquarters, logsTotal, sawmill, storehouse } = sawmillFixture();
    headquarters.handcarts = 4;
    storehouse.handcarts = 4;
    const logs = logsTotal();
    advance(60);
    expect(sawmill.input.logs).toBe(4);
    expect(sawmill.status).toBe("No storage has room for another hand cart");
    expect(logsTotal()).toBe(logs);
    expect(sawmill.handcarts ?? 0).toBe(0);
  });

  it("keeps sawing planks in the default mode", () => {
    const { advance, sawmill, simulation } = sawmillFixture("planks");
    expect(simulation.sawmillMode(sawmill.uid)).toBe("planks");
    expect(advance(120, () => (sawmill.output.planks ?? 0) > 0 ||
      simulation.frames().some(actor => actor.delivery?.ware === "planks"))).toBe(true);
    expect(sawmill.handcarts ?? 0).toBe(0);
  });

  it("saves the mode and a finished cart, and rejects the mode on other buildings", () => {
    const { headquarters, sawmill, simulation } = sawmillFixture();
    expect(simulation.setSawmillMode(headquarters.uid, "handcart")).toBe(false);
    sawmill.handcarts = 1;
    const save = JSON.parse(JSON.stringify(simulation.saveState()));
    expect(simulation.loadState(save)).toEqual({ ok: true });
    const loaded = simulation.buildings().find(building => building.uid === sawmill.uid)!;
    expect(simulation.sawmillMode(sawmill.uid)).toBe("handcart");
    expect(loaded.handcarts).toBe(1);
    const corrupt = JSON.parse(JSON.stringify(save));
    corrupt.buildings.find((building: SettlementBuilding) => building.uid === headquarters.uid).handcartMode = true;
    expect(simulation.loadState(corrupt).ok).toBe(false);
  });
});
