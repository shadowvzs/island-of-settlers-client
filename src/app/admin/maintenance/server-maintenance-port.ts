import type { Campaign } from "../../../../../island-of-settlers-shared/src/campaign/campaign-model";
import type { BackendConfig } from "../../backend/backend-config";
import { type AuthorizedFetch, jsonBody, readJson } from "../server-ports";
import type {
  AccountResetResult, AdminSlot, AuditEntry, CampaignSummary, MaintenanceCapabilities, MaintenancePort,
  StarterHistory, StarterRevision
} from "./maintenance-ports";

interface StarterRecord {
  createdAt?: string;
  hash: string;
  mapId: string;
  metadata: { name: string };
  revision: number;
}

const starterRevision = (record: StarterRecord): StarterRevision => ({
  createdAt: record.createdAt ?? null, hash: record.hash, mapId: record.mapId, name: record.metadata.name,
  revision: record.revision
});

const campaignSummary = (campaign: Campaign): CampaignSummary => ({
  id: campaign.id, name: campaign.name.en || campaign.id, revision: campaign.revision, state: campaign.state
});

const accountPath = (accountId: string) => `/v1/admin/maintenance/accounts/${encodeURIComponent(accountId)}`;

/**
 * The Maintenance tab over the API (plan §13.6): its own `/v1/admin/maintenance` routes plus the existing debug,
 * appearance, campaign-admin and starter routes. Every route checks the administrator role on the server.
 */
export const createServerMaintenancePort = (backend: BackendConfig, request: AuthorizedFetch): MaintenancePort => {
  const api = (path: string, init?: RequestInit) => request(`${backend.apiUrl}${path}`, init);
  const post = (path: string, body: unknown = {}) => api(path, { method: "POST", ...jsonBody(body) });
  return {
    auditLog: async () => (await readJson<{ entries: AuditEntry[] }>(await api("/v1/admin/maintenance/audit")))
      .entries,
    campaigns: async () => (await readJson<{ records: Campaign[] }>(await api("/v1/campaign-admin/campaigns")))
      .records.map(campaignSummary),
    capabilities: async () => readJson<MaintenanceCapabilities>(await api("/v1/admin/maintenance")),
    catchUpSlot: async (accountId, slotId) => (await readJson<{ advanced: boolean }>(
      await post(`${accountPath(accountId)}/slots/${encodeURIComponent(slotId)}/catch-up`))).advanced,
    clearMySaves: async () => (await readJson<{ cleared: number }>(await post("/v1/debug/saves/clear"))).cleared,
    globalWinter: async () => (await readJson<{ globalWinter: boolean }>(await api("/v1/appearance"))).globalWinter,
    recreateDatabase: async confirm => {
      await readJson(await post("/v1/admin/maintenance/database/recreate", { confirm }));
    },
    resetAccount: async (accountId, confirm, wallet) =>
      readJson<AccountResetResult>(await post(`${accountPath(accountId)}/reset`, { confirm, wallet })),
    resetGameData: async confirm => {
      await readJson(await post("/v1/admin/maintenance/game-data/reset", { confirm }));
    },
    rollbackStarter: async (revision, expectedHash) => {
      await readJson(await post("/v1/maps/starter/rollback",
        { expectedHash, mapId: revision.mapId, revision: revision.revision }));
    },
    setCampaignState: async (campaign, state) => {
      await readJson(await post(`/v1/admin/maintenance/campaigns/${encodeURIComponent(campaign.id)}/state`,
        { revision: campaign.revision, state }));
    },
    setGlobalWinter: async globalWinter => (await readJson<{ globalWinter: boolean }>(
      await api("/v1/debug/appearance", { method: "PUT", ...jsonBody({ globalWinter }) }))).globalWinter,
    slots: async accountId => (await readJson<{ slots: AdminSlot[] }>(await api(`${accountPath(accountId)}/slots`)))
      .slots,
    starterHistory: async (): Promise<StarterHistory> => {
      const body = await readJson<{ current: StarterRecord | null; revisions: StarterRecord[] }>(
        await api("/v1/maps/starter/history"));
      return { current: body.current && starterRevision(body.current), revisions: body.revisions.map(starterRevision) };
    }
  };
};
