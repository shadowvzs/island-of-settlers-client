import type { HomelessRunEnd } from "../settlement/campaign-run-end";
import { TITLE_LANDING_KEY } from "./constants";
import { titleLandingRecord } from "./helpers";

/**
 * The landing of a run without a home crosses the reload to the title page as a session value (plan §7.6): the
 * run's end and the campaign's progress before it, so the title page can tell which maps became newly available.
 * Storage failures are ignored: the title page then simply shows its menu.
 */
export const rememberTitleLanding = ({ before, run }: HomelessRunEnd) => {
  const status = run.status === "running" ? "given-up" : run.status;
  const record = titleLandingRecord({ campaignId: run.campaignId, status }, before.campaignProgress);
  try {
    sessionStorage.setItem(TITLE_LANDING_KEY, JSON.stringify(record));
  } catch {
    // No session storage: no landing dialog.
  }
};

/** The stored landing once (it is shown once), never thrown. */
export const takeTitleLanding = () => {
  try {
    const json = sessionStorage.getItem(TITLE_LANDING_KEY);
    sessionStorage.removeItem(TITLE_LANDING_KEY);
    return json;
  } catch {
    return null;
  }
};
