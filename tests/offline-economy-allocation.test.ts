import { describe, expect, it } from "vitest";

import { offlineEconomyInputAllocation } from "../src/app/settlement/offline-economy-allocation";

const foodDemand = {
  targets: { fish: 2, meat: 2, bread: 2 }, alternativeFoods: ["fish", "meat", "bread"],
  buffered: {}, available: { fish: 10, meat: 10, bread: 10 }
};
describe("offline economy canonical input allocation", () => {
  it("dispatches one food despite a target of two, then stops while that food is incoming", () => {
    expect(offlineEconomyInputAllocation(foodDemand)).toEqual({ ware: "fish", units: 1 });
    expect(offlineEconomyInputAllocation({ ...foodDemand, incoming: { fish: 1 } })).toBeUndefined();
    expect(offlineEconomyInputAllocation({ ...foodDemand, buffered: { fish: 1 } })).toBeUndefined();
  });
  it("does not top up a food buffer or reserve a different food alongside it", () => {
    expect(offlineEconomyInputAllocation({ ...foodDemand, buffered: { bread: 1 } })).toBeUndefined();
    expect(offlineEconomyInputAllocation({ ...foodDemand, incoming: { meat: 1 },
      available: { bread: 10 } })).toBeUndefined();
  });
  it("chooses the first available alternative in recipe order after the buffer empties", () => {
    expect(offlineEconomyInputAllocation({ ...foodDemand, available: { fish: 0, meat: 3, bread: 9 } }))
      .toEqual({ ware: "meat", units: 1 });
    expect(offlineEconomyInputAllocation({ ...foodDemand, available: { bread: 2 } }))
      .toEqual({ ware: "bread", units: 1 });
  });
  it("subtracts buffered and incoming stock and preserves fixed-recipe demand order", () => {
    const demand = { targets: { ironOre: 2, coal: 2 }, buffered: { ironOre: 1 }, incoming: { ironOre: 1 },
      available: { ironOre: 10, coal: 10 } };
    expect(offlineEconomyInputAllocation(demand)).toEqual({ ware: "coal", units: 1 });
    expect(offlineEconomyInputAllocation({ ...demand, incoming: {} }))
      .toEqual({ ware: "ironOre", units: 1 });
  });
  it("replaces goods already committed to an input return", () => {
    expect(offlineEconomyInputAllocation({ targets: { logs: 2 }, buffered: { logs: 2 },
      reservedReturns: { logs: 1 }, available: { logs: 10 } })).toEqual({ ware: "logs", units: 1 });
  });
  it("allows a larger dispatch only when the caller supplies an eligible cart capacity", () => {
    expect(offlineEconomyInputAllocation({ ...foodDemand, dispatchCapacity: 4 }))
      .toEqual({ ware: "fish", units: 2 });
    expect(offlineEconomyInputAllocation({ targets: { logs: 6 }, buffered: {},
      available: { logs: 3 }, dispatchCapacity: 4 })).toEqual({ ware: "logs", units: 3 });
  });
  it("is read-only and rejects invalid dispatch capacity", () => {
    const before = JSON.stringify(foodDemand);
    expect(offlineEconomyInputAllocation({ ...foodDemand, available: {} })).toBeUndefined();
    expect(JSON.stringify(foodDemand)).toBe(before);
    expect(() => offlineEconomyInputAllocation({ ...foodDemand, dispatchCapacity: 0 })).toThrow("capacity");
  });
});
