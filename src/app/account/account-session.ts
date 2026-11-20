import type { SaveCoordinator } from "../save-store/save-coordinator";
import type { PlayerAccount } from "./account-boot";
import type { AccountSettingsOptions } from "./settings/helpers";

type LeaveSaving = Pick<SaveCoordinator, "flush" | "setPaused" | "stop"> | null;

/**
 * Leaving the running game (Log out, Switch save slot, Exit game): save after a running save; a failed save keeps
 * the player here (false). Then saving stops for good, `end` closes what must close, and `leave` loads the page.
 */
export const leaveAfterSaving = async (saving: LeaveSaving, end: () => Promise<void>, leave: () => void) => {
  saving?.setPaused(true);
  if (saving && !(await saving.flush("logout"))) {
    saving.setPaused(false);
    return false;
  }
  saving?.stop();
  await end();
  leave();
  return true;
};

interface AccountSessionOptions {
  /** Leaves the game for the start scroll (a page load). */
  leave: () => void;
  player: PlayerAccount;
  /** Ends this device's cloud slot session (the save API lease, the tab's slot), before leaving the page. */
  releaseSession?: () => Promise<void>;
  saving: LeaveSaving;
}

/**
 * Settings > Account > Log out and Switch save slot: save the game (after a running save); a failed save keeps
 * the player here. Then saving stops for good, the slot's session ends (and for Log out the identity session),
 * and the page returns to the start, where the remembered sign-in shows the slot choice.
 */
export const createAccountSession = ({ leave, player, releaseSession, saving }: AccountSessionOptions) => {
  const leaveWith = (end: () => Promise<void>) => leaveAfterSaving(saving, end, leave);
  const endSlot = async () => { await releaseSession?.().catch(() => undefined); };
  const settings: AccountSettingsOptions = {
    displayName: player.account.displayName,
    logOut: () => leaveWith(async () => {
      await endSlot();
      await player.identity.logout();
    }),
    switchSlot: releaseSession && (() => leaveWith(endSlot))
  };
  return { settings };
};
