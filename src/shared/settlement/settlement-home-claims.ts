import type {
  HomeClaimConfirmCommand
} from "../../../../island-of-settlers-shared/src/commands/home-claim-confirm-command";
import { addToHome } from "./colony-economy";
import { HOME_CLAIM_NOT_PENDING, NO_SCRIPT_UI_EFFECTS as NO_PENDING_CLAIMS } from "./constants";
import { contextIslandRole } from "./island-role";
import type { SettlementContext } from "./settlement-types";

/** One declared home reward the island's script granted and the server has not confirmed yet (§4.14). */
export interface PendingHomeClaim {
  /** Interval windows: the first grant's game time (the grid anchor the server checks); null otherwise. */
  anchorUtc: number | null;
  bookId: string;
  occurrence: string;
  rewardId: string;
  scriptHash: string;
}

/**
 * The declared home reward queue of the simulation (TRG7, trigger design §4.14, §9.4 step 5): a read of the
 * pending claims the client submits to the server claim route, and the recorded `confirmHomeClaim` that drops a
 * confirmed claim and stores the ledger's goods at home (only on the home island; elsewhere the ledger keeps them
 * for the reward delivery of a later lane).
 */
export const createSimulationHomeClaims = (context: SettlementContext) => ({
  /** Pending claims with the book identity the server resolves (a copy; reading never changes the island). */
  pendingHomeClaims: (): readonly PendingHomeClaim[] => {
    const engine = context.script?.engine;
    const snapshot = context.scriptSnapshot;
    if (!engine || !snapshot || engine.state.pendingHomeClaims.length === 0) return NO_PENDING_CLAIMS;
    const granted = engine.state.grantedHomeRewards ?? {};
    return engine.state.pendingHomeClaims.map(({ occurrence, rewardId }) => ({
      anchorUtc: granted[rewardId]?.firstUtc ?? null, bookId: engine.script.quests.id, occurrence, rewardId,
      scriptHash: snapshot.scriptHash
    }));
  },
  /** Recorded: the server confirmed this claim; refused when it is not pending (stale or forged). */
  confirmHomeClaim: (confirm: HomeClaimConfirmCommand): true | string => {
    const engine = context.script?.engine;
    if (!engine?.confirmHomeClaim(confirm.rewardId, confirm.occurrence)) return HOME_CLAIM_NOT_PENDING;
    if (contextIslandRole(context) === "home" && Object.keys(confirm.goods).length)
      addToHome(context.buildings, confirm.goods);
    return true;
  }
});
