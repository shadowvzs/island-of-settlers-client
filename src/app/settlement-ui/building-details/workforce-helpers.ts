import type { I18n } from "@lingui/core";
import { settlerByJob, settlerTool } from "@shared/catalog";

import { translateMessage } from "../../../shared/i18n/translate";
import { resolveAssetUrl } from "../../content/asset-url";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import { compareWorkerJobs } from "../worker-order";

/** Jobs without their own portrait (catalog icon) show a carrier with their tool as a badge. */
const FALLBACK_PORTRAIT_JOB = "Carrier";

export const getWorkforceInventoryEntries = (
  workforce: Readonly<Record<string, number>> = {},
  availableSettlers = 0,
  i18n?: I18n
) => [
  { job: "available", label: translateMessage(i18n, M.details.workforce.idle), count: availableSettlers },
  { job: "Carrier", label: translateMessage(i18n, M.details.workforce.carriers), count: workforce.Carrier ?? 0 },
  ...Object.entries(workforce)
    .filter(([job, count]) => job !== "Carrier" && count > 0)
    .sort(([left], [right]) => compareWorkerJobs(left, right))
    .map(([job, count]) => ({ job, label: job, count }))
];

/** The job's own portrait (mounts show the horse render), or undefined. */
const ownPortrait = (job: string) => {
  const entry = settlerByJob(job);
  return entry?.icon && resolveAssetUrl(entry.icon, { key: entry.key });
};

/** Native job portrait; jobs without one show the carrier. */
export const getWorkerPortraitSource = (job: string) => ownPortrait(job) ?? ownPortrait(FALLBACK_PORTRAIT_JOB);

/** The tool badge of a job without its own portrait; null otherwise. */
const getWorkerToolBadge = (job: string) => {
  if (ownPortrait(job)) return null;
  return settlerTool(job) ?? null;
};

/** One settlers cell: counts as text, accessible name and the portrait / badge to draw. */
export const getWorkforceCells = (
  workforce?: Readonly<Record<string, number>>, availableSettlers?: number, i18n?: I18n
) =>
  getWorkforceInventoryEntries(workforce, availableSettlers, i18n).map(({ count, job, label }) => ({
    badge: getWorkerToolBadge(job),
    count: String(count),
    job,
    label,
    title: translateMessage(i18n, M.details.workforce.count, { count, label })
  }));
