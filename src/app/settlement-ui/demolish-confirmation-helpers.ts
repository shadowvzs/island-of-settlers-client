import type { I18n } from "@lingui/core";

import { getNationBuildingDefinition } from "../../render-common/buildings/nation-building-text";
import { translateMessage } from "../../shared/i18n/translate";
import { createExternalStore, type ReadableStore } from "../components/ui-store";
import { SETTLEMENT_MESSAGES as M } from "./messages";
import type { SettlementBuildingSummary } from "./types";

/** Marks the confirmation window; a press inside it never dismisses the question. */
const DEMOLISH_CONFIRM_SELECTOR = "[data-demolish-confirm]";

export interface DemolishConfirmationText {
  confirmLabel: string;
  keepLabel: string;
  question: string;
  title: string;
}

/** The open question: which building, its name and the wording (demolish or remove a site). */
export interface DemolishQuestion {
  completed?: boolean;
  name: string;
  text: DemolishConfirmationText;
  type: number;
  uid: string;
}

/** Completed buildings are demolished; an unfinished plan or site is removed. */
export const getDemolishConfirmationText = (
  buildingName: string,
  completed: boolean | undefined,
  i18n?: I18n
): DemolishConfirmationText => {
  if (completed === false)
    return {
      confirmLabel: translateMessage(i18n, M.common.remove),
      keepLabel: translateMessage(i18n, M.common.keep),
      question: translateMessage(i18n, M.demolish.removeQuestion, { name: buildingName }),
      title: translateMessage(i18n, M.demolish.removeTitle)
    };
  return {
    confirmLabel: translateMessage(i18n, M.common.demolish),
    keepLabel: translateMessage(i18n, M.common.keep),
    question: translateMessage(i18n, M.demolish.question, { name: buildingName }),
    title: translateMessage(i18n, M.demolish.title)
  };
};

/** The question ends when its building disappears or another building gets the focus. */
export const isDemolishQuestionStale = (
  pendingUid: string | null,
  focusedUid: string | null | undefined,
  buildings: readonly { id: string }[] | undefined
) => {
  if (pendingUid === null) return false;
  if (focusedUid !== pendingUid) return true;
  return !buildings?.some(building => building.id === pendingUid);
};

/** True for a press on (or inside) the confirmation window. */
export const isInsideDemolishConfirmation = (target: EventTarget | null) => {
  const closest = (target as Partial<Element> | null)?.closest;
  return typeof closest === "function" && closest.call(target, DEMOLISH_CONFIRM_SELECTOR) !== null;
};

/** Accessible names of the two choices. */
export const getDemolishChoiceLabels = (
  { completed, name }: Pick<DemolishQuestion, "completed" | "name">, i18n?: I18n
) => ({
  confirm: translateMessage(i18n,
    completed === false ? M.demolish.removeConfirm : M.demolish.confirm, { name }),
  keep: translateMessage(i18n, M.demolish.keep, { name })
});

/**
 * While a question is open, Escape (kept from closing other windows) or a press anywhere outside the
 * window cancels it. Capture listeners on `target` (the window in the game); returns their removal.
 */
export const listenForDemolishDismissal = (target: EventTarget, onCancel: () => void) => {
  const listeners = new AbortController();
  const settings = { capture: true, signal: listeners.signal };
  target.addEventListener("keydown", event => {
    if ((event as KeyboardEvent).key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onCancel();
  }, settings);
  target.addEventListener("pointerdown", event => {
    if (!isInsideDemolishConfirmation(event.target)) onCancel();
  }, settings);
  return () => listeners.abort();
};

type QuestionStore = ReadableStore<DemolishQuestion | null>;

export interface DemolishConfirmation extends QuestionStore {
  /** Dismisses the question (Escape, a press elsewhere, Keep, close button, stale focus). */
  cancel: () => void;
  /** Ends the question for `uid`; true when it was pending, so the caller demolishes once. */
  confirm: (uid: string) => boolean;
  pending: () => string | null;
  /** Asks the question for one building at a time. */
  request: (building: Pick<SettlementBuildingSummary, "completed" | "id" | "type">, nation?: string) => void;
}

/** Pending demolish question behind the confirmation window (React-free; the view subscribes). */
export const createDemolishConfirmation = (i18n?: I18n): DemolishConfirmation => {
  const store = createExternalStore<DemolishQuestion | null>(null);
  return {
    cancel: () => store.set(null),
    confirm: uid => {
      if (store.getSnapshot()?.uid !== uid) return false;
      store.set(null);
      return true;
    },
    getSnapshot: store.getSnapshot,
    pending: () => store.getSnapshot()?.uid ?? null,
    request: (building, nation) => {
      if (store.getSnapshot()?.uid === building.id) return;
      const name = getNationBuildingDefinition(building.type, nation).name;
      store.set({ completed: building.completed, name,
        text: getDemolishConfirmationText(name, building.completed, i18n), type: building.type,
        uid: building.id });
    },
    subscribe: store.subscribe
  };
};
