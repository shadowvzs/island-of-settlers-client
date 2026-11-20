import { expect, it } from "vitest";

import { refreshActorsOnLeveledGround } from "../src/shared/settlement/settlement-foundation-worker";
import type { SettlementActor, SettlementContext } from "../src/shared/settlement/settlement-types";
import type { WorldData } from "../src/shared/world/world-data";

const world = (height: number) => ({ cellsX: 8, cellsZ: 8,
  heights: new Float32Array(9 * 9).fill(height) }) as unknown as WorldData;

it("keeps visible settlers on newly levelled ground", () => {
  const data = world(3);
  const actor = { visible: true, x: 2.5, y: 0, z: 2.5 } as SettlementActor;
  const hidden = { visible: false, x: 2.5, y: 0, z: 2.5 } as SettlementActor;
  const outside = { visible: true, x: 7.5, y: 0, z: 7.5 } as SettlementActor;
  const context = { options: { world: data }, actors: [actor, hidden, outside] } as unknown as SettlementContext;
  refreshActorsOnLeveledGround(context, { minX: 1, minZ: 1, maxX: 4, maxZ: 4 });
  expect(actor.y).toBe(3);
  expect(hidden.y).toBe(0);
  expect(outside.y).toBe(0);
});
