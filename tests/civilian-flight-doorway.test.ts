import { expect, it } from "vitest";

import { startCivilianFlight } from "../src/shared/settlement/military-civilian-safety";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import { addActor, addPlot, createTrafficWorld } from "./helpers/traffic-scenario";

/** Raiders are within reach of every civilian; no storage door is held. */
const threatenedStore = () => {
  const scene = createTrafficWorld(40);
  const store = addPlot(scene, { depth: 5, doorRotation: 0, typeId: 29, uid: 7, width: 5, x: 20, z: 12 });
  scene.context.civilianThreat = {
    active: () => true, doorThreatened: () => false, enemyWithin: () => true, fallen: () => false,
    nearestEnemy: () => undefined, takeRefugeSearch: () => true, threatens: () => true, unsafeRefuge: () => false
  } as unknown as SettlementContext["civilianThreat"];
  return { scene, store };
};

/** Mixed fixture, storage 7: a carrier put to flight on the threshold stood in the entry lane for 180 s. */
it("lets a carrier already walking in through a storage door finish entering", () => {
  const { scene, store } = threatenedStore();
  const carrier = addActor(scene, { home: 0, job: "Carrier", path: [store.doorThreshold], phase: "enterPickup",
    uid: 14, ...store.workerApproach });
  carrier.delivery = { destination: 9, reserved: false, source: store.uid, ware: "logs" };
  expect(startCivilianFlight(scene.context, carrier)).toBe(false);
  expect(carrier.phase).toBe("enterPickup");
  expect(carrier.demolitionReturning).toBeUndefined();
});

it("still puts a carrier on the road outside the doorway to flight", () => {
  const { scene, store } = threatenedStore();
  const carrier = addActor(scene, { home: store.uid, job: "Carrier", path: [store.access], phase: "home",
    uid: 15, x: store.access.x, z: store.access.z + 3 });
  expect(startCivilianFlight(scene.context, carrier)).toBe(true);
  expect(carrier.phase).toBe("demolitionBlocked");
});
