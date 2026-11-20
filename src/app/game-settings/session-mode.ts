import { DEFAULT_AUTOSAVE_MINUTES } from "../../../../island-of-settlers-shared/src/game-settings/constants";
import {
  type GameSettings, hasHomeIsland
} from "../../../../island-of-settlers-shared/src/game-settings/game-settings";
import {
  type EffectiveSaving, effectiveSaving, showsMenuBeforePlay
} from "../../../../island-of-settlers-shared/src/game-settings/setting-availability";
import { continuesLastGame, startScrollUrl } from "../account/account-boot";
import {
  GUEST_SLOT, GUEST_STORY_SLOT, OFFLINE_HOME_SLOT, OFFLINE_STORY_SLOT
} from "../settlement/game-slot-rows";
import { CONTINUE_PARAM, TITLE_PARAM } from "./constants";

/**
 * What the boot derives from the deployment's settings (plan §5.6, §7.2, §7.3; lane GS3a). Null settings are
 * today's game: online, with a home, automatic saving every 2 minutes.
 */

/** Offline mode: no sign-in, lease, verified save or online feature (until OFFLINE-CLOUD adds optional sign-in). */
export const isOfflineMode = (settings: GameSettings | null) => settings?.connectivity === "offline";

/** True when the deployment plays without a home island (campaigns only). */
export const playsWithoutHome = (settings: GameSettings | null) => settings !== null && !hasHomeIsland(settings);

/**
 * The browser working slot of a game without a cloud slot: home and no-home rows never share one (rev H1), and
 * offline rows never share one with browser-only online play.
 */
export const browserWorkingSlot = (settings: GameSettings | null) => {
  const home = !playsWithoutHome(settings);
  if (isOfflineMode(settings)) return home ? OFFLINE_HOME_SLOT : OFFLINE_STORY_SLOT;
  return home ? GUEST_SLOT : GUEST_STORY_SLOT;
};

/** The save coordinator's triggers: the interval in minutes (0 = none) and whether key events save. */
export interface CoordinatorSaving {
  events: boolean;
  minutes: number;
}

/** Tool runs: no interval saves; events and tab hiding still save (today). */
const TOOL_RUN_SAVING: CoordinatorSaving = Object.freeze({ events: true, minutes: 0 });
const TODAY_SAVING: CoordinatorSaving = Object.freeze({ events: true, minutes: DEFAULT_AUTOSAVE_MINUTES });
/** Automatic saving off (rev I22): only the technical triggers (tab hide, page hide, travel) write. */
const MANUAL_SAVING: CoordinatorSaving = Object.freeze({ events: false, minutes: 0 });

/** Which store keeps this browser's game: IndexedDB, or the localStorage fallback that cannot hold slot copies. */
export type BrowserBackend = "indexeddb" | "local-storage";

/** Why Save/Load slots are off although the settings allow them. */
export type SlotsBlocked = "indexedDb";

export interface BrowserSaving extends EffectiveSaving {
  /** Set when the settings allow slots but this session cannot keep them. */
  slotsBlocked?: SlotsBlocked;
}

/** Today's game (no settings): automatic saving every 2 minutes, no slots. */
const TODAY_EFFECTIVE: BrowserSaving = Object.freeze({ autosave: true, autosaveMinutes: DEFAULT_AUTOSAVE_MINUTES,
  slots: false });

/**
 * The saving this session applies (plan §5.5, §5.6): the effective switches (D1, D1b, D2, D3), then the session's
 * limits. A signed-in cloud slot (online without a home, D1b) keeps its Save/Load copies in the server's unverified
 * store (OFFLINE-CLOUD) and always saves automatically: the verified slot stays current. The localStorage fallback
 * cannot hold copies: slots are off there and automatic saving is forced on, never losing progress (rev I12).
 */
export const browserSaving = (
  settings: GameSettings | null, backend: BrowserBackend, signedIn = false
): BrowserSaving => {
  if (!settings) return TODAY_EFFECTIVE;
  const saving = effectiveSaving(settings);
  if (!saving.slots) return saving;
  if (signedIn) return { ...saving, autosave: true };
  if (backend === "local-storage") return { ...saving, autosave: true, slots: false, slotsBlocked: "indexedDb" };
  return saving;
};

/** The coordinator's triggers under the session's saving (D1, D1b, D3 and the fallback rule resolved). */
export const coordinatorSaving = (
  settings: GameSettings | null, toolRun: boolean, backend: BrowserBackend = "indexeddb", signedIn = false
): CoordinatorSaving => {
  if (toolRun) return TOOL_RUN_SAVING;
  if (!settings) return TODAY_SAVING;
  const saving = browserSaving(settings, backend, signedIn);
  return saving.autosave ? { events: true, minutes: saving.autosaveMinutes } : MANUAL_SAVING;
};

/**
 * A title page exists (plan §7.2 step 3; owner 2026-11-13): always without a home or in offline mode, and online
 * with a home while the admin's "game menu before play" switch is on (absent = on). Exit game returns to it. No
 * settings (tool runs, a build that knows none) keep booting straight into the island.
 */
export const hasTitlePage = (settings: GameSettings | null) => settings !== null && showsMenuBeforePlay(settings);

/**
 * Whether the boot shows the title page (GS3b renders it; plan §7.2 step 3): wherever one exists (`hasTitlePage`), or
 * when `?title=1` asks. Tool runs, `?map=`/`?seed=` launches and reloads of the running game (`reloadPage`: a
 * voyage, a new island, a detail level) keep booting straight into the game.
 */
export const wantsTitlePage = (
  settings: GameSettings | null, search: string, toolRun: boolean, inSessionReload = false
) => {
  if (toolRun || inSessionReload || !continuesLastGame(search)) return false;
  const query = new URLSearchParams(search);
  if (query.get(CONTINUE_PARAM) === "1") return false;
  if (query.get(TITLE_PARAM) === "1") return true;
  return hasTitlePage(settings);
};

/** The start URL that continues the working slot without the title page (a Load in game, SAVE-SLOTS). */
export const continueGameUrl = (href: string) => {
  const url = new URL(startScrollUrl(href));
  url.searchParams.delete(TITLE_PARAM);
  url.searchParams.set(CONTINUE_PARAM, "1");
  return url.href;
};

/** The current URL without `?continue=1` (the boot consumed it; a later reload shows the title page again). */
export const withoutContinueParam = (href: string) => {
  const url = new URL(href);
  url.searchParams.delete(CONTINUE_PARAM);
  return url.href;
};

/** The start URL with the title page asked for (Exit game, the end of a run without a home). */
export const titlePageUrl = (href: string) => {
  const url = new URL(startScrollUrl(href));
  url.searchParams.delete(CONTINUE_PARAM);
  url.searchParams.set(TITLE_PARAM, "1");
  return url.href;
};
