/** The administrator's campaign authoring routes and the map files beside them. */
export const CAMPAIGN_ADMIN_PATH = "/v1/campaign-admin";
export const CAMPAIGN_MAP_FILES_PATH = `${CAMPAIGN_ADMIN_PATH}/map-files`;

export const HTTP_NOT_FOUND = 404;
export const HTTP_CONFLICT = 409;

/** The synced record kinds in sync order (statistics are the server's own aggregates). */
export const CAMPAIGN_SYNC_KINDS = ["campaigns", "maps", "images"] as const;

/** Web storage key prefix of the sync base; the server's URL follows. */
export const CAMPAIGN_SYNC_BASE_KEY_PREFIX = "island-campaign-sync:";
