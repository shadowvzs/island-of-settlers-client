import { describe, expect, it } from "vitest";

import { createHeadlessIsland } from "../src/app/settlement/headless-replay";
import { hashSettlementState } from "../src/shared/settlement/settlement-state-hash";
import type { SettlementPoint } from "../src/shared/settlement/settlement-types";
import { spawnAround } from "../tools/bench/garrison-balance-harness";
import { readDevelopedFixture } from "./helpers/developed-fixture";

/**
 * SAVE-DRIFT (2026-11-11): the busy developed island (stock churn, felling, planting, fields) with computer
 * groups marching across it, saved as a whole game at several ticks and reopened as a new headless island,
 * continues exactly like the uninterrupted run (settlement, world resources and runtime state hash).
 */
type Island = Awaited<ReturnType<typeof createHeadlessIsland>>;

const stateHash = (island: Island) => hashSettlementState({
  runtime: island.runtimeState(), settlement: island.simulation.saveState(), world: island.world
});

interface MarchGroup { home: SettlementPoint; ids: number[]; there: SettlementPoint }

/** Two groups that cross the town and turn round every 20 s (flow fields, queued legs, riders). */
const marchingIsland = async () => {
  const island = await createHeadlessIsland(await readDevelopedFixture());
  const west = { x: 50.5, z: 50.5 }, east = { x: 112.5, z: 54.5 };
  const groups: MarchGroup[] = [
    { home: west, there: east, types: ["shield", "cavalry", "heavy", "archer", "shield", "cavalry"] as const },
    { home: east, there: west, types: ["cavalry", "shield", "heavy", "shield"] as const }
  ].map(({ home, there, types }) =>
    ({ home, ids: types.map(type => spawnAround(island.simulation, home, type, 0, 1)), there }));
  return { groups, island };
};

/** One tick of the march: the same orders reach both islands (commands are inputs, not saved state). */
const step = (island: Island, groups: readonly MarchGroup[], tick: number) => {
  if (tick % 400 === 0) for (const group of groups)
    island.simulation.commandMilitaryOpponent(group.ids, tick % 800 === 0 ? group.there : group.home, 1, "move");
  island.simulation.update(.05);
};

describe("a whole-game save of the developed island continues exactly", () => {
  it.each([[120], [520]])("saved at tick %i", async checkpoint => {
    const { groups, island } = await marchingIsland();
    for (let tick = 0; tick < checkpoint; tick++) step(island, groups, tick);
    const reloaded = await createHeadlessIsland(JSON.parse(JSON.stringify(await island.save())));
    expect(stateHash(reloaded)).toBe(stateHash(island));
    for (let tick = checkpoint; tick < checkpoint + 400; tick++) {
      step(island, groups, tick); step(reloaded, groups, tick);
      if (tick % 10 === 9) expect(stateHash(reloaded), `tick ${tick}`).toBe(stateHash(island));
    }
  }, 600_000);
});
