import { expect, it } from "vitest";

import { getBuildingStockContact } from "../src/render-common/buildings/building-stock-anchors";
import type {
  SettlementBuilding,
  SettlementContext
} from "../src/shared/settlement/settlement-types";
import {
  findWellOutputPath,
  wellOutputObstacles
} from "../src/shared/settlement/settlement-well-output-path";
import {
  wellBucketPickupContact,
  wellWaterOutputContact
} from "../src/shared/settlement/settlement-well-work";
import type { WorldData } from "../src/shared/world/world-data";
const fixture = (rotation: number, slot: number) => {
  const size = 32,
    world = {
      cellsX: size,
      cellsZ: size,
      walkCost: new Uint8Array(size ** 2).fill(10),
      props: {
        count: 0,
        types: new Uint8Array(),
        scale: new Float32Array(),
        x: new Float32Array(),
        z: new Float32Array()
      }
    } as unknown as WorldData;
  const building = {
    uid: 1,
    typeId: 35,
    x: 16,
    y: 0,
    z: 16,
    rotation,
    width: 2,
    depth: 2,
    output: { water: slot },
    input: {},
    access: { x: 16, z: 17.5 }
  } as unknown as SettlementBuilding;
  const context = {
    options: {
      world,
      stockContact: (
        b: SettlementBuilding,
        kind: "input" | "output",
        ware: string,
        index: number
      ) => {
        const c = getBuildingStockContact(35, kind, ware, index, b.x, b.z, b.rotation, b.y)!;
        return {
          slot: index,
          ware,
          approach: { x: c.approach[0], y: c.approach[1], z: c.approach[2] },
          stock: { x: c.warePosition[0], y: c.warePosition[1], z: c.warePosition[2] },
          yaw: c.wareYaw,
          scale3: { x: c.wareScale[0], y: c.wareScale[1], z: c.wareScale[2] }
        };
      }
    },
    occupied: new Uint8Array(size ** 2),
    buildings: [building]
  } as unknown as SettlementContext;
  return { building, context };
};
it.each(Array.from({ length: 24 }, (_, index) => [Math.floor(index / 6), index % 6]))(
  "well %s, next slot %s follows a short direct/court path and avoids every occupied bucket",
  (rotation, slot) => {
    const { building, context } = fixture(rotation!, slot!);
    const from = wellBucketPickupContact(building).approach,
      to = wellWaterOutputContact(context, building, slot!).approach;
    const path = findWellOutputPath(context, building, from, to);
    expect(path).not.toBeNull();
    const obstacles = wellOutputObstacles(context, building);
    let cursor = from,
      total = 0;
    for (const point of path!) {
      const distance = Math.hypot(point.x - cursor.x, point.z - cursor.z);
      total += distance;
      for (let t = 0; t <= 1; t += 0.025)
        for (const bucket of obstacles)
          expect(
            Math.hypot(
              cursor.x + (point.x - cursor.x) * t - bucket.x,
              cursor.z + (point.z - cursor.z) * t - bucket.z
            )
          ).toBeGreaterThanOrEqual(bucket.radius - 1e-6);
      cursor = { ...point, y: 0 };
    }
    expect(total).toBeLessThan(2.3);
    if (slot === 0) {
      expect(path).toHaveLength(1);
      expect(total).toBeLessThan(0.35);
    }
  }
);
