import { ADMIN_PANEL_PARAM, ADMIN_SETTINGS_PANEL } from "./admin-links";
import { startGame } from "./game-boot";
import { showLoadingFailure } from "./loading-screen";

import "./admin-page.css";

/** The administrator page stops before loading any admin chunk or game runtime. */
const denyAdminAccess = () => {
  document.title = "401 Unauthorized — Island of Settlers";
  const viewport = document.getElementById("viewport");
  if (!viewport) return;
  viewport.innerHTML = `<main class="admin-unauthorized">
    <p class="admin-unauthorized__code">401</p>
    <h1>Unauthorized</h1>
    <p>Administration is available only to administrators.</p>
    <p><a href="./">Return to the game</a></p>
  </main>`;
};

/**
 * `?panel=settings` (plan §13.1): the Administration window alone, no game runtime. Its chunk is a dynamic import
 * off this entry; the role check runs inside it before anything is shown, and every admin route checks again.
 */
const startAdministrationWindow = async () => {
  document.getElementById("loading-screen")?.remove();
  document.title = "Island of Settlers — Administration";
  const host = document.createElement("div");
  host.id = "admin-window";
  document.body.append(host);
  const { mountAdminWindow } = await import("./admin/mount-admin-window");
  if (await mountAdminWindow(host)) return;
  host.remove();
  denyAdminAccess();
};

const wantsAdministrationWindow = () =>
  new URLSearchParams(location.search).get(ADMIN_PANEL_PARAM) === ADMIN_SETTINGS_PANEL;

const start = () => {
  if (wantsAdministrationWindow()) return startAdministrationWindow();
  return startGame({
    admin: {
      denied: denyAdminAccess,
      // The loader chunk itself waits for the server-verified role; no admin code is fetched before it.
      load: async () => (await import("./admin-modules")).loadAdminModules()
    }
  });
};

void start().catch(showLoadingFailure);
