import { ScriptIconButton } from "../icon-button";
import { IssueList, SentenceParts } from "../sentence-row";
import { QuestTextFields } from "../text-language-inputs";
import type { FormLabels } from "../use-form-labels";
import type { BoardColumnRow } from "./helpers";
import type { BoardPanelView } from "./use-board-panel";

interface ColumnCardProps {
  column: BoardColumnRow;
  formLabels: FormLabels;
  view: BoardPanelView;
}
/** One column: header, what the cell shows, its expression slot(s), width, align, move and remove. */
const ColumnCard = ({ column, formLabels, view }: ColumnCardProps) => {
  const { labels, options } = view;
  return (
    <li className="script-board__column" data-column={column.id} data-error={column.cell.hasError}>
      <div className="script-board__column-head">
        <QuestTextFields label={labels.header} text={column.header}
          onCommit={header => view.onColumn(column.id, { header })} />
        <div className="script-board__column-buttons">
          <ScriptIconButton disabled={column.first} icon="moveLeft" label={column.moveLeftLabel}
            onClick={() => view.onMoveColumn(column.id, -1)} />
          <ScriptIconButton disabled={column.last} icon="moveRight" label={column.moveRightLabel}
            onClick={() => view.onMoveColumn(column.id, 1)} />
          <ScriptIconButton icon="delete" label={column.removeLabel} onClick={() => view.onRemoveColumn(column.id)} />
        </div>
      </div>
      <div className="script-variable__fields">
        <label>{labels.format}<select value={column.format}
          onChange={event => view.onCellFormat(column.id, event.target.value)}>
          {options.formats.map(format => <option key={format.key} value={format.key}>{format.label}</option>)}
        </select></label>
        <span className="script-board__cell"><SentenceParts labels={formLabels} parts={column.cell.parts}
          onOpenSlot={view.onOpenSlot} /></span>
        <label title={labels.width}>{labels.widthShort}<input aria-label={labels.width} className="input-narrow"
          defaultValue={column.width} inputMode="numeric" key={`${column.id}:${column.width}`}
          placeholder={labels.widthAuto} onBlur={event => view.onColumnWidth(column.id, event.target.value)} />
        </label>
        <label>{labels.align}<select value={column.align}
          onChange={event => view.onColumn(column.id, { align: event.target.value as BoardColumnRow["align"] })}>
          {options.aligns.map(align => <option key={align.key} value={align.key}>{align.label}</option>)}
        </select></label>
      </div>
      <IssueList issues={column.cell.issues} />
    </li>
  );
};

interface BoardColumnsProps {
  formLabels: FormLabels;
  view: BoardPanelView;
}
/** The columns of the board, left to right, and "+ Column". */
export const BoardColumns = ({ formLabels, view }: BoardColumnsProps) => (
  <section className="script-form__section">
    <h4>{view.labels.columns}</h4>
    <ul className="script-board__columns">
      {view.columns.map(column => <ColumnCard column={column} formLabels={formLabels} key={column.id}
        view={view} />)}
    </ul>
    <button className="script-form__add" type="button" onClick={view.onAddColumn}>{view.labels.addColumn}</button>
  </section>
);
