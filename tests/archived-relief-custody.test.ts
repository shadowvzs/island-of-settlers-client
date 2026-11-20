import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, it, vi } from "vitest";

import { ARCHIVED_RELIEF_EXTERNAL_CUSTODY, archivedReliefCustodyBlocker } from "../src/app/settlement/archived-relief-custody";
import { openArchivedReliefIsland, runArchivedReliefNative } from "../src/app/settlement/archived-relief-native";
import { createReliefIslandPort } from "../src/app/settlement/relief-island-port";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";

const paid = async (): Promise<GameSaveV1> => (JSON.parse(await readFile(resolve(
  "tests/fixtures/relief-archive/paid.save.json"), "utf8")) as GameSaveV1).archipelago!.home!;

it.each(["supply", "ore"] as const)("retains an actual %s visitor and paid aid before any unbridged external callback", async role => {
  const source = await paid(), native = await openArchivedReliefIsland(source);
  expect(native.simulation.sendVisitorShip({ stone: 4 }, ["ironOre"], role, [], 120)).not.toBeNull();
  const saved = await native.save(), before = JSON.stringify(saved), action = vi.fn();
  expect(archivedReliefCustodyBlocker(saved)).toBe(ARCHIVED_RELIEF_EXTERNAL_CUSTODY);
  await expect(runArchivedReliefNative(saved, "home", action, saved.savedAt + 300_000)).rejects.toThrow(ARCHIVED_RELIEF_EXTERNAL_CUSTODY);
  expect(action).not.toHaveBeenCalled(); expect(JSON.stringify(saved)).toBe(before);
  expect(saved.settlement.naval.fleet.ships[0]!.cargo).toEqual({ stone: 4 });
  expect(saved.settlement.reliefCollections!.jobs[0]!.departed).toBe(false);
  const port = createReliefIslandPort({ archivedOwnedIslands: () => [{ islandId: null, save: saved }],
    updateArchivedIsland: vi.fn() });
  expect(await port.list("ironOre")).toEqual([]);
});

it("refuses waiting colony departures and queued market deliveries before they create a cross-island ship", async () => {
  const source = await paid();
  expect(archivedReliefCustodyBlocker(source)).toBeUndefined();
  source.settlement.naval.fleet.orders.push({ colony: { expeditionId: 2 } } as never);
  expect(archivedReliefCustodyBlocker(source)).toBe(ARCHIVED_RELIEF_EXTERNAL_CUSTODY);
  source.settlement.naval.fleet.orders = [];
  source.settlement.naval.colonies.expeditions.push({ status: "preparing" } as never);
  expect(archivedReliefCustodyBlocker(source)).toBe(ARCHIVED_RELIEF_EXTERNAL_CUSTODY);
  source.settlement.naval.colonies.expeditions = [];
  source.settlement.trade!.deliveries.push({ id: "pending" } as never);
  expect(archivedReliefCustodyBlocker(source)).toBe(ARCHIVED_RELIEF_EXTERNAL_CUSTODY);
});

it.each(["overdue", "ambiguous"])("skips %s colony donors and rechecks before a zero-time payment", async kind => {
  const source = await paid(), { colonyOreShipMs } = await import("../src/shared/settlement/archipelago");
  delete source.runtime;
  const interval = colonyOreShipMs(0), cursor = { expeditionId: 2, conqueredAt: source.savedAt - 4 * interval,
    beforeNextOreShipAt: kind === "overdue" ? source.savedAt - 1 : source.savedAt + 3 * interval };
  const action = vi.fn(), before = JSON.stringify(source);
  const port = createReliefIslandPort({ archivedOwnedIslands: () => [{ islandId: 2, save: source, colonyCursor: cursor }],
    updateArchivedIsland: vi.fn() });
  expect(await port.list("ironOre")).toEqual([]);
  await expect(runArchivedReliefNative(source, "colony-2", action, source.savedAt, source.savedAt, cursor)).rejects.toThrow(
    kind === "overdue" ? "overdue legacy" : "unjournalled historical");
  expect(action).not.toHaveBeenCalled(); expect(JSON.stringify(source)).toBe(before);
});

it("refuses a discontinuous counter anchor before another payment while preserving its retained chain", async () => {
  const source = await paid(), beforeJob = structuredClone(source.settlement.reliefCollections);
  (source.runtime as any).archivedReliefProof.intervals[0].endChecksum = "discontinuous-anchor";
  const action = vi.fn(), before = JSON.stringify(source);
  await expect(runArchivedReliefNative(source, "home", action, source.savedAt, source.savedAt)).rejects.toThrow("changed outside its relief journal");
  expect(action).not.toHaveBeenCalled(); expect(JSON.stringify(source)).toBe(before);
  expect(source.settlement.reliefCollections).toEqual(beforeJob);
});

it("uses the first frozen talent context when checking historical colony shipment origin", async () => {
  const source = await paid();
  const { colonyOreShipMs } = await import("../src/shared/settlement/archipelago");
  const { archivedReliefSourceBlocker } = await import("../src/app/settlement/archived-relief-custody");
  const cursor = { expeditionId: 2, conqueredAt: source.savedAt - 1000,
    beforeNextOreShipAt: source.savedAt - 1000 + colonyOreShipMs(0) };
  (source.runtime as any).archivedReliefProof.contexts[0].colonyCursor = cursor;
  (source.runtime as any).archivedReliefProof.contexts[0].player.talents = {};
  source.player!.talents = { colonyShipInterval: 5 };
  expect(archivedReliefSourceBlocker(source, cursor)).toBeUndefined();
});
