import { COLONY_LIFETIME_MS } from "@shared/catalog/balance";

import { type ArchivedColonyCursor } from "../../shared/settlement/archived-relief-journal";
import { addColonyNativeCoverage } from "../../shared/settlement/colony-native-economy";
import type { GameSaveV1 } from "../../shared/settlement/game-save";
import { islandKey } from "../../shared/settlement/game-save-rows";
import type { createArchivedIslandAccess } from "./archived-island-access";
import { runArchivedReliefNative } from "./archived-relief-native";

const CHUNK_MS = 30_000, CHECK_SECONDS = 10;
const pending = (save: GameSaveV1) => save.settlement.reliefCollections?.jobs.some(job => !job.departed) ?? false;

/** Advance only due cursor slots genuinely replaced by this exact native coverage. */
export const coveredColonyCursor = (cursor: ArchivedColonyCursor | undefined, save: GameSaveV1, to: number) => {
  if (!cursor || to <= save.savedAt) return cursor;
  return { ...cursor, afterNextOreShipAt: cursor.beforeNextOreShipAt,
    afterNativeEconomy: addColonyNativeCoverage(cursor.beforeNativeEconomy, save.savedAt, to) };
};

export const createArchivedReliefCoordinator = (options: {
  archive: ReturnType<typeof createArchivedIslandAccess>;
  now(): number;
  busy(): boolean;
}) => {
  let running: Promise<unknown> | undefined, age = 0, disposed = false;
  const blockers = new Map<number | null, string>();
  const owns = (id: number | null) => options.archive.archivedOwnedIslands().some(island =>
    island.islandId === id && pending(island.save));
  const advanceTo = async (target: number) => {
    const outcomes = [];
    for (const island of options.archive.archivedOwnedIslands()) {
      if (disposed || !pending(island.save) || target - island.save.savedAt < 50) continue;
      const result = await options.archive.updateArchivedIsland(island.islandId, "relief:chronology", async (baseline, context) => {
        const deadline = context.colonyCursor?.conqueredAt === undefined ? Infinity
          : context.colonyCursor.conqueredAt + COLONY_LIFETIME_MS;
        const to = baseline.savedAt + Math.floor(Math.max(0, Math.min(CHUNK_MS, target - baseline.savedAt, deadline - baseline.savedAt)) / 50) * 50;
        const cursor = coveredColonyCursor(context.colonyCursor, baseline, to);
        return runArchivedReliefNative(baseline, islandKey(island.islandId), () => undefined, to,
          context.questClock, cursor, context.sourceVersion);
      });
      if (result.ok) blockers.delete(island.islandId);
      else blockers.set(island.islandId, result.reason);
      outcomes.push({ islandId: island.islandId, result });
    }
    return outcomes;
  };
  return {
    owns, advanceTo,
    blocker: (id: number | null) => blockers.get(id),
    update: (dt: number) => {
      age += Math.max(0, dt);
      if (disposed || age < CHECK_SECONDS || running || options.busy()) return;
      age = 0;
      running = advanceTo(options.now()).finally(() => { running = undefined; });
    },
    whenIdle: () => running ?? Promise.resolve(),
    dispose: () => { disposed = true; }
  };
};
