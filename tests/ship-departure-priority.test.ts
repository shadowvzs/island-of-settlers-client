import { expect, it } from "vitest";

import { createFleetBerthing } from "../src/shared/settlement/settlement-naval-berthing";
import type { NavalShip } from "../src/shared/settlement/settlement-naval-fleet";
import { createShipRoutePlanner } from "../src/shared/settlement/settlement-ship-routes";
import { createShipSea } from "./helpers/ship-motion-scenarios";

it.each(["positioning", "sailing"] as const)("backs an admitted %s approach out of a departure lane without losing intent or queue priority", phase => {
  const sea = createShipSea(), harbour = sea.harbour(45, 15, 0, 2), ships: NavalShip[] = [];
  const planner = createShipRoutePlanner(sea.world, sea.sea);
  const berthing = createFleetBerthing({ construction: () => [], context: sea.context, planner, sea: sea.sea, ships });
  const berths = berthing.berths.forHarbour(harbour.uid, true);
  expect(berths).toHaveLength(2);
  const first = berths[0]!, second = berths[1]!;
  const departing: NavalShip = { id: 1, ...first, yaw: first.yaw ?? 0, y: -1, phase: "stranded",
    sourceUid: harbour.uid, destinationUid: 200, cargo: { planks: 1 }, cargoCount: 1,
    route: [], cursor: 0, timer: 0 };
  const incoming: NavalShip = { ...departing, id: 2, x: first.x + 13, z: first.z, phase,
    sourceUid: phase === "positioning" ? harbour.uid : 200,
    destinationUid: harbour.uid, cargo: { planks: 4, stone: 6, hammer: 1, shovel: 1 }, cargoCount: 12,
    orderId: 17, passengers: [101, 102, 103], reservedFor: 17, route: [{ ...second }] };
  const leader: NavalShip = { ...departing, id: 3, x: 70.5, z: 90.5, destinationUid: harbour.uid,
    queuedAt: { x: 70.5, z: 90.5 }, cargo: {}, cargoCount: 0, route: [] };
  ships.push(departing, incoming, leader);
  const receipt = { cargo: { ...incoming.cargo }, passengers: [...incoming.passengers!], order: incoming.orderId,
    source: incoming.sourceUid, destination: incoming.destinationUid, reserved: incoming.reservedFor };
  berthing.makeWay(departing, { x: 75.5, z: first.z }, harbour.uid);
  expect(incoming.phase).toBe(phase);
  expect(incoming.queuedAt).toBeDefined();
  expect(incoming.waitsAtEdge).toBe(true);
  expect(incoming.route.at(-1)).toMatchObject({ x: incoming.queuedAt!.x, z: incoming.queuedAt!.z });
  expect(berthing.queuedNear(harbour.uid)).toBe(leader);
  expect({ cargo: incoming.cargo, passengers: incoming.passengers, order: incoming.orderId,
    source: incoming.sourceUid, destination: incoming.destinationUid, reserved: incoming.reservedFor }).toEqual(receipt);
  expect(planner.route(incoming, incoming.queuedAt!, berthing.obstacles(incoming))).not.toBeNull();
  // The priority belongs to a paid departing load, not any empty ship passing an active approach.
  incoming.queuedAt = undefined; incoming.waitsAtEdge = undefined; incoming.route = [{ ...second }];
  departing.cargo = {}; departing.cargoCount = 0;
  berthing.makeWay(departing, { x: 75.5, z: first.z }, harbour.uid);
  expect(incoming.queuedAt).toBeUndefined();
  // A loaded hull also cannot preempt an approach belonging to another harbour.
  departing.cargo = { planks: 1 }; departing.cargoCount = 1;
  if (phase === "positioning") incoming.sourceUid = 200;
  else incoming.destinationUid = 200;
  berthing.makeWay(departing, { x: 75.5, z: first.z }, harbour.uid);
  expect(incoming.queuedAt).toBeUndefined();
});
