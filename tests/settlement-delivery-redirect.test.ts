import { expect, it } from "vitest";

import { redirectStorageDeliveries } from "../src/shared/settlement/settlement-delivery-redirect";
import type {
  SettlementActor,
  SettlementBuilding,
  SettlementContext
} from "../src/shared/settlement/settlement-types";

const storage = (uid: number, x: number): SettlementBuilding => ({
  accepts: {}, access: { x, z: 4 }, construction: 1, cycle: 0, depth: 2,
  door: 0, doorThreshold: { x, z: 3 }, hasDoor: true, incoming: {}, input: {}, inventory: {},
  output: {}, required: {}, rotation: 0, selected: false, status: "", typeId: 29, uid,
  width: 2, workerApproach: { x, z: 3 }, working: false, x, y: 0, z: 4
}) as unknown as SettlementBuilding;

const actor = (delivery: NonNullable<SettlementActor["delivery"]>): SettlementActor => ({
  action: "carry", animationTime: 0, building: delivery.destination, delivery, home: 0,
  job: "Carrier", path: [], pathIndex: 0, phase: "deliver", timer: 0, uid: 5, visible: true,
  ware: delivery.ware, x: 6, y: 0, yaw: 0, z: 4
});

const context = (
  buildings: SettlementBuilding[],
  actors: SettlementActor[],
  roads: Record<string, unknown> = {
    addRoad: () => true, route: () => null, routeMetrics: () => ({ route: null, status: "no-path" })
  }
) => ({ actors, buildings, options: { roads } }) as unknown as SettlementContext;

it("reroutes an ordinary delivery but not a workshop-upgrade commitment", () => {
  const disabled = storage(1, 4), other = storage(2, 8);
  disabled.accepts.iron = false;
  const upgrade = actor({ destination: 1, source: 0, upgrade: true, ware: "iron" });
  const ordinary = actor({ destination: 1, source: 0, ware: "iron" });
  ordinary.ware = null;
  disabled.incoming.iron = 2;
  const roads = {
    addRoad: () => true,
    route: (from: { x: number; z: number }, to: { x: number; z: number }) => ({
      cost: 1, length: 1, points: [from, to]
    }),
    routeMetrics: (from: { x: number; z: number }, to: { x: number; z: number }) => ({
      route: { cost: 1, length: 1, points: [from, to] }, status: "found"
    })
  };
  expect(redirectStorageDeliveries(context([disabled, other], [upgrade, ordinary], roads), 1, "iron"))
    .toBe(1);
  expect(upgrade.delivery!.destination).toBe(1);
  expect(ordinary.delivery!.destination).toBe(2);
  expect(disabled.incoming.iron).toBe(1);
  expect(other.incoming.iron).toBe(1);
});

it("keeps committed cargo when no other connected storage accepts the ware", () => {
  const disabled = storage(1, 4), other = storage(2, 8);
  disabled.accepts.iron = false;
  const carrier = actor({ destination: 1, source: 0, ware: "iron" });
  disabled.incoming.iron = 1;
  expect(redirectStorageDeliveries(context([disabled, other], [carrier]), 1, "iron")).toBe(0);
  expect(carrier.delivery!.destination).toBe(1);
  expect(disabled.incoming.iron).toBe(1);
});
