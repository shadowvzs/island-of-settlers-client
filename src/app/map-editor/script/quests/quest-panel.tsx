import { ScriptIconButton } from "../icon-button";
import type { ScriptWorkspace } from "../script-workspace";
import type { ScriptDialogs } from "../use-script-dialogs";
import { HomeRewardsSection } from "./home-rewards-section";
import { QuestForm } from "./quest-form";
import { QuestGroups } from "./quest-groups";
import { useQuestLabels } from "./use-quest-labels";
import { useQuestPanel } from "./use-quest-panel";

interface QuestPanelProps {
  dialogs: ScriptDialogs;
  workspace: ScriptWorkspace;
}
/** The Quests tab (design §13.6): the book in order with groups and declared home rewards beside the form. */
export const QuestPanel = ({ dialogs, workspace }: QuestPanelProps) => {
  const view = useQuestPanel(workspace);
  const labels = useQuestLabels();
  return (
    <section aria-label={labels.tab} className="script-workspace__triggers script-quests">
      <nav aria-label={labels.list} className="script-list">
        <button className="script-form__add" type="button" onClick={view.onAdd}>{labels.add}</button>
        {!view.rows.length && <p className="script-list__empty">{labels.empty}</p>}
        <ul className="script-list__rows">
          {view.rows.map(row => (
            <li className="script-list__item" data-selected={row.selected} key={row.id}>
              <button aria-pressed={row.selected} className="script-list__trigger-name" type="button"
                onClick={() => view.onSelect(row.id)}>{row.title}</button>
              {row.silent && <small className="script-quest__badge">{labels.silent}</small>}
              {row.errors && <span className="script-list__errors">{row.errors}</span>}
              <ScriptIconButton disabled={row.first} icon="moveUp" label={row.moveUpLabel}
                onClick={() => view.onMove(row.id, -1)} />
              <ScriptIconButton disabled={row.last} icon="moveDown" label={row.moveDownLabel}
                onClick={() => view.onMove(row.id, 1)} />
            </li>
          ))}
        </ul>
        <QuestGroups view={view} />
        <HomeRewardsSection dialogs={dialogs} workspace={workspace} />
      </nav>
      {!view.quest && <p className="script-form__note">{labels.none}</p>}
      {view.quest && <QuestForm campaign={view.campaign} dialogs={dialogs} key={view.quest.id} quest={view.quest}
        workspace={workspace} />}
    </section>
  );
};
