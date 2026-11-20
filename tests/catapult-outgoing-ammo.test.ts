import { expect, it } from "vitest";

import { availableTransportGood } from "../src/shared/settlement/settlement-land-transport-claims";
import type { SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";

it.each(["hand", "cup", "loose"] as const)("outgoing transport excludes the real %s stone while roof deliveries remain withdrawable", ammo => {
  const source = { uid: 1, typeId: 16, construction: 1, input: { stone: 1 },
    catapultCycle: { operator: 2, target: 3, phase: "ready", elapsed: 0, ammo } } as unknown as SettlementBuilding;
  const context = { actors: [] } as unknown as SettlementContext;
  expect(availableTransportGood(context, source, "stone", true)).toBe(0);
  source.input.stone = 4;
  expect(availableTransportGood(context, source, "stone", true)).toBe(3);
  delete source.catapultCycle;
  expect(availableTransportGood(context, source, "stone", true)).toBe(4);
});
