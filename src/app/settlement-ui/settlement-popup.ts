import type { I18n } from "@lingui/core";

import { translateMessage } from "../../shared/i18n/translate";
import { playVictoryFanfare } from "../audio/victory-fanfare";
import { createLazyReactContent } from "../components/lazy-react-content";
import { createExternalStore, type ExternalStore } from "../components/ui-store";
import type { ArtImage } from "./art-helpers";
import { SETTLEMENT_MESSAGES as M } from "./messages";
import type { RewardEntry } from "./reward-icons/entries";

export interface SettlementPopupAction {
  label: string;
  /** Without an icon the action is a plain text button. */
  icon?: string;
  iconOnly?: boolean;
  primary?: boolean;
  onSelect?: () => void;
}
/** Shown in one line under the message (the shared reward row): the experience badge, then the reward icons. */
interface SettlementPopupRewards {
  entries: readonly RewardEntry[];
}
interface SettlementPopupBuilding {
  label: string;
  type: number;
}
export interface SettlementPopupContent {
  title: string;
  message: string;
  art?: ArtImage;
  rewards?: SettlementPopupRewards;
  tone?: "victory" | "defeat" | "question";
  /** Buildings shown with their menu icons under the rewards (the level-up's newly unlocked ones). */
  buildings?: readonly SettlementPopupBuilding[];
  /** Plays the victory fanfare when the popup opens (won colony or adventure). */
  fanfare?: boolean;
  actions: readonly SettlementPopupAction[];
}

/** The popup on screen (null while hidden); a new revision per `show` refocuses its first action. */
export interface SettlementPopupState {
  content: SettlementPopupContent | null;
  revision: number;
}
export type SettlementPopupStore = ExternalStore<SettlementPopupState>;

/**
 * One modal at a time on a dimmed backdrop; any action (or Escape, through a document listener) closes
 * it. The backdrop stays DOM; its React card loads on the first popup.
 */
export const createSettlementPopup = (i18n?: I18n) => {
  const backdrop = document.createElement("div");
  backdrop.className = "settlement-popup";
  backdrop.hidden = true;
  const store = createExternalStore<SettlementPopupState>({ content: null, revision: 0 });
  let escape: ((event: KeyboardEvent) => void) | undefined;
  const close = () => {
    backdrop.hidden = true;
    if (escape) document.removeEventListener("keydown", escape);
    escape = undefined;
    store.set({ content: null, revision: store.getSnapshot().revision });
  };
  const content = createLazyReactContent(backdrop, translateMessage(i18n, M.popup.title),
    async () => (await import("./popup/mount")).createPopupMount(store, close), {
      error: name => translateMessage(i18n, M.common.loadFailed, { name }),
      loading: name => translateMessage(i18n, M.common.loading, { name })
    });
  const show = (next: SettlementPopupContent) => {
    close();
    if (next.fanfare) playVictoryFanfare();
    store.set({ content: next, revision: store.getSnapshot().revision + 1 });
    backdrop.hidden = false;
    escape = event => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    };
    document.addEventListener("keydown", escape);
    content.mount();
  };
  return { close, dispose: content.unmount, root: backdrop, show };
};
