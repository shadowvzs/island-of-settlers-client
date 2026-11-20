import { useLingui } from "@lingui/react";

import { translateMessage } from "../../../../shared/i18n/translate";
import type { CampaignEditor } from "../campaign-editor";
import { CAMPAIGN_EDITOR_MESSAGES as M } from "../messages";
import { useCampaignEditorState } from "../use-campaign-editor";
import { type CheckJumpTarget, checkSections, checkSummary } from "./helpers";

/** The note under the header: nothing checked yet, or the last check found no problem. */
const checkNote = (checked: boolean, problems: number) => {
  if (!checked) return M.validation.empty;
  return problems ? null : M.validation.passed;
};

/** The Check tab: the last report as counted sections, and the jump of a clicked entry. */
export const useCheckSection = (editor: CampaignEditor) => {
  const { i18n } = useLingui();
  const { busy, draft, maps, report } = useCampaignEditorState(editor);
  const sections = report && draft ? checkSections(report, draft, maps, i18n) : [];
  const note = checkNote(report !== null, sections.length);
  return {
    busy,
    note: note ? translateMessage(i18n, note) : "",
    runLabel: translateMessage(i18n, M.check.run),
    sections,
    summary: report ? checkSummary(report, maps, i18n) : null,
    title: translateMessage(i18n, M.sections.validation),
    onJump: (target: CheckJumpTarget) => {
      if (target.kind === "mapEditor") void editor.openMap(target.mapId, target.script);
      else editor.jumpTo(target);
    }
  };
};
