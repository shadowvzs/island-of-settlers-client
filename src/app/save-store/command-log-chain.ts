import type { CommandLogInterval } from "../../shared/settlement/command-log";
import type { RandomDraw } from "../../shared/settlement/simulation-random";

/** Unconfirmed intervals kept for a long offline stretch (one per save); older ones end the chain. */
const MAX_PENDING_INTERVALS = 64;
const DROPPED_GAP = "Earlier command log intervals were dropped while offline";
/** Draw ring buffers kept for the server's request after a mismatch (newest intervals). */
const KEPT_TRAILS = 8;

const trailKey = (island: string, endTick: number) => `${island}:${endTick}`;

/**
 * The command log intervals since the last confirmed upload (D4.2). Every upload carries all of them, so a body
 * that replaced an unsent one still covers the whole chain from the last revision the server holds; the first
 * interval names that revision, later ones continue it (`baseRevision: null`).
 */
export const createCommandLogChain = () => {
  let base: number | null = null, pending: CommandLogInterval[] = [];
  /** A gap the next captured interval carries (a server mutation invalidated the open local interval). */
  let nextGap: string | undefined;
  /** The newest interval each body carries. */
  const sentLast = new WeakMap<ArrayBuffer, CommandLogInterval>();
  const trails = new Map<string, RandomDraw[]>();
  return {
    /** Adds the interval a capture ended; returns the chain the upload carries and its newest interval. */
    add: (interval: CommandLogInterval | null, trail?: RandomDraw[]) => {
      if (interval) {
        pending.push(interval);
        if (nextGap) {
          pending[0] = { ...pending[0]!, gaps: [...pending[0]!.gaps ?? [], nextGap] };
          nextGap = undefined;
        }
      }
      if (interval && trail) {
        trails.set(trailKey(interval.island, interval.endTick), trail);
        if (trails.size > KEPT_TRAILS) trails.delete(trails.keys().next().value!);
      }
      if (pending.length > MAX_PENDING_INTERVALS) {
        pending = pending.slice(-MAX_PENDING_INTERVALS);
        base = null;
        pending[0] = { ...pending[0]!, gaps: [...pending[0]!.gaps ?? [], DROPPED_GAP] };
      }
      return { intervals: pending.map((entry, index) => ({ ...entry, baseRevision: index === 0 ? base : null })),
        last: pending.at(-1) };
    },
    /** The server stored `body` as `revision`: its intervals are delivered; the next chain starts there. */
    confirmed: (body: ArrayBuffer, revision: number) => {
      const last = sentLast.get(body);
      if (last) pending = pending.slice(pending.indexOf(last) + 1);
      base = revision;
    },
    /** The game (re)started from `revision`, or from a copy the server never had (null). */
    restart: (revision: number | null) => {
      base = revision;
      pending = [];
      nextGap = undefined;
    },
    /**
     * The server wrote the save outside the client's command-log interval (a stock move): later uploads start a
     * new chain at `revision`; `gap` marks the next captured interval as not replayable from that base.
     */
    rebase: (revision: number, gap?: string) => {
      base = revision;
      pending = [];
      nextGap = gap;
    },
    /** The draw ring buffer at the end of the interval of `island` that ended at `endTick`, if still kept. */
    trail: (island: string, endTick: number) => trails.get(trailKey(island, endTick)),
    /** `replacement` is `body` rebuilt (same intervals): it confirms the same ones. */
    replaced: (body: ArrayBuffer, replacement: ArrayBuffer) => {
      const last = sentLast.get(body);
      if (last) sentLast.set(replacement, last);
    },
    /** `body` carries the pending intervals up to `last`. */
    sent: (body: ArrayBuffer, last: CommandLogInterval | undefined) => { if (last) sentLast.set(body, last); }
  };
};
