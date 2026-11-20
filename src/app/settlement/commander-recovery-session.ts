import type { PlayerInventory } from "../../shared/progression/player-inventory";
import type { CloudSession } from "../cloud/cloud-boot";
import type { SaveCoordinator } from "../save-store/save-coordinator";
import { type SessionLifecycle, SessionTransitionCancelled, SessionTransitionReloadRequired } from "../session-lifecycle";
import type { IslandSettlement } from "./island-settlement";

export type PlayerRecoveryResult={ ok:true;items:PlayerInventory;gems:number }|{ ok:false;reason:string };
interface Options {
  cloud?:CloudSession;
  getSettlement:()=>IslandSettlement|undefined;
  lifecycle:SessionLifecycle;
  rebase:()=>void;
  reload:()=>void;
  saving:SaveCoordinator;
  settle:()=>Promise<void>;
}
const PENDING="Commander recovery is awaiting server confirmation";

/** Hold the exact saved baseline until the server effect is adopted; unknown commits reload through its receipt. */
export const createCommanderRecoverySession = ({ cloud,getSettlement,lifecycle,rebase,reload,saving,settle }:Options) =>
  async(commanderId:string):Promise<PlayerRecoveryResult>=>{
    const settlement=getSettlement();
    if (!cloud || !settlement) return { ok:false,reason:"Commander recovery is unavailable" };
    if (settlement.simulation.islandRole() !== "home") return { ok:false,reason:"Return to the home island first" };
    if (settlement.bugReplay.recording()) return { ok:false,reason:"Finish the reproduction recording before using this item" };
    const problem=settlement.simulation.commanderRecoveryProblem(commanderId);
    if (problem) return { ok:false,reason:problem };
    const result=await lifecycle.run({ key:"commander-recovery",keepSession:true,run:async token=>{
      // The lifecycle publishes its active owner immediately after invoking this async callback.
      await Promise.resolve();
      const current=()=>token.current() && getSettlement() === settlement;
      if (!await saving.flushTransition(current)) return { ok:false as const,reason:"The home island could not be saved" };
      await saving.whenIdle();await settle();await cloud.store.whenIdle();
      if (!current()) throw new SessionTransitionCancelled();
      if (cloud.store.hasPendingUpload()) return { ok:false as const,reason:"Wait for the home island save to upload" };
      const verified=await cloud.verification.afterUpload();
      if (!current()) throw new SessionTransitionCancelled();
      if (verified?.verifiedRevision !== cloud.store.revision())
        return { ok:false as const,reason:"Wait for this save revision to be verified before using the item" };
      const answer=await cloud.recovery.use(commanderId,data=>{
        if (!current() || settlement.bugReplay.recording()) throw new Error(PENDING);
        const loaded=settlement.simulation.loadState(data);
        if (!loaded.ok) throw new Error(loaded.reason);
        rebase();
      });
      if (!current()) throw new SessionTransitionCancelled();
      if ((!answer.ok && answer.pending) || (answer.ok && answer.reload)) {
        saving.stop();
        if (answer.ok) await cloud.discardUnsent();
        reload();
        throw new SessionTransitionReloadRequired();
      }
      if (!answer.ok) return { ok:false as const,reason:answer.reason };
      return { ok:true as const,items:answer.receipt.wallet.items,gems:answer.receipt.wallet.gems };
    } });
    if (result.ok) return result.value;
    if (result.reason === "reload-required") return { ok:false,reason:PENDING };
    return { ok:false,reason:"The current island operation must finish before commander recovery" };
  };
