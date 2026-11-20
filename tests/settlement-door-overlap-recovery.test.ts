import { describe, expect, it } from "vitest";

import { isInOwnDoorPassage, passageBuilding } from "../src/shared/settlement/settlement-entrance";
import {
  beginStorageTrafficTick
} from "../src/shared/settlement/settlement-door-traffic";
import { addActor, addPlot, createTrafficWorld } from "./helpers/traffic-scenario";

const passagePoint = (
  building: { access: { x: number; z: number }; workerApproach: { x: number; z: number } },
  fraction: number
) => ({
  x: building.workerApproach.x + (building.access.x - building.workerApproach.x) * fraction,
  z: building.workerApproach.z + (building.access.z - building.workerApproach.z) * fraction
});

describe("loaded door passage recovery", () => {
  it("keeps one crew in a saved doorway, putting extra departures inside and arrivals back outside", () => {
    const scene = createTrafficWorld(40);
    const store = addPlot(scene, {
      uid: 31, typeId: 29, x: 20, z: 20, width: 5, depth: 5, doorRotation: 0
    });
    const exitPath = [
      store.workerApproach,
      store.access,
      { x: store.access.x + 2, z: store.access.z }
    ];
    const entrancePath = [store.access, store.workerApproach, store.doorThreshold];
    const exitA = addActor(scene, {
      uid: 465, job: "Carrier", phase: "exitLoaded", ...passagePoint(store, .35),
      building: store.uid, path: exitPath, ware: "water"
    });
    const exitB = addActor(scene, {
      uid: 517, job: "Carrier", phase: "exitLoaded", ...passagePoint(store, .5),
      building: store.uid, path: exitPath, ware: "logs"
    });
    const enterA = addActor(scene, {
      uid: 396, job: "Carrier", phase: "enterDelivery", ...passagePoint(store, .6),
      building: store.uid, home: store.uid, path: entrancePath, ware: "planks"
    });
    const enterB = addActor(scene, {
      uid: 478, job: "Carrier", phase: "enterDelivery", ...passagePoint(store, .75),
      building: store.uid, home: store.uid, path: entrancePath, ware: "hides"
    });
    Object.assign(exitA, { pathIndex: 1, delivery: { source: store.uid, destination: 15,
      ware: "water", reserved: false } });
    Object.assign(exitB, { pathIndex: 1, delivery: { source: store.uid, destination: 12,
      ware: "logs", reserved: false } });
    Object.assign(enterA, { pathIndex: 1, delivery: { source: 12, destination: store.uid,
      ware: "planks", reserved: false } });
    Object.assign(enterB, { pathIndex: 1, delivery: { source: 24, destination: store.uid,
      ware: "hides", reserved: false } });
    expect(scene.context.actors.filter(actor => isInOwnDoorPassage(scene.context, actor))).toHaveLength(4);

    beginStorageTrafficTick(scene.context, .05);

    const visibleInPassage = scene.context.actors.filter(actor =>
      actor.visible && passageBuilding(actor) === store.uid && isInOwnDoorPassage(scene.context, actor));
    expect(visibleInPassage).toHaveLength(1);
    expect([exitA, exitB].filter(actor => actor.visible)).toHaveLength(1);
    expect([exitA, exitB].filter(actor => !actor.visible)).toHaveLength(1);
    expect(enterA.visible && enterB.visible).toBe(true);
    expect(enterA.phase).toBe("deliver");
    expect(enterB.phase).toBe("deliver");
    expect(enterA.ware).toBe("planks");
    expect(enterB.ware).toBe("hides");
    expect(isInOwnDoorPassage(scene.context, enterA)).toBe(false);
    expect(isInOwnDoorPassage(scene.context, enterB)).toBe(false);
  });

  /**
   * Owner save 2026-11-07: soldiers and settlers leaving the HQ behind a loaded carrier were taken
   * for arrivals, lost their road journey at the doorstep and then tried to cross the dense town
   * straight to a door 27–47 tiles away (full fine searches every tick, stranded walkers).
   */
  const departureScene = (withArrival: boolean) => {
    const scene = createTrafficWorld(40);
    const store = addPlot(scene, {
      uid: 31, typeId: 29, x: 20, z: 20, width: 5, depth: 5, doorRotation: 0
    });
    const outward = { x: store.access.x + 2, z: store.access.z };
    const loaded = addActor(scene, {
      uid: 465, job: "Carrier", phase: "exitLoaded", ...passagePoint(store, .35),
      building: store.uid, path: [store.workerApproach, store.access, outward], ware: "water"
    });
    Object.assign(loaded, { pathIndex: 1, delivery: { source: store.uid, destination: 15,
      ware: "water", reserved: false } });
    const journey = [store.access, outward, { x: outward.x + 8, z: outward.z + 6 }];
    const leaving = addActor(scene, {
      uid: 119, job: "Soldier", phase: "assigned", ...passagePoint(store, .55),
      building: 40, home: store.uid, path: [...journey]
    });
    const arrival = withArrival ? addActor(scene, {
      uid: 396, job: "Carrier", phase: "enterDelivery", ...passagePoint(store, .75),
      building: store.uid, home: store.uid, path: [store.access, store.workerApproach, store.doorThreshold],
      ware: "planks"
    }) : undefined;
    if (arrival) Object.assign(arrival, { pathIndex: 1, delivery: { source: 12, destination: store.uid,
      ware: "planks", reserved: false } });
    return { arrival, journey, leaving, loaded, scene, store };
  };

  it("leaves a worker walking out behind a loaded carrier on its journey", () => {
    const { journey, leaving, loaded, scene } = departureScene(false);
    const before = { x: leaving.x, z: leaving.z };

    beginStorageTrafficTick(scene.context, .05);

    expect(leaving).toMatchObject({ ...before, path: journey, pathIndex: 0, phase: "assigned", visible: true });
    expect(loaded.visible).toBe(true);
  });

  it("puts an extra departure back inside with its journey, never out on the doorstep as an arrival", () => {
    const { arrival, journey, leaving, loaded, scene, store } = departureScene(true);

    beginStorageTrafficTick(scene.context, .05);

    expect(loaded.visible).toBe(true);
    expect(leaving).toMatchObject({ ...store.doorThreshold, path: journey, phase: "assigned", visible: false });
    expect(arrival!.phase).toBe("deliver");
    expect(isInOwnDoorPassage(scene.context, arrival!)).toBe(false);
  });
});
