import { useLingui } from "@lingui/react";
import { useState } from "react";

import { translateMessage } from "../../../shared/i18n/translate";
import { addGroups } from "./add-options";
import { SCRIPT_MESSAGES as M } from "./messages";
import type { ScriptWorkspace } from "./script-workspace";
import type { AddRequest } from "./use-script-dialogs";
import { scriptMapKind } from "./validation";

const TITLES = { action: M.add.actionTitle, condition: M.add.conditionTitle, event: M.add.eventTitle };
const GROUP_LABELS: Readonly<Record<string, typeof M.add.flow>> = {
  ...M.add.groups, flow: M.add.flow, predicates: M.add.predicates, rows: M.add.rows
};

/** The add list's view model: title, search, grouped options (with their lane when later) and the choice. */
export const useAddMenu = (workspace: ScriptWorkspace, request: AddRequest, onClose: () => void) => {
  const { i18n } = useLingui();
  const [query, setQuery] = useState("");
  const mapKind = scriptMapKind(workspace.world);
  return {
    cancelLabel: translateMessage(i18n, M.picker.cancel),
    groups: addGroups(request.kind, mapKind, i18n.locale, query).map(group => ({
      id: group.id, label: translateMessage(i18n, GROUP_LABELS[group.id] ?? M.add.flow),
      options: group.options.map(option => ({ ...option, laterText: option.later
        ? translateMessage(i18n, M.add.later, { lane: option.later }) : "" }))
    })),
    query,
    searchLabel: translateMessage(i18n, M.add.search),
    title: translateMessage(i18n, TITLES[request.kind]),
    onChoose: (key: string) => {
      request.apply(key);
      onClose();
    },
    onClose,
    onQueryChange: setQuery
  };
};
