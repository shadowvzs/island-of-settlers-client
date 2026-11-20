import { useLingui } from "@lingui/react";

import { ACCOUNT_MESSAGES } from "../messages";
import { type AccountSettingsOptions, getSignedInHint } from "./helpers";
import { LeavePanel } from "./leave-panel";
import { SettingsButton } from "./settings-button";
import { useAccountSettings } from "./use-account-settings";

import "./account-settings.css";

/** Settings > Account: who is signed in, Switch save slot and Log out (confirmed in place, no browser dialog). */
export const AccountSettings = ({ displayName, logOut, switchSlot }: AccountSettingsOptions) => {
  const { i18n } = useLingui();
  const { openPanel, panelKey, closePanel, onOpen } = useAccountSettings();
  return (
    <div className="account-settings">
      <p className="settings-panel__hint">{getSignedInHint(displayName, i18n)}</p>
      <div className="account-settings__actions">
        {switchSlot && (
          <SettingsButton
            label={i18n._(ACCOUNT_MESSAGES.settings.switchSlot)}
            onClick={() => onOpen("switchSlot")}
          />
        )}
        <SettingsButton label={i18n._(ACCOUNT_MESSAGES.settings.logOut)} onClick={() => onOpen("logOut")} />
      </div>
      {openPanel === "switchSlot" && switchSlot && (
        <LeavePanel
          confirmLabel={i18n._(ACCOUNT_MESSAGES.settings.saveAndChoose)}
          id="account-switch-question"
          key={panelKey}
          question={i18n._(ACCOUNT_MESSAGES.settings.switchQuestion)}
          onClose={closePanel}
          onConfirm={switchSlot}
        />
      )}
      {openPanel === "logOut" && (
        <LeavePanel
          confirmLabel={i18n._(ACCOUNT_MESSAGES.settings.saveAndLogOut)}
          id="account-logout-question"
          key={panelKey}
          question={i18n._(ACCOUNT_MESSAGES.settings.logOutQuestion)}
          onClose={closePanel}
          onConfirm={logOut}
        />
      )}
      <p className="settings-panel__hint">{i18n._(ACCOUNT_MESSAGES.settings.onlineHint)}</p>
    </div>
  );
};
