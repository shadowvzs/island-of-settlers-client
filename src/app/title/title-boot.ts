import type { GameSettings } from "../../../../island-of-settlers-shared/src/game-settings/game-settings";
import { isHomelessRun } from "../../shared/campaign/campaign-run-game";
import { type PlayerAccount, startScrollUrl } from "../account/account-boot";
import { createAccountSession } from "../account/account-session";
import { type CloudSession, endCloudSession } from "../cloud/cloud-boot";
import { isAdministrator, resolveDevelopmentAccess } from "../development-access";
import { browserSaving, browserWorkingSlot } from "../game-settings/session-mode";
import type { createLoadingScreen } from "../loading-screen";
import { type OfflineCloud, withOfflineCloud } from "../save-slots/offline-cloud";
import { openSlotRepository } from "../save-slots/slot-repository";
import { openLocalSaveStore } from "../save-store/local-save-store";
import { settingsStorage } from "../settings/graphics-settings";
import { createCampaignDepartureSources } from "../settlement/campaign-departure-sources";
import { openGameDatabase } from "../settlement/game-database";
import { TITLE_CONSUMED_PARAMS } from "./constants";
import { titleEntries, titleModeLabel } from "./helpers";
import { takeTitleLanding } from "./title-landing";
import { createTitleSession, type TitleServer, type TitleSlot } from "./title-session";
import type { TitleSlotsOptions } from "./title-slots";

export interface TitlePageBootOptions {
  account: PlayerAccount | null;
  cloud: CloudSession | null;
  /** Administrators and development sessions also see this browser's authored campaigns. */
  developmentAllowed: boolean;
  loading: Pick<ReturnType<typeof createLoadingScreen>, "setTitle">;
  /** A signed-in offline player's server saves (OFFLINE-CLOUD): the slot list reads the server. */
  offlineCloud: OfflineCloud | null;
  settings: GameSettings | null;
  /** Called once the title page is on screen (the boot then downloads the island graph behind it). */
  onShown?: () => void;
}

/**
 * A signed-in cloud slot (ONLINE-STORY): the game chosen at sign-in, its player row between runs, and a written run
 * becomes the game the boot continues with. A home game stays untouched without a home (owner Q4).
 */
const cloudTitleSlot = (cloud: CloudSession): TitleSlot => ({
  hasSavedGame: async () => cloud.initialGame !== null,
  holdsHomeGame: () => cloud.initialGame !== null && !isHomelessRun(cloud.initialGame),
  readStoryProgress: async () => cloud.initialGame?.player ?? await cloud.store.readStoryProgress?.() ?? null,
  writeSavedGame: async save => {
    await cloud.store.writeSavedGame(save);
    cloud.initialGame = save;
  }
});

/** A browser slot counts its session row; a signed-in offline player's also copies it to the server. */
const openTitleSlot = async ({ cloud, offlineCloud, settings }: TitlePageBootOptions): Promise<TitleSlot> => {
  if (cloud) return cloudTitleSlot(cloud);
  return withOfflineCloud(await openLocalSaveStore(browserWorkingSlot(settings)), offlineCloud);
};

/** Signed in: the server keeps the attempts; the run starts under the lease's rules. */
const titleServer = (cloud: CloudSession | null): TitleServer | undefined =>
  cloud ? { rules: cloud.lease.gameRules(), startAttempt: cloud.economy.startCampaignAttempt } : undefined;

/** The session's Save/Load slots (SAVE-SLOTS): browser slots when the settings and this browser allow them. */
const openTitleSlots = async (
  { account, cloud, offlineCloud, settings }: TitlePageBootOptions
): Promise<TitleSlotsOptions | undefined> => {
  const { backend } = await openGameDatabase();
  const saving = browserSaving(settings, backend, Boolean(cloud));
  if (!saving.slots) return undefined;
  const owner = account && cloud ? { account, cloud } : null;
  return {
    autosave: saving.autosave, reload: () => location.reload(),
    repository: await openSlotRepository(browserWorkingSlot(settings), { cloud: owner, offline: offlineCloud }),
    // A cloud slot's progress lives on the server: New game cannot reset it from here.
    resettable: !owner
  };
};

/** The game boots on the start URL without the title's own parameters (a reload continues the game). */
const dropTitleParams = () => {
  const url = new URL(location.href);
  TITLE_CONSUMED_PARAMS.forEach(param => url.searchParams.delete(param));
  history.replaceState(history.state, "", url.href);
};

/** Settings > Account on the title page: nothing runs yet, so leaving needs no save (Log out, Switch save slot). */
const titleAccount = ({ account, cloud }: TitlePageBootOptions) => account && createAccountSession({
  leave: () => location.assign(startScrollUrl(location.href)), player: account,
  releaseSession: cloud ? () => endCloudSession(cloud) : undefined, saving: null
}).settings;

/**
 * The signed-in account's administrator role, on the player entry too (its Development tools stay off there). A
 * development build's guest is not an administrator: the Administration window would refuse it anyway.
 */
const titleAdmin = (account: PlayerAccount | null) => isAdministrator(resolveDevelopmentAccess({
  devBuild: import.meta.env.DEV, online: Boolean(account), role: account?.account.role
}));

/**
 * Boot step 3 (plan §7.2, GS3b): the title page before any world, renderer or worker exists. It resolves when the
 * player continues, starts a new game, or a campaign map was written to the working slot; the boot then continues
 * as a plain launch of the working slot.
 */
export const runTitlePage = async (options: TitlePageBootOptions) => {
  const now = options.cloud?.clock ?? Date.now;
  const session = await createTitleSession({
    landingJson: takeTitleLanding(), nation: settingsStorage.readWorkerNation(), now,
    server: titleServer(options.cloud), settings: options.settings, slot: await openTitleSlot(options),
    slots: await openTitleSlots(options),
    sources: createCampaignDepartureSources({ economy: options.cloud?.economy,
      localAllowed: options.developmentAllowed, now })
  });
  const host = document.createElement("div");
  // The HUD root class gives the title page the shared paper theme and button skin.
  host.className = "settlement-ui title-page-host";
  document.body.append(host);
  options.loading.setTitle(true);
  const { mountTitlePage } = await import("./mount");
  const unmount = mountTitlePage(host, {
    account: titleAccount(options) ?? undefined,
    baseUrl: import.meta.env.BASE_URL,
    entries: titleEntries({ admin: titleAdmin(options.account), hasSavedGame: session.hasSavedGame,
      hasStoryProgress: session.hasStoryProgress, settings: options.settings,
      slotHoldsHome: session.slotHoldsHome, slots: session.slotFacts }),
    modeLabel: titleModeLabel(options.settings),
    session,
    settings: options.settings
  });
  options.onShown?.();
  await session.done;
  unmount();
  host.remove();
  options.loading.setTitle(false);
  dropTitleParams();
};
