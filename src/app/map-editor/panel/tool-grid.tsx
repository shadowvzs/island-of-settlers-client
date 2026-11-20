import type { ReactNode } from "react";

import type { EditorStore } from "../editor-store";
import { ToolButton } from "./fields";
import type { ToolButtonRow, ToolButtonSpec } from "./helpers";
import { useToolRows } from "./use-editor-store";

const TOOL_CLASS = "map-editor__tool";

interface ToolGridViewProps {
  children?: ReactNode;
  rows: readonly ToolButtonRow[];
  onPick: (row: ToolButtonRow) => void;
}
const ToolGridView = ({ children, rows, onPick }: ToolGridViewProps) => (
  <div className="map-editor__tools">
    {rows.map(row => (
      <ToolButton action={row.action} active={row.active} className={TOOL_CLASS} key={row.key}
        pressed={row.active} onClick={() => onPick(row)} />
    ))}
    {children}
  </div>
);

interface ToolGridProps {
  children?: ReactNode;
  specs: readonly ToolButtonSpec[];
  store: EditorStore;
}
/** A grid of tool buttons (44px icons); picking the active tool again puts it away. */
export const ToolGrid = ({ children, specs, store }: ToolGridProps) => (
  <ToolGridView rows={useToolRows(store, specs)} onPick={row => store.toggleTool(row.kind, row.value)}>
    {children}
  </ToolGridView>
);

export { TOOL_CLASS };
