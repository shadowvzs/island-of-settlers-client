import type { GameSaveV1 } from "../../shared/settlement/game-save";
import { islandKey } from "../../shared/settlement/game-save-rows";
import type { ReliefCollectionRequest } from "../../shared/settlement/settlement-relief-collections";
import type { ArchipelagoSession } from "./archipelago-session";
import { archivedReliefSourceBlocker } from "./archived-relief-custody";
import { openArchivedReliefIsland, runArchivedReliefNative } from "./archived-relief-native";

export interface ArchivedReliefCandidate {
  islandId: number | null;
  islandSeed: number;
  harbourUid: number;
  available: number;
}
type ArchiveAccess = Pick<ArchipelagoSession, "archivedOwnedIslands" | "updateArchivedIsland"> &
  Partial<Pick<ArchipelagoSession, "archivedReliefBlocker" | "advanceArchivedReliefTo" | "archivedReliefReceipts">>;

/** Filed-island collection never borrows stock or creates a receipt on the island currently on screen. */
export interface ArchivedReliefChronology {
  /** The caller owns the interval and suppresses legacy abstract economy over this exact coverage. */
  advance(save: GameSaveV1, seconds: number): Promise<{ save: GameSaveV1; coveredFrom: number; coveredTo: number }>;
}

export const createReliefIslandPort = (archive: ArchiveAccess, chronology?: ArchivedReliefChronology) => {
  const closed = () => archive.archivedReliefReceipts?.() ?? [];
  const statuses = () => [...archive.archivedOwnedIslands(), ...closed()].flatMap(({ islandId, save }) =>
    (save.settlement.reliefCollections?.jobs ?? []).filter(job => !closed().some(receipt => receipt.islandId === islandId) || job.departed).map(job => {
      const ship = save.settlement.naval.fleet.ships.find(candidate => candidate.id === job.shipId);
      let stage: "ready-to-claim" | "departing" | "loading" | "paid-awaiting-ship" = "paid-awaiting-ship";
      if (job.departed) stage = "ready-to-claim";
      else if (job.loaded) stage = "departing";
      else if (ship?.phase === "loading") stage = "loading";
      return { islandId, islandSeed: save.settlement.world.seed, questId: job.questId, ware: job.ware,
        amount: job.amount, harbourUid: job.harbourUid, loaded: job.loaded, departed: job.departed, stage,
        blocker: archive.archivedReliefBlocker?.(islandId),
        closed: closed().some(receipt => receipt.islandId === islandId) };
    }));
  return {
    newAidBlocker: () => closed().length ? "Claim the completed relief rewards before sending more aid" : undefined,
    statuses,
    list: async (ware: string): Promise<ArchivedReliefCandidate[]> => {
      const candidates: ArchivedReliefCandidate[] = [];
      if (closed().length) return candidates;
      for (const island of archive.archivedOwnedIslands()) {
        if (archivedReliefSourceBlocker(island.save, island.colonyCursor, island.questClock)) continue;
        const session = await openArchivedReliefIsland(island.save);
        candidates.push(...session.simulation.reliefCollectionCandidates(ware).map(candidate => ({ ...candidate,
          islandId: island.islandId, islandSeed: island.save.settlement.world.seed })));
      }
      return candidates.sort((a, b) => b.available - a.available || a.islandSeed - b.islandSeed || a.harbourUid - b.harbourUid);
    },
    reserve: async (candidate: ArchivedReliefCandidate, request: ReliefCollectionRequest) => {
      if (closed().length) return { ok: false as const, reason: "Claim the completed relief rewards before sending more aid" };
      const result = await archive.updateArchivedIsland(candidate.islandId, `relief:${request.questId}`, async (baseline, context) => {
        if (closed().length) throw new Error("Claim the completed relief rewards before sending more aid");
        if (baseline.settlement.world.seed !== candidate.islandSeed)
          throw new Error("The selected relief island changed");
        return runArchivedReliefNative(baseline, islandKey(candidate.islandId), simulation => {
          simulation.pruneReliefCollections(baseline.player?.quests.map(quest => quest.id) ?? []);
          return simulation.requestReliefCollection({ ...request, harbourUid: candidate.harbourUid });
        }, baseline.savedAt, context.questClock, context.colonyCursor, context.sourceVersion);
      });
      return result.ok ? result.value : { ok: false as const, reason: result.reason };
    },
    /** Explicit chronological work, never a side effect of listing ports or reading their receipts. */
    advanceArchivedRelief: async (seconds: number) => {
      if (!Number.isFinite(seconds) || seconds < 0) throw new Error("Invalid archived relief duration");
      const outcomes = [];
      for (const island of archive.archivedOwnedIslands()) {
        if (!island.save.settlement.reliefCollections?.jobs.some(job => !job.departed)) continue;
        const result = await archive.updateArchivedIsland(island.islandId, "relief:advance", async baseline => {
          if (!chronology) throw new Error("Archived relief needs a coordinated chronological economy owner");
          const advanced = await chronology.advance(baseline, seconds);
          if (advanced.coveredFrom !== baseline.savedAt || advanced.coveredTo !== advanced.save.savedAt ||
            Math.abs(advanced.coveredTo - advanced.coveredFrom - seconds * 1000) > 1e-6)
            throw new Error("Archived relief advancement has incomplete chronological coverage");
          return { save: advanced.save, value: { coveredFrom: advanced.coveredFrom, coveredTo: advanced.coveredTo } };
        });
        outcomes.push({ islandId: island.islandId, result });
      }
      return outcomes;
    }
  };
};
export type ReliefIslandPort = ReturnType<typeof createReliefIslandPort>;
