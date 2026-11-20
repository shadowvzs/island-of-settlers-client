import { expect, it, vi } from "vitest";

import { createNavalFleet, type NavalShip } from "../src/shared/settlement/settlement-naval-fleet";
import { createNavalTerrainRefresh } from "../src/shared/settlement/settlement-naval-terrain";
import { createShipRoutePlanner } from "../src/shared/settlement/settlement-ship-routes";
import { createShipSea } from "./helpers/ship-motion-scenarios";

it.each([true, false])("keeps a floating loader eligible to yield after traffic/queue refusal (endpoint %s)", hasEndpoint => {
  const { sea, world } = createShipSea(), planner = createShipRoutePlanner(world, sea);
  const ship: NavalShip = { id: 1, x: 40.5, y: 0, z: 35.5, yaw: 0, phase: "positioning",
    sourceUid: 1, destinationUid: 2, orderId: 7, cargo: { planks: 1 }, cargoCount: 1,
    route: [{ x: 80.5, z: 90.5 }], cursor: 0, timer: 0 };
  const refresh = createNavalTerrainRefresh(world, sea, { docks: { clear: vi.fn() }, planner,
    endpoint: () => hasEndpoint ? { x: 80.5, z: 90.5 } : undefined, route: () => false, ships: [ship] });
  world.heights[5] = 3; world.terrainRevision = 1;
  refresh();
  expect(ship.phase).toBe("stranded");
  expect(ship.retryPhase).toBe("positioning");
  expect(ship.terrainBlocked).toBeUndefined();
  expect(ship.cargo).toEqual({ planks: 1 });
  expect(ship.orderId).toBe(7);
});

it("retains the terrain wait when an actual new land barrier cuts the static voyage", () => {
  const { sea, world } = createShipSea(), planner = createShipRoutePlanner(world, sea);
  const ship: NavalShip = { id: 1, x: 40.5, y: 0, z: 35.5, yaw: 0, phase: "sailing",
    cargo: { logs: 1 }, cargoCount: 1, route: [{ x: 80.5, z: 90.5 }], cursor: 0, timer: 0 };
  const refresh = createNavalTerrainRefresh(world, sea, { docks: { clear: vi.fn() }, planner,
    endpoint: () => ({ x: 80.5, z: 90.5 }), route: () => false, ships: [ship] });
  for (let z = 0; z <= world.cellsZ; z++) for (let x = 59; x <= 61; x++)
    world.heights[z * (world.cellsX + 1) + x] = 3;
  world.terrainRevision = 1;
  refresh();
  expect(ship.terrainBlocked).toBe(true);
  expect(ship.retryPhase).toBe("sailing");
  expect(ship.cargo).toEqual({ logs: 1 });
});

it("repairs an old terrainBlocked flag when only the existing source queue gates a saved loader", () => {
  const sea = createShipSea(), source = sea.harbour(20), destination = sea.harbour(90);
  const fleet = createNavalFleet(sea.context, sea.sea);
  fleet.addShip({ x: 40.5, z: 40.5 }, 0);
  fleet.addShip({ x: 70.5, z: 75.5 }, 0);
  const state = structuredClone(fleet.saveState());
  Object.assign(state.ships[0]!, { phase: "stranded", terrainBlocked: true, retryPhase: "positioning",
    sourceUid: source.uid, destinationUid: destination.uid, cargo: { planks: 1 }, cargoCount: 1, timer: 0 });
  Object.assign(state.ships[1]!, { phase: "stranded", retryPhase: "positioning", sourceUid: source.uid,
    destinationUid: destination.uid, queuedAt: { x: 70.5, z: 75.5 }, timer: 1 });
  fleet.restore(state);
  fleet.update(.05);
  const repaired = fleet.saveState().ships[0]!;
  expect(repaired.terrainBlocked).toBeUndefined();
  expect(repaired.retryPhase).toBe("positioning");
  expect(repaired.phase).toBe("stranded");
  expect(repaired.cargo).toEqual({ planks: 1 });
  expect(repaired.sourceUid).toBe(source.uid);
});
