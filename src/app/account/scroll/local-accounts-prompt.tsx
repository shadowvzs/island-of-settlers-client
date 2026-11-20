import { useLingui } from "@lingui/react";

import { AccountStatus } from "../form/account-status";
import { ACCOUNT_MESSAGES } from "../messages";
import { getLocalAccountsLead, LOCAL_ACCOUNTS_NOTE, LOCAL_ACCOUNTS_TITLE } from "./helpers";
import type { LocalAccountsOptions } from "./scroll-pages";
import { ScrollButton, ScrollHeading } from "./scroll-parts";
import { useLocalAccountsPrompt } from "./use-local-accounts-prompt";

/** The old local accounts offer: export their saves (once), or not now. */
export const LocalAccountsPrompt = ({ removeOn, usernames, onExport, onLater }: LocalAccountsOptions) => {
  const { i18n } = useLingui();
  const { busy, status, onExportClick } = useLocalAccountsPrompt(onExport);
  return (
    <div className="account-scroll__sheet">
      <ScrollHeading
        lead={getLocalAccountsLead(usernames, removeOn, i18n)}
        title={LOCAL_ACCOUNTS_TITLE}
      />
      <div className="account-scroll__choices">
        <ScrollButton
          disabled={busy}
          label={ACCOUNT_MESSAGES.scroll.exportSaves}
          type="button"
          onClick={onExportClick}
        />
        <ScrollButton disabled={busy} label={ACCOUNT_MESSAGES.scroll.notNow} type="button" onClick={onLater} />
      </div>
      <AccountStatus className="account-scroll__status" status={status} />
      <p className="account-scroll__note">{i18n._(LOCAL_ACCOUNTS_NOTE)}</p>
    </div>
  );
};
