import type { MessageDescriptor } from "@lingui/core";

import { CACHED_SETTINGS_KEY } from "../../game-settings/constants";
import type { AdminIconName } from "../constants";
import type { MaintenanceCapabilities } from "./maintenance-ports";
import { MAINTENANCE_MESSAGES as M } from "./messages";

/** Boot value of this browser's maintenance log (M11/M12 have no server audit; plan §13.6). */
export const BROWSER_LOG_KEY = "admin-maintenance-log";
/** Boot values a browser data reset (M12) keeps: the local settings source and the maintenance log. */
export const KEPT_BROWSER_VALUES = [CACHED_SETTINGS_KEY, BROWSER_LOG_KEY] as const;
/** Entries kept in the browser log. */
export const BROWSER_LOG_LIMIT = 20;
/** The typed confirmation of the browser data reset (M12). */
export const BROWSER_RESET_WORD = "reset";
/** The typed confirmation of "Clear my cloud saves" (M7). */
export const MY_SAVES_WORD = "my saves";
/** Audit rows the tab shows (the route allows up to 100). */
export const AUDIT_ROWS = 30;
/** Where restores are documented (M3 placeholder). */
export const RESTORE_DOC = "docs/server/ops.md";

/** The simple tools of the tab (M4/M5/M6/M8/M9/M10 have their own rows). */
export type ToolId = "M1" | "M2" | "M3" | "M7" | "M11" | "M12" | "M12b";
export type ToolScope = "both" | "browser" | "online";
export type ServerFlagKey = keyof MaintenanceCapabilities["flags"];

export interface ToolSpec {
  /** The text the administrator types; `host` = the server's host name, null = a plain confirmation. */
  confirm: "host" | typeof BROWSER_RESET_WORD | typeof MY_SAVES_WORD | null;
  flag: ServerFlagKey | null;
  id: ToolId;
  placeholder: boolean;
  scope: ToolScope;
}

/** Server data tools in their display order (plan §13.6). */
export const SERVER_TOOLS: readonly ToolSpec[] = [
  { confirm: "host", flag: "databaseReset", id: "M1", placeholder: false, scope: "online" },
  { confirm: "host", flag: "databaseReset", id: "M2", placeholder: false, scope: "online" },
  { confirm: null, flag: null, id: "M3", placeholder: true, scope: "online" },
  { confirm: MY_SAVES_WORD, flag: null, id: "M7", placeholder: false, scope: "online" }
];

/** Browser tools: shown with and without a server (standalone builds show only these). */
export const BROWSER_TOOLS: readonly ToolSpec[] = [
  { confirm: null, flag: null, id: "M11", placeholder: false, scope: "both" },
  { confirm: BROWSER_RESET_WORD, flag: null, id: "M12", placeholder: false, scope: "browser" },
  { confirm: BROWSER_RESET_WORD, flag: null, id: "M12b", placeholder: false, scope: "browser" }
];

export const TOOL_ICONS: Record<ToolId, AdminIconName> = {
  M1: "reset", M2: "recreate", M3: "restore", M7: "clearSaves", M11: "caches", M12: "reset", M12b: "recreate"
};

export const TOOL_INFO: Record<ToolId, MessageDescriptor> = {
  M1: M.tools.M1Info, M2: M.tools.M2Info, M3: M.tools.M3Info, M7: M.tools.M7Info, M11: M.tools.M11Info,
  M12: M.tools.M12Info, M12b: M.tools.M12bInfo
};
