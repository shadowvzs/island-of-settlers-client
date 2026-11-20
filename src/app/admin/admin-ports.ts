import type { CampaignMap } from "../../../../island-of-settlers-shared/src/campaign/campaign-model";
import type { GameSettings } from "../../../../island-of-settlers-shared/src/game-settings/game-settings";
import type { BrowserMaintenancePort, MaintenancePort } from "./maintenance/maintenance-ports";

/**
 * What the Administration window reads and writes (plan §13.1): the server routes (GS1 settings, identity
 * accounts) when an administrator is signed in, else this browser's local settings source (GS3a, offline builds).
 */
export type SettingsStore = "local" | "server";

export interface SettingsSnapshot {
  revision: string;
  settings: GameSettings;
}

export interface RevisionInfo {
  /** ISO time; null for the built-in default (`legacy`). */
  createdAt: string | null;
  /** The administrator's account id; null for the built-in default. */
  createdBy: string | null;
  revision: string;
}

export type SaveSettingsResult =
  | { ok: true; snapshot: SettingsSnapshot; warnings: string[] }
  | { messages: string[]; ok: false };

export interface SettingsPort {
  load(): Promise<SettingsSnapshot>;
  /** The current revision's author and time; null without a history (local store). */
  latestRevision(): Promise<RevisionInfo | null>;
  save(settings: GameSettings): Promise<SaveSettingsResult>;
  store: SettingsStore;
}

export type AccountStatus = "active" | "banned" | "deleted" | "deletion_pending";
export type AccountStatusChange = "ban" | "unban";

export interface AdminAccount {
  displayName: string;
  id: string;
  lastSeenAt: string | null;
  role: "admin" | "moderator" | "player";
  status: AccountStatus;
}

export interface UsersPort {
  list(): Promise<AdminAccount[]>;
  /** The changed account; throws an Error with the server's message when refused. */
  setStatus(accountId: string, change: AccountStatusChange): Promise<AdminAccount>;
}

export interface AdminPorts {
  /** M11/M12: this browser's caches and game data (with and without a server). */
  browserMaintenance: BrowserMaintenancePort;
  /** The campaign map records this browser holds (the editors' store), for the mode-warning counts. */
  campaignMaps(): Promise<CampaignMap[]>;
  /** The server maintenance tools (plan §13.6); null on a local store. */
  maintenance: MaintenancePort | null;
  settings: SettingsPort;
  /** Null on a local store (no accounts without a server). */
  users: UsersPort | null;
}
