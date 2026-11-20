import { translateMessage } from "../../../shared/i18n/translate";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import { createOpenRequest } from "../open-request";
import { createReactSettlementWindow } from "../react-window";
import type { SettlementUiOptions } from "../types";
import type { SettlementUiStore } from "../ui-store";
import { isQuestListed } from "./helpers";

type QuestWindowOptions = Pick<
  SettlementUiOptions, "i18n" | "onCompleteQuest" | "onShowTutorial" | "onSkipTutorial" | "onTutorialOpened"
>;

/**
 * Quest book opened from the HUD quest button. Every open selects the first quest again and marks the
 * tutorial step seen; the store coalesces the 0.5 s ticks (React renders once per changed book).
 * `openWith` is the script opener token (design §6.10, rev m3): that opening starts on the given quest; a quest
 * the book does not list (hidden, unknown) is refused with a log line and the default selection shows.
 */
export const createQuestWindow = (store: SettlementUiStore, options: QuestWindowOptions) => {
  const request = createOpenRequest();
  const frame = createReactSettlementWindow({
    className: "settlement-ui__quest-window",
    contentClassName: "settlement-ui__overview quest-window",
    heading: translateMessage(options.i18n, M.quests.title),
    id: "settlement-quest-title",
    load: async visibility => (await import("./mount")).createQuestBookMount(store, visibility, request, options)
  });
  const open = () => {
    options.onTutorialOpened?.();
    frame.open();
  };
  return {
    ...frame,
    open,
    openWith: ({ questId }: { questId: string | null }) => {
      const listed = questId !== null && isQuestListed(store.getSnapshot(), questId);
      if (questId !== null && !listed) console.info(`Script openUi: quest ${questId} is not listed; default shown`);
      request.set(listed ? { opened: frame.nextOpening(), subjectId: questId } : null);
      open();
    }
  };
};
