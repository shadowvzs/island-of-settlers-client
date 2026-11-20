import { scrollIntoViewWhen } from "../focus";
import { ScriptIconButton } from "../icon-button";
import type { ScriptWorkspace } from "../script-workspace";
import { IssueList } from "../sentence-row";
import type { VariableRow } from "./helpers";
import { InitialValueField } from "./initial-value-field";
import { useVariablePanel, type VariablePanelView } from "./use-variable-panel";

interface VariableCardProps {
  row: VariableRow;
  view: VariablePanelView;
}
/** One variable: name, type, initial value, quest texts switch, comment, users and issues. */
const VariableCard = ({ row, view }: VariableCardProps) => {
  const { labels } = view;
  const { variable } = row;
  return (
    <li className="script-variable" data-linked={row.id === view.linkedId} data-variable={row.id}
      ref={scrollIntoViewWhen(row.id === view.linkedId)}>
      <div className="script-variable__head">
        <label>{labels.name}<input defaultValue={row.name} key={`${row.id}:${row.name}`}
          onBlur={event => view.onName(row.id, event.target.value)} /></label>
        <label>{labels.type}<select value={variable.type} onChange={event => view.onType(variable,
          event.target.value)}>
          {row.types.map(type => <option key={type.key} value={type.key}>{type.label}</option>)}
        </select></label>
        <label><input checked={row.questVisible} type="checkbox"
          onChange={event => view.onQuestVisible(row.id, event.target.checked)} />{labels.questVisible}</label>
        <ScriptIconButton className="script-variable__delete" icon="delete" label={row.deleteLabel}
          onClick={() => view.onDelete(variable)} />
      </div>
      <div className="script-variable__initial">
        <span className="script-variable__label">{labels.initial}</span>
        <InitialValueField row={row} view={view} />
      </div>
      {variable.type === "actorGroup" && (
        <label>{labels.maxLength}<input className="input-count" defaultValue={variable.maxLength}
          key={`${row.id}:${String(variable.maxLength)}`} min={1} type="number"
          onBlur={event => view.onMaxLength(row.id, Number(event.target.value))} /></label>
      )}
      <label className="script-variable__comment">{labels.comment}<input defaultValue={row.comment}
        key={`${row.id}:${row.comment}`} onBlur={event => view.onComment(row.id, event.target.value)} /></label>
      <p className="script-actor__users">{row.usedBy}</p>
      <IssueList issues={row.issues} />
    </li>
  );
};

interface VariablePanelProps {
  workspace: ScriptWorkspace;
}
/** The Variables tab (design §13.4): typed map variables with their initial values and users. */
export const VariablePanel = ({ workspace }: VariablePanelProps) => {
  const view = useVariablePanel(workspace);
  const { labels } = view;
  return (
    <section aria-label={labels.title} className="script-variables">
      <p className="script-form__note">{labels.info}</p>
      <div className="script-list__toolbar">
        <input aria-label={labels.search} placeholder={labels.search} type="search" value={view.query}
          onChange={event => view.onQuery(event.target.value)} />
        <select aria-label={labels.addType} value={view.newType}
          onChange={event => view.onNewType(event.target.value)}>
          {view.newTypes.map(type => <option key={type.key} value={type.key}>{type.label}</option>)}
        </select>
        <button type="button" onClick={view.onAdd}>{labels.add}</button>
      </div>
      {!view.rows.length && <p className="script-form__note">{labels.empty}</p>}
      <ul className="script-variables__list">
        {view.rows.map(row => <VariableCard key={row.id} row={row} view={view} />)}
      </ul>
    </section>
  );
};
