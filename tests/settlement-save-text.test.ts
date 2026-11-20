import { describe, expect, it } from "vitest";

import { type CapturedGame,hydrateCapturedGame } from "../src/app/save-store/captured-game";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { huntingWorld } from "./helpers/hunting-world";

describe("single-copy settlement capture", () => {
  it("returns a snapshot and its text from the same serialization", () => {
    const world = huntingWorld();
    const simulation = createSettlementSimulation({ world, roads: createRoadNetwork(world) });
    const { snapshot, text } = simulation.saveStateWithText();
    expect(JSON.parse(text)).toEqual(snapshot);
    expect(simulation.saveState()).toEqual(snapshot);
  });

  it("rehydrates a wire capture only when the settlement travelled as text", () => {
    const world = huntingWorld();
    const simulation = createSettlementSimulation({ world, roads: createRoadNetwork(world) });
    const { snapshot, text } = simulation.saveStateWithText();
    const wire = { save: [world, null, {}, undefined], settlementText: text } as unknown as CapturedGame;
    expect(hydrateCapturedGame(wire).save[1]).toEqual(snapshot);
    const page = { save: [world, snapshot, {}, undefined], settlementText: text } as unknown as CapturedGame;
    expect(hydrateCapturedGame(page)).toBe(page);
  });
});
