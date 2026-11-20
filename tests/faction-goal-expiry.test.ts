import { describe, expect, it, vi } from "vitest";

import { doStep, emptyScript, num, ref, str, trigger } from "../../island-of-settlers-shared/tests/script-fixtures";
import { stageGameSession } from "../src/app/settlement/game-session";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { AI_FACTION, aiIslandSave } from "./helpers/ai-island-save";
import { economyCampaignScenario } from "./helpers/economy-factions";
import { huntingWorld } from "./helpers/hunting-world";

vi.mock("../src/shared/world/generation/generate-world", async (importOriginal) =>
  (await import("./helpers/world-cache-store")).cachedGenerateWorldModule(importOriginal));

/**
 * EAI4-FOLLOWUP (found by EAI5c): a timed `setFactionGoal` of a `maintain` faction with no soldiers and no buildings
 * ends at its tick and leaves the save, though the faction has nothing to decide.
 */

const AI = 1;
const SECONDS = 10;
const TICKS_PER_SECOND = 20;

const defendScript = () => {
  const region = { id: "post", name: "post", shape: { centerX: 30, centerZ: 30, kind: "circle" as const, radius: 6 } };
  return emptyScript({ regions: [region], triggers: [trigger("t-goal", { actions: [doStep("s1", "setFactionGoal", {
    faction: { faction: AI, kind: "slot" }, goal: str("defend"), region: ref("region", "post"),
    seconds: num(SECONDS) })] })] });
};

const emptyFactionIsland = () => {
  const world = huntingWorld();
  world.scenario = economyCampaignScenario([AI]);
  world.script = defendScript();
  return createSettlementSimulation({ canWorkerEnterPlot: () => true, homeBuilding: 0, initialSettlers: 8,
    roads: createRoadNetwork(world), world });
};

type Simulation = ReturnType<typeof emptyFactionIsland>;

const goalOf = (simulation: Simulation) => simulation.saveState().factionAi?.find(entry => entry.faction === AI)?.goal;

const advanceTo = (simulation: Simulation, tick: number) => {
  while (simulation.gameTick() < tick) simulation.update(.05);
};

describe("a timed faction goal of a faction with nothing to decide", () => {
  it("is gone at its end tick, and a save after it holds no goal", () => {
    const simulation = emptyFactionIsland();
    advanceTo(simulation, 2);
    const goal = goalOf(simulation);
    expect(goal).toMatchObject({ goal: "defend" });
    const until = goal!.until!;
    expect(until).toBeLessThanOrEqual(simulation.gameTick() + SECONDS * TICKS_PER_SECOND);
    advanceTo(simulation, until - 1);
    expect(goalOf(simulation)).toBeDefined();
    advanceTo(simulation, until + 1);
    expect(goalOf(simulation)).toBeUndefined();
    advanceTo(simulation, until + 31 * TICKS_PER_SECOND);
    const saved = JSON.parse(JSON.stringify(simulation.saveState()));
    expect(saved.factionAi?.find((entry: { faction: number }) => entry.faction === AI)?.goal).toBeUndefined();
  }, 120_000);

});

/** EAI5b's quiet AI island (a `maintain` faction, no script) with a timed defend goal of 10 s in its save. */
const quietIslandWithGoal = async () => {
  const save = await aiIslandSave(false);
  const factionAi = save.settlement.factionAi!.find(entry => entry.faction === AI_FACTION)!;
  factionAi.goal = { area: { radius: 6, x: 47, z: 46 }, goal: "defend", until: (save.settlement.gameTick ?? 0) + 15 };
  const loaded = await stageGameSession(structuredClone(save)), { world } = loaded.map;
  const simulation = createSettlementSimulation({ canWorkerEnterPlot: () => true, roads: createRoadNetwork(world),
    world });
  expect(simulation.loadState(loaded.settlement)).toEqual({ ok: true });
  return { simulation, until: factionAi.goal.until! };
};

const goalIn = (simulation: Simulation) =>
  simulation.saveState().factionAi?.find(entry => entry.faction === AI_FACTION)?.goal;

describe("a skip over a timed goal's end (EAI5b skips)", () => {
  // The movement skip caps its steps by the same `ticksBeforeFactionAi`; this idle island only quiet-skips.
  it.each(["advanceQuietTicks"] as const)(
    "%s stops before the end tick and the goal ends on it as with exact ticks", async skip => {
      const exact = await quietIslandWithGoal(), skipped = await quietIslandWithGoal();
      const { until } = exact;
      let skippedTicks = 0;
      while (skipped.simulation.gameTick() < until) {
        const advanced = skipped.simulation[skip](until + 400 - skipped.simulation.gameTick());
        skippedTicks += advanced;
        if (!advanced) skipped.simulation.update(.05);
      }
      expect(skippedTicks, "the island is quiet").toBeGreaterThan(0);
      expect(skipped.simulation.gameTick(), "no skip jumps past the end tick").toBe(until);
      advanceTo(skipped.simulation, until + 1);
      advanceTo(exact.simulation, until + 1);
      expect(goalIn(skipped.simulation)).toBeUndefined();
      expect(skipped.simulation.saveState().factionAi).toEqual(exact.simulation.saveState().factionAi);
    }, 120_000);
});
