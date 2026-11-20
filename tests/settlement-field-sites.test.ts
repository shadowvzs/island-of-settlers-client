import { describe, expect, it, vi } from "vitest";

import { createFieldSiteValidator } from "../src/shared/settlement/settlement-field-sites";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import { BUILD } from "../src/shared/world/world-data";

const SIZE = 16;

/** A flat open island with one finished building whose stock approaches the wheat validator inspects. */
const fieldContext = (stockContact: () => null) => {
  const occupied = new Uint8Array(SIZE * SIZE);
  const world = { buildClass: new Uint8Array(SIZE * SIZE).fill(BUILD.large), cellsX: SIZE, cellsZ: SIZE,
    walkCost: new Uint8Array(SIZE * SIZE).fill(10) };
  const roads = { revision: 0, route: () => null, segments: () => [] };
  const building = { input: {}, output: {}, required: {}, typeId: 37, uid: 1, x: 8, z: 8 };
  return { buildings: [building], occupied, options: { roads, stockContact, world }, reservations: new Set<string>()
  } as unknown as SettlementContext;
};

describe("field site validator", () => {
  it("rejects taken wheat cells before computing stock contact geometry (LOG-02)", () => {
    const stockContact = vi.fn(() => null);
    const context = fieldContext(stockContact);
    const canUse = createFieldSiteValidator(context, []);
    context.occupied[6 * SIZE + 6] = 1;
    expect(canUse(6, 6, undefined, true)).toBe(false);
    context.reservations.add(`field:${7 * SIZE + 6}`);
    expect(canUse(6, 7, undefined, true)).toBe(false);
    expect(stockContact).not.toHaveBeenCalled();
    expect(canUse(10, 10, undefined, true)).toBe(true);
    expect(stockContact).toHaveBeenCalled();
  });
});
