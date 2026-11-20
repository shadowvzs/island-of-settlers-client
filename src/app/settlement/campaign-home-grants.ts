import {
  type CampaignGrant, isGrantPending, withoutPendingGrants, withPendingGrant
} from "../../shared/campaign/campaign-grants";
import type { CampaignRunState } from "../../shared/campaign/campaign-run";
import { applyCampaignGrants, type Archipelago } from "../../shared/settlement/archipelago";
import type { Goods } from "../../shared/settlement/settlement-types";
import type { createArchivedIslandAccess } from "./archived-island-access";

type ArchiveAccess = Pick<ReturnType<typeof createArchivedIslandAccess>, "isMutating" | "updateArchipelago">;

interface CampaignHomeGrantsOptions {
  archive: ArchiveAccess;
  /** True while a session transition (travel, import, resume, another archive write) runs. */
  busy(): boolean;
  run(): CampaignRunState | undefined;
  setRun(run: CampaignRunState): void;
}

/** Seconds between retries of pending grants while a run is on screen. */
export const GRANT_RETRY_SECONDS = 2;

/**
 * Home-bound grants of the campaign run on screen (owner decision 2026-11-11, point 1). A grant is first kept
 * pending in the run's save, then written into `archipelago.rewards`; a refused write (busy, cancelled, failed)
 * leaves it pending. It is retried after the blocking transition (the frame update), folded into the next save
 * (`fold`, also on the way home: travel captures through the same group), and retried on the first frame after a
 * boot. The marker's applied ids make every retry idempotent. Live only: the run's simulation and its replay never see a grant.
 */
export const createCampaignHomeGrants = (options: CampaignHomeGrantsOptions) => {
  // A run booted with pending grants retries on its first frame (`update`), once the boot has settled.
  let writing = false, retryAge = GRANT_RETRY_SECONDS;
  const pending = () => options.run()?.pendingGrants ?? [];
  const settle = (ids: readonly string[]) => {
    const run = options.run();
    if (run) options.setRun(withoutPendingGrants(run, ids));
  };
  /** Writes every pending grant in one serialized archipelago write; true when nothing is left pending. */
  const flush = async (): Promise<boolean> => {
    const grants = pending();
    if (writing || !grants.length) return !grants.length;
    writing = true;
    let written = false;
    try {
      const result = await options.archive.updateArchipelago("home-grant", group =>
        ({ group: applyCampaignGrants(group, grants), value: true }));
      written = result.ok;
    } finally { writing = false; }
    if (!written) return false;
    settle(grants.map(grant => grant.id));
    // Grants queued while this write ran follow at once.
    return flush();
  };
  /** Queues one grant; a repeated id is ignored. */
  const queue = (id: string, goods: Readonly<Goods>) => {
    const run = options.run();
    if (!run) return writeWithoutRun(options.archive, { goods: { ...goods }, id });
    if (isGrantPending(run, id)) return flush();
    options.setRun(withPendingGrant(run, { goods: { ...goods }, id }));
    return flush();
  };
  /**
   * Folds the pending grants into the group about to be saved, so the save writes them with the run that drops
   * them. Skipped while an archive write runs (that write owns the group).
   */
  const fold = (group: Archipelago) => {
    const grants = pending();
    if (!grants.length || writing || options.archive.isMutating()) return group;
    settle(grants.map(grant => grant.id));
    return applyCampaignGrants(group, grants);
  };
  /** Retries pending grants once the blocking transition has finished. */
  const update = (seconds: number) => {
    if (!pending().length || writing) return;
    retryAge += seconds;
    if (retryAge < GRANT_RETRY_SECONDS || options.busy()) return;
    retryAge = 0;
    void flush();
  };
  return { flush, fold, queue, update };
};

/** A grant without a run on screen (no run state to hold it): written directly, as before C12. */
const writeWithoutRun = async (archive: ArchiveAccess, grant: CampaignGrant) => {
  const result = await archive.updateArchipelago("home-grant", group =>
    ({ group: applyCampaignGrants(group, [grant]), value: true }));
  return result.ok;
};
