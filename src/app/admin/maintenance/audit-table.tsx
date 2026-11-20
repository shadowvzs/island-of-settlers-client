import { AdminIconButton } from "../admin-icon-button";
import type { MaintenanceView } from "./use-maintenance";

interface AuditTableProps {
  reloadLabel: string;
  title: string;
  view: MaintenanceView["audit"];
  onReload: () => void;
}
/** The newest administrator actions (success and refusal) from `admin.audit_log`. */
export const AuditTable = ({ reloadLabel, title, view, onReload }: AuditTableProps) => (
  <section className="admin-maintenance__audit">
    <div className="admin-users__bar">
      <h3 className="admin-maintenance__subtitle">{title}</h3>
      <AdminIconButton icon="reload" label={reloadLabel} onClick={onReload} />
    </div>
    <table className="admin-users__table">
      <thead>
        <tr>
          <th>{view.headers.when}</th>
          <th>{view.headers.who}</th>
          <th>{view.headers.action}</th>
          <th>{view.headers.target}</th>
          <th>{view.headers.result}</th>
        </tr>
      </thead>
      <tbody>
        {view.rows.map(row => (
          <tr data-result={row.result} key={row.id}>
            <td>{row.when}</td>
            <td>{row.who}</td>
            <td>{row.action}</td>
            <td>{row.target}</td>
            <td>{row.result}</td>
          </tr>
        ))}
      </tbody>
    </table>
    {view.emptyText && <p className="admin-settings__note">{view.emptyText}</p>}
  </section>
);
