import { SHORT_ID_LENGTH } from "../constants";
import { BROWSER_LOG_LIMIT, type ToolSpec } from "./constants";
import type {
  AdminSlot, AuditEntry, CampaignState, CampaignSummary, MaintenanceCapabilities, StarterHistory, StarterRevision
} from "./maintenance-ports";

/** Why a tool cannot run: its server flag is unset (with the flag's name), it is a placeholder, or nothing. */
export type ToolBlock = { flag: string; kind: "flag" } | { kind: "placeholder" } | null;

export const toolBlock = (spec: ToolSpec, capabilities: MaintenanceCapabilities | null): ToolBlock => {
  if (spec.placeholder) return { kind: "placeholder" };
  if (!spec.flag || !capabilities) return null;
  const flag = capabilities.flags[spec.flag];
  return flag.enabled ? null : { flag: flag.name, kind: "flag" };
};

/** The exact text the confirmation dialog expects, or null for a plain confirmation. */
export const expectedConfirmation = (spec: ToolSpec, capabilities: MaintenanceCapabilities | null) => {
  if (spec.confirm === "host") return capabilities?.confirmHost ?? null;
  return spec.confirm;
};

export interface BrowserLogEntry {
  action: string;
  at: string;
}

const parseBrowserLog = (value: string | null): BrowserLogEntry[] => {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as BrowserLogEntry[] : [];
  } catch {
    return [];
  }
};

/** The browser log with `entry` appended, newest last, at most BROWSER_LOG_LIMIT entries (JSON). */
export const appendBrowserLog = (previous: string | null, entry: BrowserLogEntry) =>
  JSON.stringify([...parseBrowserLog(previous), entry].slice(-BROWSER_LOG_LIMIT));

export const shortId = (id: string) => id.slice(0, SHORT_ID_LENGTH);

export interface AuditRowView {
  action: string;
  id: string;
  result: string;
  target: string;
  when: string;
  who: string | null;
}

const paramsText = (params: AuditEntry["params"]) =>
  Object.entries(params).map(([key, value]) => `${key}=${String(value)}`).join(", ");

/** Audit rows for the table; `who` null = no session (the view shows "not signed in"). */
export const auditRows = (entries: readonly AuditEntry[]): AuditRowView[] => entries.map(entry => {
  const params = paramsText(entry.params);
  return {
    action: params ? `${entry.action} (${params})` : entry.action,
    id: entry.id,
    result: entry.result,
    target: entry.target ?? "",
    when: new Date(entry.at).toLocaleString(),
    who: entry.adminAccount && shortId(entry.adminAccount)
  };
});

export interface CampaignRowModel {
  campaign: CampaignSummary;
  nextState: CampaignState;
}

/** Each campaign with the state its one action switches to (Ready ↔ Draft). */
export const campaignRows = (campaigns: readonly CampaignSummary[]): CampaignRowModel[] =>
  campaigns.map(campaign => ({ campaign, nextState: campaign.state === "ready" ? "draft" : "ready" }));

export interface StarterRowModel {
  current: boolean;
  revision: StarterRevision;
}

/** Starter revisions, newest first; the current one has no rollback. */
export const starterRows = (history: StarterHistory | null): StarterRowModel[] => {
  if (!history) return [];
  const current = history.current;
  return [...history.revisions]
    .sort((first, second) => second.revision - first.revision)
    .map(revision => ({
      current: current !== null && current.mapId === revision.mapId && current.revision === revision.revision,
      revision
    }));
};

/** Why a slot cannot be caught up (M5), or null: no catch-up on this server, or no stored build. */
export const catchUpBlock = (slot: AdminSlot, capabilities: MaintenanceCapabilities | null) => {
  if (!capabilities?.catchUp) return "noCatchUp" as const;
  return slot.sourceVersion ? null : "noVersion" as const;
};
