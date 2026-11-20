import { describe, expect, it } from "vitest";

import { createIslandStockContacts } from "../src/app/settlement/island-stock-contacts";
import { isBuildingCourtyardPointWalkable } from "../src/render-common/buildings/building-courtyard";
import { stockStyleFor } from "../src/render-common/buildings/building-stock-layout";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { carrierRoadRecoveryPath } from "../src/shared/settlement/settlement-carrier-road-recovery";
import { makeBuilding } from "../src/shared/settlement/settlement-placement";
import { stockContact } from "../src/shared/settlement/settlement-stock-transfers";
import type { SettlementActor, SettlementContext } from "../src/shared/settlement/settlement-types";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const SAWMILL = 33;

const strandedFixture = (logs: number) => {
  const size = 48;
  const world = { cellsX: size, cellsZ: size, heights: new Float32Array((size + 1) ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), blocking: new Uint8Array(size ** 2),
    buildClass: new Uint8Array(size ** 2).fill(BUILD.large), props: { count: 0 },
    mineZones: [], oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2)
  } as unknown as WorldData;
  const context = { options: { world }, actors: [], buildings: [], nextBuilding: 0, nextActor: 1,
    occupied: new Uint8Array(size ** 2), reservations: new Set(), settlers: 0, transfers: [],
    resourceAmounts: new Map(), accumulator: 0, scheduling: 0 } as unknown as SettlementContext;
  const home = makeBuilding(context, 0, 6, 6), sawmill = makeBuilding(context, SAWMILL, 22, 20);
  home.construction = sawmill.construction = 1;
  context.buildings.push(home, sawmill);
  context.options.roads = createRoadNetwork(world);
  // The offline replay's island hooks: authored stock bays and the courtyard walk test.
  context.options.stockContact = createIslandStockContacts(world, () => false, () => "roman");
  context.options.canWorkerEnterPlot = (building, point) => isBuildingCourtyardPointWalkable(building.typeId,
    building.x, building.z, building.rotation, point, building.output, building.input,
    stockStyleFor("roman", building));
  const corner = { x: home.access.x, z: sawmill.access.z };
  context.options.roads.addRoad(home.access, corner);
  context.options.roads.addRoad(corner, sawmill.access);
  // The carrier put down the first log; a later delivery grew the pile under its stand.
  const { approach } = stockContact(context, sawmill, "input", "logs", 0);
  sawmill.input.logs = logs;
  const carrier = { uid: 7, job: "Carrier", phase: "returnBlockedCarrier", visible: true, ware: null,
    home: home.uid, building: sawmill.uid, stockBuilding: sawmill.uid, x: approach.x, z: approach.z, y: 0,
    yaw: 0, action: "idle", animationTime: 0, path: [], pathIndex: 0, timer: 1 } as unknown as SettlementActor;
  context.actors.push(carrier);
  return { carrier, context, home };
};

describe("carrier stranded on an input pile (CARRIER-STRANDED-ON-PILE)", () => {
  it.each([1, 2])("finds a walkable way home from the sawmill log bay with %i logs", logs => {
    const { carrier, context, home } = strandedFixture(logs);
    const recovery = carrierRoadRecoveryPath(context, carrier, home.access);
    expect(recovery).not.toBeNull();
    expect(recovery!.path.at(-1)).toEqual(home.access);
  });
});
