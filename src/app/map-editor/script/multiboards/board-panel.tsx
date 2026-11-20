import { MultiboardWindow } from "../../../script/multiboard/multiboard-window";
import { ScriptIconButton } from "../icon-button";
import type { ScriptWorkspace } from "../script-workspace";
import { IssueList } from "../sentence-row";
import { QuestTextFields } from "../text-language-inputs";
import { useFormLabels } from "../use-form-labels";
import type { ScriptDialogs } from "../use-script-dialogs";
import { BoardColumns } from "./board-columns";
import { BoardRows } from "./board-rows";
import { type BoardPanelView, useBoardPanel } from "./use-board-panel";

import "../../../script/multiboard/multiboard.css";

const noToggle = () => {};

interface BoardPartProps {
  view: BoardPanelView;
}

/** The live preview: the game's own board window over the engine's evaluation at map start. */
const BoardPreview = ({ view }: BoardPartProps) => (
  <section className="script-board__preview">
    <h4>{view.labels.preview}</h4>
    {view.preview && <MultiboardWindow board={view.preview} onToggle={noToggle} />}
    {!view.preview && <p className="script-form__note">{view.labels.previewUnavailable}</p>}
  </section>
);

/** Title, start state, audience and sort of the selected board. */
const BoardSettings = ({ view }: BoardPartProps) => {
  const { board, labels } = view;
  if (!board) return null;
  return (
    <div className="script-board__settings">
      <div className="script-variable__fields">
        <label>{labels.variable}<input defaultValue={view.name} key={`${view.selectedId}:${view.name}`}
          onBlur={event => view.onName(event.target.value)} /></label>
        <label><input checked={board.initiallyVisible} type="checkbox"
          onChange={event => view.onField({ initiallyVisible: event.target.checked })} />{labels.visible}</label>
        <label><input checked={board.initiallyCollapsed} type="checkbox"
          onChange={event => view.onField({ initiallyCollapsed: event.target.checked })} />{labels.collapsed}</label>
        <label>{labels.audience}<select value={JSON.stringify(board.audience)}
          onChange={event => view.onAudience(event.target.value)}>
          {view.players.map(player => <option key={player.key} value={player.key}>{player.label}</option>)}
        </select></label>
        <label>{labels.sort}<select value={board.sort?.columnId ?? ""}
          onChange={event => view.onSort(event.target.value, board.sort?.direction ?? "desc")}>
          <option value="">{labels.unsorted}</option>
          {view.columns.map(column => <option key={column.id} value={column.id}>{column.name}</option>)}
        </select></label>
        {board.sort && (
          <select aria-label={labels.sort} value={board.sort.direction}
            onChange={event => view.onSort(board.sort?.columnId ?? "", event.target.value)}>
            {view.options.directions.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
        )}
        <ScriptIconButton className="script-board__delete" icon="delete" label={labels.delete}
          onClick={view.onDelete} />
      </div>
      <QuestTextFields label={labels.title} text={board.title} onCommit={title => view.onField({ title })} />
    </div>
  );
};

interface BoardPanelProps {
  dialogs: ScriptDialogs;
  workspace: ScriptWorkspace;
}
/** The Multiboards tab (design §13.5): the board list beside the selected board's editor and live preview. */
export const BoardPanel = ({ dialogs, workspace }: BoardPanelProps) => {
  const view = useBoardPanel(workspace, dialogs);
  const formLabels = useFormLabels();
  const { labels } = view;
  return (
    <section aria-label={labels.tab} className="script-workspace__triggers script-boards">
      <nav aria-label={labels.list} className="script-list">
        <p className="script-form__note">{labels.info}</p>
        <button className="script-form__add" type="button" onClick={view.onAdd}>{labels.add}</button>
        {!view.boards.length && <p className="script-list__empty">{labels.empty}</p>}
        <ul className="script-list__rows">
          {view.boards.map(row => (
            <li className="script-list__item" data-selected={row.selected} key={row.id}>
              <button aria-pressed={row.selected} className="script-list__trigger-name" type="button"
                onClick={() => view.onSelect(row.id)}>{row.title} <small>{row.name}</small></button>
            </li>
          ))}
        </ul>
      </nav>
      {!view.board && <p className="script-form__note">{labels.none}</p>}
      {view.board && (
        <article className="script-form">
          <BoardSettings view={view} />
          <IssueList issues={view.issues} />
          <BoardRows formLabels={formLabels} view={view} />
          <BoardColumns formLabels={formLabels} view={view} />
          <BoardPreview view={view} />
          <footer className="script-form__footer"><span>{view.usedBy}</span></footer>
        </article>
      )}
    </section>
  );
};
