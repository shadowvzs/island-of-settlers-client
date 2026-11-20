import { expect, it } from "vitest";

import { separateIdlePeople } from "../src/shared/settlement/settlement-idle-separation";
import { actorSeparation, isTrafficPassThrough } from "../src/shared/settlement/settlement-traffic";
import type { SettlementActor, SettlementBuilding } from "../src/shared/settlement/settlement-types";
import { createTrafficWorld } from "./helpers/traffic-scenario";

const fixture = () => {
  const { context } = createTrafficWorld();
  const hq = { uid: 0, typeId: 0, construction: 1, doorThreshold: { x: 10, z: 10 },
    workerApproach: { x: 10, z: 11 }, access: { x: 10, z: 12 } } as SettlementBuilding;
  context.buildings.push(hq);
  context.military = {
    factionOf: uid => uid === 99 ? 1 : 0,
    supplyDemand: () => ({ coins: 0, drink: 0, drinkWare: "wine" })
  };
  const carrier = { uid: 1, home: 0, building: 0, job: "Carrier", x: 10, z: 11.5 } as SettlementActor;
  const soldier = { uid: 2, home: 0, building: 0, job: "Soldier", x: 10.1, z: 11.6 } as SettlementActor;
  return { carrier, context, hq, soldier };
};

it("allows friendly foot soldiers and carriers to share the HQ entrance lane", () => {
  const { carrier, context, soldier } = fixture();
  expect(isTrafficPassThrough(context, carrier, { ...carrier, uid: 3 })).toBe(true);
  expect(isTrafficPassThrough(context, soldier, { ...soldier, x: 11.2, z: 12.3 })).toBe(true);
  expect(isTrafficPassThrough(context, soldier, { ...soldier, uid: 3 })).toBe(true);
  expect(isTrafficPassThrough(context, carrier, soldier)).toBe(true);
  expect(isTrafficPassThrough(context, { ...soldier, home: 4, building: 4 }, soldier)).toBe(true);
  expect(isTrafficPassThrough(context, soldier, { ...soldier, home: 4, building: 4 })).toBe(true);
});

it("retains same-type collision outside HQ and at ordinary storehouses", () => {
  const { carrier, context, hq } = fixture();
  expect(isTrafficPassThrough(context, carrier, { ...carrier, x: 13 })).toBe(false);
  hq.typeId = 29;
  expect(isTrafficPassThrough(context, carrier, { ...carrier, uid: 3 })).toBe(false);
});

it("spreads visible idle settlers that stopped on the same HQ spot", () => {
  const { carrier, context } = fixture();
  const first = { ...carrier, uid: 10, action: "idle", visible: true, x: 12, z: 12, path: [], pathIndex: 0 } as SettlementActor;
  const second = { ...carrier, uid: 11, action: "idle", visible: true, x: 12, z: 12, path: [], pathIndex: 0 } as SettlementActor;
  context.actors.push(first, second);
  separateIdlePeople(context);
  expect(Math.hypot(first.x - second.x, first.z - second.z))
    .toBeGreaterThan(actorSeparation(first, second) - .01);
});

it("keeps enemy soldiers, carts and horses out of the new HQ exemption", () => {
  const { carrier, context, soldier } = fixture();
  expect(isTrafficPassThrough(context, soldier, { ...soldier, uid: 99 })).toBe(false);
  expect(isTrafficPassThrough(context, carrier, { ...carrier, handcart: {} as never })).toBe(false);
  expect(isTrafficPassThrough(context, soldier, { ...soldier, mounted: true })).toBe(false);
});
