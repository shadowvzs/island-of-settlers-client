import type { AccountStore } from "../account-store";
import type { IdentityAccount } from "../identity-client";

/** The links under a scroll form: switch Register / Sign in, and Play as guest. */
interface ScrollLinkOptions {
  /** Plays without an account in this browser's save (no online features). */
  onGuest: () => void;
  onSwitchMode: () => void;
}

export interface AccountFormOptions extends ScrollLinkOptions {
  store: AccountStore;
  onAccount: (account: IdentityAccount) => void;
}

/** The one-time offer to export the saves of this browser's old local accounts before they are removed. */
export interface LocalAccountsOptions {
  /** The date their saves are removed, already formatted for the player. */
  removeOn: string;
  usernames: readonly string[];
  /** Downloads one game file per account, then the scroll closes. */
  onExport: () => Promise<void>;
  onLater: () => void;
}

export interface ScrollChoice {
  label: string;
  /** May be async (creating a save slot); the buttons stay busy while it runs, a failure shows below. */
  onSelect: () => void | Promise<void>;
}

/** A question with its answers: the save slots, taking a session over, restoring an unsent save. */
export interface ChoicesOptions {
  choices: readonly ScrollChoice[];
  lead: string;
  /** A short line under the answers. */
  note?: string;
  title: string;
}

/** One page of the scroll: Register, Sign in, a question with answers, or the old local accounts offer. */
export type ScrollPage =
  | ({ kind: "register" } & AccountFormOptions)
  | ({ kind: "signIn" } & AccountFormOptions)
  | ({ kind: "choices" } & ChoicesOptions)
  | ({ kind: "localAccounts" } & LocalAccountsOptions);

/** The page on the scroll; a new `id` per `show` mounts a fresh page (empty fields, initial focus). */
export interface ShownScrollPage {
  id: number;
  page: ScrollPage;
}
