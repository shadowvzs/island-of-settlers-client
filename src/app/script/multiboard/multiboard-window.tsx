import { memo } from "react";

import { SettlementIcon } from "../../components/settlement-icon";
import type { BoardRowView, BoardView } from "./helpers";

interface MultiboardRowProps {
  row: BoardRowView;
}
const MultiboardRowView = ({ row }: MultiboardRowProps) => (
  <tr data-multiboard-row={row.id}>
    {row.cells.map(cell => (
      <td className={cell.className} key={cell.id}>
        <span className="multiboard__cell-content">
          {cell.icon !== null && <img alt="" className="multiboard__icon" draggable={false} src={cell.icon} />}
          <span>{cell.text}</span>
        </span>
      </td>
    ))}
  </tr>
);
/** A row renders again only when the engine replaced it (a dirty cell changed its value). */
const MultiboardRow = memo(MultiboardRowView);

interface MultiboardTableProps {
  board: BoardView;
}
const MultiboardTable = ({ board }: MultiboardTableProps) => (
  <table className="multiboard__table" id={board.bodyId}>
    <colgroup>
      {board.columns.map(column => <col key={column.id} style={column.style} />)}
    </colgroup>
    {board.hasHeaders && (
      <thead>
        <tr>
          {board.columns.map(column => (
            <th className={column.className} key={column.id} scope="col">{column.header}</th>
          ))}
        </tr>
      </thead>
    )}
    <tbody>
      {board.rows.map(row => <MultiboardRow key={row.id} row={row} />)}
    </tbody>
  </table>
);

interface MultiboardWindowProps {
  board: BoardView;
  onToggle: (board: BoardView) => void;
}
const MultiboardWindowView = ({ board, onToggle }: MultiboardWindowProps) => (
  <section aria-label={board.title} className={board.className} data-multiboard={board.id}>
    <header className="multiboard__header">
      <h3 className="multiboard__title" title={board.title}>{board.title}</h3>
      <button
        aria-controls={board.bodyId}
        aria-expanded={board.expanded}
        aria-label={board.toggleLabel}
        className="multiboard__toggle"
        title={board.toggleLabel}
        type="button"
        onClick={() => onToggle(board)}
      >
        <SettlementIcon name={board.toggleIcon} />
      </button>
    </header>
    {board.expanded && <MultiboardTable board={board} />}
  </section>
);
/** One compact board window: the author's title on the left, the collapse icon on the right, then the table. */
export const MultiboardWindow = memo(MultiboardWindowView);
