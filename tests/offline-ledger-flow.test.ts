import { describe, expect, it } from "vitest";

import {
  addFlow, cutAfterEvents, flowDifference, type LedgerFlow, type LedgerSample, skipLimit,
  type SkipRoom, sourceUse, steadyWindows
} from "../src/app/settlement/offline-ledger-flow";

const WINDOW = 120;

const flow = (changes: Partial<LedgerFlow> = {}): LedgerFlow => ({
  animals: 0, births: 0, cycles: {}, holdings: {}, home: {}, ore: {}, produced: {}, resources: {},
  seconds: WINDOW, stored: {}, trees: 0, ...changes
});

const sample = (values: Partial<LedgerSample> = {}): LedgerSample => ({
  animals: 0, births: 0, cycles: {}, elapsed: 0, holdings: {}, home: {}, inBuildings: {}, ore: {},
  produced: {},
  resources: {}, sources: {}, stored: {}, structure: "", trees: 0, ...values
});

const room = (values: Partial<SkipRoom> = {}): SkipRoom => ({
  mixedWares: new Set(), peopleRoom: Infinity, storageRoom: () => 1000, treeRoom: Infinity, window: WINDOW,
  ...values
});

const water = (count: number) => flow({ holdings: { water: count }, stored: { water: count } });

describe("offline ledger flows", () => {
  it("measures and adds flows between samples", () => {
    const first = sample({ births: 2, holdings: { planks: 10 } });
    const second = sample({ births: 3, elapsed: WINDOW, holdings: { logs: 2, planks: 7 } });
    const change = flowDifference(first, second);
    expect(change).toMatchObject({ births: 1, holdings: { logs: 2, planks: -3 }, seconds: WINDOW });
    expect(addFlow(change, change))
      .toMatchObject({ births: 2, holdings: { logs: 4, planks: -6 }, seconds: 2 * WINDOW });
  });

  it("keeps only the latest windows that grow at one rate", () => {
    const windows = [water(20), water(20), water(5), water(5), water(5), water(5)];
    expect(steadyWindows(windows)).toHaveLength(4);
    expect(steadyWindows([water(5), water(6), water(4), water(5)])).toHaveLength(4);
  });

  it("restarts the regime after a ware ran out or the population reached its limit", () => {
    const bread = (count: number) => flow({ holdings: { bread: count }, stored: { bread: count } });
    const used = [bread(-6), bread(-6), bread(0), bread(0)];
    expect(cutAfterEvents(used, sample({ holdings: { bread: 0 } }), room())).toHaveLength(2);
    expect(cutAfterEvents(used, sample({ holdings: { bread: 40 } }), room())).toHaveLength(4);
    const births = [flow({ births: 2 }), flow({ births: 1 }), flow(), flow()];
    expect(cutAfterEvents(births, sample(), room({ peopleRoom: 0 }))).toHaveLength(2);
  });

  it("never skips past a stock, a storage, the population limit or a mine's ore", () => {
    const regime = flow({ births: 2, holdings: { bread: -10, water: 20 }, ore: { 7: -4 }, seconds: 600,
      stored: { bread: -10, water: 20 } });
    const now = sample({ holdings: { bread: 100, water: 50 }, inBuildings: { bread: 100, water: 50 }, ore: { 7: 50 },
      stored: { bread: 100, water: 50 } });
    // Each limit keeps one window's flow (plus two units) in reserve.
    expect(skipLimit(regime, now, room())).toBe(9);
    expect(skipLimit(regime, now, room({ storageRoom: () => 100 }))).toBe(4);
    expect(skipLimit(regime, now, room({ peopleRoom: 5 }))).toBe(2);
    expect(skipLimit(regime, { ...now, ore: { 7: 10 } }, room())).toBe(1);
    // A ware that went up and down again is steady, even with nothing of it left.
    expect(skipLimit(flow({ holdings: { logs: 0 } }), sample(), room())).toBe(Infinity);
  });

  it("spreads worked units over started sources without working one out", () => {
    expect(sourceUse({ "fish:1": 3, "fish:2": 12, "stone:4": 6 }, "fish", 6)).toEqual({ "fish:1": 2, "fish:2": 4 });
  });
});
