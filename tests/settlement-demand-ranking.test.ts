import { describe, expect, it } from "vitest";

import { DEMAND_RANKING } from "../src/shared/balance/economy";
import { rankConsumerDemands } from "../src/shared/settlement/settlement-demand-ranking";
import type { SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";
import { demandFixture, SKINNER, TANNER } from "./helpers/demand-fixture";

const WAIT = DEMAND_RANKING.waitTicksPerUnit;

const consumer = (uid: number, demandWaitSince?: Record<string, number>) =>
  ({ uid, ...(demandWaitSince ? { demandWaitSince } : {}) }) as SettlementBuilding;
const clockAt = (tick: number) => ({ clock: { tick: () => tick } }) as unknown as SettlementContext;
const order = (context: SettlementContext, demands: Parameters<typeof rankConsumerDemands>[1]) =>
  rankConsumerDemands(context, demands).map(demand => `${demand.building.uid}:${demand.ware}`);

describe("demand ranking helper (owner 2026-11-09)", () => {
  it("keeps each ware's first position, ranks a ware's consumers by need and keeps building order on ties", () => {
    const a = consumer(1), b = consumer(2), c = consumer(3);
    expect(order(clockAt(0), [
      { building: a, missing: 1, ware: "pig" }, { building: a, missing: 1, ware: "logs" },
      { building: b, missing: 2, ware: "pig" }, { building: c, missing: 1, ware: "pig" },
      { building: c, missing: 3, ware: "logs" }
    ])).toEqual(["2:pig", "1:pig", "3:pig", "3:logs", "1:logs"]);
  });

  it("moves a small consumer up by one item per waiting step, so it overtakes a larger one", () => {
    const small = consumer(1, { pig: 0 }), large = consumer(2);
    const demands = [{ building: small, missing: 1, ware: "pig" }, { building: large, missing: 3, ware: "pig" }];
    expect(order(clockAt(WAIT * 2 - 1), demands)).toEqual(["2:pig", "1:pig"]);
    // Equal rank keeps building order: the small consumer is first in the list.
    expect(order(clockAt(WAIT * 2), demands)).toEqual(["1:pig", "2:pig"]);
    expect(rankConsumerDemands(clockAt(WAIT * 5), demands)[0]!.rank).toBe(6);
  });
});

describe("demand-based delivery in the simulation", () => {
  it("serves the consumer with the larger uncovered need, not the first one in building order", () => {
    const f = demandFixture(), [butcher, skinner] = f.consumers;
    butcher!.input.pig = 1;
    f.breeder.output.pig = 1;
    expect(f.advance(10, () => f.carriers().length > 0)).toBe(true);
    expect(f.destinations()).toEqual([skinner!.uid]);
  });

  it("does not starve a small consumer next to a large one that keeps consuming", () => {
    const f = demandFixture(), [butcher, skinner] = f.consumers;
    skinner!.input.pig = 1;
    let butcherDeliveries = 0;
    const served = f.advance(180, () => (skinner!.input.pig ?? 0) + (skinner!.incoming.pig ?? 0) > 1, () => {
      // The butcher eats every delivered pig: its need stays at the full input target.
      butcherDeliveries += butcher!.input.pig ?? 0;
      butcher!.input.pig = 0;
      if (!f.carriers().length && !(f.breeder.output.pig ?? 0)) f.breeder.output.pig = 1;
    });
    expect(served).toBe(true);
    expect(butcherDeliveries).toBeGreaterThan(0);
    expect(f.simulation.saveState().gameTick).toBeLessThan(150 * 20);
  });

  it("gives nothing to a paused consumer and starts its wait only when it resumes", () => {
    const f = demandFixture(), [butcher, skinner] = f.consumers;
    skinner!.productionPaused = true;
    butcher!.input.pig = 1;
    f.breeder.output.pig = 1;
    expect(f.advance(10, () => f.carriers().length > 0)).toBe(true);
    expect(f.destinations()).toEqual([butcher!.uid]);
    f.advance(30);
    expect(skinner!.demandWaitSince).toBeUndefined();
    skinner!.productionPaused = false;
    const resumed = f.simulation.saveState().gameTick;
    f.advance(1);
    expect(skinner!.demandWaitSince?.pig ?? -1).toBeGreaterThanOrEqual(resumed ?? 0);
  });

  it("keeps a delivery's destination while ranks change on the way", () => {
    const f = demandFixture(), [butcher, skinner] = f.consumers;
    butcher!.input.pig = 1;
    f.breeder.output.pig = 1;
    expect(f.advance(10, () => f.carriers().length > 0)).toBe(true);
    const carrier = f.carriers()[0]!;
    // The butcher now needs more than the skinner; the pig on its way still goes to the skinner.
    butcher!.input.pig = 0;
    expect(f.advance(120, () => !carrier.delivery, () => {
      if (carrier.delivery) expect(carrier.delivery.destination).toBe(skinner!.uid);
    })).toBe(true);
    expect(skinner!.input.pig).toBe(1);
    expect(butcher!.incoming.pig ?? 0).toBe(0);
  });

  it("loses no pig when the destination is demolished while the pig is on its way", () => {
    const f = demandFixture(), [, skinner] = f.consumers;
    f.breeder.output.pig = 1;
    const before = f.pigTotal();
    expect(f.advance(10, () => f.carriers().length > 0)).toBe(true);
    const carrier = f.carriers()[0]!;
    expect(f.advance(30, () => carrier.ware === "pig")).toBe(true);
    f.simulation.demolishBuilding(skinner!.uid);
    expect(f.advance(180, () => !f.carriers().length)).toBe(true);
    expect(f.pigTotal()).toBe(before);
  });

  it("supplies a chain: the skinner's hides go to the tanner while pigs go to the skinner", () => {
    const f = demandFixture([SKINNER, TANNER]), [skinner, tanner] = f.consumers;
    skinner!.output.hides = 1;
    f.breeder.output.pig = 1;
    expect(f.advance(30, () => f.carriers("hides").length > 0 && f.carriers("pig").length > 0)).toBe(true);
    expect(f.destinations("hides")).toEqual([tanner!.uid]);
    expect(f.destinations("pig")).toEqual([skinner!.uid]);
  });

  it("continues identically after a save taken mid-delivery with saved waiting ticks", () => {
    const f = demandFixture(), [butcher] = f.consumers;
    butcher!.input.pig = 1;
    f.breeder.output.pig = 1;
    expect(f.advance(10, () => f.carriers().length > 0)).toBe(true);
    f.advance(2);
    const save = JSON.parse(JSON.stringify(f.simulation.saveState()));
    expect(save.buildings.find((building: SettlementBuilding) => building.uid === butcher!.uid).demandWaitSince)
      .toBeDefined();
    f.advance(30);
    const continued = JSON.stringify(f.simulation.saveState());
    expect(f.simulation.loadState(save)).toEqual({ ok: true });
    f.advance(30);
    expect(JSON.stringify(f.simulation.saveState())).toBe(continued);
  });
});
