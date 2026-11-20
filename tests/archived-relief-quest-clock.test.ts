import { expect, it } from "vitest";

import { createHeadlessIsland } from "../src/app/settlement/headless-replay";
import { createPlayerProgress } from "../src/shared/progression/player-progress";
import { registerReliefQuests } from "../src/shared/progression/relief-quests";
import { createGameSave } from "../src/shared/settlement/game-save";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { huntingWorld } from "./helpers/hunting-world";

it("keeps current global relief quests while the archived island retains its genuine old native clock", async () => {
  const world = huntingWorld(), initial = createSettlementSimulation({ world, roads: createRoadNetwork(world) });
  const baseline = await createGameSave(world, initial.saveState(), { name: "Archive quest clock",
    source: "generated", savedAt: 1_000_000, animals: [] });
  const quest = { id: "2026-10-29-0", kind: "deliver" as const, ware: "logs", amount: 4, experience: 5,
    progress: 0, done: false, reward: {} };
  baseline.player = { ...createPlayerProgress(world.seed), questDay: "2026-10-29", quests: [quest],
    relief: registerReliefQuests(undefined, [quest], "2026-10-29") };
  const current = await createHeadlessIsland(baseline, false, false, { questClock: () => Date.UTC(2026, 9, 29, 12) });
  const saved = await current.save();
  expect(saved.player!.questDay).toBe("2026-10-29"); expect(saved.player!.quests).toEqual([quest]);
  expect(current.simulation.gameNow()).toBe(1_000_000); expect(saved.savedAt).toBe(1_000_000);
  expect(saved.settlement.gameTick).toBe(baseline.settlement.gameTick);
  const legacy = await createHeadlessIsland(baseline);
  expect((await legacy.save()).player!.questDay).toBe("1970-01-01");
});
