/** What the Maintenance tab reads and does (plan §13.6, M1–M12). Server tools need a signed-in administrator. */

export interface ServerFlag {
  enabled: boolean;
  /** The environment variable that registers the routes (`DEBUG_DATABASE_RESET`, `ADMIN_DESTRUCTIVE_ACTIONS`). */
  name: string;
}

export interface MaintenanceCapabilities {
  catchUp: boolean;
  /** The host name the server expects as the typed confirmation of M1/M2. */
  confirmHost: string;
  flags: { databaseReset: ServerFlag; destructiveActions: ServerFlag };
}

export interface AuditEntry {
  action: string;
  adminAccount: string | null;
  at: string;
  id: string;
  params: Record<string, boolean | number | string>;
  result: string;
  target: string | null;
}

export interface AdminSlot {
  flagged: boolean;
  id: string;
  name: string;
  revision: number;
  slotNo: number;
  sourceVersion: string | null;
  updatedAt: string;
  verifiedRevision: number | null;
}

export interface AccountResetResult {
  campaignAttempts: number;
  campaignProgress: number;
  slots: number;
  wallet: boolean;
}

export type CampaignState = "draft" | "ready";

export interface CampaignSummary {
  id: string;
  name: string;
  revision: number;
  state: CampaignState;
}

export interface StarterRevision {
  createdAt: string | null;
  hash: string;
  mapId: string;
  name: string;
  revision: number;
}

export interface StarterHistory {
  current: StarterRevision | null;
  revisions: StarterRevision[];
}

export interface MaintenancePort {
  auditLog(): Promise<AuditEntry[]>;
  campaigns(): Promise<CampaignSummary[]>;
  capabilities(): Promise<MaintenanceCapabilities>;
  /** M5: answers whether the slot advanced. */
  catchUpSlot(accountId: string, slotId: string): Promise<boolean>;
  /** M7: the number of removed slots. */
  clearMySaves(): Promise<number>;
  globalWinter(): Promise<boolean>;
  /** M2 (typed host name). */
  recreateDatabase(confirm: string): Promise<void>;
  /** M4 (typed display name). */
  resetAccount(accountId: string, confirm: string, wallet: boolean): Promise<AccountResetResult>;
  /** M1 (typed host name). */
  resetGameData(confirm: string): Promise<void>;
  /** M9: points the starter back at an immutable revision. */
  rollbackStarter(revision: StarterRevision, expectedHash: string | null): Promise<void>;
  setCampaignState(campaign: CampaignSummary, state: CampaignState): Promise<void>;
  /** M10. */
  setGlobalWinter(enabled: boolean): Promise<boolean>;
  slots(accountId: string): Promise<AdminSlot[]>;
  starterHistory(): Promise<StarterHistory>;
}

/** M11/M12: this browser's data; available with and without a server. */
export interface BrowserMaintenancePort {
  clearCaches(): Promise<void>;
  /** Deletes the whole local game database (local accounts too); the page reloads afterwards. */
  recreateDatabase(): Promise<void>;
  /** Every browser slot goes; the settings source and the maintenance log stay. */
  resetGames(): Promise<void>;
}
