import { leaveAfterSaving } from "../../account/account-session";
import { type CloudSession, endCloudSession } from "../../cloud/cloud-boot";
import { titlePageUrl } from "../../game-settings/session-mode";
import type { SaveCoordinator } from "../../save-store/save-coordinator";

interface ExitGameOptions {
  cloud: CloudSession | null;
  saving: Pick<SaveCoordinator, "flush" | "setPaused" | "stop"> | null;
}

/**
 * Exit game (plan §7.6): the working slot is saved (a failed save keeps the player in the game with the save
 * error), a signed-in slot's lease ends, then the page reloads to the title page: the reload frees GPU and worker
 * memory and reuses the tested boot path. With automatic saving off the Game section asks "Save to slot… / Leave
 * without saving" instead (SAVE-SLOTS); this flush serves sessions without slots.
 */
export const createExitGame = ({ cloud, saving }: ExitGameOptions) => () => leaveAfterSaving(
  saving,
  async () => { if (cloud) await endCloudSession(cloud).catch(() => undefined); },
  () => location.assign(titlePageUrl(location.href))
);
