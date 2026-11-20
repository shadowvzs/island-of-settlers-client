import { createIdentityClient } from "../account/identity-client";
import { detectBackend } from "../backend/backend-status";
import type { AdminPorts } from "./admin-ports";
import { readCampaignMapRecords } from "./campaign-maps";
import { createLocalSettingsPort } from "./local-ports";
import { createBrowserMaintenancePort } from "./maintenance/browser-maintenance-port";
import { createServerMaintenancePort } from "./maintenance/server-maintenance-port";
import { createAuthorizedFetch, createServerSettingsPort, createServerUsersPort } from "./server-ports";

/**
 * The Administration window's role check and data ports (plan §13.1). With a backend: the remembered session must
 * be an administrator (every admin route checks the role again on the server). Without one: only a development
 * build may edit this browser's local settings source, as the map editor's local mode does. Null = denied.
 */
export const openAdminSession = async (): Promise<AdminPorts | null> => {
  const backend = await detectBackend();
  if (!backend) {
    if (!import.meta.env.DEV) return null;
    return {
      browserMaintenance: createBrowserMaintenancePort(), campaignMaps: readCampaignMapRecords, maintenance: null,
      settings: createLocalSettingsPort(), users: null
    };
  }
  const identity = createIdentityClient({ identityUrl: backend.identityUrl });
  const account = await identity.resume();
  if (account?.role !== "admin") return null;
  const request = createAuthorizedFetch(identity);
  return {
    browserMaintenance: createBrowserMaintenancePort(),
    campaignMaps: readCampaignMapRecords,
    maintenance: createServerMaintenancePort(backend, request),
    settings: createServerSettingsPort(backend, request),
    users: createServerUsersPort(backend, request)
  };
};
