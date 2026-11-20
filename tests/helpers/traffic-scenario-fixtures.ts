import type { SettlementPoint } from "../../src/shared/settlement/settlement-types";
import {
  addActor, addPlot, addRoadWalker, buildCorridor, buildWallColumn, createTrafficWorld, type ScenarioBuild
} from "./traffic-scenario";

/** Shared scenario builders, ported from the council's scratch probes (S1-S10, exp2/exp5, feel). */
const walker = (scenario: ScenarioBuild, uid: number, points: SettlementPoint[], job = "Settler") => {
  const [start, ...path] = points;
  const actor = addActor(scenario.scene, {
    job, path, uid, x: start!.x, yaw: Math.atan2(path[0]!.x - start!.x, path[0]!.z - start!.z), z: start!.z
  });
  scenario.movers.push(actor);
  return actor;
};
const open = (size = 20): ScenarioBuild => ({ movers: [], scene: createTrafficWorld(size) });

export const headOn = () => {
  const scenario = open();
  walker(scenario, 1, [{ x: 4, z: 10 }, { x: 12, z: 10 }]);
  walker(scenario, 2, [{ x: 12, z: 10.02 }, { x: 4, z: 10.02 }]);
  return scenario;
};
export const fourWay = () => {
  const scenario = open();
  walker(scenario, 1, [{ x: 4, z: 10 }, { x: 12, z: 10 }]);
  walker(scenario, 2, [{ x: 12, z: 10 }, { x: 4, z: 10 }]);
  walker(scenario, 3, [{ x: 8, z: 6 }, { x: 8, z: 14 }]);
  walker(scenario, 4, [{ x: 8, z: 14 }, { x: 8, z: 6 }]);
  return scenario;
};
export const platoons = () => {
  const scenario = open();
  for (let index = 0; index < 6; index++)
    walker(scenario, index + 1, [{ x: 4 + index * .4, z: 10 }, { x: 14 + index * .4, z: 10 }]);
  for (let index = 0; index < 6; index++)
    walker(scenario, index + 11, [{ x: 14 - index * .4, z: 10.05 }, { x: 6 - index * .4, z: 10.05 }]);
  return scenario;
};
export const perpendicularStreams = () => {
  const scenario = open();
  for (let index = 0; index < 5; index++)
    walker(scenario, index + 1, [{ x: 3 + index * .5, z: 10 }, { x: 16 + index * .5, z: 10 }]);
  for (let index = 0; index < 5; index++)
    walker(scenario, index + 11, [{ x: 10, z: 3 + index * .5 }, { x: 10, z: 16 + index * .5 }]);
  return scenario;
};
const corridorWorld = () => {
  const scenario = open();
  for (let x = 5; x < 13; x++) for (let z = 0; z < 20; z++) if (z !== 10) scenario.scene.occupied[z * 20 + x] = 1;
  return scenario;
};
export const corridorTwoByTwo = () => {
  const scenario = corridorWorld();
  walker(scenario, 1, [{ x: 3, z: 10.5 }, { x: 15, z: 10.5 }]);
  walker(scenario, 2, [{ x: 15, z: 10.5 }, { x: 3, z: 10.5 }]);
  walker(scenario, 3, [{ x: 15.4, z: 10.5 }, { x: 3.4, z: 10.5 }]);
  walker(scenario, 4, [{ x: 2.6, z: 10.5 }, { x: 14.6, z: 10.5 }]);
  return scenario;
};
export const star = (count: number) => () => {
  const scenario = open();
  for (let index = 0; index < count; index++) {
    const angle = index * 2 * Math.PI / count;
    walker(scenario, index + 1, [{ x: 10 + 3 * Math.cos(angle), z: 10 + 3 * Math.sin(angle) },
      { x: 10 - 3 * Math.cos(angle), z: 10 - 3 * Math.sin(angle) }]);
  }
  return scenario;
};

/** S9: a one-tile gate in a wall, n versus n ground workers with distinct far goals. */
export const gate = (count: number) => () => {
  const scenario = open(24);
  buildWallColumn(scenario.scene, 12, [10]);
  const row = (index: number) => 9.6 + Math.floor(index / 3) * .8 + (index % 3) * .3;
  for (let index = 0; index < count; index++) scenario.movers.push(addActor(scenario.scene, {
    path: [{ x: 12.5, z: 10.5 }, { x: 19, z: 8 + index * .6 }], uid: index + 1,
    x: 6 - (index % 3) * .6, z: row(index)
  }));
  for (let index = 0; index < count; index++) scenario.movers.push(addActor(scenario.scene, {
    path: [{ x: 12.5, z: 10.5 }, { x: 5, z: 8 + index * .6 }], uid: index + 20,
    x: 18 + (index % 3) * .6, z: row(index)
  }));
  return scenario;
};
/** S6: an unpaved corridor of one or two tiles, n versus n workers. */
export const groundCorridor = (width: number, count: number) => () => {
  const scenario = open(24);
  buildCorridor(scenario.scene, 10, width);
  const centre = 10 + width / 2;
  for (let index = 0; index < count; index++) scenario.movers.push(addActor(scenario.scene, {
    path: [{ x: 21 - index * .5, z: centre }], uid: index + 1, x: 3 + index * .5, z: centre
  }));
  for (let index = 0; index < count; index++) scenario.movers.push(addActor(scenario.scene, {
    path: [{ x: 2 + index * .5, z: centre }], uid: index + 10, x: 20 - index * .5, z: centre
  }));
  return scenario;
};
/** S1: a one-tile road corridor, loaded carriers four against four. */
export const roadCorridor = () => {
  const scenario = open(24);
  buildCorridor(scenario.scene, 10, 1);
  scenario.scene.roads.addRoad({ x: 2, z: 10.5 }, { x: 21, z: 10.5 });
  for (let index = 0; index < 4; index++) scenario.movers.push(addRoadWalker(scenario.scene, {
    job: "Carrier", to: { x: 21 - index * .5, z: 10.5 }, uid: index + 1, ware: "logs", x: 3 + index * .6, z: 10.5
  }));
  for (let index = 0; index < 4; index++) scenario.movers.push(addRoadWalker(scenario.scene, {
    job: "Carrier", to: { x: 2 + index * .5, z: 10.5 }, uid: index + 10, ware: "logs", x: 20 - index * .6, z: 10.5
  }));
  return scenario;
};
/** exp2: two platoons with one shared goal per side, meeting head on. */
export const sharedGoal = (count = 4, gap = .3) => () => {
  const scenario = open(30);
  for (let index = 0; index < count; index++)
    walker(scenario, index + 1, [{ x: 5 - index * gap, z: 10 }, { x: 18, z: 10 }], "Builder");
  for (let index = 0; index < count; index++)
    walker(scenario, index + 100, [{ x: 15 + index * gap, z: 10 }, { x: 2, z: 10 }], "Builder");
  return scenario;
};
/** exp5: an idle leveler standing 0.1 from the walker's next waypoint. */
export const idleAtWaypoint = () => {
  const scenario = open(30);
  const mover = walker(scenario, 9, [{ x: 5, z: 10 }, { x: 10.1, z: 10 }, { x: 10.1, z: 14 }], "Builder");
  mover.yaw = Math.PI / 2;
  addActor(scenario.scene, { job: "Builder", phase: "levelWaiting", uid: 1, x: 10, z: 10 });
  return scenario;
};
/** S3: a passing carrier on the road beside an idle unit of the given job and phase. */
export const idleBesideRoad = (job: string, phase: string, offset = .19) => () => {
  const scenario = open(24);
  scenario.scene.roads.addRoad({ x: 2, z: 10.5 }, { x: 21, z: 10.5 });
  addActor(scenario.scene, { job, phase, uid: 50, x: 10, yaw: 1, z: 10.5 + offset });
  scenario.movers.push(addRoadWalker(scenario.scene, {
    job: "Carrier", to: { x: 20.5, z: 10.5 }, uid: 1, ware: "logs", x: 3, z: 10.5
  }));
  return scenario;
};
/** A one-tile road corridor with an idle unit standing on the road itself. */
export const corridorWithIdler = (job: string, phase: string) => () => {
  const scenario = open(24);
  buildCorridor(scenario.scene, 10, 1);
  scenario.scene.roads.addRoad({ x: 2, z: 10.5 }, { x: 21, z: 10.5 });
  addActor(scenario.scene, { job, phase, uid: 50, x: 10, z: 10.69 });
  scenario.movers.push(addRoadWalker(scenario.scene, {
    job: "Carrier", to: { x: 20.5, z: 10.5 }, uid: 1, ware: "logs", x: 3, z: 10.5
  }));
  return scenario;
};
/** Door test: an outbound worker hidden inside, a squatter waiting on its threshold. */
export const doorstepSquatter = () => {
  const scenario = open(32);
  const building = addPlot(scenario.scene, { depth: 3, doorRotation: 0, uid: 0, width: 3, x: 10.5, z: 8.5 });
  const hidden = addActor(scenario.scene, {
    path: [building.workerApproach, { x: 10.5, z: 14 }], uid: 1, visible: false,
    x: building.doorThreshold.x, z: building.doorThreshold.z
  });
  addActor(scenario.scene, {
    phase: "levelWaiting", uid: 2, x: building.doorThreshold.x + .05, z: building.doorThreshold.z + .15
  });
  scenario.movers.push(hidden);
  return { building, hidden, scenario };
};
/**
 * S7: a stock court owned by a carrier handing over a ware; `count` carriers queue outside it for the
 * same contact. Returns the owner so a test can let it leave.
 */
export const stockCourtWaiters = (count: number) => () => {
  const scenario = open(24);
  const building = addPlot(scenario.scene, { depth: 3, doorRotation: 0, uid: 7, width: 3, x: 10.5, z: 8.5 });
  const approach = { x: 11.4, z: 9.7 };
  const contact = { approach, scale: 1, slot: 0, stock: { x: 11.4, y: .15, z: 9.4 }, ware: "logs", yaw: 0 };
  const owner = addActor(scenario.scene, {
    job: "Carrier", phase: "deliveryTransfer", uid: 1, ware: "logs", x: approach.x, z: approach.z
  });
  Object.assign(owner, { stockBuilding: building.uid, stockContact: contact });
  for (let index = 0; index < count; index++) {
    const waiter = addActor(scenario.scene, {
      job: "Carrier", path: [approach], phase: "deliveryStockWalk", uid: 10 + index, ware: "logs",
      x: 12.6 + index * .5, z: 12.5 + index * .4
    });
    Object.assign(waiter, { stockBuilding: building.uid, stockContact: contact });
    scenario.movers.push(waiter);
  }
  return { building, owner, scenario };
};
