import type { MessageDescriptor } from "@lingui/core";
import { useLingui } from "@lingui/react";

import { translateMessage } from "../../../shared/i18n/translate";
import type { UsersPort } from "../admin-ports";
import type { AdminIconName } from "../constants";
import { useConfirmRequest } from "../use-confirm-request";
import {
  BROWSER_TOOLS, RESTORE_DOC, SERVER_TOOLS, TOOL_ICONS, TOOL_INFO, type ToolId, type ToolSpec
} from "./constants";
import { auditRows, expectedConfirmation, type ToolBlock, toolBlock } from "./helpers";
import type {
  AuditEntry, BrowserMaintenancePort, MaintenanceCapabilities, MaintenancePort
} from "./maintenance-ports";
import { MAINTENANCE_MESSAGES as M } from "./messages";
import { useAccountSlots } from "./use-account-slots";
import { useContentRows } from "./use-content-rows";
import { useMaintenanceData } from "./use-maintenance-data";

export interface MaintenancePorts {
  browser: BrowserMaintenancePort;
  /** Null on a standalone build (no server): only the browser tools show. */
  server: MaintenancePort | null;
  /** The account list of M5 (the Users tab's port); null without a server. */
  users: UsersPort | null;
}

export interface ToolRowView {
  blockedReason: string;
  icon: AdminIconName;
  id: ToolId;
  info: string;
  label: string;
  scope: string;
}

type Translate = (descriptor: MessageDescriptor, values?: Record<string, unknown>) => string;

const blockedText = (block: ToolBlock, t: Translate) => {
  if (!block) return "";
  if (block.kind === "placeholder") return t(M.reasons.placeholder);
  return t(M.reasons.flag, { flag: block.flag });
};

const toolRow = (spec: ToolSpec, capabilities: MaintenanceCapabilities | null, t: Translate): ToolRowView => ({
  blockedReason: blockedText(toolBlock(spec, capabilities), t),
  icon: TOOL_ICONS[spec.id],
  id: spec.id,
  info: t(TOOL_INFO[spec.id], { doc: RESTORE_DOC }),
  label: t(M.tools[spec.id]),
  scope: t(M.scope[spec.scope])
});

const flagState = (flag: MaintenanceCapabilities["flags"]["databaseReset"], t: Translate) =>
  flag.enabled ? t(M.status.flagOn) : t(M.status.flagOff, { flag: flag.name });

const statusLine = (capabilities: MaintenanceCapabilities | null, standalone: boolean, t: Translate) => {
  if (standalone) return t(M.status.standalone);
  if (!capabilities) return "";
  return t(M.status.flags, {
    databaseReset: flagState(capabilities.flags.databaseReset, t),
    destructiveActions: flagState(capabilities.flags.destructiveActions, t),
    host: capabilities.confirmHost
  });
};

const auditView = (entries: readonly AuditEntry[], t: Translate) => ({
  emptyText: entries.length ? "" : t(M.audit.empty),
  headers: {
    action: t(M.audit.action), result: t(M.audit.result), target: t(M.audit.target), when: t(M.audit.when),
    who: t(M.audit.who)
  },
  rows: auditRows(entries).map(row => ({ ...row, who: row.who ?? t(M.audit.nobody) }))
});

/** The work of each simple tool; the answer is the status line. */
const toolWork = (ports: MaintenancePorts, t: Translate, done: string) => ({
  M1: async (confirm: string) => { await ports.server?.resetGameData(confirm); return done; },
  M2: async (confirm: string) => { await ports.server?.recreateDatabase(confirm); return done; },
  M3: async () => done,
  M7: async () => t(M.results.cleared, { count: await ports.server?.clearMySaves() ?? 0 }),
  M11: async () => { await ports.browser.clearCaches(); return done; },
  M12: async () => { await ports.browser.resetGames(); return done; },
  M12b: async () => {
    await ports.browser.recreateDatabase();
    window.location.reload();
    return done;
  }
});

const confirmLines = (spec: ToolSpec, t: Translate) => {
  const lines = [t(TOOL_INFO[spec.id], { doc: RESTORE_DOC })];
  if (spec.scope === "browser") lines.push(t(M.confirm.closeTabs));
  return lines;
};

/** The Maintenance tab (plan §13.6): status, the server and browser tool rows, the dialog and the audit reload. */
export const useMaintenance = (ports: MaintenancePorts) => {
  const { i18n } = useLingui();
  const t: Translate = (descriptor, values) => translateMessage(i18n, descriptor, values);
  const { data, reload } = useMaintenanceData(ports.server);
  const confirm = useConfirmRequest();
  const capabilities = data.capabilities;
  const specs = [...(ports.server ? SERVER_TOOLS : []), ...BROWSER_TOOLS];
  const accounts = useAccountSlots({
    capabilities, confirm, server: ports.server, t, users: ports.users, onChanged: reload
  });
  const content = useContentRows({ confirm, data, server: ports.server, t, onChanged: reload });

  const runTool = (id: ToolId) => {
    const spec = specs.find(entry => entry.id === id);
    if (!spec || toolBlock(spec, capabilities)) return;
    const label = t(M.tools[id]);
    const expected = expectedConfirmation(spec, capabilities);
    const work = toolWork(ports, t, t(M.status.done, { tool: label }))[id];
    confirm.open({
      confirmLabel: t(M.confirm.run, { tool: label }), expected, lines: confirmLines(spec, t), option: null,
      run: async () => {
        const status = await work(expected ?? "");
        await reload();
        return status;
      },
      title: label
    });
  };

  return {
    accounts,
    audit: auditView(data.audit, t),
    auditReloadLabel: t(M.audit.reload),
    browserRows: BROWSER_TOOLS.map(spec => toolRow(spec, capabilities, t)),
    confirm,
    content,
    data,
    error: data.error && t(M.status.loadFailed, { error: data.error }),
    hasServer: Boolean(ports.server),
    reload,
    runTool,
    sectionTitles: {
      accounts: t(M.sections.accounts), audit: t(M.sections.audit), browser: t(M.sections.browser),
      content: t(M.sections.content), server: t(M.sections.server)
    },
    serverRows: ports.server ? SERVER_TOOLS.map(spec => toolRow(spec, capabilities, t)) : [],
    status: statusLine(capabilities, !ports.server, t),
    winterLabel: t(M.tools.M10)
  };
};

export type MaintenanceView = ReturnType<typeof useMaintenance>;
