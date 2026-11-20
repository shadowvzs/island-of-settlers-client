import { useLingui } from "@lingui/react";

import { toBusyLabel } from "../form/helpers";
import { useFocusOnMount } from "../form/use-focus-on-mount";
import { useSubmitOnce } from "../form/use-submit-once";
import { ACCOUNT_MESSAGES } from "../messages";

/**
 * Leaving the game, confirmed in place: the confirm button reads "Saving…" while the game is saved; a failed
 * save keeps the player here. A successful leave loads another page, so the buttons stay busy.
 */
export const useLeavePanel = (leave: () => Promise<boolean>) => {
  const { i18n } = useLingui();
  const confirmRef = useFocusOnMount<HTMLButtonElement>();
  const form = useSubmitOnce(i18n._(ACCOUNT_MESSAGES.settings.leaveFailed), async () => {
    if (await leave()) return true;
    throw new Error(i18n._(ACCOUNT_MESSAGES.settings.saveFailed));
  });
  return {
    busy: form.busy,
    busyLabel: toBusyLabel(form.busy, i18n._(ACCOUNT_MESSAGES.settings.saving)),
    confirmRef,
    status: form.status,
    onConfirmClick: () => void form.submit()
  };
};
