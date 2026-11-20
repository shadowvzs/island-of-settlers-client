import { expect, it, vi } from "vitest";

import { createRemoteArchivedRelief } from "../src/app/save-store/remote-archived-relief";
import type { ArchivedIslandProof } from "../src/shared/settlement/archived-relief-journal";
import { completeGame } from "./save-fixtures";

const proof = (): ArchivedIslandProof => ({ version: 1, island: "home", coverage: { from: 10, to: 1010 },
  intervals: [{ format: "island-settlers-command-log", version: 1, island: "home", sourceVersion: "abc123",
    baseRevision: null, baseTick: 0, endAccumulator: 0, endTick: 20, baseChecksum: "a", endChecksum: "b", checksums: [],
    randomStates: [], entries: [] }] });
const paid = () => {
  const game = completeGame();
  if (!game.archipelago?.home) throw new Error("Missing filed home fixture");
  game.archipelago.home.runtime = { camera: { zoom: 2 }, archivedReliefProof: proof() };
  return game;
};

it("binds a journal to the server's own island anchor without mutating the retained chain", async () => {
  const journal = proof();
  const readArchivedIslandAnchor = vi.fn(async () => ({ revision: 17 }));
  const remote = createRemoteArchivedRelief({ readArchivedIslandAnchor }, "slot");
  expect((await remote.bind(journal)).intervals[0]!.baseRevision).toBe(17);
  expect(journal.intervals[0]!.baseRevision).toBeNull();
  expect(readArchivedIslandAnchor).toHaveBeenCalledWith("slot", "home");
});

it("retains a durable paid save and full journal when verification is pending or unavailable", async () => {
  const save = paid(), journal = proof(); journal.intervals[0]!.baseRevision = 17;
  const remote = createRemoteArchivedRelief({ verifyArchivedIsland: async () => { throw new Error("pending"); } }, "slot");
  expect(await remote.acknowledge(save, journal, 18)).toBe(save);
  expect(save.archipelago!.home!.runtime).toHaveProperty("archivedReliefProof");
  expect(await createRemoteArchivedRelief({}, "slot").acknowledge(save, journal, 18)).toBe(save);
});

it("clears only the acknowledged donor's proof metadata and preserves all economy and other state", async () => {
  const save = paid(), journal = proof(); journal.intervals[0]!.baseRevision = 17;
  const remote = createRemoteArchivedRelief({ verifyArchivedIsland: async () => ({ verified: true, island: "home", revision: 18 }) }, "slot");
  const canonical = await remote.acknowledge(save, journal, 18);
  expect(canonical.archipelago!.home!.runtime).toEqual({ camera: { zoom: 2 } });
  expect(save.archipelago!.home!.runtime).toHaveProperty("archivedReliefProof");
  expect({ ...canonical, archipelago: undefined }).toEqual({ ...save, archipelago: undefined });
  expect(canonical.archipelago!.home!.settlement).toBe(save.archipelago!.home!.settlement);
  expect(canonical.archipelago!.colonies).toBe(save.archipelago!.colonies);
});

it("resumes after a lost acknowledgment by retaining only the tail after the server's attested tick", async () => {
  const journal = proof(), player = completeGame().player!;
  journal.intervals[0]!.baseRevision = 17;
  journal.intervals.push({ ...journal.intervals[0]!, baseRevision: null, baseTick: 20, endTick: 40 });
  journal.coverage.to = 2010;
  journal.contexts = [{ baseTick: 0, endTick: 20, player, questClock: 10, revision: 17 },
    { baseTick: 20, endTick: 40, player, questClock: 1010 }];
  const remote = createRemoteArchivedRelief({ readArchivedIslandAnchor: async () => ({ revision: 18, tick: 20, savedAt: 1010 }) }, "slot");
  const bound = await remote.bind(journal, 19);
  expect(bound.intervals).toHaveLength(1);
  expect(bound.intervals[0]).toMatchObject({ baseRevision: 18, baseTick: 20, endTick: 40 });
  expect(bound.contexts).toHaveLength(1);
  expect(bound.contexts![0]!.revision).toBe(19);
  expect(bound.coverage).toEqual({ from: 1010, to: 2010 });
  expect(journal.intervals).toHaveLength(2);
  expect(journal.contexts[1]!.revision).toBeUndefined();
});
