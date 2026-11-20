import { createExternalStore, type ExternalStore } from "../components/ui-store";
import type { SaveApiClient } from "../save-store/save-api-client";
import type { SaveTimers } from "../save-store/save-coordinator";

/** The server verifies command logs off the upload path: check once immediately, then at most these retries. */
const VERIFICATION_RETRY_MS = [0, 2000, 5000] as const;
const DEFAULT_TIMERS: SaveTimers = { clear: handle => clearTimeout(handle), set: (run, ms) => setTimeout(run, ms) };

/** The slot's verification state as the client sees it (the server remains the authority). */
export interface VerificationState {
  /** A mismatch or plausibility flag; null when the slot has none. */
  flag: Record<string, unknown> | null;
  flaggedAt: string | null;
  /** The newest revision this client read or wrote; null before the slot is loaded. */
  revision: number | null;
  /** A positive revision is known and is not the server's verified revision yet (or none is verified). */
  pending: boolean;
  /** The slot's last successfully verified revision (the restore point); null before any verification. */
  verifiedRevision: number | null;
}

interface VerificationStatusOptions {
  api: Pick<SaveApiClient, "readVerification">;
  /** The newest revision the local store knows (RemoteSaveStore.revision). */
  revision: () => number | null;
  slotId: string;
  /** Bounded checks after an upload: delays before each read. Default VERIFICATION_RETRY_MS. */
  retryDelays?: readonly number[];
  timers?: SaveTimers;
}

export interface VerificationStatus {
  /** The latest read, for the small save-status line; null until the first read. */
  readonly status: ExternalStore<VerificationState | null>;
  /** One read of the slot's verification state (also publishes it). */
  check: () => Promise<VerificationState>;
  /** Bounded checks after an upload; stops once the newest revision is verified. */
  afterUpload: () => Promise<VerificationState | null>;
  stop: () => void;
}

/**
 * The client side of `GET /v1/saves/:slot/verification` (D4.3): exposes the verified revision, flag and pending
 * state, and polls a bounded number of times after an upload because the server replays in worker threads.
 */
export const createVerificationStatus = ({
  api, retryDelays = VERIFICATION_RETRY_MS, revision, slotId, timers = DEFAULT_TIMERS
}: VerificationStatusOptions): VerificationStatus => {
  const status = createExternalStore<VerificationState | null>(null);
  const waits = new Map<ReturnType<typeof setTimeout>, () => void>();
  let reading: Promise<VerificationState> | null = null, running: Promise<VerificationState | null> | null = null;
  let closed = false;

  const wait = (ms: number) => new Promise<void>(resolve => {
    const handle = timers.set(() => {
      waits.delete(handle);
      resolve();
    }, ms);
    waits.set(handle, resolve);
  });
  const check = () => {
    reading ??= (async () => {
      try {
        const verification = await api.readVerification(slotId);
        const current = revision(), verified = verification.verifiedRevision;
        const next: VerificationState = {
          flag: verification.flag, flaggedAt: verification.flaggedAt, revision: current,
          pending: current !== null && current > 0 && (verified === null || verified < current),
          verifiedRevision: verified
        };
        status.set(next);
        return next;
      } finally {
        reading = null;
      }
    })();
    return reading;
  };
  const afterUpload = () => {
    if (running) return running;
    const run = async () => {
      let state: VerificationState | null = null;
      for (const delay of retryDelays) {
        if (delay > 0) await wait(delay);
        if (closed) return state;
        try {
          state = await check();
        } catch {
          // The next save or claim checks again; a status read never blocks play.
          return state;
        }
        if (closed) return null;
        if (!state.pending) break;
      }
      return state;
    };
    running = run().finally(() => { running = null; });
    return running;
  };
  return {
    afterUpload,
    check,
    status,
    stop: () => {
      closed = true;
      for (const [handle, resolve] of waits) {
        timers.clear(handle);
        resolve();
      }
      waits.clear();
    }
  };
};

interface LevelReclaimerOptions {
  /** Re-claims the player's level from the server economy; the server caps it by the verified save. */
  claimLevel: (level: number) => void;
  /** The player's local level: the claim's ceiling. */
  level: () => number;
  status: Pick<VerificationStatus, "afterUpload" | "check">;
}

export interface LevelReclaimer {
  /** Reads the verification once and records the re-claim baseline before the boot claim. */
  boot: () => Promise<VerificationState | null>;
  /** Bounded checks after an upload or a claim; claims once per newly verified revision. */
  afterUpload: () => Promise<VerificationState | null>;
}

/**
 * A level claim is capped by the account's newest verified save (`island-of-settlers-api/src/economy/verified-level.ts`), while a
 * just-uploaded save may still be queued for replay. This re-claims the local level once whenever the verified
 * revision advances, so the level gems paid after a verified upload do not wait for the next boot. Claims are
 * idempotent on the server, and nothing here derives XP: only the server's verified revision can advance.
 */
export const createLevelReclaimer = ({ claimLevel, level, status }: LevelReclaimerOptions): LevelReclaimer => {
  let baseline: number | null | undefined;
  const reclaim = (state: VerificationState | null) => {
    if (!state) return;
    const verified = state.verifiedRevision;
    if (baseline === undefined) {
      baseline = verified;
      return;
    }
    if (verified === null || verified <= (baseline ?? -1)) return;
    baseline = verified;
    const current = level();
    if (current > 1) claimLevel(current);
  };
  return {
    afterUpload: async () => {
      const state = await status.afterUpload().catch(() => null);
      reclaim(state);
      return state;
    },
    boot: async () => {
      const state = await status.check().catch(() => null);
      baseline = state?.verifiedRevision ?? null;
      return state;
    }
  };
};
