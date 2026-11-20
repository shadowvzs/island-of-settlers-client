import { expect, it } from "vitest";

import { createCommandLogRecorder } from "../src/shared/settlement/command-log";
import { replayCommandLog } from "../src/shared/settlement/command-log-replay";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { huntingWorld } from "./helpers/hunting-world";

const create = () => {
  const world = huntingWorld(), roads = createRoadNetwork(world);
  return createSettlementSimulation({ clockStart: 0, world, roads, initialSettlers: 0,
    roadDecorationCustody: { consume: () => true, receive: () => true } });
};

it("journals same-UID rotate/move reproducibly while direct production uploads reject private custody commands", () => {
  const simulation = create();
  expect(simulation.placeRoadDecoration({ item: "roadDecoration:indigenous-flower-pot:native",
    position: { x: 18.25, z: 10.5 }, yaw: 0 }).ok).toBe(true);
  const base = simulation.saveState(), recorder = createCommandLogRecorder(simulation, { sourceVersion: "transforms" });
  recorder.open();
  expect(simulation.rotateRoadDecoration(1).ok).toBe(true);
  expect(simulation.moveRoadDecoration(1, { x: 20.25, z: 10.5 }, Math.PI / 2).ok).toBe(true);
  simulation.update(.05);
  const interval = recorder.close("home")!;
  expect(interval.entries.map(entry => entry.command.name)).toEqual(["rotateRoadDecoration", "moveRoadDecoration"]);
  const replay = create(); expect(replay.loadState(base).ok).toBe(true);
  expect(replayCommandLog(replay, interval, { rejectDebug: false })).toEqual({ ok: true, endChecksum: interval.endChecksum });
  expect(replay.saveState().roadDecorations).toEqual(simulation.saveState().roadDecorations);
  const direct = create(); expect(direct.loadState(base).ok).toBe(true);
  expect(replayCommandLog(direct, interval)).toMatchObject({ ok: false,
    mismatch: { kind: "invalid", reason: "Rejected command rotateRoadDecoration" } });
  const malformed = structuredClone(interval); malformed.entries[1]!.command.args[1] = { x: Infinity, z: 10.5 };
  expect(replayCommandLog(create(), malformed, { rejectDebug: false })).toMatchObject({ ok: false,
    mismatch: { kind: "invalid", reason: "Invalid road decoration transform" } });
});
