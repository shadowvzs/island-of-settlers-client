import { describe, expect, it } from "vitest";

import { SHIP_SAILING_MULTIPLIER } from "../src/shared/balance/colonies";
import { createNavalFleet } from "../src/shared/settlement/settlement-naval-fleet";
import { createShipSea, SHIP_TICK } from "./helpers/ship-motion-scenarios";

describe("saved visitor sailing duration", () => {
  it("waits off-map across save/load, then uses normal approach and cargo unloading", () => {
    const sea = createShipSea(), harbour = sea.harbour(30);
    const fleet = createNavalFleet(sea.context, sea.sea);
    const id = fleet.sendVisitor(harbour.uid, { fish: 5 }, [], "supply", [], 150);
    expect(id).not.toBeNull();
    expect(fleet.frames()).toHaveLength(0);
    for (let tick = 0; tick < 60 / SHIP_TICK; tick++) fleet.update(SHIP_TICK);
    expect(harbour.inventory.fish ?? 0).toBe(0);
    const saved = structuredClone(fleet.saveState());
    const remaining = 150 - 60 * SHIP_SAILING_MULTIPLIER;
    expect(saved.ships[0]!.timer).toBeCloseTo(remaining);
    const restored = createNavalFleet(sea.context, sea.sea);
    restored.restore(saved);
    for (let tick = 0; tick < (remaining / SHIP_SAILING_MULTIPLIER - 1) / SHIP_TICK; tick++) restored.update(SHIP_TICK);
    expect(restored.frames()).toHaveLength(0);
    expect(harbour.inventory.fish ?? 0).toBe(0);
    for (let tick = 0; tick < 2 / SHIP_TICK; tick++) restored.update(SHIP_TICK);
    expect(restored.frames()).toHaveLength(1);
    for (let tick = 0; tick < 600 / SHIP_TICK && (harbour.inventory.fish ?? 0) < 5; tick++)
      restored.update(SHIP_TICK);
    expect(harbour.inventory.fish).toBe(5);
  }, 30000);

  it("retains immediate legacy arrival and rejects invalid travel times without creating ships", () => {
    const sea = createShipSea(), harbour = sea.harbour(30), fleet = createNavalFleet(sea.context, sea.sea);
    for (const duration of [-1, NaN, Infinity, 86401])
      expect(fleet.sendVisitor(harbour.uid, {}, [], "supply", [], duration)).toBeNull();
    expect(fleet.saveState().ships).toHaveLength(0);
    expect(fleet.sendVisitor(harbour.uid, { fish: 1 })).not.toBeNull();
    expect(fleet.frames()).toHaveLength(1);
  });
});
