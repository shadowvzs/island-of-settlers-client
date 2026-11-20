import { WORLD_PLAY_PARAM } from "./game-settings/constants";

/**
 * Links to the administrator pages (the map editor, the administrator game page and the Administration window).
 * A module without admin or editor imports: menus that only link to those pages (the title page, Development
 * tools) load no such code with it.
 */

/** `admin.html?panel=settings` opens the Administration window alone (no game runtime; plan §13.1). */
export const ADMIN_PANEL_PARAM = "panel";
export const ADMIN_SETTINGS_PANEL = "settings";

/** The map editor page beside the page at `href` (its own query is dropped). */
export const mapEditorUrl = (href: string) => new URL("editor.html", href).href;

/**
 * The administrator game page starting the authored World01 map fresh: the map editor's Play, which must not
 * continue the saved home island.
 */
export const adminAuthoredMapUrl = (href: string) => {
  const url = new URL("admin.html", href);
  url.searchParams.set(WORLD_PLAY_PARAM, "1");
  return url.href;
};

/** The Administration window (server settings) beside the page at `href`. */
export const adminSettingsUrl = (href: string) =>
  new URL(`admin.html?${ADMIN_PANEL_PARAM}=${ADMIN_SETTINGS_PANEL}`, href).href;
