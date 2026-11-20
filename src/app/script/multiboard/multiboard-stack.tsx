import { MultiboardWindow } from "./multiboard-window";
import { useMultiboards } from "./use-multiboards";

import "./multiboard.css";

/** Every visible board, stacked in the top right corner (plain DOM: the same on every detail level). */
export const MultiboardStack = () => {
  const { boards, label, onToggle } = useMultiboards();
  return (
    <aside aria-label={label} className="multiboard-stack">
      {boards.map(board => <MultiboardWindow board={board} key={board.id} onToggle={onToggle} />)}
    </aside>
  );
};
