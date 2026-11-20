import { describe, expect, it, vi } from "vitest";

import { adventureOffers } from "../src/shared/settlement/adventure-rules";
import { colonyIslandOffers } from "../src/shared/settlement/colony-expedition-rules";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { cachedWorld } from "./helpers/cached-worlds";

const fixture = (size = 96) => {
  let month = 7;
  const calendar = vi.fn(() => ({ month, timeZone: "UTC" }));
  const world = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: size, cellsZ: size,
    seed: 1234, mountains: .35, rivers: 0, forest: .5, erosionDroplets: 100 });
  const simulation = createSettlementSimulation({ world, roads: createRoadNetwork(world),
    initialSettlers: 0, initialStock: {}, discoveryCalendar: calendar });
  return { simulation, calendar, world, setMonth: (value: number) => { month = value; } };
};

describe("committed seasonal offer batches", () => {
  it("reads the calendar once for both initial lists, persists them and never rerolls on query/reload", () => {
    const { calendar, setMonth, simulation } = fixture();
    const colonies = simulation.colonyIslands(), adventures = simulation.adventureIslands();
    expect(calendar).toHaveBeenCalledTimes(1);
    expect(colonies.every(island => island.discovery?.month === 7)).toBe(true);
    const saved = simulation.saveState();
    setMonth(12);
    expect(simulation.colonyIslands()).toEqual(colonies);
    expect(simulation.adventureIslands()).toEqual(adventures);
    expect(simulation.loadState(JSON.parse(JSON.stringify(saved)))).toEqual({ ok: true });
    expect(simulation.colonyIslands()).toEqual(colonies);
    expect(simulation.adventureIslands()).toEqual(adventures);
    expect(calendar).toHaveBeenCalledTimes(1);
    const card = simulation.colonyIslands()[0]!;
    card.discovery!.month = 1;
    expect(simulation.colonyIslands()[0]!.discovery!.month).toBe(7);
  });

  it("new undiscovered saves retain the new policy while absent legacy metadata keeps old helper behavior", () => {
    const { calendar, simulation, world } = fixture();
    const pristine = simulation.saveState();
    expect(simulation.loadState(pristine)).toEqual({ ok: true });
    expect(simulation.colonyIslands()[0]!.discovery).toBeDefined();
    expect(calendar).toHaveBeenCalledTimes(1);
    const legacy = simulation.saveState();
    delete legacy.naval.colonies!.discoveryVersion;
    delete legacy.naval.colonies!.discoveryTimeZone;
    delete legacy.naval.colonies!.colonyOffers;
    delete legacy.naval.colonies!.adventureOffers;
    expect(simulation.loadState(legacy)).toEqual({ ok: true });
    expect(simulation.colonyIslands()).toEqual(colonyIslandOffers(world.seed).map(island => ({ ...island, taken: false })));
    expect(simulation.adventureIslands()).toEqual(adventureOffers(world.seed));
    expect(calendar).toHaveBeenCalledTimes(1);
  });

  it("a future adventure round gets its own snapshot without changing existing colony offers", () => {
    const { calendar, setMonth, simulation } = fixture();
    const colonies = simulation.colonyIslands();
    const saved = simulation.saveState();
    saved.naval.colonies!.adventureRound = 1;
    delete saved.naval.colonies!.adventureOffers;
    setMonth(12);
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    const next = simulation.adventureIslands();
    expect(next.every(island => island.discovery?.month === 12)).toBe(true);
    expect(next.map(island => island.id)).toEqual([100, 101, 102, 103]);
    expect(simulation.colonyIslands()).toEqual(colonies);
    expect(calendar).toHaveBeenCalledTimes(2);
  });

  it("rejects corrupt policy/duration or duplicate persisted offers before committing the save", () => {
    const { simulation } = fixture();
    simulation.colonyIslands();
    const saved = simulation.saveState();
    saved.naval.colonies!.colonyOffers![0]!.voyageSeconds += 1;
    expect(simulation.loadState(saved).ok).toBe(false);
    const duplicate = simulation.saveState();
    duplicate.naval.colonies!.adventureOffers![1]!.id = duplicate.naval.colonies!.adventureOffers![0]!.id;
    expect(simulation.loadState(duplicate).ok).toBe(false);
  });

  it("debug overrides make a separate marked test record and invalid overrides grant nothing", () => {
    // Seed 1234 at 96² lacks harbour water for a departing ship; 128² has it. 256² spent
    // over 3 s generating terrain alone and exceeded the default timeout in the full parallel run.
    const { simulation } = fixture(128);
    const before = simulation.saveState();
    expect(simulation.startDebugExpedition("adventure", { month: 13 })).toMatchObject({ ok: false });
    expect(simulation.saveState()).toEqual(before);
    const offers = simulation.adventureIslands();
    const started = simulation.startDebugExpedition("adventure", { month: 7, theme: "winter" });
    expect(started.ok, started.ok ? "" : started.reason).toBe(true);
    const record = simulation.colonyExpeditions()[0]!.island;
    expect(record).toMatchObject({ debug: true, theme: "winter", discovery: {
      month: 7, season: "summer", debug: { month: 7, theme: "winter" }
    } });
    expect(record.voyageSeconds).toBe(Math.ceil(record.discovery!.baseVoyageSeconds * 1.25));
    expect(simulation.adventureIslands()).toEqual(offers);
  });
});
