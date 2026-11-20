import { useLingui } from "@lingui/react";

import { translateMessage } from "../../../../shared/i18n/translate";
import { QUEST_MESSAGES as M } from "./messages";

/** Fixed texts of the quest form and list in the active locale. */
export const useQuestLabels = () => {
  const { i18n } = useLingui();
  const text = (descriptor: Parameters<typeof translateMessage>[1]) => translateMessage(i18n, descriptor);
  return {
    activation: text(M.activation), activationAction: text(M.activationAction),
    activationAuto: text(M.activationAuto), add: text(M.add), addCondition: text(M.addCondition),
    completedWhen: text(M.completedWhen), counter: text(M.counter), counterHint: text(M.counterHint),
    delete: text(M.delete), empty: text(M.empty), failure: text(M.failure), failureOn: text(M.failureOn),
    group: text(M.group), hidden: text(M.hidden), hiddenNote: text(M.hiddenNote), list: text(M.list),
    none: text(M.none), onActivate: text(M.onActivate), onFailure: text(M.onFailure), onSuccess: text(M.onSuccess),
    optional: text(M.optional), prerequisites: text(M.prerequisites), progress: text(M.progress),
    scriptedNote: text(M.scriptedNote), showProgress: text(M.showProgress), silent: text(M.silentBadge),
    since: text(M.since), sinceActivation: text(M.sinceActivation), sinceMapStart: text(M.sinceMapStart),
    tab: text(M.tab), target: text(M.target), text: text(M.text), title: text(M.title),
    visibility: text(M.visibility), visible: text(M.visible)
  };
};

export type QuestLabels = ReturnType<typeof useQuestLabels>;
