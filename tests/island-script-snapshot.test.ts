import { expect, it } from "vitest";

import { mapScriptHash } from "../../island-of-settlers-shared/src/script/hash";
import { emptyScript, plantTrees } from "../../island-of-settlers-shared/tests/script-fixtures";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

/** TRG1: the map start snapshot of the island's script, saved deduplicated against the island's own map header. */

const worldFixture = () => {
  const size = 40;
  return { seed: 9, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 5.5, z: 5.5 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2), mineZones: [],
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(),
      scale: new Float32Array() }
  } as unknown as WorldData;
};

const simulationOf = (world: WorldData) => createSettlementSimulation({ world, roads: createRoadNetwork(world) });

it("islands of maps without a script save no snapshot", () => {
  const simulation = simulationOf(worldFixture());
  expect(simulation.scriptSnapshot()).toBeUndefined();
  expect(simulation.saveState()).not.toHaveProperty("scriptSnapshot");
});

it("the map start copies the script; a save stores only its revision and hash and restores it", () => {
  const world = { ...worldFixture(), script: plantTrees() };
  const simulation = simulationOf(world);
  const hash = mapScriptHash(world.script);
  expect(simulation.scriptSnapshot()).toMatchObject({ revision: 1, scriptHash: hash });
  const saved = simulation.saveState();
  expect(saved.scriptSnapshot).toEqual({ revision: 1, scriptHash: hash });
  const loaded = simulationOf(world);
  expect(loaded.loadState(saved)).toEqual({ ok: true });
  expect(loaded.scriptSnapshot()?.script).toEqual(world.script);
});

it("a snapshot that differs from the map header keeps its own script; a mismatch is refused", () => {
  const world = { ...worldFixture(), script: plantTrees() };
  const simulation = simulationOf(world);
  const revised = { ...world, script: { ...emptyScript(), revision: 2 } };
  const keeper = simulationOf(revised);
  expect(keeper.loadState(simulation.saveState())).toMatchObject({ ok: false });
  const full = { ...simulation.saveState(), scriptSnapshot: { revision: 1, script: plantTrees(),
    scriptHash: mapScriptHash(plantTrees()) } };
  expect(keeper.loadState(full)).toEqual({ ok: true });
  expect(keeper.scriptSnapshot()?.revision).toBe(1);
  expect(keeper.saveState().scriptSnapshot?.script).toEqual(plantTrees());
  expect(simulationOf(worldFixture()).loadState(simulation.saveState())).toMatchObject({ ok: false });
});
