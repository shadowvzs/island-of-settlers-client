import { expect, it } from "vitest";

import { productionBlockageHint, productionWaitStatus } from "../src/app/settlement/production-wait-status";
import type { SettlementBuilding } from "../src/shared/settlement/settlement-types";

const building = (typeId: number, overrides: Partial<SettlementBuilding> = {}) =>
  ({
    typeId,
    status: "Waiting for inputs",
    input: {},
    incoming: {},
    ...overrides
  }) as SettlementBuilding;
it("distinguishes missing stock from incoming cargo without mutating the building", () => {
  const site = building(33, { input: { logs: 0 }, incoming: { logs: 1 } });
  const before = structuredClone(site);
  expect(productionWaitStatus(site, "roman")).toMatch(/0\/1 ready, 1 incoming/);
  expect(site).toEqual(before);
});
it("counts repeated hand-cart inputs and offers alternative mine foods", () => {
  expect(
    productionWaitStatus(building(33, { handcartMode: true, input: { logs: 2 } }), "roman")
  ).toMatch(/2\/4 ready/);
  expect(productionWaitStatus(building(10), "roman")).toMatch(/Needs one of:/);
});
it("uses nation drink ingredients and leaves other statuses alone", () => {
  expect(productionWaitStatus(building(6), "japanese")).toMatch(/rice/i);
  expect(productionWaitStatus(building(6, { status: "Production stopped" }), "japanese")).toBe(
    "Production stopped"
  );
});

it("explains proven blockers without finding paths, mutating stock or labelling normal rests as jams", () => {
  const site = building(33, { construction: 1, status: "Road not connected to storage" });
  const before = structuredClone(site);
  expect(productionBlockageHint(site, "roman", 0)).toMatch(/Connect.*entrance/);
  expect(site).toEqual(before);
  expect(productionBlockageHint(building(33, { status: "Resting", worker: 1 }), "roman", 0)).toBeNull();
  expect(productionBlockageHint(building(33, { productionPaused: true }), "roman")).toMatch(/paused/);
  expect(productionBlockageHint(building(6, { construction: 1, status: "Staffed" }), "japanese", 0))
    .toMatch(/no idle settlers/);
  expect(productionBlockageHint(building(6, { construction: 1, status: "Staffed" }), "roman", 0, true))
    .toMatch(/^Population limit reached/);
  expect(productionBlockageHint(building(17, { status: "Waiting for axe" }), "roman"))
    .toMatch(/road-connected storage/);
});
