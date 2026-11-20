import type { DragEvent } from "react";

import { ScriptIconButton } from "./icon-button";
import type { ScriptWorkspace } from "./script-workspace";
import { type TriggerListView, useTriggerList } from "./use-trigger-list";

const DRAG_TYPE = "application/x-script-trigger";

type Row = TriggerListView["rows"][number];
type FolderRow = Extract<Row, { kind: "folder" }>;
type TriggerRow = Extract<Row, { kind: "trigger" }>;

const allowDrop = (event: DragEvent) => {
  if (event.dataTransfer.types.includes(DRAG_TYPE)) event.preventDefault();
};

interface FolderItemProps {
  deleteLabel: string;
  nameLabel: string;
  row: FolderRow;
  onDelete: (id: string) => void;
  onDrop: (triggerId: string, folderId: string | null) => void;
  onRename: (id: string, name: string) => void;
}
const FolderItem = ({ deleteLabel, nameLabel, row, onDelete, onDrop, onRename }: FolderItemProps) => (
  // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- drop target; keyboard: folder select
  <li className="script-list__folder" data-depth={row.depth} onDragOver={allowDrop}
    onDrop={event => onDrop(event.dataTransfer.getData(DRAG_TYPE), row.id)}>
    <span aria-hidden="true">▾</span>
    {row.id === null && <span className="script-list__folder-name">{row.label}</span>}
    {row.id !== null && (
      <>
        <input aria-label={nameLabel} className="script-list__folder-input" defaultValue={row.label}
          key={row.label} onBlur={event => onRename(row.id!, event.target.value)} />
        <ScriptIconButton icon="delete" label={deleteLabel} onClick={() => onDelete(row.id!)} />
      </>
    )}
    <span className="script-list__count">{row.count}</span>
  </li>
);

interface TriggerItemProps {
  row: TriggerRow;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
}
const TriggerItem = ({ row, onSelect, onToggle }: TriggerItemProps) => (
  <li className="script-list__trigger" data-depth={row.depth} data-off={!row.enabled} data-selected={row.selected}>
    <input aria-label={row.label} checked={row.enabled} type="checkbox" onChange={() => onToggle(row.id)} />
    <button aria-current={row.selected} className="script-list__trigger-name" draggable type="button"
      onClick={() => onSelect(row.id)} onDragStart={event => event.dataTransfer.setData(DRAG_TYPE, row.id)}>
      {row.label}
    </button>
    {row.errorText && <span className="script-list__errors">{row.errorText}</span>}
  </li>
);

interface ListRowProps {
  row: Row;
  view: TriggerListView;
}
const ListRow = ({ row, view }: ListRowProps) => {
  if (row.kind === "trigger") return <TriggerItem row={row} onSelect={view.onSelect} onToggle={view.onToggleTrigger} />;
  return <FolderItem deleteLabel={view.deleteFolderLabel(row.label)} nameLabel={view.folderNameLabel} row={row}
    onDelete={view.onDeleteFolder} onDrop={view.onDropTrigger} onRename={view.onRenameFolder} />;
};

interface TriggerListProps {
  workspace: ScriptWorkspace;
  onOpenTemplates: () => void;
}
/** The left column: search, add buttons, filter, folders with their triggers (drag a trigger onto a folder). */
export const TriggerList = ({ workspace, onOpenTemplates }: TriggerListProps) => {
  const view = useTriggerList(workspace, onOpenTemplates);
  return (
    <nav aria-label={view.listLabel} className="script-list">
      <div className="script-list__toolbar">
        <button type="button" onClick={view.onAddTrigger}>{view.addTriggerLabel}</button>
        <button type="button" onClick={view.onAddTemplate}>{view.addTemplateLabel}</button>
        <button type="button" onClick={view.onAddFolder}>{view.addFolderLabel}</button>
        {view.hasClipboardTrigger && <ScriptIconButton icon="paste" label={view.pasteLabel}
          onClick={view.onPaste} />}
      </div>
      <div className="script-list__find">
        <input aria-label={view.searchLabel} className="script-list__search" placeholder={view.searchPlaceholder}
          type="search" value={view.query} onChange={event => view.onQueryChange(event.target.value)} />
        <select aria-label={view.filterLabel} title={view.filterLabel} value={view.filter}
          onChange={event => view.onFilterChange(event.target.value)}>
          {view.filters.map(filter => <option key={filter.id} value={filter.id}>{filter.label}</option>)}
        </select>
      </div>
      {view.emptyText && <p className="script-list__empty">{view.emptyText}</p>}
      <ul className="script-list__rows">
        {view.rows.map(row => <ListRow key={`${row.kind}:${row.id ?? ""}`} row={row} view={view} />)}
      </ul>
    </nav>
  );
};
