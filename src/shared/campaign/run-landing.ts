import {
  type GameSettings, hasHomeIsland
} from "../../../../island-of-settlers-shared/src/game-settings/game-settings";
import type { CampaignMapStatus } from "../../../../island-of-settlers-shared/src/script/engine/home-rewards";
import type { CampaignRunStatus } from "./campaign-run";

/**
 * Where the player lands after a campaign run ended (plan §7.6, lane GS3a; the title page and the dialog are GS3b).
 * Pure: the settings' `afterMap`, the run's end and the campaign's map statuses before and after the end decide.
 */
export type RunLanding =
  | { kind: "home" }
  | { campaignId: string; kind: "selection" }
  /**
   * The "after a map" dialog: Next map only when exactly one map became available (`nextMapId`), "Choose your path"
   * on a fork (`forked`), neither when the campaign is complete; Campaign selection and Exit game always.
   */
  | { campaignId: string; forked: boolean; kind: "exitChoice"; nextMapId: string | null };

type MapStatuses = ReadonlyMap<string, CampaignMapStatus>;

const newlyAvailable = (before: MapStatuses, after: MapStatuses) =>
  [...after].filter(([mapId, status]) => status === "available" && before.get(mapId) !== "available")
    .map(([mapId]) => mapId);

const homeOrSelection = (settings: GameSettings, campaignId: string): RunLanding =>
  hasHomeIsland(settings) ? { kind: "home" } : { campaignId, kind: "selection" };

/** The landing after a run; a defeat or give-up never opens a new map: home with one, else the selection. */
export const landingAfterRun = (
  settings: GameSettings, run: { campaignId: string; status: CampaignRunStatus }, before: MapStatuses,
  after: MapStatuses
): RunLanding => {
  const { campaignId } = run;
  if (run.status !== "won") return homeOrSelection(settings, campaignId);
  if (settings.afterMap === "home") return homeOrSelection(settings, campaignId);
  if (settings.afterMap === "campaignSelect") return { campaignId, kind: "selection" };
  const opened = newlyAvailable(before, after);
  const nextMapId = opened.length === 1 ? opened[0]! : null;
  return { campaignId, forked: opened.length > 1, kind: "exitChoice", nextMapId };
};
