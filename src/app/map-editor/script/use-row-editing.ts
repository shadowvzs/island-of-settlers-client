import { useState } from "react";

/** A row's inline comment editor: open/close and the committed text (one undo step on blur). */
export const useRowEditing = (onCommit: (text: string) => void) => {
  const [editing, setEditing] = useState(false);
  return {
    editing,
    onEdit: () => setEditing(true),
    onFinish: (text: string) => {
      setEditing(false);
      onCommit(text);
    }
  };
};
