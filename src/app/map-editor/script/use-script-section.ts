import { useLingui } from "@lingui/react";

import { translateMessage } from "../../../shared/i18n/translate";
import { SCRIPT_MESSAGES as M } from "./messages";
import type { ScriptWindow } from "./script-window";
import { useWorkspaceHeader, useWorkspaceState } from "./use-script-workspace";

/** The Script category's summary (counts), Ready status and opener label. */
export const useScriptSection = (script: ScriptWindow) => {
  const { i18n } = useLingui();
  const state = useWorkspaceState(script.workspace);
  const header = useWorkspaceHeader(script.workspace);
  const { actors, triggers, variables } = state.script;
  const empty = !actors.length && !triggers.length && !variables.length;
  return {
    openLabel: translateMessage(i18n, M.workspace.open),
    ready: header.ready,
    status: header.status,
    summary: empty ? translateMessage(i18n, M.workspace.empty) : translateMessage(i18n, M.workspace.summary,
      { actors: actors.length, triggers: triggers.length, variables: variables.length }),
    onOpen: script.open
  };
};
