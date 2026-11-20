import { TypedConfirmDialog } from "../typed-confirm-dialog";
import { AccountSlotsGroup } from "./account-slots-group";
import { AuditTable } from "./audit-table";
import { ContentGroup } from "./content-group";
import { ToolGroup } from "./tool-group";
import { type MaintenancePorts, useMaintenance } from "./use-maintenance";

interface MaintenanceTabProps {
  ports: MaintenancePorts;
}
/**
 * Maintenance (plan §13.6, card ADMIN-DEBUG): server data tools (flag-gated, typed confirmations), account slots,
 * published content, this browser's data and the audit log. Standalone builds show only the browser tools.
 */
export const MaintenanceTab = ({ ports }: MaintenanceTabProps) => {
  const view = useMaintenance(ports);
  const { confirm, sectionTitles } = view;
  return (
    <div className="admin-maintenance">
      <p className="admin-settings__note">{view.status}</p>
      {view.error && <p className="admin-settings__issues" role="alert">{view.error}</p>}
      {confirm.status && <p className="admin-settings__saved" role="status">{confirm.status}</p>}
      <div className="admin-settings__columns">
        {view.hasServer && <ToolGroup rows={view.serverRows} title={sectionTitles.server} onRun={view.runTool} />}
        <ToolGroup rows={view.browserRows} title={sectionTitles.browser} onRun={view.runTool} />
        {view.hasServer && <AccountSlotsGroup title={sectionTitles.accounts} view={view.accounts} />}
        {view.hasServer && (
          <ContentGroup title={sectionTitles.content} view={view.content} winterLabel={view.winterLabel} />
        )}
      </div>
      {view.hasServer && (
        <AuditTable reloadLabel={view.auditReloadLabel} title={sectionTitles.audit} view={view.audit}
          onReload={() => void view.reload()} />
      )}
      {confirm.request && (
        <TypedConfirmDialog request={confirm.request} onCancel={confirm.close} onDone={confirm.finish} />
      )}
    </div>
  );
};
