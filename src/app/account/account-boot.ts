import type { I18n } from "@lingui/core";

import { translateMessage } from "../../shared/i18n/translate";
import type { BackendConfig } from "../backend/backend-config";
import { detectBackend } from "../backend/backend-status";
import { askCloudRetry, type CloudSession, startCloudSession } from "../cloud/cloud-boot";
import { WORLD_PLAY_PARAM } from "../game-settings/constants";
import { errorMessage } from "../helpers";
import { applyStoredHudTheme } from "../hud-theme";
import { browserStorageArea } from "../preferences/registry";
import { openGameDatabase } from "../settlement/game-database";
import { type AccountScroll, askForAccount, mountAccountScroll } from "./account-scroll";
import { createAccountStore } from "./account-store";
import { createIdentityClient, type IdentityAccount, type IdentityClient } from "./identity-client";
import { ACCOUNT_MESSAGES } from "./messages";

/** `?skipLogin=1` starts without an account (guest run in the guest save slot). */
const SKIP_LOGIN_PARAM = "skipLogin";
/** `?login=1` shows registration / signs in even in automated browsers (registration-review.ts). */
const FORCE_LOGIN_PARAM = "login";
/** URL parameters that ask for a particular island: the last save is not loaded over them. */
const ISLAND_PARAMS = ["map", "seed", WORLD_PLAY_PARAM] as const;

/**
 * Registration is skipped with ?skipLogin=1 and in automated browsers (Playwright tools: navigator.webdriver),
 * unless ?login=1 asks for it, so every existing bench and review tool keeps starting straight into the game.
 */
export const isLoginSkipped = (search: string, automated: boolean) => {
  const query = new URLSearchParams(search);
  if (query.get(SKIP_LOGIN_PARAM) === "1") return true;
  if (query.get(FORCE_LOGIN_PARAM) === "1") return false;
  return automated;
};

/** A plain launch (no ?seed=, ?map= or ?world=1) continues the account's last saved game. */
export const continuesLastGame = (search: string) => {
  const query = new URLSearchParams(search);
  return ISLAND_PARAMS.every(param => !query.has(param));
};

/**
 * Where Log out goes: the same page without island parameters, so the next player starts on the scroll and
 * then continues their own last game.
 */
export const startScrollUrl = (href: string) => {
  const url = new URL(href);
  ISLAND_PARAMS.forEach(param => url.searchParams.delete(param));
  return url.href;
};

/** A player signed in to the identity service (only with an available backend). */
export interface PlayerAccount {
  account: IdentityAccount;
  backend: BackendConfig;
  identity: IdentityClient;
}

export interface StartedPlayer {
  /** Detected public backend, also available when the player chooses guest play. */
  backend?: BackendConfig | null;
  /** The signed-in account; null for guest play (standalone, or Play as guest) and tool runs. */
  account: PlayerAccount | null;
  /** The signed-in account's cloud slot, session and starting game. */
  cloud: CloudSession | null;
  /** Tools and ?skipLogin=1: a fresh island without account, continued save or autosave. */
  toolRun: boolean;
}

interface StartAccountOptions {
  automated: boolean;
  /** The backend the boot already detected (GS3a reads the settings first); absent: detected here. */
  backend?: BackendConfig | null;
  container: HTMLElement;
  /** Active interface language; absent keeps the English source copy (tests and tool runs). */
  i18n?: I18n;
  search: string;
  /** Hides the loading caption while the account scroll is open. */
  setRegistering: (registering: boolean) => void;
}

interface StartPlayerOptions extends StartAccountOptions {
  /** The admin entry: offline mode still signs in for the role check, but opens no cloud slot (plan §7.2 step 4). */
  accountOnly?: boolean;
  /**
   * Offline mode (GS3a): no cloud slot or lease. The scroll offers signing in (OFFLINE-CLOUD: the offline saves are
   * also kept in the server's unverified offline store) or Play as guest (this browser only).
   */
  offline?: boolean;
}

/** The account scroll opens on demand (in the stored HUD theme) and closes once the player is in. */
export const createScrollHost = ({ container, i18n, setRegistering }: Pick<StartAccountOptions,
  "container" | "i18n" | "setRegistering">) => {
  let scroll: AccountScroll | null = null;
  return {
    close: () => {
      if (!scroll) return;
      scroll.close();
      scroll = null;
      setRegistering(false);
    },
    open: () => {
      if (scroll) return scroll;
      applyStoredHudTheme();
      setRegistering(true);
      scroll = mountAccountScroll(container, i18n);
      return scroll;
    }
  };
};

const GUEST: Omit<StartedPlayer, "toolRun"> = { account: null, cloud: null };

/** The cloud slot; when the service fails now, the player tries again or plays as guest. */
const openCloud = async (options: Parameters<typeof startCloudSession>[0]): Promise<CloudSession | null> => {
  for (;;) {
    try {
      return await startCloudSession(options);
    } catch (error) {
      const reason = errorMessage(error,
        translateMessage(options.i18n, ACCOUNT_MESSAGES.scroll.saveServiceUnavailable));
      if (!(await askCloudRetry(options.openScroll(), reason, options.i18n))) return null;
    }
  }
};

/**
 * The remembered session signs in silently; otherwise the scroll asks (Sign in, Register or Play as guest).
 * A signed-in player then opens a cloud slot (cloud-boot.ts) on the same scroll.
 */
const signInOnline = async (backend: BackendConfig, options: StartAccountOptions, withCloud = true) => {
  const identity = createIdentityClient({ identityUrl: backend.identityUrl });
  const host = createScrollHost(options);
  try {
    const signedIn = (await identity.resume()) ??
      (await askForAccount({ scroll: host.open(), store: createAccountStore(identity) }));
    if (!signedIn) return GUEST;
    const account = { account: signedIn, backend, identity };
    if (!withCloud) return { account, cloud: null };
    const cloud = await openCloud({ database: await openGameDatabase(), openScroll: host.open, player: account,
      tabStorage: browserStorageArea("session") });
    return cloud ? { account, cloud } : GUEST;
  } finally {
    host.close();
  }
};

/**
 * Before any world work: detects the backend (unless the boot did), then decides who plays. Account sign-in exists
 * only with an available backend; standalone (no backend configured or reachable) plays in the browser save and never
 * shows login or registration UI (owner rule 2026-10-22, plan §7.2). Offline mode signs in without a cloud slot.
 */
export const startPlayer = async (options: StartPlayerOptions): Promise<StartedPlayer> => {
  const backend = options.backend === undefined ? await detectBackend() : options.backend;
  const toolRun = isLoginSkipped(options.search, options.automated);
  if (toolRun || !backend) return { ...GUEST, backend, toolRun };
  if (options.offline) return { ...(await signInOnline(backend, options, false)), backend, toolRun };
  return { ...(await signInOnline(backend, options)), backend, toolRun };
};
