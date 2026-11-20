import { useLingui } from "@lingui/react";

import { translateMessage } from "../../../../../shared/i18n/translate";
import type { CampaignEditor } from "../../campaign-editor";
import { useCampaignEditorState } from "../../use-campaign-editor";
import { graphOf } from "../helpers";
import { CAMPAIGN_PATH_MESSAGES as PM } from "../messages";
import { startMapChoices } from "./helpers";

/** The campaign's start maps, whether its graph is still the linear one, and "Make linear". */
export const useStartMaps = (editor: CampaignEditor) => {
  const { i18n } = useLingui();
  const state = useCampaignEditorState(editor);
  const graph = graphOf(state.draft!, state.maps);
  const linear = !graph.explicit;
  return {
    choices: startMapChoices(graph, state.maps, i18n.locale),
    linearBadge: linear ? translateMessage(i18n, PM.linearBadge) : "",
    linearLabel: translateMessage(i18n, PM.makeLinear),
    note: translateMessage(i18n, linear ? PM.linearNote : PM.startMapsNote),
    title: translateMessage(i18n, PM.startMaps),
    onMakeLinear: editor.makeLinear,
    onStartChange: (mapId: string, start: boolean) => editor.setStartMap(mapId, start)
  };
};
