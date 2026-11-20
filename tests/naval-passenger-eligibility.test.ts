import { expect, it } from "vitest";

import { isFreeOwnReserve, reserveReachesHarbour } from "../src/shared/settlement/naval-passenger-eligibility";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";

it("excludes foreign, traveling, busy, garrisoned and already assigned soldiers", () => {
  const context = { military: { factionOf: (uid: number) => uid === 1 ? 0 : 1 } } as SettlementContext;
  const actor = { uid: 1, job: "Soldier", phase: "militaryReserve" } as SettlementActor;
  expect(isFreeOwnReserve(context, actor)).toBe(true);
  for (const patch of [{ uid: 2 }, { job: "Carrier" }, { phase: "garrison" }, { phase: "militaryMarch" },
    { phase: "navalWaiting" }, { navalOrder: 5 }])
    expect(isFreeOwnReserve(context, { ...actor, ...patch } as SettlementActor)).toBe(false);
});

it("only counts reserves at the source or with a real road route from their home", () => {
  const source = { uid: 4, access: { x: 9, z: 3 } } as SettlementBuilding;
  const home = { uid: 2, access: { x: 1, z: 3 } } as SettlementBuilding;
  let connected = false;
  const context = { buildings: [home, source], options: { roads: { route: () => connected ? [home.access] : null } } } as unknown as SettlementContext;
  expect(reserveReachesHarbour(context, { home: 4 } as SettlementActor, source)).toBe(true);
  expect(reserveReachesHarbour(context, { home: 2 } as SettlementActor, source)).toBe(false);
  expect(reserveReachesHarbour(context, { home: 99 } as SettlementActor, source)).toBe(false);
  connected = true;
  expect(reserveReachesHarbour(context, { home: 2 } as SettlementActor, source)).toBe(true);
});
