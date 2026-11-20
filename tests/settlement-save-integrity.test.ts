import { describe, expect, it } from "vitest";

import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { saveIntegrityProblem } from "../src/shared/settlement/settlement-save-integrity";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { huntingWorld } from "./helpers/hunting-world";

const savedIsland = () => {
  const world = huntingWorld();
  const simulation = createSettlementSimulation({ initialSettlers: 8, roads: createRoadNetwork(world), world });
  for (let tick = 0; tick < 40; tick++) simulation.update(.05);
  return simulation.saveState();
};

describe("snapshot integrity counts (D3)", () => {
  it("saves the counts it wrote, so an intact snapshot passes", () => {
    const save = savedIsland();
    expect(save.integrity).toEqual({ actors: save.actors.length, buildings: save.buildings.length,
      soldiers: save.military?.soldiers.length ?? 0, timers: expect.any(Number), transfers: save.transfers.length });
    expect(saveIntegrityProblem(save)).toBeNull();
  });

  it("rejects a snapshot that lost an entity or carries corrupt counts", () => {
    const save = savedIsland();
    expect(saveIntegrityProblem({ ...save, buildings: [] }))
      .toBe(`Snapshot integrity: ${save.buildings.length} buildings expected, 0 written`);
    expect(saveIntegrityProblem({ ...save, integrity: { ...save.integrity!, timers: -1 } }))
      .toBe("Invalid snapshot integrity counts");
  });

  it("accepts older snapshots without counts", () => {
    expect(saveIntegrityProblem({ ...savedIsland(), integrity: undefined })).toBeNull();
  });
});
