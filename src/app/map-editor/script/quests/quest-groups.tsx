import { ScriptIconButton } from "../icon-button";
import { QuestTextFields } from "../text-language-inputs";
import type { QuestPanelView } from "./use-quest-panel";

interface QuestGroupsProps {
  view: QuestPanelView;
}
/** Quest groups (QU §7.3): title, together or one after the other, unlock level, required groups. */
export const QuestGroups = ({ view }: QuestGroupsProps) => {
  const labels = view.groupLabels;
  return (
    <details className="script-quest__groups">
      <summary>{labels.title} ({view.groups.length})</summary>
      <ul className="script-variables__list">
        {view.groups.map(({ group, level, others }) => (
          <li className="script-variable" key={group.id}>
            <QuestTextFields label={labels.name} text={group.title}
              onCommit={title => view.onGroupTitle(group.id, title)} />
            <div className="script-variable__fields">
              <label>{labels.order}<select value={group.activation}
                onChange={event => view.onGroupActivation(group.id, event.target.value)}>
                <option value="parallel">{labels.parallel}</option>
                <option value="sequential">{labels.sequential}</option>
              </select></label>
              <label>{labels.level}<input className="input-count" defaultValue={level} key={level} min={1}
                type="number" onBlur={event => view.onGroupLevel(group.id, event.target.value)} /></label>
              <ScriptIconButton icon="delete" label={labels.delete} onClick={() => view.onDeleteGroup(group.id)} />
            </div>
            {others.length > 0 && (
              <fieldset><legend>{labels.requires}</legend>
                {others.map(other => (
                  <label key={other.key}><input checked={other.checked} type="checkbox"
                    onChange={event => view.onGroupRequires(group.id, other.key, event.target.checked)} />
                  {other.label}</label>
                ))}
              </fieldset>
            )}
          </li>
        ))}
      </ul>
      <button className="script-form__add" type="button" onClick={view.onAddGroup}>{labels.add}</button>
    </details>
  );
};
