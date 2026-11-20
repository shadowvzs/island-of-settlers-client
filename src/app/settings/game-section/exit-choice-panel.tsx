import { useLingui } from "@lingui/react";

import { AccountStatus } from "../../account/form/account-status";
import { useFocusOnMount } from "../../account/form/use-focus-on-mount";
import { ACCOUNT_MESSAGES } from "../../account/messages";
import { InlinePanel } from "../../account/settings/inline-panel";
import { SettingsButton } from "../../account/settings/settings-button";
import type { useGameSection } from "./use-game-section";

interface ExitChoicePanelProps {
  model: ReturnType<typeof useGameSection>;
}
/** Exit game with automatic saving off (plan §7.3): Save to slot…, Leave without saving, Cancel. */
export const ExitChoicePanel = ({ model }: ExitChoicePanelProps) => {
  const { i18n } = useLingui();
  // Focus moves to the first choice (as Save and exit does), which also scrolls the question into view.
  const firstRef = useFocusOnMount<HTMLButtonElement>();
  return (
    <InlinePanel id="settings-exit-choice-question" question={model.text.manualExitQuestion}>
      <div className="account-settings__row">
        <SettingsButton buttonRef={firstRef} label={model.text.saveToSlot} onClick={model.onSaveToSlot} />
        <SettingsButton
          busyLabel={model.leaveBusyLabel}
          label={model.text.leaveWithoutSaving}
          onClick={model.onLeaveWithoutSaving}
        />
        <SettingsButton label={i18n._(ACCOUNT_MESSAGES.settings.cancel)} onClick={model.onClose} />
      </div>
      <AccountStatus className="account-settings__status" status={model.leaveStatus} />
    </InlinePanel>
  );
};
