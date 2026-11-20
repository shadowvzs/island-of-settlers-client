import type { WorkerNation } from "../../render-common/workers/worker-unit";

/**
 * A browser-only account from before online accounts (accounts table, 2026-10-12 .. 2026-10-22). Its game
 * stays in the slot keyed by its id until the retirement removes it (local-account-retirement.ts).
 */
export interface LocalAccountRow {
  createdAt: number;
  id: string;
  race: WorkerNation;
  username: string;
  usernameKey: string;
}

/** Boot value of the old local accounts: the account signed in on this browser (version 4 migration). */
export const CURRENT_ACCOUNT_KEY = "current-account";

/** The old local accounts of this browser (game-database.ts, game-local-storage.ts). */
export interface LocalAccountsDatabase {
  listAccounts(): Promise<LocalAccountRow[]>;
  /** One transaction: the accounts with their game rows and per-account boot values. */
  removeAccounts(ids: readonly string[]): Promise<void>;
}
