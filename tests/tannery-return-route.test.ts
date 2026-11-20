import { describe, expect, it } from "vitest";

import { createIslandStockContacts } from "../src/app/settlement/island-stock-contacts";
import {
  type BuildingStockContact,
  getBuildingStockContact
} from "../src/render-common/buildings/building-stock-anchors";
import { stockStyleFor } from "../src/render-common/buildings/building-stock-layout";
import { makeBuilding } from "../src/shared/settlement/settlement-placement";
import type {
  SettlementActor,
  SettlementContext,
  SettlementStockContact
} from "../src/shared/settlement/settlement-types";
import { updateWorker } from "../src/shared/settlement/settlement-workers";
import { BLOCKING } from "../src/shared/world/world-data";
import { huntingWorld } from "./helpers/hunting-world";

/** A Tannery's leather table faces the blocked strip just outside its west plot edge. */
const fixture = () => {
  const world = huntingWorld(48), size = world.cellsX;
  // The table's outward stance belongs in cell x=9; that strip is the cliff that trapped the
  // natural level-9 Tannery at 147.5,218.5 even though its road access stayed clear.
  for (let z = 9; z <= 16; z++) {
    const cell = z * size + 9;
    world.walkCost[cell] = 0;
    world.blocking[cell] = BLOCKING.cliff;
  }
  const context = {
    options: { world, roads: { route: () => null } },
    buildings: [], actors: [], occupied: new Uint8Array(size * size), reservations: new Set<string>(),
    nextActor: 0, nextBuilding: 0, settlers: 0, resourceAmounts: new Map(), accumulator: 0,
    scheduling: 0, transfers: []
  } as unknown as SettlementContext;
  const building = makeBuilding(context, 8, 12.5, 12.5, 2);
  building.construction = 1;
  building.input = { hides: 2, planks: 2 };
  building.worker = 0;
  context.buildings.push(building);
  const left = building.x - building.width / 2, top = building.z - building.depth / 2;
  for (let z = top; z < top + building.depth; z++)
    for (let x = left; x < left + building.width; x++) context.occupied[z * size + x] = 1;
  context.occupied[Math.floor(building.access.z) * size + Math.floor(building.access.x)] = 2;
  const occupied = (x: number, z: number) =>
    (context.occupied[Math.floor(z) * size + Math.floor(x)] ?? 0) > 0;
  const stockContact = createIslandStockContacts(world, occupied);
  context.options.stockContact = stockContact;
  const actor = {
    uid: 0, ...building.doorThreshold, y: building.y, yaw: 0, visible: false, job: "Tanner",
    action: "idle", ware: "leather", phase: "returnBlocked", building: building.uid, home: building.uid,
    stockBuilding: building.uid, path: [], pathIndex: 0, timer: 0, animationTime: 0
  } as SettlementActor;
  context.actors.push(actor);
  return { actor, building, context, size, stockContact, world };
};
const savedContact = (contact: BuildingStockContact): SettlementStockContact => ({
  ware: contact.ware, slot: contact.slot, yaw: contact.wareYaw, scale: contact.scale,
  scale3: { x: contact.wareScale[0], y: contact.wareScale[1], z: contact.wareScale[2] },
  stock: { x: contact.warePosition[0], y: contact.warePosition[1], z: contact.warePosition[2] },
  approach: { x: contact.approach[0], y: contact.approach[1], z: contact.approach[2] },
  presentation: contact.presentation
});

describe("Tannery output stance on an obstructed side yard", () => {
  it("moves the return handoff onto reachable ground instead of waiting forever", () => {
    const { actor, building, context, size, stockContact, world } = fixture();
    // The historical saved contact was the table's nominal edge, on the cliff itself.
    const stale = getBuildingStockContact(8, "output", "leather", 0, building.x, building.z,
      building.rotation, building.y, building.output, building.input, stockStyleFor(undefined, building))!;
    expect(world.walkCost[Math.floor(stale.approach[2]) * size + Math.floor(stale.approach[0])]).toBe(0);
    actor.stockContact = savedContact(stale);
    const fresh = stockContact(building, "output", "leather", 0)!;
    expect(world.walkCost[Math.floor(fresh.approach.z) * size + Math.floor(fresh.approach.x)]).toBeTruthy();
    expect(fresh.approach).not.toEqual(stale.approach);
    for (let tick = 0; tick < 3000 && building.output.leather !== 1; tick++) updateWorker(context, actor, .05);
    expect(building.output.leather).toBe(1);
    expect(actor.ware).toBeNull();
  });
});
