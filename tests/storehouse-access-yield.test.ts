import { expect, it } from "vitest";

import { resumeRemoteStockDelivery } from "../src/shared/settlement/settlement-carrier-remote-stock";
import { updateCarrier } from "../src/shared/settlement/settlement-logistics";
import { beginPersonTrafficTick } from "../src/shared/settlement/settlement-person-index";
import { clearBlockedStorageAccess } from "../src/shared/settlement/settlement-storage-access-yield";
import { addActor, addPlot, createTrafficWorld } from "./helpers/traffic-scenario";

const fixture = () => {
  const scene = createTrafficWorld(32);
  const store = addPlot(scene, { depth: 5, doorRotation: 0, typeId: 29, uid: 7, width: 5, x: 10, z: 8 });
  const destination = addPlot(scene, { depth: 4, doorRotation: 0, typeId: 6, uid: 12, width: 4, x: 22, z: 22 });
  expect(scene.roads.addRoad(store.access, { x: store.access.x, z: store.access.z + 4 })).toBe(true);
  const arrival = addActor(scene, { building: store.uid, home: store.uid, job: "Carrier", phase: "deliver",
    uid: 385, ware: "meat", x: store.access.x, z: store.access.z + 1.4, path: [store.access] });
  const blocker = addActor(scene, { building: destination.uid, home: store.uid, job: "Carrier",
    phase: "carrierDeliveryBlocked", uid: 398, ware: "planks", ...store.access });
  blocker.delivery = { source: store.uid, destination: destination.uid, ware: "planks", reserved: false };
  blocker.timer = 100;
  beginPersonTrafficTick(scene.context);
  return { ...scene, arrival, blocker, destination, store };
};

it("physically clears a blocked loaded carrier from storage access without losing its delivery", () => {
  const { arrival, blocker, context, store } = fixture();
  const delivery = blocker.delivery;
  expect(clearBlockedStorageAccess(context, arrival, store)).toBe(true);
  expect(blocker.queueTarget).toBeDefined();
  const previous = { x: blocker.x, z: blocker.z };
  for (let tick = 0; tick < 40 && blocker.queueTarget; tick++) {
    beginPersonTrafficTick(context);
    const before = { x: blocker.x, z: blocker.z };
    updateCarrier(context, blocker, .05);
    expect(Math.hypot(blocker.x - before.x, blocker.z - before.z)).toBeLessThan(.1);
  }
  expect(Math.hypot(blocker.x - previous.x, blocker.z - previous.z)).toBeGreaterThan(.5);
  expect(blocker.queueTarget).toBeUndefined();
  expect(blocker.phase).toBe("carrierDeliveryBlocked");
  expect(blocker.delivery).toBe(delivery);
  expect(blocker.ware).toBe("planks");
});

it("leaves a carrier performing a physical handoff in place", () => {
  const { arrival, blocker, context, store } = fixture();
  blocker.wareTransfer = { direction: "pickup", ware: "planks",
    target: { x: blocker.x, y: 1, z: blocker.z }, progress: .5 };
  expect(clearBlockedStorageAccess(context, arrival, store)).toBe(false);
  expect(blocker.queueTarget).toBeUndefined();
  expect(blocker.ware).toBe("planks");
});

it("rejoins the road for a remote blocked receiver while retaining the original loaded job", () => {
  const { blocker, context, destination, roads, store } = fixture();
  expect(roads.addRoad(store.access, destination.access)).toBe(true);
  const delivery = blocker.delivery, before = { x: blocker.x, z: blocker.z };
  expect(resumeRemoteStockDelivery(context, blocker, destination)).toBe(true);
  expect({ x: blocker.x, z: blocker.z }).toEqual(before);
  expect(blocker.delivery).toBe(delivery);
  expect(blocker.ware).toBe("planks");
  expect(blocker.phase).toBe("deliver");
  expect(blocker.path.at(-1)).toEqual(destination.access);
});

it("retains a local blocked stock errand rather than sending it around the public roads", () => {
  const { blocker, context, destination } = fixture();
  blocker.x = destination.access.x; blocker.z = destination.access.z;
  expect(resumeRemoteStockDelivery(context, blocker, destination)).toBe(false);
  expect(blocker.phase).toBe("carrierDeliveryBlocked");
  expect(blocker.ware).toBe("planks");
});
