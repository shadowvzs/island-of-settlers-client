import type { EditorHistory } from "./editor-history";
import { getHistoryShortcut, isTextEntry } from "./helpers";

/** Undo / redo keys while the editor is open, not while typing in a text field. */
export const bindHistoryShortcuts = (history: EditorHistory, isOpen: () => boolean) => {
  const onKeyDown = (event: KeyboardEvent) => {
    const action = getHistoryShortcut(event);
    if (!action || !isOpen() || isTextEntry(event.target)) return;
    event.preventDefault();
    history[action]();
  };
  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
};
