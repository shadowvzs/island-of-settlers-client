import { expect, it } from "vitest";

import { createCommandLogRecorder } from "../src/shared/settlement/command-log";
import { replayCommandLog } from "../src/shared/settlement/command-log-replay";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { QUEST_CLAIM_COST_SHORT } from "../src/shared/settlement/settlement-quest-claim";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { huntingWorld } from "./helpers/hunting-world";

const create = () => {
  const world = huntingWorld(), roads = createRoadNetwork(world);
  return createSettlementSimulation({ clockStart: 0, world, roads, initialSettlers: 0 });
};

const claim = (fields: object = {}) => ({ bookId: "home-default", cost: { fish: 3 }, goods: { coins: 20 },
  occurrence: "2026-11-11-0", questId: "daily:2026-11-11-0", skip: false, ...fields });

it("records a quest claim that takes its cost and stores its goods, and replays it at the same tick", () => {
  const simulation = create();
  simulation.receiveHomeGoods({ fish: 5 });
  const fish = simulation.resourceTotal("fish");
  const base = simulation.saveState();
  const coins = simulation.resourceTotal("coins");
  const recorder = createCommandLogRecorder(simulation, { sourceVersion: "quest-claim" });
  recorder.open();
  expect(simulation.claimQuest(claim({ cost: { fish: fish + 1 } }))).toBe(QUEST_CLAIM_COST_SHORT);
  expect(simulation.claimQuest(claim())).toBe(true);
  expect(simulation.claimQuest(claim({ cost: { fish: fish + 1 }, skip: true }))).toBe(true);
  simulation.update(.05);
  const interval = recorder.close("home")!;
  expect(interval.entries.map(entry => entry.command.name)).toEqual(["claimQuest", "claimQuest", "claimQuest"]);
  expect(simulation.resourceTotal("fish")).toBe(fish - 3);
  expect(simulation.resourceTotal("coins")).toBe(coins + 20);
  const replay = create();
  expect(replay.loadState(base).ok).toBe(true);
  expect(replayCommandLog(replay, interval)).toEqual({ ok: true, endChecksum: interval.endChecksum });
  expect(replay.resourceTotal("fish")).toBe(fish - 3);
  const malformed = structuredClone(interval);
  malformed.entries[1]!.command.args[0] = { ...claim(), cost: { fish: -3 } };
  expect(replayCommandLog(create(), malformed)).toMatchObject({ ok: false,
    mismatch: { kind: "invalid", reason: "Invalid quest claim" } });
});
