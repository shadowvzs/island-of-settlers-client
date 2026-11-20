import { useLingui } from "@lingui/react";
import { useCallback, useEffect, useState } from "react";

import { translateMessage } from "../../../shared/i18n/translate";
import type { AccountStatusChange, AdminAccount, UsersPort } from "../admin-ports";
import { USER_LIST_LIMIT } from "../constants";
import { errorText } from "../helpers";
import type { MaintenancePort } from "../maintenance/maintenance-ports";
import { ADMIN_MESSAGES as M } from "../messages";
import { canResetProgress, replaceAccount, userRows } from "./helpers";
import { useAccountReset } from "./use-account-reset";

interface AccountListResult {
  accounts: AdminAccount[] | null;
  error: string;
}

const fetchAccounts = async (port: UsersPort): Promise<AccountListResult> => {
  try {
    return { accounts: await port.list(), error: "" };
  } catch (failure) {
    return { accounts: null, error: errorText(failure) };
  }
};

/** The Users placeholder: the first 100 accounts, ban/unban through the identity service and M4 (progress reset). */
export const useUsers = (port: UsersPort, maintenance: MaintenancePort | null) => {
  const { i18n } = useLingui();
  const [accounts, setAccounts] = useState<AdminAccount[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const reset = useAccountReset(maintenance);

  const apply = useCallback((result: AccountListResult) => {
    setAccounts(result.accounts);
    setError(result.error);
  }, []);

  useEffect(() => {
    let live = true;
    const run = async () => {
      const result = await fetchAccounts(port);
      if (live) apply(result);
    };
    void run();
    return () => { live = false; };
  }, [apply, port]);

  const load = async () => apply(await fetchAccounts(port));

  const changeStatus = async (accountId: string, change: AccountStatusChange) => {
    setBusyId(accountId);
    setError("");
    try {
      const changed = await port.setStatus(accountId, change);
      setAccounts(current => current && replaceAccount(current, changed));
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusyId(null);
    }
  };

  const list = accounts ?? [];
  const rows = userRows(list, translateMessage(i18n, M.users.never)).map((row, index) => ({
    ...row,
    actionIcon: row.action === "unban" ? "apply" as const : "ban" as const,
    actionLabel: row.action && translateMessage(i18n, M.users[row.action], { name: row.name }),
    busy: busyId === row.id,
    onReset: () => reset.open(list[index]!),
    resetLabel: reset.label(list[index]!),
    resettable: reset.available && canResetProgress(list[index]!)
  }));
  return {
    changeStatus,
    emptyText: accounts?.length === 0 ? translateMessage(i18n, M.users.empty) : "",
    error,
    headers: {
      lastSeen: translateMessage(i18n, M.users.lastSeen), name: translateMessage(i18n, M.users.name),
      role: translateMessage(i18n, M.users.role), status: translateMessage(i18n, M.users.status)
    },
    note: translateMessage(i18n, M.users.note, { limit: USER_LIST_LIMIT }),
    reload: load,
    reloadLabel: translateMessage(i18n, M.users.reload),
    reset: reset.confirm,
    resetBlocked: reset.blocked,
    rows
  };
};
