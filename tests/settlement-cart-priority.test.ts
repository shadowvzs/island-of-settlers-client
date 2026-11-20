import { describe, expect, it } from "vitest";

import { cartWorthyUnits } from "../src/shared/settlement/settlement-cart-priority";
import type { SettlementActor } from "../src/shared/settlement/settlement-types";
import { fixture } from "./helpers/handcart-fixture";

type Fixture = ReturnType<typeof fixture>;

const walkers = (f: Fixture) => f.simulation.frames().filter(actor => actor.delivery?.ware === "stone" &&
  !actor.handcart);
const relocating = (f: Fixture) => f.simulation.frames().filter(actor => actor.phase === "settlerRelocate" &&
  actor.building === f.headquarters.uid);
/** Adds producer stone and a second order without overwriting the first one's output. */
const order = (f: Fixture, destination: number, amount: number) => {
  f.source.output.stone = (f.source.output.stone ?? 0) + amount;
  expect(f.simulation.transferWare(f.source.uid, destination, "stone", amount)).toBe(true);
};
/** The HQ keeps its cart but no idle settler: every free person waits in the storehouse. */
const crewlessHeadquarters = () => {
  const f = fixture();
  f.storehouse.idleSettlers = f.headquarters.idleSettlers;
  f.headquarters.idleSettlers = 0;
  return f;
};

describe("owner cart priority (2026-11-08)", () => {
  it("defines cart-worthy as more than one walking load and at least half a cart", () => {
    expect(cartWorthyUnits(6)).toBe(3);
    expect(cartWorthyUnits(2)).toBe(2);
    expect(cartWorthyUnits(12)).toBe(6);
  });

  it("sends a free carrier to fetch a crewless cart for a big job instead of walkers", () => {
    const f = crewlessHeadquarters(), { baseline, before } = f.dispatch(6);
    expect(f.advance(5, () => relocating(f).length > 0)).toBe(true);
    expect(relocating(f)).toHaveLength(1);
    expect(f.advance(120, () => {
      expect(walkers(f)).toHaveLength(0);
      return f.crews().some(actor => actor.handcart!.trip?.planned === 6);
    })).toBe(true);
    expect(f.advance(180, () => f.delivered(baseline, 6))).toBe(true);
    expect(f.stoneTotal()).toBe(before);
  });

  it("restores a save taken while the fetcher walks to the cart, and continues identically", () => {
    const f = crewlessHeadquarters();
    f.dispatch(6);
    expect(f.advance(5, () => relocating(f).length > 0)).toBe(true);
    f.advance(2);
    const save = JSON.parse(JSON.stringify(f.simulation.saveState()));
    f.advance(20);
    const continued = JSON.stringify(f.simulation.saveState());
    expect(f.simulation.loadState(save)).toEqual({ ok: true });
    f.advance(20);
    expect(JSON.stringify(f.simulation.saveState())).toBe(continued);
  });

  it("keeps small jobs with walkers while the only bay is busy", () => {
    const f = fixture(), { baseline } = f.dispatch(6);
    expect(f.advance(30, () => f.crews().length > 0)).toBe(true);
    order(f, f.storehouse.uid, 2);
    expect(f.advance(5, () => walkers(f).length > 0)).toBe(true);
    expect(f.advance(240, () => f.delivered(baseline, 8))).toBe(true);
  });

  it("never lets walkers reserve a cart-worthy transfer while carts serve it", () => {
    const f = fixture();
    f.headquarters.handcarts = 2;
    f.dispatch(60);
    let most = 0;
    f.advance(90, () => { most = Math.max(most, walkers(f).length); return false; });
    // Two serving carts cover 12 of the remaining need; walkers may take only a tail below 3.
    expect(most).toBe(0);
    expect(f.crews().length).toBeGreaterThan(0);
  });

  it("gives a free cart crew the largest uncovered cart-worthy job first", () => {
    const f = fixture(), trips: NonNullable<NonNullable<SettlementActor["handcart"]>["trip"]>[] = [];
    f.dispatch(6);
    expect(f.advance(30, () => f.crews().length > 0)).toBe(true);
    order(f, f.headquarters.uid, 3);
    order(f, f.storehouse.uid, 9);
    expect(f.advance(300, () => {
      for (const crew of f.crews()) {
        const trip = crew.handcart!.trip;
        if (trip && !trips.includes(trip)) trips.push(trip);
      }
      return trips.length >= 2;
    })).toBe(true);
    // After the first order, the newer 9-stone order outranks the older 3-stone one.
    expect(trips[1]).toMatchObject({ destination: f.storehouse.uid, planned: 6 });
  });
});
