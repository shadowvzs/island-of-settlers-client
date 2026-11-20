import { useLingui } from "@lingui/react";
import { useMemo } from "react";

import { translateMessage } from "../../shared/i18n/translate";
import type { AdminPorts } from "./admin-ports";
import { ADMIN_MESSAGES as M } from "./messages";

/** The window's title and tab labels; the Users tab exists only with a server (no accounts locally). */
export const useAdminWindow = (ports: AdminPorts) => {
  const { i18n } = useLingui();
  const maintenancePorts = useMemo(() => ({
    browser: ports.browserMaintenance, server: ports.maintenance, users: ports.users
  }), [ports]);
  return {
    labels: {
      maintenance: translateMessage(i18n, M.window.tabMaintenance),
      settings: translateMessage(i18n, M.window.tabSettings),
      users: translateMessage(i18n, M.window.tabUsers)
    },
    maintenancePorts,
    tabsLabel: translateMessage(i18n, M.window.tabs),
    title: translateMessage(i18n, M.window.title),
    users: ports.users
  };
};
