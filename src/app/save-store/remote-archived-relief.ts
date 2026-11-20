import type { ArchivedIslandProof } from "../../shared/settlement/archived-relief-journal";
import { ARCHIVED_RELIEF_PROOF_KEY } from "../../shared/settlement/archived-relief-journal";
import type { GameSaveV1 } from "../../shared/settlement/game-save";
import type { SaveApiClient } from "./save-api-client";

export type ArchivedProofApi = Partial<Pick<SaveApiClient, "readArchivedIslandAnchor" | "verifyArchivedIsland">>;
const clearProof = (save: GameSaveV1): GameSaveV1 => {
  if (!save.runtime || typeof save.runtime !== "object") return save;
  const runtime = { ...save.runtime };
  Reflect.deleteProperty(runtime, ARCHIVED_RELIEF_PROOF_KEY);
  return { ...save, runtime };
};
export const replaceFiledIslandProof = (game: GameSaveV1, proof: ArchivedIslandProof, clear = false): GameSaveV1 => {
  const update = (save: GameSaveV1) => {
    if (clear) return clearProof(save);
    const runtime: Record<string, unknown> = {};
    if (save.runtime && typeof save.runtime === "object") Object.assign(runtime, save.runtime);
    runtime[ARCHIVED_RELIEF_PROOF_KEY] = proof;
    return { ...save, runtime };
  };
  const group = game.archipelago;
  if (!group) return game;
  if (proof.island === "home" && group.active !== null && group.home)
    return { ...game, archipelago: { ...group, home: update(group.home) } };
  const reliefReceipts = group.reliefReceipts?.map(receipt => `colony-${receipt.islandId}` === proof.island
    ? { ...receipt, save: update(receipt.save) } : receipt);
  return { ...game, archipelago: { ...group, reliefReceipts, colonies: group.colonies.map(colony =>
    `colony-${colony.expeditionId}` === proof.island && colony.save
      ? { ...colony, save: update(colony.save) } : colony) } };
};

/** Refused verification never rolls back an already durable payment or drops its recoverable journal. */
export const createRemoteArchivedRelief = (api: ArchivedProofApi, slot: string) => {
  const verify = async (proof: ArchivedIslandProof, revision: number) => {
    if (!api.verifyArchivedIsland || proof.intervals[0]?.baseRevision === null) return false;
    try {
      const result = await api.verifyArchivedIsland(slot, revision, proof);
      return result.verified && result.island === proof.island && result.revision === revision;
    } catch { return false; }
  };
  return { verify,
  bind: async (proof: ArchivedIslandProof, contextRevision?: number): Promise<ArchivedIslandProof> => {
    if (contextRevision !== undefined) proof = { ...proof, contexts: proof.contexts?.map(context =>
      context.revision === undefined ? { ...context, revision: contextRevision } : context) };
    if (!api.readArchivedIslandAnchor) return proof;
    try {
      const anchor = await api.readArchivedIslandAnchor(slot, proof.island);
      if (anchor.revision === null) return proof;
      let start = 0;
      if (proof.intervals[0]?.baseRevision !== anchor.revision && anchor.tick !== undefined && anchor.savedAt !== undefined) {
        const tail = proof.intervals.findLastIndex(interval => interval.baseTick === anchor.tick);
        if (tail >= 0) start = tail;
      }
      return { ...proof, coverage: { ...proof.coverage,
        from: start > 0 ? anchor.savedAt! : proof.coverage.from }, contexts: proof.contexts?.slice(start),
      intervals: proof.intervals.slice(start).map((interval, index) =>
        index === 0 ? { ...interval, baseRevision: anchor.revision } : interval) };
    } catch { return proof; }
  },
  acknowledge: async (save: GameSaveV1, proof: ArchivedIslandProof, revision: number) =>
    await verify(proof, revision) ? replaceFiledIslandProof(save, proof, true) : save
  };
};
