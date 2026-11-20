import { Tabs } from "../components/tabs";
import type { AdminPorts } from "./admin-ports";
import { presentItems } from "./helpers";
import { MaintenanceTab } from "./maintenance/maintenance-tab";
import { GameSettingsTab } from "./settings/game-settings-tab";
import { useAdminWindow } from "./use-admin-window";
import { UsersTab } from "./users/users-tab";

import "./admin-window.css";

interface AdminWindowProps {
  ports: AdminPorts;
}
/** The Administration window (plan §13.1): Game settings, Users (server only) and Maintenance tabs. */
export const AdminWindow = ({ ports }: AdminWindowProps) => {
  const adminWindow = useAdminWindow(ports);
  const { labels, maintenancePorts, users } = adminWindow;
  const items = presentItems([
    { content: <GameSettingsTab ports={ports} />, id: "settings", label: labels.settings },
    users && { content: <UsersTab maintenance={ports.maintenance} port={users} />, id: "users", label: labels.users },
    { content: <MaintenanceTab ports={maintenancePorts} />, id: "maintenance", label: labels.maintenance }
  ]);
  return (
    <main className="admin-window">
      <h1>{adminWindow.title}</h1>
      <Tabs idPrefix="admin-window" items={items} label={adminWindow.tabsLabel} listClassName="admin-window__tabs"
        panelClassName="admin-window__panel" tabClassName="admin-window__tab" />
    </main>
  );
};
