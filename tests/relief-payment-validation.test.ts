import { expect, it } from "vitest";

import type { PlayerProgress } from "../src/shared/progression/player-progress";
import { reliefPaymentProblem } from "../src/shared/progression/relief-payment-validation";

const assignment = (): Pick<PlayerProgress, "quests" | "relief"> => ({ quests: [{ id: "2026-10-28-0",
  kind: "deliver", ware: "ironOre", amount: 12, experience: 5, progress: 0, done: false, reward: { coins: 10 } }],
relief: { version: 1, missions: [{ questId: "2026-10-28-0", day: "2026-10-28", ware: "ironOre",
  amount: 12, stage: "awaiting-aid", loaded: 0, departed: false }] } });
const manifest = { version: 1, questId: "2026-10-28-0", ware: "ironOre", amount: 12 };

it("accepts the exact assigned payment and only retries an already paid job on its existing donor", () => {
  const progress = assignment();
  expect(reliefPaymentProblem(progress, manifest)).toBeUndefined();
  progress.relief!.missions[0]!.stage = "paid-awaiting-ship";
  const job = { questId: manifest.questId, ware: manifest.ware, amount: manifest.amount, islandSeed: 7, harbourUid: 4 };
  expect(reliefPaymentProblem(progress, manifest)).toBeTruthy();
  expect(reliefPaymentProblem(progress, manifest, [job])).toBeUndefined();
  progress.relief!.missions[0]!.islandSeed = 7; progress.relief!.missions[0]!.harbourUid = 4;
  for (const stage of ["paid-awaiting-ship", "loading", "departing", "ready-to-claim"] as const) {
    progress.relief!.missions[0]!.stage = stage;
    expect(reliefPaymentProblem(progress, manifest, [job])).toBeUndefined();
    expect(reliefPaymentProblem(progress, manifest, [])).toBeTruthy();
    expect(reliefPaymentProblem(progress, manifest, [{ ...job, islandSeed: 8 }])).toBeTruthy();
    expect(reliefPaymentProblem(progress, manifest, [{ ...job, harbourUid: 5 }])).toBeTruthy();
    expect(reliefPaymentProblem(progress, { ...manifest, harbourUid: 5 }, [job])).toBeTruthy();
    expect(reliefPaymentProblem(progress, manifest, [{ ...job, amount: 1 }])).toBeTruthy();
  }
});
it("refuses substituting one cheap ware, another quantity or another quest identity", () => {
  for (const change of [{ ware: "logs", amount: 1 }, { amount: 1 }, { questId: "2026-10-28-1" }, { version: 2 }])
    expect(reliefPaymentProblem(assignment(), { ...manifest, ...change })).toBeTruthy();
});
it("does not turn produce, ordinary, completed or returned quests into new relief payments", () => {
  const produce = assignment(); produce.quests[0]!.kind = "produce";
  expect(reliefPaymentProblem(produce, manifest)).toBeTruthy();
  expect(reliefPaymentProblem({ quests: assignment().quests }, manifest)).toBeTruthy();
  const done = assignment(); done.quests[0]!.done = true;
  expect(reliefPaymentProblem(done, manifest)).toBeTruthy();
  const returned = assignment(); returned.relief!.missions[0]!.stage = "returned";
  expect(reliefPaymentProblem(returned, manifest)).toBeTruthy();
});
