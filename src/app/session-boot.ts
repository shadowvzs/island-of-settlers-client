import { isLoginSkipped, startPlayer } from "./account/account-boot";
import { runBrowserRetention } from "./account/local-account-retirement";
import type { LoadAdminModules } from "./admin-modules";
import { readAppParams } from "./app-params";
import { detectBackend } from "./backend/backend-status";
import { type DevelopmentAccess, resolveDevelopmentAccess } from "./development-access";
import type { DevelopmentModules } from "./development-modules";
import { isOfflineMode, wantsTitlePage, withoutContinueParam } from "./game-settings/session-mode";
import { loadBootGameSettings } from "./game-settings/settings-boot";
import { createLoadingScreen } from "./loading-screen";
import { languagePreference } from "./localization/language-store";
import { takeInSessionReload } from "./page-reload";
import { openOfflineCloud } from "./save-slots/offline-cloud";

import "./styles.css";

export interface GameBootOptions {
  /**
   * Admin page: the admin chunk and its Development tools load only after the server account's role
   * is verified. A denied account gets the page's 401 surface and no game/runtime starts.
   */
  admin?: { denied: () => void; load: LoadAdminModules };
  /**
   * Starts the island graph download once it no longer competes with the boot's own screens: behind the shown
   * title page, or at once when the boot goes straight to the island.
   */
  prefetchIsland?: () => void;
}

type SignedInPlayer = Awaited<ReturnType<typeof startPlayer>>;

/** Local dev/test only: established test URL switches and simulation hooks, but no Development panel. */
const loadLocalDevelopment = async (params: ReturnType<typeof readAppParams>) => {
  const localDev = (await import("./local-dev-modules")).localDevModules;
  Object.assign(params, localDev.readDevParams(location.search));
  const sceneReplayBoot = await localDev.readSceneReplayBoot();
  if (!sceneReplayBoot) return { developmentModules: localDev.development, replaying: false };
  await localDev.startSceneReplayViewer(sceneReplayBoot, params);
  return { developmentModules: undefined, replaying: true };
};

/** Admin page: the role decides access; only then do the admin-only modules download. */
const resolveAdminDevelopment = async (
  admin: NonNullable<GameBootOptions["admin"]>,
  params: ReturnType<typeof readAppParams>,
  player: SignedInPlayer
) => {
  const developmentAccess: DevelopmentAccess = resolveDevelopmentAccess({
    devBuild: import.meta.env.DEV,
    online: Boolean(player.account),
    role: player.account?.account.role
  });
  if (!developmentAccess.allowed) return null;
  const modules = await admin.load();
  Object.assign(params, modules.readDevParams(location.search));
  return { developmentAccess, developmentModules: modules };
};

/**
 * Everything before the first world, renderer or worker: language, backend, game settings, sign-in and the
 * title page. It stays out of the game graph (`game-boot`) so the title page does not wait for that download.
 * Returns undefined when the page stops here (admin access denied, local scene replay).
 */
export const startBootSession = async (options: GameBootOptions = {}) => {
  const params = readAppParams(location.search);
  let developmentModules: DevelopmentModules | undefined;
  if (!options.admin && import.meta.env.DEV) {
    // This branch (and its chunks) is removed from the production player entry.
    const localDevelopment = await loadLocalDevelopment(params);
    if (localDevelopment.replaying) return undefined;
    developmentModules = localDevelopment.developmentModules;
  }
  // The saved translation is a lazily loaded catalog: activate it before the first translated text.
  await languagePreference.ready();
  const loading = createLoadingScreen();
  const startOptions = {
    automated: navigator.webdriver === true,
    container: document.getElementById("viewport")!,
    i18n: languagePreference.i18n,
    search: location.search,
    setRegistering: loading.setRegistering
  };
  const toolRunRequested = isLoginSkipped(location.search, startOptions.automated);
  const inSessionReload = takeInSessionReload();
  // Browser save retention (never during play), backend detection, the game settings (GS3a), then sign-in when
  // the settings play online.
  await runBrowserRetention({ ...startOptions, offer: !toolRunRequested })
    .catch(error => console.warn("[retention] skipped:", error));
  const detectedBackend = await detectBackend();
  const { settings: gameSettings } =
    await loadBootGameSettings({ backend: detectedBackend, toolRun: toolRunRequested });
  // Same inputs as the sign-in's tool run (`isLoginSkipped`), so the title decision is known before sign-in.
  const showsTitle = wantsTitlePage(gameSettings, location.search, toolRunRequested, inSessionReload);
  if (!showsTitle) options.prefetchIsland?.();
  const player = await startPlayer({ ...startOptions,
    accountOnly: Boolean(options.admin), backend: detectedBackend, offline: isOfflineMode(gameSettings) });
  const { account: playerAccount, cloud, toolRun } = player;
  // The player entry never shows or loads Development tools, even for a signed-in admin.
  let developmentAccess: DevelopmentAccess = { allowed: false, reason: "player-entry" };
  if (options.admin) {
    const adminDevelopment = await resolveAdminDevelopment(options.admin, params, player);
    if (!adminDevelopment) {
      options.admin.denied();
      return undefined;
    }
    ({ developmentAccess, developmentModules } = adminDevelopment);
  }
  // OFFLINE-CLOUD: a signed-in offline player's working slot comes down first when the server copy is newer.
  const offlineCloud = await openOfflineCloud({ account: playerAccount, cloud, settings: gameSettings, toolRun });
  await offlineCloud?.sync.pull().catch(error => console.warn("[offline-cloud] working slot not synced:", error));
  // GS3b (plan §7.2 step 3): the title page before any world, renderer or worker is prepared.
  if (showsTitle)
    await (await import("./title/title-boot")).runTitlePage({ account: playerAccount, cloud, loading,
      developmentAllowed: developmentAccess.allowed || Boolean(developmentModules), offlineCloud,
      onShown: options.prefetchIsland, settings: gameSettings });
  // SAVE-SLOTS: `?continue=1` (a Load in game) skips the title page once; a later reload shows it again.
  const continuedUrl = withoutContinueParam(location.href);
  if (continuedUrl !== location.href) history.replaceState(history.state, "", continuedUrl);
  return {
    ...player, developmentAccess, developmentModules, gameSettings, loading, offlineCloud, params
  };
};

/** The signed-in page session that the island boot (`game-boot`) continues from. */
export type BootSession = NonNullable<Awaited<ReturnType<typeof startBootSession>>>;
