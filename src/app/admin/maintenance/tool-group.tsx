import { AdminIconButton } from "../admin-icon-button";
import type { ToolId } from "./constants";
import type { ToolRowView } from "./use-maintenance";

interface ToolGroupProps {
  rows: readonly ToolRowView[];
  title: string;
  onRun: (id: ToolId) => void;
}
/** A titled group of maintenance tools: icon button (tooltip = name or why it is disabled), name, scope, info. */
export const ToolGroup = ({ rows, title, onRun }: ToolGroupProps) => (
  <fieldset className="admin-settings__group admin-maintenance__group">
    <legend>{title}</legend>
    {rows.map(row => (
      <div className="admin-maintenance__tool" data-tool={row.id} key={row.id}>
        <AdminIconButton disabled={Boolean(row.blockedReason)} icon={row.icon} label={row.blockedReason || row.label}
          onClick={() => onRun(row.id)} />
        <div className="admin-maintenance__tool-text">
          <span className="admin-maintenance__tool-name">{row.label}</span>
          <span className="admin-maintenance__scope">{row.scope}</span>
          <span className="admin-settings__note">{row.info}</span>
          {row.blockedReason && <span className="admin-maintenance__blocked">{row.blockedReason}</span>}
        </div>
      </div>
    ))}
  </fieldset>
);
