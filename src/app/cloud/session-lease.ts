import { isGameSettings } from "../../../../island-of-settlers-shared/src/game-settings/game-settings-shape";
import { type SimRules, toSimRules } from "../../../../island-of-settlers-shared/src/game-settings/sim-rules";
import type { SaveApiClient, ServerFull, SessionLease } from "../save-store/save-api-client";
import type { SaveTimers } from "../save-store/save-coordinator";

const DEFAULT_TIMERS: SaveTimers = { clear: handle => clearTimeout(handle), set: (run, ms) => setTimeout(run, ms) };
/** Heartbeats run three times per lease lifetime; a failed one retries sooner. */
const HEARTBEATS_PER_LEASE = 3;
const RETRY_MS = 5000;

interface LeaseKeeperOptions {
  api: Pick<SaveApiClient, "acquireLease" | "releaseLease" | "renewLease">;
  /** Another device took the session over (or it expired unseen): this one must stop saving. */
  onLost: () => void;
  timers?: SaveTimers;
}

/** The simulated rules of a lease's settings grant; undefined from an older server or a malformed grant. */
export const grantedSimRules = (lease: Pick<SessionLease, "gameSettings">): SimRules | undefined => {
  const grant = lease.gameSettings;
  if (!grant || typeof grant.revision !== "string" || !isGameSettings(grant.settings)) return undefined;
  return toSimRules(grant.settings, grant.revision);
};

/**
 * This device's single live session of the account (the save API lease): acquired at start (taking it over
 * when asked), renewed by heartbeat, released at logout or when the tab closes. A lost lease is reported once.
 */
export const createLeaseKeeper = ({ api, onLost, timers = DEFAULT_TIMERS }: LeaseKeeperOptions) => {
  let lease: SessionLease | null = null, timer: ReturnType<typeof setTimeout> | undefined;
  let serverTime: string | undefined, gameRules: SimRules | undefined;
  const clear = () => {
    if (timer !== undefined) timers.clear(timer);
    timer = undefined;
  };
  const schedule = (ms: number) => {
    clear();
    timer = timers.set(() => void heartbeat(), ms);
  };
  const interval = (current: SessionLease) => current.ttlSeconds * 1000 / HEARTBEATS_PER_LEASE;
  const heartbeat = async () => {
    if (!lease) return;
    try {
      const result = await api.renewLease(lease.leaseId);
      if (result.ok) {
        lease = result.lease;
        schedule(interval(lease));
        return;
      }
      lease = null;
      clear();
      onLost();
    } catch {
      schedule(RETRY_MS);
    }
  };
  return {
    /**
     * Starts the session: `acquired`, `held` when another device plays and `takeOver` was not asked, or the
     * server's queue place when it is full.
     */
    acquire: async (takeOver: boolean): Promise<"acquired" | "held" | ServerFull> => {
      const result = await api.acquireLease(takeOver);
      if (!result.ok && result.reason === "full") return result;
      if (!result.ok) return "held";
      lease = result.lease;
      serverTime = lease.serverTime;
      gameRules = grantedSimRules(lease);
      schedule(interval(lease));
      return "acquired";
    },
    id: () => lease?.leaseId,
    /**
     * The game rules the lease granted (rev G4): each live island adopts them through the recorded command. Kept
     * for the whole session; only the next acquire (a new session) grants a newer revision.
     */
    gameRules: () => gameRules,
    /** The server's UTC time when the session started (ISO); undefined before or from an older server. */
    serverTime: () => serverTime,
    /**
     * Checks this tab's lease before a retained resume: a heartbeat now proves it is still the live
     * session, a lost answer stops saving, and a network failure is `unknown` (not proof of authority).
     */
    verify: async (): Promise<"current" | "lost" | "unknown"> => {
      if (!lease) return "lost";
      try {
        const result = await api.renewLease(lease.leaseId);
        if (!result.ok) {
          lease = null;
          clear();
          onLost();
          return "lost";
        }
        lease = result.lease;
        schedule(interval(lease));
        return "current";
      } catch { return "unknown"; }
    },
    /** Ends the session (logout, closing tab); `keepalive` outlives the page. */
    release: async (keepalive = false) => {
      const current = lease;
      lease = null;
      clear();
      if (current) await api.releaseLease(current.leaseId, keepalive);
    }
  };
};
