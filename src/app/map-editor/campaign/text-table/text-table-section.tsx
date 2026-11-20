import { LanguageFlag } from "../../../localization/language-choice";
import type { CampaignEditor } from "../campaign-editor";
import type { TextCell, TextColumn, TextGroup, TextRow } from "./helpers";
import { useTextTable } from "./use-text-table";

import "./text-table.css";

type SetText = (textId: string, language: string, value: string) => void;

interface TextCellInputProps {
  cell: TextCell;
  multiline: boolean;
  textId: string;
  onChange: SetText;
}
/** One language of one text; the input grows with its content. */
const TextCellInput = ({ cell, multiline, textId, onChange }: TextCellInputProps) => (
  <td data-language={cell.language} data-missing={cell.missing}>
    <textarea aria-label={cell.label} data-multiline={multiline} id={cell.id} lang={cell.language} rows={1}
      value={cell.value} onChange={event => onChange(textId, cell.language, event.target.value)} />
  </td>
);

interface TextTableRowProps {
  row: TextRow;
  onChange: SetText;
}
const TextTableRow = ({ row, onChange }: TextTableRowProps) => (
  <tr>
    <th scope="row">{row.label}</th>
    {row.cells.map(cell => <TextCellInput cell={cell} key={cell.language} multiline={row.multiline} textId={row.id}
      onChange={onChange} />)}
  </tr>
);

interface TextGroupBodyProps {
  columnCount: number;
  group: TextGroup;
  onChange: SetText;
}
/** The texts of one document under its name and missing count. */
const TextGroupBody = ({ columnCount, group, onChange }: TextGroupBodyProps) => (
  <tbody>
    <tr className="campaign-texts__group">
      <th colSpan={columnCount} scope="rowgroup">
        {group.title}
        {group.missing > 0 && <span className="campaign-texts__missing">{group.missingLabel}</span>}
      </th>
    </tr>
    {group.rows.map(row => <TextTableRow key={row.id} row={row} onChange={onChange} />)}
  </tbody>
);

interface TextTableHeadProps {
  columns: readonly TextColumn[];
  textColumnLabel: string;
}
const TextTableHead = ({ columns, textColumnLabel }: TextTableHeadProps) => (
  <thead>
    <tr>
      <th scope="col">{textColumnLabel}</th>
      {columns.map(column => (
        <th key={column.language} scope="col">
          <span className="campaign-editor__language">
            {column.locale && <LanguageFlag locale={column.locale} />}
            {column.label}
          </span>
        </th>
      ))}
    </tr>
  </thead>
);

interface TextTableSectionProps {
  editor: CampaignEditor;
}
/** Every campaign text side by side in EN / HU / DE: missing cells are red, edits go through the editor store. */
export const TextTableSection = ({ editor }: TextTableSectionProps) => {
  const view = useTextTable(editor);
  return (
    <section aria-label={view.title} className="campaign-editor__form campaign-texts">
      <div className="campaign-texts__bar">
        <label className="campaign-editor__check">
          <input checked={view.onlyMissing} type="checkbox"
            onChange={event => view.onOnlyMissingChange(event.target.checked)} />
          {view.onlyMissingLabel}
        </label>
        {view.hasMissing && <span className="campaign-texts__missing">{view.missingLabel}</span>}
        <button aria-label={view.undoLabel} className="campaign-editor__icon-button" disabled={!view.canUndo}
          title={view.undoLabel} type="button" onClick={editor.undoTextEdit}>
          <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
            <path d="M9 7 4 12l5 5M4 12h10a6 6 0 0 1 0 12h-2" transform="translate(0 -3)" />
          </svg>
        </button>
      </div>
      {view.emptyNote && <p className="campaign-editor__hint">{view.emptyNote}</p>}
      {view.groups.length > 0 && <table className="campaign-texts__table">
        <TextTableHead columns={view.columns} textColumnLabel={view.textColumnLabel} />
        {view.groups.map(group => <TextGroupBody columnCount={view.columns.length + 1} group={group} key={group.id}
          onChange={editor.setText} />)}
      </table>}
    </section>
  );
};
