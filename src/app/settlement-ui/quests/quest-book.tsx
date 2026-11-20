import { useLingui } from "@lingui/react";
import type { KeyboardEvent } from "react";

import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { OpenRequestStore } from "../open-request";
import type { SettlementWindowVisibilityStore } from "../react-window";
import type { SettlementUiStore } from "../ui-store";
import { QUEST_DETAILS_ID, type QuestTab } from "./helpers";
import { QuestDetailPane, QuestIcon } from "./quest-details";
import { type QuestBookOptions, type QuestBookView, useQuestBook } from "./use-quest-book";

interface QuestEntryProps {
  tab: QuestTab;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>, index: number) => void;
  onSelect: (id: string) => void;
}
const QuestEntry = ({ tab, onKeyDown, onSelect }: QuestEntryProps) => (
  <button
    aria-controls={QUEST_DETAILS_ID}
    aria-selected={tab.selected}
    className={tab.className}
    data-quest-id={tab.id}
    id={tab.tabId}
    role="tab"
    tabIndex={tab.tabIndex}
    type="button"
    onClick={() => onSelect(tab.id)}
    onKeyDown={event => onKeyDown(event, tab.index)}
  >
    <QuestIcon icon={tab.icon} />
    <strong>{tab.title}</strong>
    <small>{tab.progressText}</small>
  </button>
);

const QuestBookView = ({
  details, loaded, renewCountdown, renewText, status, tabs, onClaim, onShow, onSkip, onTabKeyDown, onTabSelect
}: QuestBookView) => {
  const { i18n } = useLingui();
  if (!loaded) return null;
  return (
    <>
      <div
        aria-label={i18n._(M.quests.open)}
        aria-orientation={tabs.orientation}
        className="quest-window__list"
        role={tabs.role}
      >
        {tabs.tutorial && <strong className="quest-window__section">{i18n._(M.quests.tutorial)}</strong>}
        {tabs.tutorial && <QuestEntry tab={tabs.tutorial} onKeyDown={onTabKeyDown} onSelect={onTabSelect} />}
        <strong className="quest-window__section">
          {i18n._(M.quests.daily)}
          <small aria-label={renewText} className="quest-window__countdown" title={renewText}>
            ({renewCountdown})
          </small>
        </strong>
        {tabs.daily.map(tab => (
          <QuestEntry key={tab.id} tab={tab} onKeyDown={onTabKeyDown} onSelect={onTabSelect} />
        ))}
      </div>
      <div
        aria-labelledby={tabs.selectedTabId}
        className="quest-window__detail-pane"
        id={QUEST_DETAILS_ID}
        role="tabpanel"
      >
        <QuestDetailPane details={details} onClaim={onClaim} onShow={onShow} onSkip={onSkip} />
      </div>
      <small className="quest-window__status" role="status">{status}</small>
    </>
  );
};

interface QuestBookProps {
  options: QuestBookOptions;
  request: OpenRequestStore;
  store: SettlementUiStore;
  visibility: SettlementWindowVisibilityStore;
}
/** Quest book: today's open quests (tutorial step first) on the left, the selected quest on the right. */
export const QuestBook = ({ options, request, store, visibility }: QuestBookProps) => (
  <QuestBookView {...useQuestBook(store, visibility, request, options)} />
);
