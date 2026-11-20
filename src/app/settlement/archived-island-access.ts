import type { PlayerProgress } from "../../shared/progression/player-progress";
import type { Archipelago } from "../../shared/settlement/archipelago";
import type { ArchivedColonyCursor, ArchivedIslandProof } from "../../shared/settlement/archived-relief-journal";
import type { GameSaveV1 } from "../../shared/settlement/game-save";
import type { SaveStore } from "../save-store/save-store";
import { type SessionLifecycle, SessionTransitionCancelled } from "../session-lifecycle";

export interface ArchivedOwnedIsland { islandId: number | null; save: GameSaveV1; colonyCursor?: ArchivedColonyCursor; questClock?: number }
interface ArchivedIslandAccessOptions {
  group(): Archipelago;
  setGroup(group: Archipelago): void;
  capture(): Promise<GameSaveV1>;
  persist: Pick<SaveStore, "writeSavedGame"> & {
    writeArchivedIslandGame?: (save: GameSaveV1, proof: ArchivedIslandProof) => Promise<GameSaveV1 | void>;
  };
  transition: SessionLifecycle;
  settle?: () => Promise<void>;
  player?: () => PlayerProgress;
  now?: () => number;
  sourceVersion?: string;
  prepareArchivedProgress?: (next: PlayerProgress) => PlayerProgress;
  acceptArchivedProgress?: (expected: PlayerProgress, next: PlayerProgress) => boolean;
  onProgressConflict?: () => void | Promise<void>;
}

/** Only filed friendly settlements participate; active, hostile and adventure worlds are never donors. */
export const archivedOwnedIslands = (group: Archipelago): ArchivedOwnedIsland[] => [
  ...(group.active !== null && group.home ? [{ islandId: null, save: group.home }] : []),
  ...group.colonies.flatMap(colony => colony.expeditionId !== group.active && colony.status === "conquered" && colony.save
    ? [{ islandId: colony.expeditionId, save: colony.save, colonyCursor: { expeditionId: colony.expeditionId,
      conqueredAt: colony.conqueredAt, beforeNextOreShipAt: colony.nextOreShipAt, afterNextOreShipAt: colony.nextOreShipAt, beforeNativeEconomy: colony.nativeEconomy, afterNativeEconomy: colony.nativeEconomy } }] : [])
];

/** Returns a new group (the given one stays untouched) and the caller's result value. */
type ArchipelagoChange<T> = (group: Archipelago) => { group: Archipelago; value: T };
type ArchiveResult<T> = { ok: true; value: T } | { ok: false; reason: string };
const archiveResult = <T>(result: Awaited<ReturnType<SessionLifecycle["run"]>>): ArchiveResult<T> => {
  if (result.ok) return { ok: true, value: result.value as T };
  const failed = result.reason === "failed" && result.error instanceof Error;
  return { ok: false, reason: failed ? (result.error as Error).message : result.reason };
};

/** One exact filed-island mutation, serialized with travel/import/resume and persisted before publication. */
export const createArchivedIslandAccess = (options: ArchivedIslandAccessOptions) => {
  let mutating = 0;
  /** Archipelago record writes wait for every earlier archive write, so none overwrites another. */
  let tail: Promise<unknown> = Promise.resolve();
  const track = <T>(work: Promise<T>) => {
    tail = Promise.all([tail, work.catch(() => undefined)]);
    return work;
  };
  /** Changes an archipelago record (rewards, campaign marker) and persists it with the save on screen. */
  const changeArchipelago = async <T>(key: string, change: ArchipelagoChange<T>) => {
    const result = await options.transition.run({ keepSession: true, key: `archipelago:${key}`, run: async token => {
      await options.settle?.();
      if (!token.current()) throw new SessionTransitionCancelled();
      // `change` returns a new group and leaves the given one untouched (filed saves are large: no deep copy).
      const group = options.group(), changed = change(group);
      const active = await options.capture();
      if (!token.current() || options.group() !== group) throw new SessionTransitionCancelled();
      const player = options.player?.();
      await options.persist.writeSavedGame({ ...active, archipelago: changed.group, ...(player ? { player } : {}) });
      if (!token.current()) throw new SessionTransitionCancelled();
      options.setGroup(changed.group);
      return changed.value;
    } });
    return archiveResult<T>(result);
  };
  return {
  isMutating: () => mutating > 0,
  /**
   * A cross-document write from the island on screen into the archipelago (a campaign grant into
   * `archipelago.rewards`, a pending home debit; plan R9/R38). It waits for earlier archive writes, so a filed
   * relief update and this write both persist; another transition (travel, import, resume) refuses it as busy.
   */
  updateArchipelago: <T>(key: string, change: ArchipelagoChange<T>) => {
    mutating++;
    const work = tail.then(() => changeArchipelago(key, change)).finally(() => { mutating--; });
    return track(work);
  },
  archivedOwnedIslands: (): ArchivedOwnedIsland[] => archivedOwnedIslands(options.group()).map(island => ({ ...island, questClock: options.now?.() })),
  updateArchivedIsland: <T>(islandId: number | null, key: string,
    change: (save: GameSaveV1, context: { questClock: number; sourceVersion: string; colonyCursor?: ArchivedColonyCursor }) =>
      Promise<{ save: GameSaveV1; value: T; proof?: ArchivedIslandProof; player?: PlayerProgress;
        colonyCursor?: ArchivedColonyCursor }>
  ): Promise<ArchiveResult<T>> => track((async (): Promise<ArchiveResult<T>> => {
    mutating++;
    try {
    const result = await options.transition.run({ keepSession: true, key: `archive:${islandId ?? "home"}:${key}`,
      run: async token => {
        await options.settle?.();
        if (!token.current()) throw new SessionTransitionCancelled();
        const group = options.group(), source = archivedOwnedIslands(group).find(island => island.islandId === islandId);
        if (!source) throw new SessionTransitionCancelled();
        const original = JSON.stringify(source.save);
        const playerBefore = options.player && structuredClone(options.player());
        const current = () => token.current() && options.group() === group &&
          JSON.stringify(source.save) === original &&
          (!playerBefore || JSON.stringify(options.player?.()) === JSON.stringify(playerBefore));
        const baseline = structuredClone(source.save);
        if (options.player) baseline.player = structuredClone(options.player());
        const colony = group.colonies.find(record => record.expeditionId === islandId);
        const changed = await change(baseline, { questClock: options.now?.() ?? baseline.savedAt,
          sourceVersion: options.sourceVersion ?? "0".repeat(40),
          colonyCursor: colony && { expeditionId: colony.expeditionId, conqueredAt: colony.conqueredAt,
            beforeNextOreShipAt: colony.nextOreShipAt, afterNextOreShipAt: colony.nextOreShipAt, beforeNativeEconomy: colony.nativeEconomy, afterNativeEconomy: colony.nativeEconomy } });
        if (!current()) throw new SessionTransitionCancelled();
        const save = { ...changed.save, archipelago: undefined };
        const next: Archipelago = islandId === null ? { ...group, home: save } : { ...group,
          colonies: group.colonies.map(colony => colony.expeditionId === islandId ? { ...colony, save,
            ...(changed.colonyCursor ? { nextOreShipAt: changed.colonyCursor.afterNextOreShipAt, nativeEconomy: changed.colonyCursor.afterNativeEconomy } : {}) } : colony) };
        const active = await options.capture();
        if (!current()) throw new SessionTransitionCancelled();
        const player = changed.player ? options.prepareArchivedProgress?.(changed.player) ?? changed.player : options.player?.();
        const payload = { ...active, archipelago: next, ...(player ? { player } : {}) };
        const canonical = changed.proof && options.persist.writeArchivedIslandGame
          ? await options.persist.writeArchivedIslandGame(payload, changed.proof)
          : await options.persist.writeSavedGame(payload);
        if (!token.current()) throw new SessionTransitionCancelled();
        options.setGroup(canonical?.archipelago ?? next);
        if (changed.player && playerBefore && options.acceptArchivedProgress &&
          !options.acceptArchivedProgress(playerBefore, canonical?.player ?? player!)) await options.onProgressConflict?.();
        return changed.value;
      } });
    return archiveResult<T>(result);
    } finally { mutating--; }
  })())
};
};
