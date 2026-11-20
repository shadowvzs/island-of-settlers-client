import { buildingNavigationNations, loadBuildingNavigation } from "@shared/catalog/building-data/navigation";

import { expiredColonies } from "../../shared/settlement/archipelago";
import {
  checkPlausibility as checkGamePlausibility,
  type PlausibilityResult,
  plausibilitySeconds
} from "../../shared/settlement/plausibility-bounds";
import type { Goods } from "../../shared/settlement/settlement-types";
import { type SaveSnapshot } from "../save-store/save-api-client";
import { fromSaveSnapshot, toSaveSnapshot } from "../save-store/save-snapshot";
import { type AwaySummary, summarizeTimeAway } from "./away-summary-data";
import { type CatchUpRules, pinSnapshotRules } from "./catch-up-rules";
import { advanceOfflineGame, expireColonies, type OfflineReplayFlags } from "./offline-progress";
import { decodePlausibilityResources } from "./plausibility-resources";

/**
 * The game code the api runs in Node worker threads, one bundle per client build (tools/server/build-verifier.ts):
 * command log verification (D4.3) and the offline catch-up at login (D4.4).
 */
/** Logs of every nation verify in one worker: load all building navigation sidecars before any export runs. */
await Promise.all(buildingNavigationNations().map(loadBuildingNavigation));

export { recoverSavedCommander } from "./server-commander-recovery";
export { mutateSavedRoadDecoration } from "./server-road-decoration";
export { verifyCommandLogs } from "./command-log-verify";
/** The api diffs a client's draw ring buffer with the server's trail of the same interval. */
export { firstDifferentDraw } from "../../shared/settlement/simulation-random";

export interface CaughtUpSnapshot {
  snapshot: SaveSnapshot;
  summary: AwaySummary;
}

/**
 * Server-side offline catch-up (D4.4): the stored snapshot advanced to the server's UTC `now` with the shared
 * offline progress (fast economy for every positive gap, zero native prefix, 1-day production cap;
 * colonies age on the real time). Null when no time passed worth a tick. The api passes one serializable
 * `ServerCatchUpOptions` shape from its own build config; no option changes the save format.
 */
/**
 * The colony expiry timer (D4.4) for a slot nobody plays: its conquered colonies past their lifetime end as at a
 * login (goods and troops wait for home ships), without simulating any island. Null when none expired.
 */
export const expireSnapshotColonies = (snapshot: SaveSnapshot, now: number): SaveSnapshot | null => {
  const game = fromSaveSnapshot(snapshot);
  if (!game?.archipelago || !expiredColonies(game.archipelago, now).length) return null;
  const group = structuredClone(game.archipelago);
  const { current, group: next } = expireColonies(group, game, group.active, now);
  return toSaveSnapshot({ ...current, archipelago: next, player: game.player });
};

export type ServerCatchUpOptions = OfflineReplayFlags;

/**
 * `rules`: the server's copies of the rules to advance under (GS2, rev G4, `CatchUpRules`). A snapshot whose pins
 * change but which advances no time is still answered, so the stored revision carries them.
 */
export const catchUpSnapshot = async (
  snapshot: SaveSnapshot, now: number, options: ServerCatchUpOptions = {}, rules?: CatchUpRules
): Promise<CaughtUpSnapshot | null> => {
  const pinned = pinSnapshotRules(snapshot, rules);
  const game = fromSaveSnapshot(pinned);
  if (!game) return null;
  const caughtUp = await advanceOfflineGame(game, now, undefined, options);
  if (caughtUp === game && pinned === snapshot) return null;
  return { snapshot: toSaveSnapshot(caughtUp), summary: summarizeTimeAway(game, caughtUp, now) };
};

/**
 * Plausibility of an upload (D4.5) against the snapshot before it: every ware's growth within the islands'
 * production capacity for the elapsed time plus the ledger's credits, and the map-derived tree/ore bounds when
 * both snapshots decode. No violations when either snapshot is empty; a map that cannot be decoded only skips
 * those extra bounds, never the upload.
 */
export const checkPlausibility = async ({ after, before, credits, realSeconds }: {
  after: SaveSnapshot; before: SaveSnapshot; credits: Goods; realSeconds: number;
}): Promise<PlausibilityResult> => {
  const early = fromSaveSnapshot(before), late = fromSaveSnapshot(after);
  if (!early || !late) return { seconds: 0, violations: [] };
  const seconds = plausibilitySeconds(early, late, realSeconds);
  // A stored map that cannot be decoded (older build, damaged island row) only skips the extra bounds.
  const resources = await decodePlausibilityResources(before, after, seconds).catch(() => null);
  return checkGamePlausibility({ after: late, before: early, credits, realSeconds, resources: resources ?? undefined });
};
