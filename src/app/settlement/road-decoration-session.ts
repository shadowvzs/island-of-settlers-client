import type { RoadDecorationAction, RoadDecorationIslandKey } from "../../../../island-of-settlers-shared/src/road-decoration-custody";
import type { PlayerInventory } from "../../shared/progression/player-inventory";
import type { CloudSession } from "../cloud/cloud-boot";
import type { SaveCoordinator } from "../save-store/save-coordinator";
import { type SessionLifecycle, SessionTransitionCancelled, SessionTransitionReloadRequired } from "../session-lifecycle";
import type { IslandSettlement } from "./island-settlement";

export type PlayerRoadDecorationResult = { ok: true; items: PlayerInventory; gems: number } | { ok: false; reason: string };
interface Options {
  cloud?: CloudSession;
  getSettlement(): IslandSettlement | undefined;
  islandKey(): RoadDecorationIslandKey;
  lifecycle: SessionLifecycle;
  rebase(key: RoadDecorationIslandKey): void;
  reload(): void;
  saving: SaveCoordinator;
  settle(): Promise<void>;
}
const PENDING = "Road decoration is awaiting server confirmation";

/** Save/verify a fixed baseline, then adopt a private receipt under the same transition owner. */
export const createRoadDecorationSession = ({ cloud, getSettlement, islandKey, lifecycle, rebase, reload,
  saving, settle }: Options) => async (action: RoadDecorationAction): Promise<PlayerRoadDecorationResult> => {
  const settlement = getSettlement(), key = islandKey();
  if (!cloud || !settlement) return { ok: false, reason: "Road decoration custody is unavailable" };
  if (settlement.bugReplay.recording()) return { ok: false, reason: "Finish the reproduction recording before moving this item" };
  const result = await lifecycle.run({ key: "road-decoration", keepSession: true, run: async token => {
    await Promise.resolve();
    const current = () => token.current() && getSettlement() === settlement && islandKey() === key;
    if (!await saving.flushTransition(current)) return { ok: false as const, reason: "The island could not be saved" };
    await saving.whenIdle(); await settle(); await cloud.store.whenIdle();
    if (!current()) throw new SessionTransitionCancelled();
    if (cloud.store.hasPendingUpload()) return { ok: false as const, reason: "Wait for the island save to upload" };
    const verified = await cloud.verification.afterUpload();
    if (!current()) throw new SessionTransitionCancelled();
    if (verified?.verifiedRevision !== cloud.store.revision())
      return { ok: false as const, reason: "Wait for this save revision to be verified before moving the item" };
    const answer = await cloud.roadDecorations.mutate(key, action, data => {
      if (!current() || settlement.bugReplay.recording()) throw new Error(PENDING);
      const loaded = settlement.simulation.loadState(data);
      if (!loaded.ok) throw new Error(loaded.reason);
      rebase(key);
    });
    if (!current()) throw new SessionTransitionCancelled();
    if ((!answer.ok && answer.pending) || (answer.ok && answer.reload)) {
      saving.stop(); if (answer.ok) await cloud.discardUnsent(); reload();
      throw new SessionTransitionReloadRequired();
    }
    if (!answer.ok) return { ok: false as const, reason: answer.reason };
    return { ok: true as const, items: answer.receipt.wallet.items as PlayerInventory, gems: answer.receipt.wallet.gems };
  } });
  if (result.ok) return result.value;
  return { ok: false, reason: result.reason === "reload-required" ? PENDING : "The current island operation must finish first" };
};
