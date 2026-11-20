import { useLingui } from "@lingui/react";

import { AccountStatus } from "../form/account-status";
import { ACCOUNT_MESSAGES } from "../messages";
import { InlinePanel } from "./inline-panel";
import { SettingsButton } from "./settings-button";
import { useLeavePanel } from "./use-leave-panel";

interface LeavePanelProps {
  confirmLabel: string;
  /** Distinct per panel (it labels the panel). */
  id: string;
  question: string;
  /** Saves the game (after a running save) and leaves the page; false when the save failed. */
  onConfirm: () => Promise<boolean>;
  onClose: () => void;
}
/** Settings > Account > Log out or Switch save slot, confirmed in place (no browser dialog). */
export const LeavePanel = ({ confirmLabel, id, question, onClose, onConfirm }: LeavePanelProps) => {
  const { i18n } = useLingui();
  const { busy, busyLabel, confirmRef, status, onConfirmClick } = useLeavePanel(onConfirm);
  return (
    <InlinePanel id={id} question={question}>
      <div className="account-settings__row">
        <SettingsButton busyLabel={busyLabel} buttonRef={confirmRef} label={confirmLabel} onClick={onConfirmClick} />
        <SettingsButton disabled={busy} label={i18n._(ACCOUNT_MESSAGES.settings.cancel)} onClick={onClose} />
      </div>
      <AccountStatus className="account-settings__status" status={status} />
    </InlinePanel>
  );
};
