import type { I18n } from "@lingui/core";

import { translateMessage } from "../../../shared/i18n/translate";
import { ACCOUNT_MESSAGES } from "../messages";

/** The signed-in player's actions in Settings > Account (account-session.ts). */
export interface AccountSettingsOptions {
  displayName: string;
  /** Saves the game (after a running save), ends the session and returns to the start scroll. */
  logOut: () => Promise<boolean>;
  /** Saves the game, ends this slot's session and opens the slot choice (cloud saves only). */
  switchSlot?: () => Promise<boolean>;
}

export const getSignedInHint = (displayName: string, i18n?: I18n) =>
  translateMessage(i18n, ACCOUNT_MESSAGES.settings.signedIn, { displayName });
