import { expect, it } from "vitest";

import { storageDoorLeafOpenings, updateDoorActivity } from "../src/shared/settlement/settlement-door-activity";
import { admitStorageArrival, canBeginStorageExit, ownsStorageArrival } from "../src/shared/settlement/settlement-door-traffic";
import { canEnterDoor, canLeaveDoor, entrancePath, exitPath } from "../src/shared/settlement/settlement-entrance";
import { prepareStorageDoorDeparture, storageDoorLanePoint } from "../src/shared/settlement/settlement-storage-door-lanes";
import { addActor, addPlot, createTrafficWorld } from "./helpers/traffic-scenario";

it.each([0, 29, 39])("keeps opposing foot tracks .5m apart through storage%s at all rotations", typeId => {
  for (const rotation of [0, 1, 2, 3] as const) {
    const scene = createTrafficWorld(32);
    const building = addPlot(scene, { depth: 6, doorRotation: rotation, typeId, uid: 0, width: 6, x: 12, z: 12 });
    const incoming = entrancePath(building), outgoing = exitPath(building);
    expect(incoming).toHaveLength(2); expect(outgoing).toHaveLength(2);
    for (const point of [building.access, building.workerApproach, building.doorThreshold]) {
      const a = storageDoorLanePoint(building, point, "in"), b = storageDoorLanePoint(building, point, "out");
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeCloseTo(.5, 8);
    }
    const entering = addActor(scene, { job: "Carrier", phase: "enterHome", uid: 1,
      ...storageDoorLanePoint(building, building.doorThreshold, "in") });
    const leaving = addActor(scene, { job: "Carrier", phase: "pickup", uid: 2,
      visible: false, ...building.doorThreshold });
    prepareStorageDoorDeparture(leaving, building);
    expect(canLeaveDoor(scene.context, leaving)).toBe(true);
    leaving.visible = true;
    expect(canEnterDoor(scene.context, entering, building)).toBe(true);
    leaving.x = entering.x; leaving.z = entering.z;
    expect(canEnterDoor(scene.context, entering, building)).toBe(false);
  }
});

it("retains arrival ownership while letting the independent outbound FIFO depart", () => {
  const scene = createTrafficWorld(32), { context } = scene;
  const building = addPlot(scene, { depth: 5, doorRotation: 0, typeId: 29, uid: 0, width: 5, x: 12, z: 12 });
  const arrival = addActor(scene, { home: 0, job: "Carrier", phase: "home", uid: 1,
    ...storageDoorLanePoint(building, building.access, "in"), path: [building.access] });
  admitStorageArrival(context, arrival);
  expect(ownsStorageArrival(context, arrival)).toBe(true);
  const leaving = addActor(scene, { job: "Carrier", phase: "pickup", uid: 2,
    visible: false, ...building.doorThreshold });
  prepareStorageDoorDeparture(leaving, building);
  expect(canBeginStorageExit(context, leaving)).toBe(true);
  expect(ownsStorageArrival(context, arrival)).toBe(true);
});

it("opens only the leaf physically approached and lets the other close independently", () => {
  const scene = createTrafficWorld(32), { context } = scene;
  const building = addPlot(scene, { depth: 5, doorRotation: 0, typeId: 29, uid: 0, width: 5, x: 12, z: 12 });
  const entrant = addActor(scene, { job: "Carrier", phase: "enterHome", uid: 1,
    ...storageDoorLanePoint(building, building.doorThreshold, "in") });
  updateDoorActivity(context, .05);
  expect(storageDoorLeafOpenings(building)).toEqual([0, 1]);
  const outbound = addActor(scene, { job: "Carrier", phase: "exitLoaded", uid: 2,
    ...storageDoorLanePoint(building, building.doorThreshold, "out") });
  outbound.delivery = { source: building.uid, destination: 9, ware: "logs", reserved: false };
  updateDoorActivity(context, .05);
  expect(storageDoorLeafOpenings(building)).toEqual([1, 1]);
  entrant.visible = false;
  updateDoorActivity(context, .5);
  expect(storageDoorLeafOpenings(building)).toEqual([1, .25]);
});
