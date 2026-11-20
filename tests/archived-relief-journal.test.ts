import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, it, vi } from "vitest";

import { createSessionLifecycle } from "../src/app/session-lifecycle";
import { createArchivedIslandAccess } from "../src/app/settlement/archived-island-access";
import { coveredColonyCursor, createArchivedReliefCoordinator } from "../src/app/settlement/archived-relief-coordinator";
import { runArchivedReliefNative } from "../src/app/settlement/archived-relief-native";
import { type Archipelago,colonyOreShipMs } from "../src/shared/settlement/archipelago";
import { archivedIslandProof, archivedIslandProofProblem } from "../src/shared/settlement/archived-relief-journal";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";

const paid = async (): Promise<GameSaveV1> => JSON.parse(await readFile(resolve(
  "tests/fixtures/relief-archive/paid.save.json"), "utf8"));

it.each([null, { version: 2 }, { version: 1, intervals: "bad" }, { version: 1, intervals: [] }])(
  "refuses malformed or unknown archived journals before commands/ticks without losing paid custody: %j", async malformed => {
    const source = (await paid()).archipelago!.home!, before = structuredClone(source.settlement.reliefCollections);
    source.runtime = { archivedReliefProof: malformed };
    const action = vi.fn();
    expect(archivedIslandProof(source)).toBeUndefined();
    expect(archivedIslandProofProblem(source)).toContain("paid custody is retained");
    await expect(runArchivedReliefNative(source, "home", action, source.savedAt + 1000)).rejects.toThrow("journal is invalid");
    expect(action).not.toHaveBeenCalled();
    expect(source.settlement.reliefCollections).toEqual(before);
    expect(source.runtime).toEqual({ archivedReliefProof: malformed });
  });

it("preserves a complete valid journal and rejects malformed frozen contexts", async () => {
  const source = (await paid()).archipelago!.home!;
  expect(archivedIslandProofProblem(source)).toBeUndefined();
  expect(archivedIslandProof(source)!.intervals).toHaveLength(1);
  (source.runtime as any).archivedReliefProof.contexts[0].questClock = "not a clock";
  expect(archivedIslandProof(source)).toBeUndefined();
});

it("records exact native coverage without prematurely settling abstract due slots", () => {
  const source = { savedAt: 1000 } as GameSaveV1;
  const cursor = { expeditionId: 2, beforeNextOreShipAt: 1100, afterNextOreShipAt: 1100 };
  const covered = coveredColonyCursor(cursor, source, 1200)!;
  expect(covered.afterNextOreShipAt).toBe(1100);
  expect(covered.afterNativeEconomy).toEqual({ version: 1, coverage: [[1000, 1200]], oreRemainder: 0 });
});

it("retains a paid legacy colony unchanged when native chronology cannot establish a safe handover", async () => {
  const source = (await paid()).archipelago!.home!, interval = colonyOreShipMs(0);
  delete source.runtime;
  let group = { version: 1, active: null, colonies: [{ expeditionId: 2, status: "conquered", save: source,
    conqueredAt: source.savedAt - 3 * interval, nextOreShipAt: source.savedAt - 1 }] } as Archipelago;
  const before = structuredClone(group), persist = vi.fn(async () => {});
  const archive = createArchivedIslandAccess({ group: () => group, setGroup: next => { group = next; },
    capture: async () => source, persist: { writeSavedGame: persist }, transition: createSessionLifecycle() });
  const owner = createArchivedReliefCoordinator({ archive, now: () => source.savedAt + 1000, busy: () => false });
  const result = await owner.advanceTo(source.savedAt + 1000);
  expect(result[0]!.result).toMatchObject({ ok: false });
  expect(owner.blocker(2)).toContain("legacy colony shipment");
  expect(group).toEqual(before); expect(persist).not.toHaveBeenCalled(); owner.dispose();
});
