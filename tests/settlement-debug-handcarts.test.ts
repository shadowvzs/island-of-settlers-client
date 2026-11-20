import { describe, expect, it } from "vitest";

import { handcartGrantMessage } from "../src/app/settlement/debug-tool-messages";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { HANDCART_LOGISTICS } from "../src/shared/balance/economy";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const STORAGE = 29;
const LIMIT = HANDCART_LOGISTICS.storageLimit;

const createWorld = () => {
  const size = 64;
  return { seed: 3, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 8, z: 8 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array() }
  } as unknown as WorldData;
};

/** Headquarters and a finished storehouse joined by a road. */
const fixture = () => {
  const world = createWorld();
  let blocked: ((x: number, z: number) => boolean) | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => blocked?.(x, z) ?? false });
  const simulation = createSettlementSimulation({ initialSettlers: 40,
    initialStock: { logs: 40, planks: 20, stone: 200 }, resourceTargets: () => [], roads, world });
  blocked = simulation.isOccupied;
  const [width, depth] = getBuildingDefinition(STORAGE).gridFootprint;
  const storehouse = simulation.placeBuilding(STORAGE, 30 + width % 2 / 2, 9 + depth % 2 / 2).building!;
  Object.assign(storehouse, { construction: 1, idleSettlers: 0, required: {} });
  const [dw, dd] = getBuildingDefinition(21).gridFootprint;
  const destination = simulation.placeBuilding(21, 30 + dw % 2 / 2, 20 + dd % 2 / 2).building!;
  Object.assign(destination, { construction: 1, required: {} });
  const headquarters = simulation.headquarters;
  expect(simulation.connectRoads(headquarters.access, storehouse.access)).toBe(true);
  expect(simulation.connectRoads(headquarters.access, destination.access)).toBe(true);
  expect(simulation.upgradeRoad(headquarters.access, storehouse.access)).toBeTruthy();
  expect(simulation.upgradeRoad(headquarters.access, destination.access)).toBeTruthy();
  /** Steps until a carrier pulls a cart of the headquarters out on the road. */
  const advanceUntilPulled = () => {
    for (let tick = 0; tick < 600; tick++) {
      simulation.update(.05);
      if (simulation.frames().some(actor => actor.handcart?.owner === headquarters.uid)) return true;
    }
    return false;
  };
  return { advanceUntilPulled, destination, headquarters, simulation, storehouse };
};

describe("development hand cart grant", () => {
  it("shelves the cart at the headquarters first, then at the next nearest storage with room", () => {
    const { headquarters, simulation, storehouse } = fixture();
    expect(simulation.grantHandcarts(1)).toEqual({ granted: 1, storages: [headquarters.uid] });
    expect(simulation.grantHandcarts(LIMIT)).toEqual({ granted: LIMIT,
      storages: [headquarters.uid, storehouse.uid] });
    expect(headquarters.handcarts).toBe(LIMIT);
    expect(storehouse.handcarts).toBe(1);
  });

  it("counts carts on the road against the limit and refuses once every storage is full", () => {
    const { advanceUntilPulled, destination, headquarters, simulation, storehouse } = fixture();
    simulation.grantHandcarts(1);
    simulation.transferWare(headquarters.uid, destination.uid, "stone", 6);
    expect(advanceUntilPulled()).toBe(true);
    expect(headquarters.handcarts).toBe(0);
    expect(simulation.grantHandcarts(LIMIT * 3).granted).toBe(LIMIT * 2 - 1);
    expect(headquarters.handcarts).toBe(LIMIT - 1);
    expect(simulation.handcarts(storehouse.uid)).toBe(LIMIT);
    expect(simulation.grantHandcarts(1)).toEqual({ granted: 0, storages: [] });
    expect(handcartGrantMessage(0, []).warning).toBe(true);
  });

  it("keeps granted carts through save and load and sends them out like Sawmill carts", () => {
    const { advanceUntilPulled, destination, headquarters, simulation } = fixture();
    simulation.grantHandcarts(1);
    const save = JSON.parse(JSON.stringify(simulation.saveState()));
    expect(simulation.loadState(save)).toEqual({ ok: true });
    expect(simulation.handcarts(headquarters.uid)).toBe(1);
    expect(simulation.transferWare(headquarters.uid, destination.uid, "stone", 6)).toBe(true);
    expect(advanceUntilPulled()).toBe(true);
  });

  it("names where the carts went", () => {
    expect(handcartGrantMessage(1, ["Headquarters"])).toEqual({
      text: "A hand cart added to the Headquarters.", warning: false });
    expect(handcartGrantMessage(2, ["Headquarters", "Storehouse"]).text).toBe(
      "2 hand carts added to the Headquarters, Storehouse.");
  });
});
