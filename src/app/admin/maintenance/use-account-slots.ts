import type { MessageDescriptor } from "@lingui/core";
import { useEffect, useState } from "react";

import type { AdminAccount, UsersPort } from "../admin-ports";
import { errorText } from "../helpers";
import type { ConfirmRequestState } from "../use-confirm-request";
import { catchUpBlock } from "./helpers";
import type { AdminSlot, MaintenanceCapabilities, MaintenancePort } from "./maintenance-ports";
import { MAINTENANCE_MESSAGES as M } from "./messages";

type Translate = (descriptor: MessageDescriptor, values?: Record<string, unknown>) => string;

interface AccountSlotsOptions {
  capabilities: MaintenanceCapabilities | null;
  confirm: ConfirmRequestState;
  server: MaintenancePort | null;
  t: Translate;
  users: UsersPort | null;
  onChanged: () => Promise<void>;
}

const slotText = (slot: AdminSlot, t: Translate) => {
  const verified = slot.verifiedRevision ?? t(M.accounts.unverified);
  const text = t(M.accounts.slot, { name: slot.name, revision: slot.revision, slotNo: slot.slotNo, verified });
  return slot.flagged ? `${text} · ${t(M.accounts.flagged)}` : text;
};

/** M5/M6: one account's cloud slots with catch-up (confirmed) and the re-verify placeholder. */
export const useAccountSlots = ({ capabilities, confirm, onChanged, server, t, users }: AccountSlotsOptions) => {
  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [accountId, setAccountId] = useState("");
  const [error, setError] = useState("");
  const [slots, setSlots] = useState<AdminSlot[]>([]);

  useEffect(() => {
    if (!users || !server) return undefined;
    let live = true;
    const run = async () => {
      try {
        const list = await users.list();
        if (live) setAccounts(list);
      } catch (failure) {
        if (live) setError(errorText(failure));
      }
    };
    void run();
    return () => { live = false; };
  }, [server, users]);

  const loadSlots = async (id: string) => {
    setError("");
    try {
      setSlots(id && server ? await server.slots(id) : []);
    } catch (failure) {
      setError(errorText(failure));
    }
  };

  const select = (id: string) => {
    setAccountId(id);
    void loadSlots(id);
  };

  const catchUp = (slot: AdminSlot) => {
    if (!server || catchUpBlock(slot, capabilities)) return;
    const label = t(M.tools.M5, { slot: slot.slotNo });
    confirm.open({
      confirmLabel: t(M.confirm.run, { tool: label }), expected: null, lines: [t(M.confirm.catchUp)], option: null,
      run: async () => {
        const advanced = await server.catchUpSlot(accountId, slot.id);
        await Promise.all([loadSlots(accountId), onChanged()]);
        return advanced ? t(M.results.catchUpAdvanced) : t(M.results.catchUpUnchanged);
      },
      title: label
    });
  };

  const rows = slots.map(slot => {
    const block = catchUpBlock(slot, capabilities);
    return {
      catchUp: () => catchUp(slot),
      catchUpBlocked: Boolean(block),
      catchUpLabel: block ? t(M.reasons[block]) : t(M.tools.M5, { slot: slot.slotNo }),
      id: slot.id,
      text: slotText(slot, t),
      verifyLabel: `${t(M.tools.M6, { slot: slot.slotNo })}: ${t(M.reasons.placeholder)}`
    };
  });

  return {
    accountId,
    accounts: accounts.map(account => ({ id: account.id, name: account.displayName })),
    chooseLabel: t(M.accounts.choose),
    emptyText: accountId && !slots.length ? t(M.accounts.none) : "",
    error,
    placeholder: t(M.accounts.placeholder),
    rows,
    select
  };
};
