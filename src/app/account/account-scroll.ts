import type { I18n } from "@lingui/core";

import { translateMessage } from "../../shared/i18n/translate";
import { createExternalStore } from "../components/ui-store";
import type { AccountStore } from "./account-store";
import type { IdentityAccount } from "./identity-client";
import { ACCOUNT_MESSAGES } from "./messages";
import type { ScrollPage, ShownScrollPage } from "./scroll/scroll-pages";

import "./scroll/registration.css";

const showLoadFailure = (overlay: HTMLElement, i18n?: I18n) => {
  const message = document.createElement("p");
  message.className = "account-register__failure";
  message.setAttribute("role", "alert");
  message.textContent = translateMessage(i18n, ACCOUNT_MESSAGES.scroll.loadFailed);
  overlay.replaceChildren(message);
};

/**
 * The dim backdrop over the loading screen at once; the scroll's React view loads (with React) on the first
 * open and renders the page last passed to `show`.
 */
export const mountAccountScroll = (container: HTMLElement, i18n?: I18n) => {
  const overlay = document.createElement("div");
  overlay.className = "account-register";
  container.append(overlay);
  const pages = createExternalStore<ShownScrollPage | null>(null);
  let shownPages = 0;
  let closed = false;
  let unmount: (() => void) | undefined;
  import("./scroll/mount-account-scroll").then(({ mountAccountScrollView }) => {
    if (!closed) unmount = mountAccountScrollView(overlay, pages);
  }, () => showLoadFailure(overlay, i18n));
  return {
    close: () => {
      closed = true;
      unmount?.();
      overlay.remove();
    },
    show: (page: ScrollPage) => pages.set({ id: ++shownPages, page })
  };
};

export type AccountScroll = ReturnType<typeof mountAccountScroll>;

interface AskForAccountOptions {
  scroll: AccountScroll;
  store: AccountStore;
}

/**
 * Register or Sign in, switched by the link under each form, with Play as guest under both. Opens on Sign in.
 * Resolves with the signed-in account, or null for guest play.
 */
export const askForAccount = ({ scroll, store }: AskForAccountOptions) =>
  new Promise<IdentityAccount | null>(resolve => {
    const onGuest = () => resolve(null);
    const showSignIn = () => scroll.show({ kind: "signIn", store, onAccount: resolve, onGuest,
      onSwitchMode: showRegister });
    const showRegister = () => scroll.show({ kind: "register", store, onAccount: resolve, onGuest,
      onSwitchMode: showSignIn });
    showSignIn();
  });

interface LocalAccountsOffer {
  exportSaves: () => Promise<void>;
  removeAfter: number;
  usernames: readonly string[];
}

/** The old local accounts offer on the scroll; resolves once exported or declined. */
export const offerLocalAccountExport = (scroll: AccountScroll, { exportSaves, removeAfter, usernames }:
  LocalAccountsOffer) => new Promise<void>(resolve => scroll.show({
  kind: "localAccounts", removeOn: new Date(removeAfter).toLocaleDateString(), usernames,
  onExport: async () => {
    await exportSaves();
    resolve();
  },
  onLater: resolve
}));
