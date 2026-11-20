import { AdminIconButton } from "../admin-icon-button";
import type { UsersPort } from "../admin-ports";
import type { MaintenancePort } from "../maintenance/maintenance-ports";
import { TypedConfirmDialog } from "../typed-confirm-dialog";
import { useUsers } from "./use-users";

interface UsersTabProps {
  maintenance: MaintenancePort | null;
  port: UsersPort;
}
/** Users — placeholder (owner Q8): table of the first accounts with Ban/Unban and the M4 progress reset. */
export const UsersTab = ({ maintenance, port }: UsersTabProps) => {
  const users = useUsers(port, maintenance);
  const { reset } = users;
  return (
    <div className="admin-users">
      <div className="admin-users__bar">
        <span className="admin-settings__note">{users.note}</span>
        <AdminIconButton icon="reload" label={users.reloadLabel} onClick={() => void users.reload()} />
      </div>
      {users.error && <p className="admin-settings__issues" role="alert">{users.error}</p>}
      {reset.status && <p className="admin-settings__saved" role="status">{reset.status}</p>}
      <table className="admin-users__table">
        <thead>
          <tr>
            <th>{users.headers.name}</th>
            <th>{users.headers.role}</th>
            <th>{users.headers.status}</th>
            <th>{users.headers.lastSeen}</th>
            <th aria-hidden="true" />
          </tr>
        </thead>
        <tbody>
          {users.rows.map(row => (
            <tr data-status={row.status} key={row.id}>
              <td>{row.name}</td>
              <td>{row.role}</td>
              <td>{row.status}</td>
              <td>{row.lastSeen}</td>
              <td className="admin-users__actions">
                {row.resettable && (
                  <AdminIconButton disabled={users.resetBlocked} icon="reset" label={row.resetLabel}
                    onClick={row.onReset} />
                )}
                {row.action && row.actionLabel && (
                  <AdminIconButton disabled={row.busy} icon={row.actionIcon} label={row.actionLabel}
                    onClick={() => void users.changeStatus(row.id, row.action!)} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {users.emptyText && <p className="admin-settings__note">{users.emptyText}</p>}
      {reset.request && <TypedConfirmDialog request={reset.request} onCancel={reset.close} onDone={reset.finish} />}
    </div>
  );
};
