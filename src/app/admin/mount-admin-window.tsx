import { mountReactIsland } from "../components/react-island";
import { openAdminSession } from "./admin-session";
import { AdminWindow } from "./admin-window";

/**
 * Opens the Administration window alone in `host` (`admin.html?panel=settings`): the role check first, then the
 * React view. False when the session is not an administrator (the caller shows the 401 page).
 */
export const mountAdminWindow = async (host: HTMLElement) => {
  const ports = await openAdminSession();
  if (!ports) return false;
  mountReactIsland(host, <AdminWindow ports={ports} />);
  return true;
};
