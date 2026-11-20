import { expect, it } from "vitest";

import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { cachedWorld } from "./helpers/cached-worlds";

it("persists player nation, migrates legacy games to Roman and rejects invalid choices atomically", () => {
  const world = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 48, cellsZ: 48, erosionDroplets: 0 });
  const simulation = createSettlementSimulation({ world, roads: createRoadNetwork(world) });
  expect(simulation.playerNation()).toBe("roman");
  for (const nation of ["roman", "viking", "nubian", "japanese"] as const) {
    expect(simulation.setPlayerNation(nation)).toBe(true);
    const saved = simulation.saveState();
    expect(saved.playerNation).toBe(nation);
    simulation.setPlayerNation("roman");
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    expect(simulation.playerNation()).toBe(nation);
  }
  const before = simulation.saveState();
  expect(simulation.setPlayerNation("unknown")).toBe(false);
  expect(simulation.saveState()).toEqual(before);
  expect(simulation.loadState({ ...before, playerNation: "unknown" }).ok).toBe(false);
  expect(simulation.saveState()).toEqual(before);
  const legacy = simulation.saveState(); delete legacy.playerNation;
  expect(simulation.loadState(legacy)).toEqual({ ok: true });
  expect(simulation.playerNation()).toBe("roman");
});
