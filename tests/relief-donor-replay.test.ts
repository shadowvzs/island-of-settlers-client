import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, it } from "vitest";

import { toSaveSnapshot } from "../src/app/save-store/save-snapshot";
import { verifyCommandLogs } from "../src/app/settlement/command-log-verify";
import { createHeadlessIsland } from "../src/app/settlement/headless-replay";
import { createCommandLogRecorder } from "../src/shared/settlement/command-log";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";

it.each([false, true])("native replay only permits paid retries with an existing local job: existing=%s", async existing => {
  const baseline: GameSaveV1 = JSON.parse(await readFile(resolve(
    `tests/fixtures/relief-collection/${existing ? "stage-0" : "awaiting"}.save.json`), "utf8"));
  const mission = baseline.player!.relief!.missions[0]!;
  mission.stage = "paid-awaiting-ship";
  if (!existing) { mission.islandSeed = baseline.settlement.world.seed + 1; mission.harbourUid = 9; }
  const island = await createHeadlessIsland(baseline), simulation = island.simulation;
  const recorder = createCommandLogRecorder(simulation, { sourceVersion: "0".repeat(40) }); recorder.open();
  const request = { version: 1 as const, questId: mission.questId, ware: mission.ware, amount: mission.amount };
  expect(simulation.requestReliefCollection(request).ok).toBe(true);
  const interval = recorder.close("home")!; recorder.dispose();
  const result = await verifyCommandLogs({ base: toSaveSnapshot(baseline), end: toSaveSnapshot(await island.save()),
    intervals: [{ ...interval, baseRevision: 1 }] });
  expect(result.status).toBe(existing ? "verified" : "mismatch");
  if (!existing) expect(result.mismatch?.reason).toContain("verified quest assignment");
});
