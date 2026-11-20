import type { AccountStatusChange, AdminAccount } from "../admin-ports";

/** A row of the Users placeholder: the account, its last-seen text and the one status action it allows. */
export interface UserRow {
  action: AccountStatusChange | null;
  id: string;
  lastSeen: string;
  name: string;
  role: string;
  status: string;
}

/** Ban only an active non-administrator; unban only a banned account; nothing else changes here. */
export const statusAction = (account: AdminAccount): AccountStatusChange | null => {
  if (account.status === "banned") return "unban";
  return account.status === "active" && account.role !== "admin" ? "ban" : null;
};

export const userRows = (accounts: readonly AdminAccount[], never: string): UserRow[] => accounts.map(account => ({
  action: statusAction(account),
  id: account.id,
  lastSeen: account.lastSeenAt ? new Date(account.lastSeenAt).toLocaleString() : never,
  name: account.displayName,
  role: account.role,
  status: account.status
}));

/** The list with one account replaced by the server's answer. */
export const replaceAccount = (accounts: readonly AdminAccount[], changed: AdminAccount) =>
  accounts.map(account => account.id === changed.id ? changed : account);

/** M4 is offered for every non-administrator account that still exists (the server checks again). */
export const canResetProgress = (account: AdminAccount) => account.role !== "admin" && account.status !== "deleted";
