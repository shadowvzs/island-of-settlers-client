import { useLingui } from "@lingui/react";
import { useEffect, useState } from "react";

import { translateMessage } from "../../../shared/i18n/translate";
import type { AdminAccount } from "../admin-ports";
import type { MaintenanceCapabilities, MaintenancePort } from "../maintenance/maintenance-ports";
import { MAINTENANCE_MESSAGES as M } from "../maintenance/messages";
import { useConfirmRequest } from "../use-confirm-request";

/** Why M4 cannot run here: no server tools, capabilities not loaded or ADMIN_DESTRUCTIVE_ACTIONS unset. */
const resetBlock = (port: MaintenancePort | null, capabilities: MaintenanceCapabilities | null) => {
  if (!port || !capabilities) return { flag: "", kind: "unavailable" as const };
  const flag = capabilities.flags.destructiveActions;
  return flag.enabled ? null : { flag: flag.name, kind: "flag" as const };
};

/**
 * M4 from the Users list (plan §13.6): reset one account's progress after typing its display name exactly, with
 * the wallet as an extra choice. Administrators have no reset button (the server also refuses the caller's own).
 */
export const useAccountReset = (port: MaintenancePort | null) => {
  const { i18n } = useLingui();
  const confirm = useConfirmRequest();
  const [capabilities, setCapabilities] = useState<MaintenanceCapabilities | null>(null);

  useEffect(() => {
    if (!port) return undefined;
    let live = true;
    const run = async () => {
      const next = await port.capabilities().catch(() => null);
      if (live) setCapabilities(next);
    };
    void run();
    return () => { live = false; };
  }, [port]);

  const block = resetBlock(port, capabilities);
  const flagReason = block?.kind === "flag" ? translateMessage(i18n, M.reasons.flag, { flag: block.flag }) : "";

  const open = (account: AdminAccount) => {
    if (!port || block) return;
    const label = translateMessage(i18n, M.tools.M4, { name: account.displayName });
    confirm.open({
      confirmLabel: translateMessage(i18n, M.confirm.run, { tool: label }),
      expected: account.displayName,
      lines: [translateMessage(i18n, M.confirm.accountReset)],
      option: translateMessage(i18n, M.confirm.wallet),
      run: async wallet => {
        const result = await port.resetAccount(account.id, account.displayName, wallet);
        return translateMessage(i18n, M.results.accountReset, {
          attempts: result.campaignAttempts, progress: result.campaignProgress, slots: result.slots
        });
      },
      title: label
    });
  };

  return {
    available: Boolean(port),
    blocked: Boolean(block),
    confirm,
    label: (account: AdminAccount) => flagReason || translateMessage(i18n, M.tools.M4, { name: account.displayName }),
    open
  };
};
