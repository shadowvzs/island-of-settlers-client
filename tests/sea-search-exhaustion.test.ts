import { expect, it, vi } from "vitest";

import { findSeaRoute } from "../src/shared/settlement/settlement-sea-navigation";
import { createShipSea } from "./helpers/ship-motion-scenarios";

it("emits a complete reachable set only on frontier exhaustion, never a successful or invalid early return", () => {
  const { sea, world } = createShipSea();
  const from = { x: 40.5, z: 35.5 }, exhausted = vi.fn();
  expect(findSeaRoute(world, sea, from, { x: -1, z: 20 }, undefined, exhausted)).toBeNull();
  expect(findSeaRoute(world, sea, from, { x: 10.5, z: 20.5 }, undefined, exhausted)).toBeNull();
  expect(findSeaRoute(world, sea, from, { x: 45.5, z: 40.5 }, undefined, exhausted)).not.toBeNull();
  expect(exhausted).not.toHaveBeenCalled();
  expect(findSeaRoute(world, sea, from, { x: 80.5, z: 90.5 },
    (first, second) => first.x < 60 && second.x < 60, exhausted)).toBeNull();
  expect(exhausted).toHaveBeenCalledTimes(1);
  const reachable = exhausted.mock.calls[0]![0] as Uint8Array;
  expect(reachable[35 * world.cellsX + 40]).toBe(1);
  expect(reachable[110 * world.cellsX + 25]).toBe(1);
  expect(reachable[90 * world.cellsX + 80]).toBe(0);
});
