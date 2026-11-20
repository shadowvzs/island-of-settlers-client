import { ScriptIconButton } from "../icon-button";
import { SentenceParts } from "../sentence-row";
import { QuestTextFields } from "../text-language-inputs";
import type { FormLabels } from "../use-form-labels";
import type { BoardPanelView } from "./use-board-panel";

interface BoardRowsProps {
  formLabels: FormLabels;
  view: BoardPanelView;
}

/** Fixed rows: label in every language, a catalog icon, move up and remove. */
const StaticRows = ({ formLabels, view }: BoardRowsProps) => (
  <>
    <ul className="script-board__rows">
      {view.staticRows.map(row => (
        <li className="script-board__row" key={row.id}>
          <QuestTextFields label={view.labels.rowLabel} text={row.label}
            onCommit={label => view.onRowLabel(row.id, label)} />
          <span className="script-board__icon">{view.labels.rowIcon}
            <SentenceParts labels={formLabels} parts={row.icon} onOpenSlot={view.onOpenSlot} />
          </span>
          <ScriptIconButton icon="moveUp" label={row.moveUpLabel} onClick={() => view.onMoveRow(row.id)} />
          <ScriptIconButton icon="delete" label={row.removeLabel} onClick={() => view.onRemoveRow(row.id)} />
        </li>
      ))}
    </ul>
    <button className="script-form__add" type="button" onClick={view.onAddRow}>{view.labels.addRow}</button>
  </>
);

/** Where the rows come from: fixed rows, one per player (filter), one per list item (list variable, at most). */
export const BoardRows = ({ formLabels, view }: BoardRowsProps) => {
  const { board, labels } = view;
  if (!board) return null;
  const { rows } = board;
  return (
    <section className="script-form__section">
      <h4>{labels.rows}</h4>
      <div className="script-variable__fields">
        <select aria-label={labels.rows} value={rows.kind} onChange={event => view.onRowSource(event.target.value)}>
          {view.options.rowSources.map(source => <option key={source.key} value={source.key}>{source.label}</option>)}
        </select>
        {rows.kind === "players" && (
          <label>{labels.players}<select value={JSON.stringify(rows.filter)}
            onChange={event => view.onPlayersFilter(event.target.value)}>
            {view.players.map(player => <option key={player.key} value={player.key}>{player.label}</option>)}
          </select></label>
        )}
        {rows.kind === "array" && (
          <>
            <label>{labels.rowList}<select value={rows.lengthOf.id}
              onChange={event => view.onListSource(event.target.value)}>
              {view.lists.map(list => <option key={list.key} value={list.key}>{list.label}</option>)}
            </select></label>
            <label>{labels.maxRows}<input className="input-count" defaultValue={rows.maxRows} min={1} type="number"
              onBlur={event => view.onMaxRows(event.target.value)} /></label>
          </>
        )}
      </div>
      {rows.kind === "static" && <StaticRows formLabels={formLabels} view={view} />}
    </section>
  );
};
