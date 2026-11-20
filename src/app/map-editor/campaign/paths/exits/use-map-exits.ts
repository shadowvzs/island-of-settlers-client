import { useLingui } from "@lingui/react";

import type { CampaignMap } from "../../../../../../../island-of-settlers-shared/src/campaign/campaign-model";
import type { TranslatableText } from "../../../../../../../island-of-settlers-shared/src/campaign/campaign-text";
import { translateMessage } from "../../../../../shared/i18n/translate";
import { resolveEditorText } from "../../../messages";
import type { CampaignEditor } from "../../campaign-editor";
import type { CampaignPathChoice } from "../../campaign-path-actions";
import { displayText } from "../../helpers";
import { useCampaignEditorState } from "../../use-campaign-editor";
import { canAddExit, exitRefusalText, graphOf, hasUnusedPreviousMapLock } from "../helpers";
import { CAMPAIGN_PATH_MESSAGES as PM } from "../messages";
import { exitRows, type SequenceOption, sequenceOptions } from "./helpers";

/** The selected map's exits: names, epilogues, "Leads to" choices, delete (or why not) and the unused lock. */
export const useMapExits = (editor: CampaignEditor, map: CampaignMap) => {
  const { i18n } = useLingui();
  const state = useCampaignEditorState(editor);
  const draft = state.draft!, language = i18n.locale;
  const endLabel = translateMessage(i18n, PM.campaignEnds);
  const sequenceLabel = (option: SequenceOption) => {
    if (option.missing) return translateMessage(i18n, PM.missingSequence, { id: option.value });
    return option.name ?? translateMessage(i18n, PM.mapEpilogue);
  };
  const rows = exitRows(draft, graphOf(draft, state.maps), state.maps, map, language).map(row => {
    const name = row.exit ? displayText(row.exit.name, language, row.id) : "";
    const refusal = row.refusal && exitRefusalText(row.refusal, map, row.id, state.maps, endLabel, language);
    return {
      deleteLabel: translateMessage(i18n, PM.deleteExit, { name }),
      deleteTitle: refusal ? resolveEditorText(i18n, refusal) : translateMessage(i18n, PM.deleteExit, { name }),
      deletable: row.refusal === null,
      id: row.id,
      name: row.exit?.name ?? null,
      sequence: row.exit ? sequenceOptions(map, row.exit.victorySequenceId)
        .map(option => ({ label: sequenceLabel(option), value: option.value })) : null,
      sequenceId: row.exit?.victorySequenceId ?? "",
      targets: row.targets.map(target => ({ ...target, label: target.name ?? endLabel }))
    };
  });
  return {
    addDisabled: !canAddExit(map),
    addLabel: translateMessage(i18n, PM.addExit),
    defaultLabel: translateMessage(i18n, PM.defaultExit),
    epilogueLabel: translateMessage(i18n, PM.epilogue),
    exitNameLabel: translateMessage(i18n, PM.exitName),
    leadsToLabel: translateMessage(i18n, PM.leadsTo),
    lockNote: hasUnusedPreviousMapLock(draft, map) ? translateMessage(i18n, PM.previousLock) : "",
    removeLockLabel: translateMessage(i18n, PM.removePreviousLock),
    rows,
    title: translateMessage(i18n, PM.exits),
    onAdd: () => editor.addExit(map.id),
    onDelete: (exitId: string) => editor.deleteExit(map.id, exitId),
    onNameChange: (exitId: string, name: TranslatableText) => editor.renameExit(map.id, exitId, name),
    onRemoveLock: () => editor.removePreviousMapLock(map.id),
    onSequenceChange: (exitId: string, sequenceId: string) => editor.setExitSequence(map.id, exitId, sequenceId),
    onTargetChange: (choice: Omit<CampaignPathChoice, "from">, leads: boolean) =>
      editor.setExitTarget({ ...choice, from: map.id }, leads)
  };
};
