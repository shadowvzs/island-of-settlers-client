import { STARTER_STOCK } from "@shared/catalog/balance";
import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { STONE_SOURCE_REST_SECONDS } from "../src/shared/balance/resources";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { placeProp } from "../src/shared/world/editing/prop-placement";
import { BLOCKING, PROP, PROP_REMOVED } from "../src/shared/world/world-data";
import { huntingWorld } from "./helpers/hunting-world";

const FORESTER = 20;
const QUARRY = 19;
const BOULDER_SPOT = { x: 30.5, z: 24.5 };

/** A home island with one quarry stone boulder and a working quarry next to it. */
const quarryIsland = () => {
  const world = huntingWorld();
  const boulder = placeProp(world, { kind: PROP.largeRock, seed: 7, ...BOULDER_SPOT });
  if (typeof boulder !== "number") throw new Error(`boulder refused: ${boulder}`);
  const respawned: number[] = [];
  const simulation = createSettlementSimulation({
    canWorkerEnterPlot: () => true, initialSettlers: 12, initialStock: { ...STARTER_STOCK },
    onBoulderRespawned: prop => respawned.push(prop), roads: createRoadNetwork(world), world
  });
  const [width, depth] = getBuildingDefinition(QUARRY).gridFootprint;
  const placed = simulation.placeBuilding(QUARRY, 22 + width % 2 / 2, 17 + depth % 2 / 2);
  expect(placed.ok, placed.reason).toBe(true);
  const quarry = placed.building!;
  Object.assign(quarry, { construction: 1, foundationProgress: 1, required: {} });
  expect(simulation.connectRoads(simulation.headquarters.access, quarry.access)).toBe(true);
  const cell = Math.floor(BOULDER_SPOT.z) * world.cellsX + Math.floor(BOULDER_SPOT.x);
  const isGone = () => world.props.types[boulder] === PROP_REMOVED;
  const useUp = () => {
    for (let step = 0; step < 900 * 20 && !isGone(); step++) simulation.update(.05);
    expect(isGone()).toBe(true);
  };
  const rest = (seconds: number) => {
    for (let second = 0; second < seconds; second++) simulation.update(1);
  };
  return { boulder, cell, isGone, quarry, respawned, rest, simulation, useUp, world };
};

describe("quarry stone boulders respawn", () => {
  it("comes back at the same spot after resting, survives a reload while resting and is quarried again", () => {
    const { boulder, cell, isGone, respawned, rest, simulation, useUp, world } = quarryIsland();
    const look = { rotation: world.props.rotation[boulder], scale: world.props.scale[boulder] };
    useUp();
    expect(world.blocking[cell]).toBe(BLOCKING.free);
    rest(STONE_SOURCE_REST_SECONDS / 2);
    expect(isGone()).toBe(true);
    const saved = structuredClone(simulation.saveState());
    expect(saved.stoneRespawns).toEqual([{ id: boulder, kind: "prop", restSeconds: expect.any(Number) }]);
    expect(saved.stoneRespawns![0]!.restSeconds).toBeGreaterThan(0);
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    expect(simulation.saveState().stoneRespawns).toEqual(saved.stoneRespawns);
    rest(STONE_SOURCE_REST_SECONDS / 2 - 5);
    expect(isGone()).toBe(true);
    rest(10);
    expect(isGone()).toBe(false);
    expect(respawned).toEqual([boulder]);
    expect(world.props.types[boulder]).toBe(PROP.largeRock);
    expect({ rotation: world.props.rotation[boulder], scale: world.props.scale[boulder] }).toEqual(look);
    expect([world.props.x[boulder], world.props.z[boulder]]).toEqual([BOULDER_SPOT.x, BOULDER_SPOT.z]);
    expect(world.blocking[cell]).toBe(BLOCKING.prop);
    expect(simulation.saveState().stoneRespawns).toEqual([]);
    // A fresh boulder: the quarry works it out again.
    useUp();
  });

  it("waits while a building covers the spot and returns once it is gone", () => {
    const { isGone, rest, simulation, useUp } = quarryIsland();
    useUp();
    const [width, depth] = getBuildingDefinition(FORESTER).gridFootprint;
    const placed = simulation.placeBuilding(FORESTER, Math.floor(BOULDER_SPOT.x) + width % 2 / 2,
      Math.floor(BOULDER_SPOT.z) + depth % 2 / 2);
    expect(placed.ok, placed.reason).toBe(true);
    rest(STONE_SOURCE_REST_SECONDS + 30);
    expect(isGone()).toBe(true);
    expect(simulation.saveState().stoneRespawns).toHaveLength(1);
    expect(simulation.demolishBuilding(placed.building!.uid).ok).toBe(true);
    rest(5);
    expect(isGone()).toBe(false);
  });

  it("rejects corrupt saved boulder timers", () => {
    const { boulder, simulation, useUp } = quarryIsland();
    useUp();
    const saved = structuredClone(simulation.saveState());
    const corrupt = structuredClone(saved);
    corrupt.stoneRespawns = [{ id: boulder, kind: "prop", restSeconds: -1 }];
    expect(simulation.loadState(corrupt).ok).toBe(false);
    corrupt.stoneRespawns = [{ id: 1e6, kind: "prop", restSeconds: 0 }];
    expect(simulation.loadState(corrupt).ok).toBe(false);
  });
});
