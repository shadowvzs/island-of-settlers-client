import type { PendingHomeClaim } from "../../shared/settlement/settlement-home-claims";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import type { ServerEconomy } from "../cloud/server-economy";
import { isTransientFailure } from "../save-store/save-api-client";
import type { SaveTimers } from "../save-store/save-coordinator";
import {
  HOME_CLAIM_FIRST_RETRY_MS as FIRST_RETRY_MS, HOME_CLAIM_LOG_PREFIX as LOG_PREFIX,
  HOME_CLAIM_MAX_RETRY_MS as MAX_RETRY_MS, HOME_CLAIM_SYNC_TICKS as SYNC_TICKS, HOME_CLAIM_TIMERS as DEFAULT_TIMERS
} from "./constants";

type HomeClaimSimulation = Pick<SettlementSimulation, "confirmHomeClaim" | "observeTicks" | "pendingHomeClaims">;

export interface HomeClaimSubmitterOptions {
  claim: NonNullable<ServerEconomy["claimHomeReward"]>;
  /** XP the ledger paid with a confirmed claim. */
  grantExperience: (experience: number) => void;
  log?: (line: string) => void;
  /** Rewards are on under the island's rules (plan §9.3); off: nothing is submitted, the claims stay pending. */
  rewardsOn?: () => boolean;
  simulation: HomeClaimSimulation;
  timers?: SaveTimers;
}

const claimKey = (pending: PendingHomeClaim) => `${pending.rewardId}:${pending.occurrence}`;

/**
 * Submits the island script's declared home rewards (`pendingHomeClaims`, trigger design §4.14) to the unified
 * claim route and records `confirmHomeClaim` once the ledger accepted one (the GRANT-RETRY pattern). Each
 * occurrence is idempotent on the server, so a retry after a lost answer never pays twice and still learns the
 * stored payout. Transient failures back off and retry; a refusal stays pending (nothing is lost) and is offered
 * again in the next session.
 */
export const createHomeClaimSubmitter = (options: HomeClaimSubmitterOptions) => {
  const { simulation } = options;
  const timers = options.timers ?? DEFAULT_TIMERS;
  const log = options.log ?? (line => console.info(LOG_PREFIX, line));
  const inFlight = new Set<string>(), refused = new Set<string>();
  let alive = true, delay = FIRST_RETRY_MS, ticks = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const scheduleRetry = () => {
    if (retry !== undefined) return;
    retry = timers.set(() => {
      retry = undefined;
      sync();
    }, delay);
    delay = Math.min(MAX_RETRY_MS, delay * 2);
  };
  const confirm = (pending: PendingHomeClaim, paid: { goods: Record<string, number>; xp: number }) => {
    const recorded = simulation.confirmHomeClaim({ goods: paid.goods, occurrence: pending.occurrence,
      rewardId: pending.rewardId });
    if (recorded !== true) {
      log(`${claimKey(pending)}: ${recorded}`);
      return;
    }
    if (paid.xp > 0) options.grantExperience(paid.xp);
  };
  const submit = async (pending: PendingHomeClaim) => {
    const key = claimKey(pending);
    inFlight.add(key);
    try {
      const result = await options.claim(pending);
      if (!alive) return;
      if (typeof result === "string") {
        refused.add(key);
        log(`${key} refused: ${result}`);
        return;
      }
      delay = FIRST_RETRY_MS;
      confirm(pending, result);
    } catch (error) {
      if (alive && isTransientFailure(error)) scheduleRetry();
      else refused.add(key);
    } finally {
      inFlight.delete(key);
    }
  };
  const submitPending = () => {
    const submissions: Promise<void>[] = [];
    if (options.rewardsOn?.() === false) return submissions;
    for (const pending of simulation.pendingHomeClaims()) {
      const key = claimKey(pending);
      if (!inFlight.has(key) && !refused.has(key)) submissions.push(submit(pending));
    }
    return submissions;
  };
  const sync = () => {
    if (!alive || retry !== undefined) return;
    submitPending();
  };
  /**
   * Offers every pending claim again, the refused ones included, and waits for the answers: a won campaign replay
   * (C9b) pays only after its victory reached the server, before the run leaves the screen.
   */
  const flush = async () => {
    if (!alive) return;
    refused.clear();
    await Promise.all(submitPending());
  };
  const stopTicks = simulation.observeTicks(() => {
    ticks += 1;
    if (ticks % SYNC_TICKS === 0) sync();
  });
  sync();
  return {
    dispose: () => {
      alive = false;
      stopTicks();
      if (retry !== undefined) timers.clear(retry);
    },
    flush,
    sync
  };
};
